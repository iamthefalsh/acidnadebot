import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(process.cwd(), 'data');

await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// ENHANCED MEMORY SYSTEM
// ============================================================================
class EnhancedMemory {
  constructor() {
    this.conversations = new Map();
    this.projectContext = new Map();
    this.templates = new Map();
    this.checkpoints = new Map();
    this.loadAll();
  }

  async loadAll() {
    const files = ['conversations', 'projects', 'templates', 'checkpoints'];
    for (const file of files) {
      try {
        const data = await fs.readFile(path.join(DATA_DIR, `${file}.json`), 'utf-8');
        const parsed = JSON.parse(data);
        this[file === 'projects' ? 'projectContext' : file] = new Map(Object.entries(parsed));
      } catch (error) {}
    }
  }

  async save(type) {
    const map = type === 'projects' ? this.projectContext : this[type];
    await fs.writeFile(
      path.join(DATA_DIR, `${type}.json`),
      JSON.stringify(Object.fromEntries(map), null, 2)
    );
  }

  getProject(userId) {
    if (!this.projectContext.has(userId)) {
      this.projectContext.set(userId, {
        gameType: null,
        systems: [],
        instances: new Map(),
        dependencies: {},
        lastCheckpoint: null,
        currentPlan: null
      });
    }
    return this.projectContext.get(userId);
  }

  addInstance(userId, uid, info) {
    const project = this.getProject(userId);
    project.instances.set(uid, {
      ...info,
      createdAt: Date.now()
    });
    this.save('projects');
  }

  searchInstances(userId, query) {
    const project = this.getProject(userId);
    const results = [];
    
    for (const [uid, instance] of project.instances.entries()) {
      if (instance.name.toLowerCase().includes(query.toLowerCase()) ||
          instance.classtype.toLowerCase().includes(query.toLowerCase())) {
        results.push({ uid, ...instance });
      }
    }
    
    return results;
  }

  createCheckpoint(userId, name) {
    const checkpointId = `cp_${Date.now()}`;
    const project = this.getProject(userId);
    
    this.checkpoints.set(checkpointId, {
      userId,
      name,
      snapshot: JSON.parse(JSON.stringify(project)),
      timestamp: Date.now()
    });
    
    project.lastCheckpoint = checkpointId;
    this.save('checkpoints');
    this.save('projects');
    
    return checkpointId;
  }

  rollback(userId, checkpointId) {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.userId !== userId) {
      throw new Error('Checkpoint not found');
    }
    
    this.projectContext.set(userId, checkpoint.snapshot);
    this.save('projects');
    return checkpoint;
  }

  saveTemplate(userId, name, sourceUIDs, project) {
    const template = {
      name,
      creator: userId,
      instances: [],
      dependencies: [],
      createdAt: Date.now()
    };

    sourceUIDs.forEach(uid => {
      const instance = project.instances.get(uid);
      if (instance) {
        template.instances.push(instance);
      }
    });

    this.templates.set(`${userId}_${name}`, template);
    this.save('templates');
    return template;
  }

  getTemplate(userId, name) {
    return this.templates.get(`${userId}_${name}`);
  }

  addConversation(userId, user, ai, type) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }
    
    const history = this.conversations.get(userId);
    history.push({ user, ai, type, timestamp: Date.now() });
    
    if (history.length > 50) {
      this.conversations.set(userId, history.slice(-50));
    }
    
    this.save('conversations');
  }

  getHistory(userId, limit = 8) {
    return (this.conversations.get(userId) || []).slice(-limit);
  }
}

const memory = new EnhancedMemory();

// ============================================================================
// GAME ARCHETYPE DEFINITIONS
// ============================================================================
const ARCHETYPES = {
  tycoon: {
    name: 'Tycoon',
    systems: ['Plot System', 'Currency System', 'Conveyor System', 'Dropper System', 'Upgrade System', 'Rebirth System'],
    structure: {
      Server: ['PlotManager', 'CurrencyManager', 'DataStore'],
      Client: ['UI', 'Notifications', 'Effects'],
      Shared: ['Config', 'Types']
    }
  },
  simulator: {
    name: 'Simulator',
    systems: ['Click System', 'Pet System', 'Upgrade System', 'Quest System', 'Rebirth System'],
    structure: {
      Server: ['ClickHandler', 'PetManager', 'QuestManager', 'DataStore'],
      Client: ['ClickAnimation', 'PetDisplay', 'QuestUI'],
      Shared: ['Config', 'GameData']
    }
  },
  obby: {
    name: 'Obby',
    systems: ['Checkpoint System', 'Stage System', 'Timer System', 'Leaderboard'],
    structure: {
      Server: ['StageManager', 'CheckpointHandler', 'TimerService'],
      Client: ['StageUI', 'Timer', 'Effects'],
      Shared: ['StageConfig']
    }
  },
  rpg: {
    name: 'RPG',
    systems: ['Combat System', 'Inventory System', 'Quest System', 'NPC System', 'Level System'],
    structure: {
      Server: ['CombatHandler', 'InventoryManager', 'NPCManager', 'QuestManager'],
      Client: ['InventoryUI', 'CombatUI', 'DialogueUI'],
      Shared: ['Items', 'Quests', 'NPCs']
    }
  },
  fps: {
    name: 'FPS',
    systems: ['Weapon System', 'Team System', 'Spawn System', 'Kill Tracking', 'Loadout System'],
    structure: {
      Server: ['WeaponHandler', 'TeamManager', 'KillTracker'],
      Client: ['WeaponClient', 'UI', 'Crosshair', 'Hitmarkers'],
      Shared: ['WeaponStats', 'TeamConfig']
    }
  }
};

// ============================================================================
// CORE AI SYSTEM
// ============================================================================

async function enhancedAI(userMessage, context, userId) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - an advanced Roblox Studio assistant.

CAPABILITIES:
1. Recognize game archetypes (tycoon, simulator, obby, rpg, fps)
2. Search existing instances in the workspace
3. Predict what users need next
4. Reference templates and patterns
5. Understand dependencies between systems
6. Provide auto-complete suggestions
7. Analyze security and performance

RESPONSE TYPES:

CHAT:
{
  "type": "chat",
  "message": "Response",
  "suggestions": ["Optional next steps"]
}

ARCHETYPE DETECTION:
{
  "type": "archetype",
  "detected": "tycoon",
  "message": "I'll create a complete tycoon game structure",
  "systems": ["Plot System", "Currency System", ...],
  "structure": {...}
}

PLAN:
{
  "type": "plan",
  "message": "What I'll build",
  "understanding": "Analysis",
  "references": [{"uid": "UID_123", "name": "ExistingSystem", "why": "Will integrate with this"}],
  "steps": [
    {
      "stepId": "step_1",
      "description": "Brief description",
      "dependencies": [],
      "estimatedComplexity": "simple|medium|complex"
    }
  ]
}

SUGGESTIONS (Auto-complete):
{
  "type": "suggestions",
  "predictions": [
    {
      "action": "Create validation script",
      "confidence": 0.95,
      "reasoning": "You have a button but no backend logic"
    }
  ]
}

SEARCH RESULTS:
{
  "type": "search_results",
  "query": "shop",
  "found": [
    {"uid": "UID_123", "name": "ShopModule", "relevant": "Has buy/sell functions"}
  ]
}

Be intelligent, context-aware, and helpful.`
    });

    const history = memory.getHistory(userId, 8);
    const project = memory.getProject(userId);

    let prompt = `USER: ${userMessage}\n\n`;

    if (history.length > 0) {
      prompt += `HISTORY:\n`;
      history.forEach(conv => {
        prompt += `User: ${conv.user}\nYou: ${conv.ai}\n\n`;
      });
    }

    if (project.gameType) {
      prompt += `PROJECT TYPE: ${project.gameType}\n`;
    }
    
    if (project.systems.length > 0) {
      prompt += `EXISTING SYSTEMS: ${project.systems.join(', ')}\n`;
    }

    prompt += `\nAVAILABLE ARCHETYPES:\n`;
    Object.entries(ARCHETYPES).forEach(([key, arch]) => {
      prompt += `- ${key}: ${arch.name} (${arch.systems.join(', ')})\n`;
    });

    if (context?.selectedObjects?.length > 0) {
      prompt += `\nSELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName}) [${obj.UniqueId}]\n`;
      });
    }

    if (project.instances.size > 0) {
      prompt += `\nYou can search ${project.instances.size} instances in the workspace.\n`;
    }

    prompt += `\nAnalyze and respond intelligently.`;

    const result = await model.generateContent(prompt);
    const response = JSON.parse(result.response.text());

    if (response.type === 'archetype') {
      project.gameType = response.detected;
      project.systems = response.systems;
      memory.save('projects');
    }

    if (response.type === 'plan' && response.steps) {
      project.currentPlan = response;
      memory.save('projects');
    }

    memory.addConversation(userId, userMessage, response.message, response.type);

    return response;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "I encountered an error. Could you try rephrasing?"
    };
  }
}

async function executeStep(stepId, userId, context) {
  try {
    const project = memory.getProject(userId);
    const plan = project.currentPlan;
    
    if (!plan) throw new Error('No active plan');
    
    const step = plan.steps.find(s => s.stepId === stepId);
    if (!step) throw new Error('Step not found');

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `Execute Roblox Studio actions.

RESPONSE:
{
  "type": "execution",
  "stepId": "step_1",
  "message": "Brief update",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "ModuleScript|Script|LocalScript|Part|Frame|etc",
      "parent": "game.Workspace",
      "properties": {
        "Color": [255, 0, 0],
        "Position": "UDim2.new(0, 0, 0, 0)",
        "Size": "UDim2.new(0, 100, 0, 50)",
        "Text": "Hello",
        "Source": "-- Full Lua code (for scripts only)"
      }
    },
    {
      "action": "modify",
      "name": "ExistingName",
      "parent": "game.Workspace",
      "properties": {"Color": [0, 255, 0]},
      "sourceModifications": {
        "action": "replaceAll|append|prepend|insertAfter|insertBefore|replace",
        "target": "-- code to find (for replace/insertAfter/insertBefore)",
        "newCode": "-- New code"
      }
    }
  ]
}

CRITICAL RULES:
- Parent paths must be: "game.Workspace", "game.ServerScriptService", "game.ServerStorage", etc.
- For Script/LocalScript/ModuleScript: put code in properties.Source
- Generate COMPLETE, PRODUCTION-READY Lua code
- Source modifications: use "replaceAll" carefully - it replaces entire script
- Properties must match Roblox property types exactly`
    });

    let prompt = `EXECUTE: ${stepId}\n\n`;
    prompt += `DESCRIPTION: ${step.description}\n\n`;
    prompt += `PLAN CONTEXT:\n${JSON.stringify(plan, null, 2)}\n\n`;
    
    if (context?.selectedObjects) {
      prompt += `SELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} [${obj.UniqueId}]\n`;
      });
    }

    if (project.instances.size > 0) {
      prompt += `\nAVAILABLE INSTANCES:\n`;
      for (const [uid, inst] of project.instances.entries()) {
        prompt += `- ${inst.name} (${inst.classtype})\n`;
      }
    }

    const result = await model.generateContent(prompt);
    const execution = JSON.parse(result.response.text());

    execution.actions?.forEach(action => {
      if (action.action === 'create') {
        const uid = `${action.name}_${Date.now()}`;
        memory.addInstance(userId, uid, {
          name: action.name,
          classtype: action.classtype,
          parent: action.parent
        });
      }
    });

    return execution;

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    throw error;
  }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const auth = (req, res, next) => {
  const key = req.headers['x-acidnade-key'];
  if (!key || key !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Main chat endpoint
app.post('/ai/chat', auth, async (req, res) => {
  try {
    const { message, context, userId = 'anonymous' } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    console.log(`[${userId}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`);

    const response = await enhancedAI(message, context, userId);
    res.json(response);

  } catch (error) {
    console.error('[Chat] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong. Please try again."
    });
  }
});

// COMPATIBILITY: Old /ai endpoint for Roblox plugin
app.post('/ai', auth, async (req, res) => {
  try {
    const { prompt, context, sessionId, userId } = req.body;
    
    const message = prompt || req.body.message;
    const finalUserId = userId || sessionId || 'anonymous';
    
    if (!message) {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    console.log(`[${finalUserId}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`);

    const response = await enhancedAI(message, context, finalUserId);
    res.json(response);

  } catch (error) {
    console.error('[Compatibility] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong.",
      error: true
    });
  }
});

// Execute step
app.post('/ai/execute', auth, async (req, res) => {
  try {
    const { stepId, userId = 'anonymous', context } = req.body;

    if (!stepId) {
      return res.status(400).json({ error: 'stepId required' });
    }

    console.log(`[${userId}] Executing: ${stepId}`);

    const execution = await executeStep(stepId, userId, context);
    res.json(execution);

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Execute entire plan at once
app.post('/ai/execute-all', auth, async (req, res) => {
  try {
    const { userId = 'anonymous', context } = req.body;

    const userCtx = memory.getProject(userId);
    const plan = userCtx.currentPlan;

    if (!plan || plan.type !== 'plan') {
      return res.status(400).json({
        error: 'No active plan found'
      });
    }

    console.log(`[${userId}] Executing all ${plan.steps.length} steps`);

    const executions = [];
    for (const step of plan.steps) {
      try {
        const execution = await executeStep(step.stepId, plan, context, userId);
        executions.push(execution);
      } catch (error) {
        console.error(`[Execute] Failed step ${step.stepId}:`, error.message);
        executions.push({
          type: 'execution',
          stepId: step.stepId,
          error: error.message,
          actions: []
        });
      }
    }

    res.json({
      type: 'batch_execution',
      message: `Executed ${executions.length} steps`,
      executions: executions
    });

  } catch (error) {
    console.error('[ExecuteAll] Error:', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

// Search workspace
app.post('/ai/search', auth, async (req, res) => {
  try {
    const { query, userId = 'anonymous' } = req.body;
    
    const results = memory.searchInstances(userId, query);
    
    res.json({
      type: 'search_results',
      query,
      results,
      count: results.length
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create checkpoint
app.post('/ai/checkpoint', auth, async (req, res) => {
  try {
    const { name, userId = 'anonymous' } = req.body;
    
    const checkpointId = memory.createCheckpoint(userId, name || `Checkpoint ${Date.now()}`);
    
    res.json({
      success: true,
      checkpointId,
      message: 'Checkpoint created'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rollback to checkpoint
app.post('/ai/rollback', auth, async (req, res) => {
  try {
    const { checkpointId, userId = 'anonymous' } = req.body;
    
    const checkpoint = memory.rollback(userId, checkpointId);
    
    res.json({
      success: true,
      restored: checkpoint.name,
      message: 'Rolled back successfully'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Save template
app.post('/ai/template/save', auth, async (req, res) => {
  try {
    const { name, sourceUIDs, userId = 'anonymous' } = req.body;
    
    const project = memory.getProject(userId);
    const template = memory.saveTemplate(userId, name, sourceUIDs, project);
    
    res.json({
      success: true,
      template,
      message: 'Template saved'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Use template
app.post('/ai/template/use', auth, async (req, res) => {
  try {
    const { name, customization, userId = 'anonymous' } = req.body;
    
    const template = memory.getTemplate(userId, name);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const response = await enhancedAI(
      `Use my template "${name}" with customization: ${customization}`,
      { template },
      userId
    );

    res.json(response);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get predictions/suggestions
app.post('/ai/predict', auth, async (req, res) => {
  try {
    const { context, userId = 'anonymous' } = req.body;
    
    const response = await enhancedAI(
      'Based on my recent actions, what should I do next?',
      context,
      userId
    );

    res.json(response);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current plan
app.get('/ai/plan/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const userCtx = memory.getProject(userId);
    
    res.json({
      hasPlan: !!userCtx.currentPlan,
      plan: userCtx.currentPlan || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear plan
app.delete('/ai/plan/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const project = memory.getProject(userId);
    project.currentPlan = null;
    memory.save('projects');
    
    res.json({
      success: true,
      message: 'Plan cleared'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project info
app.get('/ai/project/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const project = memory.getProject(userId);
    
    res.json({
      gameType: project.gameType,
      systems: project.systems,
      instanceCount: project.instances.size,
      lastCheckpoint: project.lastCheckpoint,
      hasPlan: !!project.currentPlan
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversation history
app.get('/ai/history/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const history = memory.getHistory(userId, limit);
    
    res.json({
      userId,
      messages: history,
      count: history.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear history
app.delete('/ai/history/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    memory.conversations.delete(userId);
    const project = memory.getProject(userId);
    project.currentPlan = null;
    await memory.save('conversations');
    await memory.save('projects');
    
    res.json({
      success: true,
      message: `Cleared history for ${userId}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available archetypes
app.get('/ai/archetypes', auth, (req, res) => {
  res.json({
    archetypes: ARCHETYPES
  });
});

// Ping endpoint for connection checks
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.0.0',
    model: 'gemini-3-flash-preview'
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Enhanced Edition',
    version: '3.0.0',
    model: 'gemini-3-flash-preview',
    features: [
      'Game archetype detection',
      'Smart workspace search',
      'Auto-complete predictions',
      'Template system',
      'Checkpoint & rollback',
      'Dependency tracking',
      'Pure AI decisions',
      'Context-aware responses',
      'Roblox plugin compatible'
    ],
    archetypes: Object.keys(ARCHETYPES),
    users: memory.conversations.size
  });
});

// ============================================================================
// STARTUP
// ============================================================================
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ACIDNADE AI - ENHANCED EDITION  🚀       ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n🌐 Port: ${PORT}`);
  console.log('🤖 Model: gemini-3-flash-preview');
  console.log('\n✨ Features:');
  console.log('  • Game Archetype Detection (5 types)');
  console.log('  • Smart Workspace Search');
  console.log('  • Template System');
  console.log('  • Checkpoint & Rollback');
  console.log('  • Auto-complete Predictions');
  console.log('  • Dependency Tracking');
  console.log('  • Pure AI Decisions');
  console.log('  • Roblox Plugin Compatible');
  console.log('\n📡 Endpoints:');
  console.log('  POST /ai - Plugin compatibility');
  console.log('  POST /ai/chat - Main interaction');
  console.log('  POST /ai/execute - Execute step');
  console.log('  POST /ai/search - Search workspace');
  console.log('  POST /ai/checkpoint - Save state');
  console.log('  POST /ai/rollback - Restore state');
  console.log('  POST /ai/template/save - Save template');
  console.log('  POST /ai/template/use - Use template');
  console.log('  POST /ai/predict - Get suggestions');
  console.log('  GET  /ping - Connection check');
  console.log('  GET  /health - System status');
  console.log('\n🎮 Supported Archetypes:');
  Object.entries(ARCHETYPES).forEach(([key, arch]) => {
    console.log(`  • ${arch.name} (${key})`);
  });
  console.log('\n✅ Ready to build amazing games!\n');
});
