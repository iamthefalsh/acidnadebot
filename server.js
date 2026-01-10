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

console.log('🚀 Starting Acidnade AI - Lemonade Enhanced');
console.log('🤖 Model: gemini-3-flash-preview');
console.log('📁 Data directory:', DATA_DIR);

// ============================================================================
// ENHANCED MEMORY SYSTEM WITH ALL LEMONADE FEATURES
// ============================================================================
class EnhancedMemory {
  constructor() {
    this.conversations = new Map();
    this.projectContext = new Map();
    this.templates = new Map();
    this.checkpoints = new Map();
    this.memoryBank = new Map();
    this.fileAccess = new Map();
    this.loadAll();
  }

  async loadAll() {
    const files = ['conversations', 'projects', 'templates', 'checkpoints', 'memorybank'];
    for (const file of files) {
      try {
        const data = await fs.readFile(path.join(DATA_DIR, `${file}.json`), 'utf-8');
        const parsed = JSON.parse(data);
        if (file === 'memorybank') {
          this.memoryBank = new Map(Object.entries(parsed));
        } else {
          this[file === 'projects' ? 'projectContext' : file] = new Map(Object.entries(parsed));
        }
      } catch (error) {
        // File doesn't exist yet, will be created on first save
      }
    }
    console.log('[Memory] Loaded from disk');
  }

  async save(type) {
    try {
      const map = type === 'projects' ? this.projectContext : 
                  type === 'memorybank' ? this.memoryBank : this[type];
      await fs.writeFile(
        path.join(DATA_DIR, `${type}.json`),
        JSON.stringify(Object.fromEntries(map), null, 2)
      );
    } catch (error) {
      console.error(`[Memory] Failed to save ${type}:`, error.message);
    }
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
    this.save('memorybank');
  }

  // File Access Tracking (Anti-Loop)
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
        recentEdits: []
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
    
    this.save('projects');
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
// PROMPT ANALYZER - Complex Prompt Breakdown
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
// UI VALIDATION - Prevent Invisible UIs
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
  
  // Check Size
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
// CORE AI SYSTEM WITH ALL LEMONADE IMPROVEMENTS
// ============================================================================

async function enhancedAI(userMessage, context, userId) {
  try {
    const complexity = analyzePromptComplexity(userMessage);
    const project = memory.getProject(userId);
    
    if (complexity.mentionedFiles.length > 0) {
      project.mentionedFiles = complexity.mentionedFiles.map(f => f.substring(1));
      memory.save('projects');
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - an advanced Roblox Studio assistant with Lemonade enhancements.

CRITICAL RULES:
1. NEVER replace script content with internal dialogue or comments about thinking
2. NEVER reread the same file multiple times in one response
3. ALWAYS stay focused on the user's request - don't do unrelated things
4. When editing scripts, provide COMPLETE code, not partial snippets
5. For UI elements, ALWAYS ensure they are visible (proper Size, Position, Visible=true)
6. When user mentions @filename, focus ONLY on those files
7. Don't use investigation tools redundantly - if you just read a file, don't read it again
8. Break complex prompts into clear, sequential steps

ROBLOX-SPECIFIC KNOWLEDGE:
- Use proper Roblox services (Workspace, ServerScriptService, ReplicatedStorage, etc.)
- Scripts: Script (server), LocalScript (client), ModuleScript (shared)
- UI hierarchy: ScreenGui > Frame > TextLabel/TextButton/etc.
- Always parent UI to PlayerGui or StarterGui
- Use proper property types (UDim2 for Size/Position, Color3 for colors)
- Modern Roblox uses task.wait() not wait()

UI CREATION RULES:
- Size must be visible: UDim2.new(0, width, 0, height) where width/height > 0
- Position: UDim2.new(scaleX, offsetX, scaleY, offsetY)
- Always set Visible = true
- Containers (Frame) need BackgroundColor3 or BackgroundTransparency < 1
- Text elements need Text, TextSize, TextColor3

RESPONSE TYPES:

CHAT:
{
  "type": "chat",
  "message": "Response",
  "suggestions": ["Optional next steps"]
}

ARCHETYPE:
{
  "type": "archetype",
  "detected": "tycoon",
  "message": "I'll create a complete tycoon game",
  "systems": ["Plot System", "Currency System", ...],
  "structure": {...}
}

PLAN (for complex prompts):
{
  "type": "plan",
  "message": "I'll break this into steps",
  "understanding": "Clear breakdown",
  "steps": [
    {
      "stepId": "step_1",
      "description": "What this step does",
      "estimatedComplexity": "simple|medium|complex",
      "focusFiles": ["@mentioned files"]
    }
  ],
  "breakdown": "Why breaking into steps"
}

SUGGESTIONS:
{
  "type": "suggestions",
  "predictions": [
    {
      "action": "What to do next",
      "confidence": 0.95,
      "reasoning": "Why this makes sense"
    }
  ]
}

Be intelligent, focused, and produce complete working code.`
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
      prompt += `Don't re-edit these unless explicitly asked.\n\n`;
    }

    if (project.mentionedFiles.length > 0) {
      prompt += `🎯 FOCUS ON THESE FILES: ${project.mentionedFiles.join(', ')}\n`;
      prompt += `User specifically mentioned these files - prioritize them.\n\n`;
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
    
    if (project.systems.length > 0) {
      prompt += `EXISTING SYSTEMS: ${project.systems.join(', ')}\n`;
    }

    prompt += `\nAVAILABLE ARCHETYPES:\n`;
    Object.entries(ARCHETYPES).forEach(([key, arch]) => {
      prompt += `- ${key}: ${arch.name}\n`;
    });

    if (context?.selectedObjects?.length > 0) {
      prompt += `\nSELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName}) [${obj.UniqueId || 'no-id'}]\n`;
      });
    }

    if (project.instances.size > 0) {
      prompt += `\n${project.instances.size} instances in workspace.\n`;
    }

    if (complexity.isComplex) {
      prompt += `\n⚠️ Complex request detected (score: ${complexity.score}).\n`;
      if (complexity.shouldBreakIntoTasks) {
        prompt += `Consider breaking into sequential steps.\n`;
      }
    }

    prompt += `\nProvide focused, complete response. No internal dialogue.`;

    console.log(`[AI] Processing for ${userId}:`, userMessage.substring(0, 60) + '...');

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

    console.log(`[AI] Response type: ${response.type}`);
    return response;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "I encountered an error processing your request. Could you try rephrasing?",
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
      systemInstruction: `Execute Roblox Studio step with complete, production-ready code.

CRITICAL RULES:
1. Generate COMPLETE scripts - no placeholders or partial code
2. Scripts must include ALL necessary code to work
3. For UI, ensure visibility: Size > 0, Position valid, Visible=true
4. Use proper Roblox services and modern APIs (task.wait not wait)
5. Don't include internal thoughts or comments about what to do

RESPONSE FORMAT:
{
  "type": "execution",
  "stepId": "step_1",
  "message": "Brief update",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script|LocalScript|ModuleScript|Part|ScreenGui|Frame|etc",
      "parent": "game.ServerScriptService",
      "properties": {
        "Size": "UDim2.new(0, 200, 0, 100)",
        "Position": "UDim2.new(0.5, -100, 0.5, -50)",
        "BackgroundColor3": [255, 255, 255],
        "Text": "Button",
        "Visible": true,
        "Source": "-- COMPLETE Lua code here (for scripts)"
      }
    },
    {
      "action": "modify",
      "name": "ExistingName",
      "parent": "game.Workspace",
      "properties": {"Color": [0, 255, 0]},
      "sourceModifications": {
        "action": "replaceAll|append|prepend|insertAfter|insertBefore|replace",
        "target": "-- code to find",
        "newCode": "-- New code"
      }
    }
  ],
  "diff": {
    "summary": "What changed",
    "filesModified": ["filename.lua"],
    "linesChanged": 45
  }
}

UI PROPERTIES (must be valid):
- Size: "UDim2.new(0, 100, 0, 50)" not "0, 0, 0, 0"
- Position: "UDim2.new(0, 10, 0, 10)" 
- Color: [255, 0, 0] as RGB array
- Text: string value
- Visible: true (boolean)

PARENT PATHS:
- Scripts: "game.ServerScriptService" or "game.StarterPlayer.StarterPlayerScripts"
- UI: "game.StarterGui" or parent to existing ScreenGui
- Models: "game.Workspace"
- Storage: "game.ServerStorage" or "game.ReplicatedStorage"`
    });

    let prompt = `EXECUTE STEP: ${stepId}\n\n`;
    prompt += `DESCRIPTION: ${step.description}\n\n`;
    
    if (step.focusFiles && step.focusFiles.length > 0) {
      prompt += `🎯 FOCUS ON: ${step.focusFiles.join(', ')}\n\n`;
    }
    
    prompt += `PLAN CONTEXT:\n${JSON.stringify(plan, null, 2)}\n\n`;
    
    if (context?.selectedObjects) {
      prompt += `SELECTED:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName})\n`;
      });
      prompt += '\n';
    }

    if (step.focusFiles) {
      for (const file of step.focusFiles) {
        if (memory.trackFileAccess(userId, file)) {
          prompt += `⚠️ WARNING: ${file} was already accessed multiple times.\n`;
          prompt += `Don't read it again unless absolutely necessary.\n`;
        }
      }
    }

    if (project.instances.size > 0) {
      prompt += `AVAILABLE INSTANCES:\n`;
      let count = 0;
      for (const [uid, inst] of project.instances.entries()) {
        if (count < 10) {
          prompt += `- ${inst.name} (${inst.classtype})\n`;
          count++;
        }
      }
      if (project.instances.size > 10) {
        prompt += `... and ${project.instances.size - 10} more\n`;
      }
    }

    console.log(`[Execute] Step ${stepId} for ${userId}`);

    const result = await model.generateContent(prompt);
    const execution = JSON.parse(result.response.text());

    if (execution.actions) {
      execution.actions.forEach(action => {
        const validation = validateUIProperties(action);
        if (!validation.valid) {
          console.log(`[UI Validation] Fixed issues in ${action.name}:`, validation.issues);
          action.properties = validation.fixedProperties;
          
          if (!execution.warnings) execution.warnings = [];
          execution.warnings.push(`Fixed UI issues in ${action.name}: ${validation.issues.join(', ')}`);
        }
        
        if (action.action === 'create') {
          const uid = `${action.name}_${Date.now()}`;
          memory.addInstance(userId, uid, {
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

    console.log(`[Execute] Completed ${stepId}, actions: ${execution.actions?.length || 0}`);
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
  message: { error: 'Rate limit exceeded. Please try again later.' },
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
      message: "Something went wrong. Please try again.",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
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
    res.status(500).json({ 
      error: error.message,
      type: 'execution',
      actions: []
    });
  }
});

// Execute all steps
app.post('/ai/execute-all', auth, async (req, res) => {
  try {
    const { userId = 'anonymous', context } = req.body;

    const project = memory.getProject(userId);
    const plan = project.currentPlan;

    if (!plan || plan.type !== 'plan') {
      return res.status(400).json({
        error: 'No active plan found'
      });
    }

    console.log(`[${userId}] Executing all ${plan.steps.length} steps`);

    const executions = [];
    for (const step of plan.steps) {
      try {
        const execution = await executeStep(step.stepId, userId, context);
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

// Memory Bank endpoints
app.get('/ai/memory/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const memoryBank = memory.getMemoryBank(userId);
    
    res.json({
      success: true,
      memory: memoryBank
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/memory/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { projectDescription, keyFiles, systemUnderstanding } = req.body;
    
    memory.updateMemoryBank(userId, {
      projectDescription,
      keyFiles,
      systemUnderstanding
    });
    
    res.json({
      success: true,
      message: 'Memory bank updated'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

// Checkpoint management
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

// Template management
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

// Predictions
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

// Project info
app.get('/ai/plan/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const project = memory.getProject(userId);
    
    res.json({
      hasPlan: !!project.currentPlan,
      plan: project.currentPlan || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get('/ai/project/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    const project = memory.getProject(userId);
    
    res.json({
      gameType: project.gameType,
      systems: project.systems,
      instanceCount: project.instances.size,
      lastCheckpoint: project.lastCheckpoint,
      hasPlan: !!project.currentPlan,
      recentEdits: project.recentEdits.slice(-5),
      mentionedFiles: project.mentionedFiles
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.delete('/ai/history/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;
    memory.conversations.delete(userId);
    const project = memory.getProject(userId);
    project.currentPlan = null;
    project.recentEdits = [];
    project.mentionedFiles = [];
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

app.get('/ai/archetypes', auth, (req, res) => {
  res.json({ archetypes: ARCHETYPES });
});

// Status endpoints
app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.1.0',
    model: 'gemini-3-flash-preview'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Lemonade Enhanced',
    version: '3.1.0',
    model: 'gemini-3-flash-preview',
    features: [
      '✅ Gemini 3 Flash (faster, cheaper)',
      '✅ Complex prompt breakdown',
      '✅ File mention support (@filename)',
      '✅ UI validation (no invisible UIs)',
      '✅ Script content preservation',
      '✅ Anti-loop protection',
      '✅ Memory bank system',
      '✅ Diff preview support',
      '✅ Game archetypes',
      '✅ Smart search',
      '✅ Templates',
      '✅ Checkpoints',
      '✅ Roblox plugin compatible'
    ],
    improvements: [
      'No script replacement with dialogue',
      'No redundant file reading',
      'Focused on user requests only',
      'Complete code generation',
      'Valid UI properties enforced'
    ],
    archetypes: Object.keys(ARCHETYPES),
    users: memory.conversations.size,
    uptime: process.uptime()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI API',
    version: '3.1.0',
    model: 'gemini-3-flash-preview',
    status: 'operational',
    endpoints: {
      chat: 'POST /ai/chat',
      execute: 'POST /ai/execute',
      health: 'GET /health',
      ping: 'GET /ping'
    },
    documentation: 'https://github.com/acidnade/ai-docs'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.message);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

// ============================================================================
// STARTUP
// ============================================================================
const server = app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ACIDNADE AI - LEMONADE ENHANCED  🍋      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n🌐 Port: ${PORT}`);
  console.log('🤖 Model: gemini-3-flash-preview (Gemini 3 Flash)');
  console.log(`📁 Data Directory: ${DATA_DIR}`);
  console.log(`🔐 Auth: ${process.env.ACIDNADE_API_KEY ? 'Enabled' : '⚠️  Warning: No API key set!'}`);
  console.log('\n✨ Lemonade-Inspired Features:');
  console.log('  • 🚀 Faster execution (Gemini 3)');
  console.log('  • 💰 Reduced costs per prompt');
  console.log('  • 🎯 Complex prompt breakdown');
  console.log('  • 📎 File mention support (@filename)');
  console.log('  • 🎨 UI validation (no invisible UIs)');
  console.log('  • 🔄 Anti-loop protection');
  console.log('  • 🧠 Memory bank system');
  console.log('  • 📊 Diff preview support');
  console.log('  • ✍️ Complete script generation');
  console.log('  • 🎮 Enhanced Roblox knowledge');
  console.log('\n📡 Endpoints:');
  console.log('  POST /ai - Plugin compatibility');
  console.log('  POST /ai/chat - Main interaction');
  console.log('  POST /ai/execute - Execute step');
  console.log('  GET/POST /ai/memory/:userId - Memory bank');
  console.log('  POST /ai/search - Search workspace');
  console.log('  POST /ai/checkpoint - Save state');
  console.log('  POST /ai/rollback - Restore state');
  console.log('  GET  /ping - Connection check');
  console.log('  GET  /health - System status');
  console.log('\n🎮 Supported Archetypes:');
  Object.entries(ARCHETYPES).forEach(([key, arch]) => {
    console.log(`  • ${arch.name} (${key})`);
  });
  console.log('\n🛡️ Bug Fixes Applied:');
  console.log('  ✅ No script dialogue replacement');
  console.log('  ✅ No redundant file reading');
  console.log('  ✅ No unrelated actions');
  console.log('  ✅ Complete code generation');
  console.log('  ✅ Valid UI enforcement');
  console.log('\n✅ Server ready! Test with: curl http://localhost:' + PORT + '/health\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[Server] SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed all connections');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[Server] SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('[Server] Closed all connections');
    process.exit(0);
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

export default app;
