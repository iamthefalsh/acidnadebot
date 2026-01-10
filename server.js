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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// ENHANCED MEMORY SYSTEM - IN-MEMORY ONLY (FOR VERCEL)
// ============================================================================
class EnhancedMemory {
  constructor() {
    this.conversations = new Map();
    this.projectContext = new Map();
    this.templates = new Map();
    this.checkpoints = new Map();
    this.memoryBank = new Map();
    this.fileAccess = new Map();
    console.log('[Memory] Using in-memory storage (Vercel compatible)');
  }

  // No file operations for Vercel - all in memory
  async save(type) {
    // Do nothing - Vercel doesn't support persistent file storage
    console.log(`[Memory] Would save ${type} (in-memory only)`);
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
    return true;
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
    return true;
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
    
    return true;
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
    
    return true;
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
// CORE AI SYSTEM - FIXED FOR VERCEL
// ============================================================================

async function enhancedAI(userMessage, context, userId) {
  try {
    const complexity = analyzePromptComplexity(userMessage);
    const project = memory.getProject(userId);
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
      systemInstruction: `CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no code blocks, no explanations outside JSON.

You are Acidnade AI - a Roblox Studio assistant. Your responses must ALWAYS be JSON objects.

ABSOLUTE RULES:
1. Response must be PURE JSON only - no markdown, no \`\`\`json\`\`\`, no code fences
2. Never include markdown headings like ## or #
3. Never show raw Lua code in the message field
4. If you need to provide code, put it in the actions array or as chat suggestions
5. Message field should contain only natural language, not code

VALID RESPONSE FORMATS (JSON only):

1. CHAT RESPONSE:
{
  "type": "chat",
  "message": "Natural language response here. Never put Lua code here."
}

2. CODE EXECUTION RESPONSE:
{
  "type": "execution",
  "message": "I'll create/update the code for you",
  "actions": [
    {
      "action": "create|modify",
      "name": "FileName",
      "classtype": "Script|LocalScript|ModuleScript|Part|Model",
      "parent": "game.ServerScriptService|game.Workspace|etc",
      "properties": {
        "Source": "-- Put Lua code here (for scripts)",
        "Size": "Vector3.new(1, 1, 1)",
        "Position": "Vector3.new(0, 5, 0)"
      }
    }
  ]
}

3. ARCHETYPE DETECTION:
{
  "type": "archetype",
  "detected": "tycoon",
  "message": "I detect this is a tycoon game",
  "systems": ["Plot System", "Currency System"]
}

4. PLAN BREAKDOWN:
{
  "type": "plan",
  "message": "I'll break this into steps",
  "steps": [
    {"stepId": "step_1", "description": "First step"}
  ]
}

IMPORTANT FOR BEE SYSTEM:
- When asked for a bee system, create ACTUAL CODE in the actions array
- Use proper Lua syntax with complete scripts
- Include both server-side (GameCore.lua) and client-side (BeeHandler) code
- Make sure the code is functional and complete

Your response MUST be parseable by JSON.parse(). Start with { and end with }.`
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

    prompt += `\nIMPORTANT: Your response must be PURE JSON only. No markdown, no code blocks.`;
    prompt += `\nIf user asks for code changes, use "type": "execution" with actions array containing the code.`;

    const result = await model.generateContent(prompt);
    
    let responseText = result.response?.text() || '';
    let response = null;
    
    console.log('[AI] Raw response:', responseText.substring(0, 200));
    
    try {
      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response from AI');
      }
      
      responseText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .replace(/^#+\s.*$/gm, '')
        .trim();
      
      const jsonMatch = responseText.match(/^\s*\{[\s\S]*\}\s*$/);
      if (jsonMatch) {
        response = JSON.parse(jsonMatch[0]);
      } else {
        console.warn('[AI] Response is not JSON, converting to chat:', responseText.substring(0, 100));
        response = {
          type: 'chat',
          message: "I need to provide that as code changes. Let me create an execution plan.",
          needsExecution: true,
          rawResponse: responseText.substring(0, 500)
        };
      }
      
      if (!response.type) {
        response.type = 'chat';
      }
      
      // If message contains code but no actions, convert to execution
      if ((response.type === 'chat' || !response.type) && 
          (responseText.includes('local ') || responseText.includes('function ') || responseText.includes('```lua'))) {
        console.log('[AI] Detected code in chat response, converting to execution');
        const codeMatch = responseText.match(/```lua\s*([\s\S]*?)\s*```/);
        if (codeMatch) {
          const code = codeMatch[1];
          response = {
            type: 'execution',
            message: 'I\'ll implement that code for you',
            actions: [{
              action: 'modify',
              name: 'GameCore.lua',
              classtype: 'ModuleScript',
              parent: 'game.ServerScriptService',
              properties: {
                Source: code
              }
            }]
          };
        }
      }
      
    } catch (parseError) {
      console.error('[AI] JSON Parse Error:', parseError.message);
      response = {
        type: 'chat',
        message: "I'll help you with that. Let me create the necessary code changes.",
        rawError: parseError.message,
        rawResponse: responseText.substring(0, 300)
      };
    }

    // Convert any code in message to proper execution
    if (response.message && (response.message.includes('```lua') || response.message.includes('local '))) {
      console.log('[AI] Converting code in message to execution');
      const codeMatch = response.message.match(/```lua\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        const code = codeMatch[1];
        response = {
          type: 'execution',
          message: 'I\'ll implement that code for you',
          actions: [{
            action: 'modify',
            name: 'GameCore.lua',
            classtype: 'ModuleScript',
            parent: 'game.ServerScriptService',
            properties: {
              Source: code
            }
          }]
        };
      }
    }

    if (response.type === 'archetype') {
      project.gameType = response.detected;
      project.systems = response.systems || [];
    }

    if (response.type === 'plan' && response.steps) {
      project.currentPlan = response;
    }

    memory.addConversation(userId, userMessage, response.message || 'Processing request', response.type);

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
      systemInstruction: `CRITICAL: You MUST respond with ONLY valid JSON. No markdown, no code blocks.

You are executing a Roblox Studio step. Your response must be PURE JSON.

RESPONSE FORMAT (JSON only):
{
  "type": "execution",
  "stepId": "${stepId}",
  "message": "Brief natural language update",
  "actions": [
    {
      "action": "create|modify",
      "name": "FileName.lua",
      "classtype": "Script|LocalScript|ModuleScript|Frame|ScreenGui|Part|Model",
      "parent": "game.ServerScriptService|game.Workspace|game.StarterPlayer",
      "properties": {
        "Size": "UDim2.new(0, 100, 0, 50) or Vector3.new(1, 1, 1)",
        "Source": "-- Put COMPLETE Lua code here for scripts",
        "Position": "Vector3.new(0, 5, 0)"
      }
    }
  ]
}

ABSOLUTE RULES:
1. NO markdown in response
2. NO code blocks (\`\`\`)
3. NO explanations outside JSON
4. Put ALL Lua code in the Source property
5. Message field should be natural language only

Your response must start with { and end with }.`
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

    prompt += `\nIMPORTANT: Return PURE JSON only. No markdown.`;

    const result = await model.generateContent(prompt);
    
    let responseText = result.response?.text() || '';
    let execution = null;
    
    console.log('[Execute] Raw response:', responseText.substring(0, 200));
    
    try {
      if (!responseText || responseText.trim() === '') {
        throw new Error('Empty response from AI');
      }
      
      responseText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .replace(/^#+\s.*$/gm, '')
        .trim();
      
      const jsonMatch = responseText.match(/^\s*\{[\s\S]*\}\s*$/);
      if (jsonMatch) {
        execution = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in response');
      }
      
      if (!execution.type) execution.type = 'execution';
      if (!execution.stepId) execution.stepId = stepId;
      if (!execution.actions) execution.actions = [];
      if (!execution.message) execution.message = 'Step executed';
      
    } catch (parseError) {
      console.error('[Execute] JSON Parse Error:', parseError.message);
      throw new Error(`Failed to parse AI response: ${parseError.message}`);
    }

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
// API ENDPOINTS
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

app.get('/ai/archetypes', auth, (req, res) => {
  res.json({ archetypes: ARCHETYPES });
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.1.0-vercel',
    model: 'gemini-3-flash-preview',
    storage: 'in-memory (Vercel compatible)'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Vercel Edition',
    version: '3.1.0-vercel',
    model: 'gemini-3-flash-preview',
    fixes: [
      '✅ Fixed file system errors for Vercel',
      '✅ Using in-memory storage only',
      '✅ No more ENOENT errors',
      '✅ JSON-only responses enforced',
      '✅ Automatic code conversion'
    ],
    memory: {
      conversations: memory.conversations.size,
      projects: memory.projectContext.size,
      users: memory.conversations.size
    }
  });
});

// ============================================================================
// STARTUP
// ============================================================================
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ACIDNADE AI - VERCEL EDITION             ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n🌐 Port: ${PORT}`);
  console.log('🤖 Model: gemini-3-flash-preview');
  console.log('💾 Storage: In-memory (Vercel compatible)');
  console.log('\n📡 Endpoints:');
  console.log('  POST /ai - Main chat endpoint');
  console.log('  POST /ai/chat - Chat with context');
  console.log('  POST /ai/execute - Execute plan steps');
  console.log('  GET  /ping - Connection check');
  console.log('  GET  /health - System status');
  console.log('\n✅ Ready for Bee System implementation!');
  console.log('   Ask: "Can u make a bee system for my @GameCore.lua"\n');
});
