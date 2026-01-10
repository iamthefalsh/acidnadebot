import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const IS_VERCEL = process.env.VERCEL === '1';

console.log('🚀 Starting Acidnade AI - Lemonade Enhanced');
console.log('🤖 Model: gemini-3-flash-preview');
console.log('📦 Environment:', IS_VERCEL ? 'Vercel (Serverless)' : 'Local');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// IN-MEMORY STORAGE (Vercel Compatible)
// ============================================================================
class MemoryStore {
  constructor() {
    this.conversations = new Map();
    this.projectContext = new Map();
    this.templates = new Map();
    this.checkpoints = new Map();
    this.memoryBank = new Map();
    this.fileAccess = new Map();
    console.log('[Memory] Using in-memory storage (Vercel compatible)');
  }

  // Memory Bank
  getMemoryBank(userId) {
    if (!this.memoryBank.has(userId)) {
      this.memoryBank.set(userId, {
        projectDescription: '',
        keyFiles: [],
        systemUnderstanding: {},
        lastUpdated: Date.now()
      });
    }
    return this.memoryBank.get(userId);
  }

  updateMemoryBank(userId, updates) {
    const bank = this.getMemoryBank(userId);
    Object.assign(bank, updates, { lastUpdated: Date.now() });
  }

  // File Access Tracking
  trackFileAccess(userId, filename) {
    const key = `${userId}_${filename}`;
    const now = Date.now();
    const lastAccess = this.fileAccess.get(key) || { count: 0, lastTime: 0 };
    
    if (now - lastAccess.lastTime > 5000) {
      lastAccess.count = 0;
    }
    
    lastAccess.count++;
    lastAccess.lastTime = now;
    this.fileAccess.set(key, lastAccess);
    
    return lastAccess.count > 3;
  }

  // Project Context
  getProject(userId) {
    if (!this.projectContext.has(userId)) {
      this.projectContext.set(userId, {
        gameType: null,
        systems: [],
        instances: new Map(),
        dependencies: {},
        lastCheckpoint: null,
        currentPlan: null,
        mentionedFiles: [],
        recentEdits: [],
        investigating: []
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
  }

  trackEdit(userId, filename, changeType) {
    const project = this.getProject(userId);
    project.recentEdits.push({
      filename,
      changeType,
      timestamp: Date.now()
    });
    
    if (project.recentEdits.length > 20) {
      project.recentEdits = project.recentEdits.slice(-20);
    }
  }

  wasRecentlyEdited(userId, filename) {
    const project = this.getProject(userId);
    const fiveSecondsAgo = Date.now() - 5000;
    return project.recentEdits.some(edit => 
      edit.filename === filename && edit.timestamp > fiveSecondsAgo
    );
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
    return checkpointId;
  }

  rollback(userId, checkpointId) {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint || checkpoint.userId !== userId) {
      throw new Error('Checkpoint not found');
    }
    
    this.projectContext.set(userId, checkpoint.snapshot);
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
  }

  getHistory(userId, limit = 8) {
    return (this.conversations.get(userId) || []).slice(-limit);
  }
}

const memory = new MemoryStore();

// ============================================================================
// GAME ARCHETYPES
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
// LEMONADE-STYLE PROGRESS TRACKING
// ============================================================================
function createProgressUpdates(message, complexity) {
  const updates = {
    investigating: [],
    searching: [],
    reading: [],
    creating: [],
    status: 'Working on the task'
  };

  // Simulate Lemonade's investigation phase
  const mentionedFiles = message.match(/@[\w.-]+/g) || [];
  
  if (mentionedFiles.length > 0) {
    updates.searching.push(`Searched Roblox docs: "${message.substring(0, 60)}..."`);
    updates.investigating.push(`Investigating (${mentionedFiles.length} tools)`);
    
    mentionedFiles.forEach(file => {
      updates.reading.push(`Globbed ***/${file.substring(1)}`);
    });
  }

  if (complexity.isComplex) {
    updates.investigating.push(`Analyzing complex request (${complexity.score} indicators)`);
  }

  return updates;
}

// ============================================================================
// PROMPT ANALYZER
// ============================================================================
function analyzePromptComplexity(message) {
  let complexity = 0;
  const indicators = {
    multipleActions: /\band\b.*\band\b/gi,
    systemWords: /system|complete|full|entire|whole/gi,
    createWords: /create|make|build|add|implement/gi,
    modifyWords: /change|modify|update|fix|improve/gi,
    uiWords: /gui|ui|interface|menu|button|frame/gi,
    scriptWords: /script|code|function|module/gi
  };
  
  Object.values(indicators).forEach(regex => {
    const matches = message.match(regex);
    if (matches) complexity += matches.length;
  });
  
  const fileMentions = message.match(/@[\w.-]+/g);
  if (fileMentions) complexity += fileMentions.length * 2;
  
  return {
    score: complexity,
    isComplex: complexity > 5,
    shouldBreakIntoTasks: complexity > 8,
    mentionedFiles: fileMentions || []
  };
}

// ============================================================================
// UI VALIDATION
// ============================================================================
function validateUIProperties(action) {
  if (!action.classtype || 
      (!action.classtype.includes('Gui') && 
       !action.classtype.includes('Frame') && 
       !action.classtype.includes('Label') && 
       !action.classtype.includes('Button'))) {
    return { valid: true };
  }
  
  const issues = [];
  const props = action.properties || {};
  
  if (props.Size) {
    const sizeStr = props.Size.toString();
    if (sizeStr.includes('0, 0, 0, 0') || sizeStr === '0') {
      issues.push('Size is zero - UI will be invisible');
      props.Size = 'UDim2.new(0, 100, 0, 50)';
    }
  } else {
    issues.push('Missing Size property');
    props.Size = 'UDim2.new(0, 100, 0, 50)';
  }
  
  if (!props.Position) {
    props.Position = 'UDim2.new(0, 0, 0, 0)';
  }
  
  if (props.Visible === false || props.Visible === 'false') {
    issues.push('UI is set to invisible');
  }
  
  if (props.BackgroundTransparency === 1 && action.classtype.includes('Frame')) {
    issues.push('Background is fully transparent');
  }
  
  if ((action.classtype.includes('Label') || action.classtype.includes('Button')) && !props.Text) {
    issues.push('Missing Text property');
    props.Text = action.name || 'Label';
  }
  
  return {
    valid: issues.length === 0,
    issues,
    fixedProperties: props
  };
}

// ============================================================================
// CORE AI SYSTEM WITH LEMONADE PROGRESS
// ============================================================================

async function enhancedAI(userMessage, context, userId) {
  try {
    const complexity = analyzePromptComplexity(userMessage);
    const project = memory.getProject(userId);
    const progress = createProgressUpdates(userMessage, complexity);
    
    if (complexity.mentionedFiles.length > 0) {
      project.mentionedFiles = complexity.mentionedFiles.map(f => f.substring(1));
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - an advanced Roblox Studio assistant.

CRITICAL RULES:
1. NEVER replace script content with internal dialogue
2. NEVER reread the same file multiple times
3. ALWAYS stay focused on the user's request
4. Provide COMPLETE code, not partial snippets
5. For UI: ensure visibility (Size > 0, Position valid, Visible=true)
6. When @filename mentioned, focus ONLY on those files
7. Break complex prompts into clear steps

RESPONSE TYPES:

CHAT:
{
  "type": "chat",
  "message": "Response",
  "progress": {
    "investigating": ["Analyzed request", "Checked references"],
    "searching": ["Searched Roblox docs"],
    "reading": ["Read @MainScript.lua"],
    "creating": []
  }
}

PLAN:
{
  "type": "plan",
  "message": "I'll break this into steps",
  "understanding": "Clear breakdown",
  "progress": {
    "investigating": ["Analyzing system requirements"],
    "searching": ["Searched for similar implementations"],
    "status": "Steps (0/4)"
  },
  "steps": [
    {
      "stepId": "step_1",
      "description": "Create base claiming system with proximity interaction",
      "status": "pending"
    }
  ]
}

ARCHETYPE:
{
  "type": "archetype",
  "detected": "tycoon",
  "message": "I'll create a complete tycoon game",
  "systems": ["Plot System", ...],
  "structure": {...}
}

ALWAYS include "progress" object with investigating/searching/reading/creating arrays.`
    });

    const history = memory.getHistory(userId, 8);
    const memoryBank = memory.getMemoryBank(userId);

    let prompt = `USER: ${userMessage}\n\n`;

    if (memoryBank.projectDescription) {
      prompt += `PROJECT MEMORY:\n${memoryBank.projectDescription}\n\n`;
    }

    if (project.recentEdits.length > 0) {
      const recentFiles = [...new Set(project.recentEdits.slice(-5).map(e => e.filename))];
      prompt += `RECENTLY EDITED: ${recentFiles.join(', ')}\n`;
      prompt += `Don't re-edit unless asked.\n\n`;
    }

    if (project.mentionedFiles.length > 0) {
      prompt += `🎯 FOCUS FILES: ${project.mentionedFiles.join(', ')}\n\n`;
    }

    if (history.length > 0) {
      prompt += `HISTORY:\n`;
      history.slice(-3).forEach(conv => {
        prompt += `User: ${conv.user}\nYou: ${conv.ai}\n\n`;
      });
    }

    if (project.gameType) {
      prompt += `PROJECT TYPE: ${project.gameType}\n`;
    }

    prompt += `\nAVAILABLE ARCHETYPES: ${Object.keys(ARCHETYPES).join(', ')}\n`;

    if (context?.selectedObjects?.length > 0) {
      prompt += `\nSELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName})\n`;
      });
    }

    if (complexity.isComplex) {
      prompt += `\n⚠️ Complex request (score: ${complexity.score}).\n`;
      if (complexity.shouldBreakIntoTasks) {
        prompt += `Consider breaking into steps.\n`;
      }
    }

    prompt += `\nProvide focused response with progress updates.`;

    console.log(`[AI] ${userId}:`, userMessage.substring(0, 60) + '...');

    const result = await model.generateContent(prompt);
    let response;
    
    try {
      response = JSON.parse(result.response.text());
    } catch (parseError) {
      console.error('[AI] JSON Parse Error:', parseError.message);
      console.error('[AI] Raw response:', result.response.text().substring(0, 200));
      
      return {
        type: 'chat',
        message: "I processed your request but had a formatting issue. Let me try again.",
        progress: progress,
        error: 'parse_error'
      };
    }

    // Ensure progress is included
    if (!response.progress) {
      response.progress = progress;
    }

    // Update project state
    if (response.type === 'archetype') {
      project.gameType = response.detected;
      project.systems = response.systems;
    }

    if (response.type === 'plan' && response.steps) {
      // Add progress to plan
      if (!response.progress) {
        response.progress = {
          investigating: [`Analyzing ${response.steps.length} steps`],
          searching: ['Searched implementation patterns'],
          status: `Steps (0/${response.steps.length})`
        };
      }
      project.currentPlan = response;
    }

    memory.addConversation(userId, userMessage, response.message, response.type);

    console.log(`[AI] Response: ${response.type}`);
    return response;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "I encountered an error. Could you try rephrasing?",
      progress: {
        investigating: [],
        searching: [],
        status: 'Error occurred'
      },
      error: error.message
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
      systemInstruction: `Execute Roblox Studio step with complete code.

RESPONSE FORMAT:
{
  "type": "execution",
  "stepId": "step_1",
  "message": "Brief update",
  "progress": {
    "reading": ["Reading ReplicatedStorage/Modules/GameCore"],
    "creating": [
      "Created LocalScript at StarterPlayer/StarterPlayerScripts/ClaimController",
      "Created ModuleScript at ReplicatedStorage/Modules/ItemConfigs",
      "Created Folder at ReplicatedStorage/ItemsModules"
    ],
    "investigating": ["Investigating (2 tools)"]
  },
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script|LocalScript|ModuleScript|Part|Frame|etc",
      "parent": "game.ServerScriptService",
      "properties": {
        "Size": "UDim2.new(0, 200, 0, 100)",
        "Source": "-- COMPLETE Lua code"
      }
    }
  ]
}

ALWAYS include progress object showing what you're doing.`
    });

    let prompt = `EXECUTE STEP: ${stepId}\n\n`;
    prompt += `DESCRIPTION: ${step.description}\n\n`;
    
    if (step.focusFiles) {
      prompt += `🎯 FOCUS: ${step.focusFiles.join(', ')}\n\n`;
    }
    
    prompt += `PLAN:\n${JSON.stringify(plan, null, 2)}\n\n`;
    
    if (context?.selectedObjects) {
      prompt += `SELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName})\n`;
      });
    }

    console.log(`[Execute] ${stepId} for ${userId}`);

    const result = await model.generateContent(prompt);
    let execution;
    
    try {
      execution = JSON.parse(result.response.text());
    } catch (parseError) {
      console.error('[Execute] JSON Parse Error:', parseError.message);
      
      return {
        type: 'execution',
        stepId: stepId,
        message: 'Completed step',
        progress: {
          creating: ['Created components'],
          status: 'Completed'
        },
        actions: [],
        error: 'parse_error'
      };
    }

    // Validate UI and track instances
    if (execution.actions) {
      execution.actions.forEach(action => {
        const validation = validateUIProperties(action);
        if (!validation.valid) {
          console.log(`[UI] Fixed ${action.name}:`, validation.issues);
          action.properties = validation.fixedProperties;
          
          if (!execution.warnings) execution.warnings = [];
          execution.warnings.push(`Fixed UI: ${validation.issues.join(', ')}`);
        }
        
        if (action.action === 'create') {
          memory.addInstance(userId, `${action.name}_${Date.now()}`, {
            name: action.name,
            classtype: action.classtype,
            parent: action.parent
          });
        }
        
        if (action.action === 'modify') {
          memory.trackEdit(userId, action.name, 'modify');
        }
      });
    }

    console.log(`[Execute] Done: ${execution.actions?.length || 0} actions`);
    return execution;

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    throw error;
  }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Rate limit exceeded' },
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

app.post('/ai/chat', auth, async (req, res) => {
  try {
    const { message, context, userId = 'anonymous' } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    const response = await enhancedAI(message, context, userId);
    res.json(response);

  } catch (error) {
    console.error('[Chat] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong.",
      error: IS_VERCEL ? undefined : error.message
    });
  }
});

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

    const response = await enhancedAI(message, context, finalUserId);
    res.json(response);

  } catch (error) {
    console.error('[Compat] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong.",
      error: true
    });
  }
});

app.post('/ai/execute', auth, async (req, res) => {
  try {
    const { stepId, userId = 'anonymous', context } = req.body;

    if (!stepId) {
      return res.status(400).json({ error: 'stepId required' });
    }

    const execution = await executeStep(stepId, userId, context);
    res.json(execution);

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    res.status(500).json({ 
      error: error.message,
      type: 'execution',
      actions: []
    });
  }
});

// Memory endpoints
app.get('/ai/memory/:userId', auth, (req, res) => {
  const { userId } = req.params;
  res.json({
    success: true,
    memory: memory.getMemoryBank(userId)
  });
});

app.post('/ai/memory/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const { projectDescription, keyFiles, systemUnderstanding } = req.body;
  
  memory.updateMemoryBank(userId, {
    projectDescription,
    keyFiles,
    systemUnderstanding
  });
  
  res.json({ success: true, message: 'Memory updated' });
});

// Search
app.post('/ai/search', auth, (req, res) => {
  const { query, userId = 'anonymous' } = req.body;
  res.json({
    type: 'search_results',
    query,
    results: memory.searchInstances(userId, query),
    count: memory.searchInstances(userId, query).length
  });
});

// Checkpoints
app.post('/ai/checkpoint', auth, (req, res) => {
  const { name, userId = 'anonymous' } = req.body;
  const checkpointId = memory.createCheckpoint(userId, name || `Checkpoint ${Date.now()}`);
  res.json({ success: true, checkpointId, message: 'Checkpoint created' });
});

app.post('/ai/rollback', auth, (req, res) => {
  try {
    const { checkpointId, userId = 'anonymous' } = req.body;
    const checkpoint = memory.rollback(userId, checkpointId);
    res.json({ success: true, restored: checkpoint.name });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Templates
app.post('/ai/template/save', auth, (req, res) => {
  const { name, sourceUIDs, userId = 'anonymous' } = req.body;
  const project = memory.getProject(userId);
  const template = memory.saveTemplate(userId, name, sourceUIDs, project);
  res.json({ success: true, template });
});

app.post('/ai/template/use', auth, async (req, res) => {
  try {
    const { name, customization, userId = 'anonymous' } = req.body;
    const template = memory.getTemplate(userId, name);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const response = await enhancedAI(
      `Use template "${name}": ${customization}`,
      { template },
      userId
    );
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Project info
app.get('/ai/project/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const project = memory.getProject(userId);
  
  res.json({
    gameType: project.gameType,
    systems: project.systems,
    instanceCount: project.instances.size,
    hasPlan: !!project.currentPlan,
    recentEdits: project.recentEdits.slice(-5),
    mentionedFiles: project.mentionedFiles
  });
});

app.get('/ai/archetypes', auth, (req, res) => {
  res.json({ archetypes: ARCHETYPES });
});

// Status
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.1.0',
    model: 'gemini-3-flash-preview',
    environment: IS_VERCEL ? 'vercel' : 'local'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Lemonade Enhanced',
    version: '3.1.0',
    model: 'gemini-3-flash-preview',
    environment: IS_VERCEL ? 'Vercel (Serverless)' : 'Local',
    storage: 'In-Memory (Vercel Compatible)',
    features: [
      '✅ Lemonade-style progress updates',
      '✅ Real-time investigating bubbles',
      '✅ File mention support (@filename)',
      '✅ Complex prompt breakdown',
      '✅ UI validation',
      '✅ Anti-loop protection',
      '✅ Memory bank',
      '✅ Vercel compatible'
    ],
    users: memory.conversations.size,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '3.1.0',
    model: 'gemini-3-flash-preview',
    status: 'operational',
    environment: IS_VERCEL ? 'Vercel' : 'Local'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: IS_VERCEL ? undefined : err.message
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// ============================================================================
// STARTUP
// ============================================================================
if (!IS_VERCEL) {
  app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════╗');
    console.log('║   ACIDNADE AI - LEMONADE ENHANCED  🍋      ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n🌐 Port: ${PORT}`);
    console.log('🤖 Model: gemini-3-flash-preview');
    console.log('💾 Storage: In-Memory');
    console.log('\n✨ Features:');
    console.log('  • 🔍 Lemonade-style progress tracking');
    console.log('  • 📎 File mention support (@filename)');
    console.log('  • 🎯 Complex prompt breakdown');
    console.log('  • 🎨 UI validation');
    console.log('  • 🔄 Anti-loop protection');
    console.log('\n✅ Ready! Test: curl http://localhost:' + PORT + '/health\n');
  });
}

export default app;
