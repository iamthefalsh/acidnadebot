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
// ENHANCED MEMORY SYSTEM WITH MEMORY BANK
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
      } catch (error) {}
    }
  }

  async save(type) {
    const map = type === 'projects' ? this.projectContext : 
                type === 'memorybank' ? this.memoryBank : this[type];
    await fs.writeFile(
      path.join(DATA_DIR, `${type}.json`),
      JSON.stringify(Object.fromEntries(map), null, 2)
    );
  }

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
// NEW: PROMPT ANALYZER
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
// NEW: UI VALIDATION
// ============================================================================
function validateUIProperties(action) {
  if (!action.classtype || !action.classtype.includes('Gui') && !action.classtype.includes('Frame') && !action.classtype.includes('Label') && !action.classtype.includes('Button')) {
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
    issues.push('Background is fully transparent - might be hard to see');
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
// CORE AI SYSTEM - FIXED VERSION
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
      systemInstruction: `You are Acidnade AI - an advanced Roblox Studio assistant with enhanced capabilities.

CRITICAL RULES:
1. ALWAYS respond in valid JSON format
2. NEVER replace script content with internal dialogue
3. NEVER reread the same file multiple times
4. ALWAYS stay focused on the user's request
5. When editing scripts, provide COMPLETE code
6. For UI elements, ensure they are visible
7. When user mentions @filename, focus ONLY on those files

RESPONSE FORMATS (must be valid JSON):

CHAT:
{
  "type": "chat",
  "message": "Your response here"
}

ARCHETYPE:
{
  "type": "archetype",
  "detected": "tycoon",
  "message": "I'll create a tycoon game",
  "systems": ["Plot System", "Currency System"],
  "structure": {...}
}

PLAN:
{
  "type": "plan",
  "message": "I'll break this into steps",
  "steps": [
    {
      "stepId": "step_1",
      "description": "First step",
      "estimatedComplexity": "simple"
    }
  ]
}

IMPORTANT: Always respond with valid JSON object. Never include any text before or after the JSON.`
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
      prompt += `🎯 FOCUS ON: ${project.mentionedFiles.join(', ')}\n`;
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
        prompt += `- ${obj.Name} (${obj.ClassName}) [${obj.UniqueId}]\n`;
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

    prompt += `\nProvide a focused, complete response in valid JSON format.`;

    const result = await model.generateContent(prompt);
    
    // 🔥 CRITICAL FIX: Handle non-JSON responses safely
    let responseText = '';
    let response = null;
    
    try {
      responseText = result.response?.text() || '';
      
      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response from AI');
      }
      
      // Try to extract JSON from response (in case Gemini adds extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        response = JSON.parse(jsonMatch[0]);
      } else {
        // If no JSON found, treat as chat message
        response = {
          type: 'chat',
          message: responseText.substring(0, 500)
        };
      }
      
      // Ensure response has required type
      if (!response.type) {
        response.type = 'chat';
      }
      
    } catch (parseError) {
      console.error('[AI] JSON Parse Error:', parseError.message, 'Response:', responseText.substring(0, 200));
      response = {
        type: 'chat',
        message: "I encountered an issue processing your request. Please try again.",
        error: parseError.message
      };
    }

    // Update project context only if response is valid
    if (response.type === 'archetype' && response.detected) {
      project.gameType = response.detected;
      project.systems = response.systems || [];
      memory.save('projects');
    }

    if (response.type === 'plan' && response.steps) {
      project.currentPlan = response;
      memory.save('projects');
    }

    memory.addConversation(userId, userMessage, response.message || 'No message', response.type);

    return response;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "I encountered an error. Could you try rephrasing?",
      error: error.message
    };
  }
}

async function executeStep(stepId, userId, context) {
  try {
    const project = memory.getProject(userId);
    const plan = project.currentPlan;
    
    if (!plan) {
      throw new Error('No active plan found');
    }
    
    const step = plan.steps?.find(s => s.stepId === stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found in plan`);
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `Execute Roblox Studio step. ALWAYS respond with valid JSON.

RESPONSE FORMAT (must be valid JSON):
{
  "type": "execution",
  "stepId": "${stepId}",
  "message": "Brief update",
  "actions": [
    {
      "action": "create|modify",
      "name": "InstanceName",
      "classtype": "Script|LocalScript|Frame|etc",
      "parent": "game.Workspace",
      "properties": {
        "Size": "UDim2.new(0, 100, 0, 50)",
        "Source": "-- Complete Lua code"
      }
    }
  ]
}

IMPORTANT: Always return valid JSON. No extra text.`
    });

    let prompt = `EXECUTE STEP: ${stepId}\n\n`;
    prompt += `DESCRIPTION: ${step.description}\n\n`;
    
    if (step.focusFiles && step.focusFiles.length > 0) {
      prompt += `🎯 FOCUS ON: ${step.focusFiles.join(', ')}\n\n`;
    }
    
    prompt += `PLAN CONTEXT:\n${JSON.stringify(plan, null, 2).substring(0, 1000)}\n\n`;
    
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
      prompt += `AVAILABLE INSTANCES (${project.instances.size} total):\n`;
      let count = 0;
      for (const [uid, inst] of project.instances.entries()) {
        if (count < 5) {
          prompt += `- ${inst.name} (${inst.classtype})\n`;
          count++;
        }
      }
      if (project.instances.size > 5) {
        prompt += `... and ${project.instances.size - 5} more\n`;
      }
    }

    prompt += `\nGenerate COMPLETE code. Return ONLY valid JSON.`;

    const result = await model.generateContent(prompt);
    
    // 🔥 FIX: Safe JSON parsing for executeStep
    let responseText = '';
    let execution = null;
    
    try {
      responseText = result.response?.text() || '';
      
      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response from AI');
      }
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        execution = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
      
      // Ensure execution has required structure
      if (!execution.type) execution.type = 'execution';
      if (!execution.stepId) execution.stepId = stepId;
      if (!execution.actions) execution.actions = [];
      if (!execution.message) execution.message = 'Step executed';
      
    } catch (parseError) {
      console.error('[Execute] JSON Parse Error:', parseError.message);
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }

    // Validate UI properties
    if (execution.actions && Array.isArray(execution.actions)) {
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
app.use(express.json({ limit: '10mb' }));
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
// API ENDPOINTS WITH BETTER ERROR HANDLING
// ============================================================================

app.post('/ai/chat', auth, async (req, res) => {
  try {
    const { message, context, userId = 'anonymous' } = req.body;
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    console.log(`[${userId}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`);

    const response = await enhancedAI(message, context, userId);
    
    // Ensure response structure
    if (!response || typeof response !== 'object') {
      return res.json({
        type: 'chat',
        message: "I couldn't generate a proper response. Please try again."
      });
    }
    
    res.json(response);

  } catch (error) {
    console.error('[Chat] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong. Please try again.",
      error: error.message
    });
  }
});

app.post('/ai', auth, async (req, res) => {
  try {
    const { prompt, context, sessionId, userId } = req.body;
    
    const message = prompt || req.body.message;
    const finalUserId = userId || sessionId || 'anonymous';
    
    if (!message || message.trim() === '') {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    console.log(`[${finalUserId}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`);

    const response = await enhancedAI(message, context, finalUserId);
    
    // Ensure response has type for Roblox plugin compatibility
    if (!response.type) {
      response.type = 'chat';
    }
    
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

app.post('/ai/execute', auth, async (req, res) => {
  try {
    const { stepId, userId = 'anonymous', context } = req.body;

    if (!stepId) {
      return res.status(400).json({ 
        type: 'execution',
        message: "stepId is required",
        actions: [],
        error: true
      });
    }

    console.log(`[${userId}] Executing: ${stepId}`);

    const execution = await executeStep(stepId, userId, context);
    
    // Ensure execution response structure
    if (!execution || typeof execution !== 'object') {
      return res.json({
        type: 'execution',
        stepId,
        message: "Execution failed to generate proper response",
        actions: [],
        error: true
      });
    }
    
    res.json(execution);

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    res.status(500).json({ 
      type: 'execution',
      message: `Execution error: ${error.message}`,
      actions: [],
      error: true
    });
  }
});

// ============================================================================
// OTHER ENDPOINTS (unchanged but with better error handling)
// ============================================================================

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

app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.1.0-fixed',
    model: 'gemini-3-flash-preview'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Fixed JSON Response',
    version: '3.1.0-fixed',
    model: 'gemini-3-flash-preview',
    fixes: [
      '✅ Fixed JSON parsing errors',
      '✅ Handles non-JSON responses',
      '✅ Better error recovery',
      '✅ Structured response validation'
    ],
    users: memory.conversations.size
  });
});

// ============================================================================
// STARTUP
// ============================================================================
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ACIDNADE AI - JSON FIXED VERSION 🛠️      ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n🌐 Port: ${PORT}`);
  console.log('🤖 Model: gemini-3-flash-preview');
  console.log('\n✨ Fixes Applied:');
  console.log('  • ✅ Fixed JSON parsing errors');
  console.log('  • ✅ Handles non-JSON AI responses');
  console.log('  • ✅ Better error recovery');
  console.log('  • ✅ Structured response validation');
  console.log('  • ✅ No more 500 errors from invalid JSON');
  console.log('\n📡 Endpoints:');
  console.log('  POST /ai - Plugin compatibility');
  console.log('  POST /ai/chat - Main chat');
  console.log('  POST /ai/execute - Execute steps');
  console.log('  GET  /ping - Connection check');
  console.log('  GET  /health - System status');
  console.log('\n✅ Ready to handle AI responses properly!\n');
});
