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
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_DIR = path.join(process.cwd(), 'data');

// Ensure data directory exists
(async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('[Init] Failed to create data directory:', error.message);
  }
})();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory sessions for active users
const sessions = new Map();

// System memory
class SystemMemory {
  constructor() {
    this.userMemories = new Map();
    this.codeSnippets = new Map();
    this.systemKnowledge = {
      GameCore: '',
      Gameinitializer: '',
      GooTypes: '',
      ToolConfigs: '',
      otherSystems: {}
    };
    this.loadMemory();
  }

  async loadMemory() {
    try {
      const memoryPath = path.join(DATA_DIR, 'user_memories.json');
      try {
        const data = await fs.readFile(memoryPath, 'utf-8');
        const memories = JSON.parse(data);
        this.userMemories = new Map(Object.entries(memories));
      } catch (error) {}
      
      const codePath = path.join(DATA_DIR, 'code_snippets.json');
      try {
        const data = await fs.readFile(codePath, 'utf-8');
        const snippets = JSON.parse(data);
        this.codeSnippets = new Map(Object.entries(snippets));
      } catch (error) {}
      
      const sysPath = path.join(DATA_DIR, 'system_knowledge.json');
      try {
        const data = await fs.readFile(sysPath, 'utf-8');
        this.systemKnowledge = JSON.parse(data);
      } catch (error) {
        this.systemKnowledge = {
          GameCore: 'User mentioned GameCore system',
          Gameinitializer: 'User mentioned Gameinitializer system',
          GooTypes: 'User mentioned GooTypes system',
          ToolConfigs: 'User mentioned ToolConfigs system',
          otherSystems: {}
        };
        await this.saveSystemKnowledge();
      }
    } catch (error) {
      console.error('[Memory] Load error:', error.message);
    }
  }

  async saveUserMemories() {
    try {
      const memoryPath = path.join(DATA_DIR, 'user_memories.json');
      const obj = Object.fromEntries(this.userMemories);
      await fs.writeFile(memoryPath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[Memory] Save error:', error.message);
    }
  }

  async saveCodeSnippets() {
    try {
      const codePath = path.join(DATA_DIR, 'code_snippets.json');
      const obj = Object.fromEntries(this.codeSnippets);
      await fs.writeFile(codePath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[Memory] Save error:', error.message);
    }
  }

  async saveSystemKnowledge() {
    try {
      const sysPath = path.join(DATA_DIR, 'system_knowledge.json');
      await fs.writeFile(sysPath, JSON.stringify(this.systemKnowledge, null, 2));
    } catch (error) {
      console.error('[Memory] Save error:', error.message);
    }
  }

  getUserMemory(userId) {
    if (!this.userMemories.has(userId)) {
      this.userMemories.set(userId, {
        conversations: [],
        preferences: {},
        lastActive: Date.now(),
        knownSystems: [],
        systemDescriptions: []
      });
    }
    return this.userMemories.get(userId);
  }

  addConversation(userId, userMessage, aiResponse, type = 'chat') {
    const memory = this.getUserMemory(userId);
    memory.conversations.push({
      user: userMessage,
      ai: aiResponse,
      type: type,
      timestamp: Date.now()
    });
    if (memory.conversations.length > 100) {
      memory.conversations = memory.conversations.slice(-100);
    }
    memory.lastActive = Date.now();
    this.saveUserMemories();
  }

  getConversationHistory(userId, maxMessages = 10) {
    const memory = this.getUserMemory(userId);
    return memory.conversations.slice(-maxMessages);
  }

  addSystemDescription(userId, description) {
    const memory = this.getUserMemory(userId);
    memory.systemDescriptions.push({
      description: description,
      timestamp: Date.now()
    });
    if (memory.systemDescriptions.length > 50) {
      memory.systemDescriptions = memory.systemDescriptions.slice(-50);
    }
    this.saveUserMemories();
  }

  getSystemDescriptions(userId) {
    const memory = this.getUserMemory(userId);
    return memory.systemDescriptions.slice(-5);
  }

  addCodeSnippet(userId, snippetName, code) {
    if (!this.codeSnippets.has(userId)) {
      this.codeSnippets.set(userId, {});
    }
    const userSnippets = this.codeSnippets.get(userId);
    userSnippets[snippetName] = {
      code: code,
      timestamp: Date.now(),
      lastUsed: Date.now()
    };
    this.saveCodeSnippets();
  }

  getUserCodeSnippets(userId) {
    return this.codeSnippets.get(userId) || {};
  }

  updateSystemKnowledge(systemName, description) {
    if (this.systemKnowledge.hasOwnProperty(systemName)) {
      this.systemKnowledge[systemName] = description;
    } else {
      this.systemKnowledge.otherSystems[systemName] = description;
    }
    this.saveSystemKnowledge();
  }

  getSystemKnowledge() {
    return this.systemKnowledge;
  }

  addKnownSystem(userId, systemName) {
    const memory = this.getUserMemory(userId);
    if (!memory.knownSystems.includes(systemName)) {
      memory.knownSystems.push(systemName);
      this.saveUserMemories();
    }
  }
}

const systemMemory = new SystemMemory();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// NEW: Advanced system description detection
function isSystemDescription(text) {
  if (!text || text.length < 50) return false;
  
  const systemKeywords = [
    // Roblox specific
    'system', 'attribute', 'module', 'config', 'toolconfig', 'toolconfigs',
    'gamecore', 'gameinitializer', 'gootypes', 'bag system',
    'capacity', 'price', 'display', 'surfacegui', 'textlabel',
    'frame', 'canvasgroup', 'basepart', 'starterbag', 'attachment',
    'serverstorage', 'workspace', 'player', 'stat',
    
    // Programming/Technical
    'function', 'method', 'class', 'object', 'instance',
    'variable', 'constant', 'property', 'event', 'signal',
    'update', 'create', 'modify', 'fix', 'add', 'remove',
    'initialize', 'configure', 'setup', 'implement',
    
    // Architecture
    'architecture', 'design', 'structure', 'component',
    'module', 'package', 'library', 'framework',
    'handler', 'manager', 'controller', 'service',
    'repository', 'factory', 'builder', 'adapter'
  ];
  
  const technicalPatterns = [
    /[A-Z][a-z]+[A-Z][a-zA-Z]+/, // CamelCase
    /\.\w+\(/, // Method calls
    /\w+\.\w+\s*=/, // Property assignments
    /\b(?:if|for|while|function|return|local)\b/, // Lua keywords
    /\b\d+\/\d+\b/, // Ratios like 0/100
    /\w+->\w+/, // Navigation like Display->SurfaceGui
  ];
  
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  let score = 0;
  
  // Check for technical keywords
  const lowerText = text.toLowerCase();
  systemKeywords.forEach(keyword => {
    if (lowerText.includes(keyword.toLowerCase())) {
      score += 2;
    }
  });
  
  // Check for technical patterns
  technicalPatterns.forEach(pattern => {
    if (pattern.test(text)) {
      score += 3;
    }
  });
  
  // Check for multi-line descriptions (systems are usually described in paragraphs)
  if (lines.length >= 3) {
    score += 5;
  }
  
  // Check for system mentions
  if (lowerText.includes('system will work like this') ||
      lowerText.includes('work like this') ||
      lowerText.includes('will work like') ||
      lowerText.includes('inside all') ||
      lowerText.includes('there will be')) {
    score += 10;
  }
  
  // Check for attribute/component lists
  if (text.includes('attribute') || text.includes('component') || text.includes('property')) {
    score += 8;
  }
  
  return score >= 15; // Threshold for system description
}

function isExecutionRequest(text, context) {
  // Priority 1: Context has selected objects
  if (context?.selectedObjects?.length > 0) {
    return true;
  }
  
  // Priority 2: System description detection
  if (isSystemDescription(text)) {
    return true;
  }
  
  // Priority 3: Direct commands
  const executionKeywords = [
    'create', 'make', 'build', 'add', 'remove', 'delete',
    'modify', 'change', 'edit', 'update', 'fix', 'repair',
    'implement', 'script', 'code', 'lua', 'part', 'gui',
    'model', 'animation', 'sound', 'camera', 'light',
    'tool', 'weapon', 'item', 'inventory', 'ui', 'interface',
    'button', 'label', 'frame', 'screen', 'hud'
  ];
  
  const lowerText = text.toLowerCase();
  const hasDirectCommand = executionKeywords.some(keyword => 
    lowerText.includes(keyword.toLowerCase())
  );
  
  if (hasDirectCommand) {
    return true;
  }
  
  // Priority 4: Question words (chat)
  const chatKeywords = [
    'hi', 'hello', 'hey', 'greetings',
    'how are you', 'what\'s up', 'sup',
    'thanks', 'thank you', 'ty', 'thx',
    'yes', 'no', 'maybe', 'ok', 'okay',
    'help', 'what can you do', 'who are you'
  ];
  
  const isChat = chatKeywords.some(keyword => 
    lowerText.startsWith(keyword) || 
    lowerText === keyword ||
    lowerText.includes(` ${keyword} `)
  );
  
  return !isChat;
}

function buildPrompt(userPrompt, context, userId, forceExecution = false) {
  const history = systemMemory.getConversationHistory(userId, 5);
  const userSnippets = systemMemory.getUserCodeSnippets(userId);
  const systemKnowledge = systemMemory.getSystemKnowledge();
  const systemDescriptions = systemMemory.getSystemDescriptions(userId);
  
  const shouldExecute = forceExecution || isExecutionRequest(userPrompt, context);
  
  let prompt = `=== USER REQUEST ANALYSIS ===\n`;
  prompt += `Type: ${shouldExecute ? 'EXECUTION' : 'CHAT'}\n`;
  prompt += `User ID: ${userId}\n\n`;
  
  if (shouldExecute) {
    prompt += `🔧 THIS IS AN EXECUTION REQUEST 🔧\n`;
    prompt += `The user is describing a system or requesting work. You MUST provide actions.\n\n`;
  }
  
  // Previous system descriptions
  if (systemDescriptions.length > 0) {
    prompt += `=== USER'S PREVIOUS SYSTEM DESCRIPTIONS ===\n`;
    systemDescriptions.forEach((desc, i) => {
      prompt += `[Description ${i + 1}]:\n${desc.description}\n\n`;
    });
  }
  
  // Conversation history
  if (history.length > 0) {
    prompt += `=== RECENT CONVERSATION ===\n`;
    history.forEach((conv, i) => {
      prompt += `${conv.type === 'execution' ? '🔧' : '💬'} `;
      prompt += `User: ${conv.user}\n`;
      prompt += `You: ${conv.ai}\n\n`;
    });
  }
  
  // Code snippets
  if (Object.keys(userSnippets).length > 0) {
    prompt += `=== USER'S CODE ===\n`;
    for (const [name, snippet] of Object.entries(userSnippets)) {
      prompt += `[${name}]:\n${snippet.code}\n\n`;
    }
  }
  
  // System knowledge
  prompt += `=== KNOWN SYSTEMS ===\n`;
  for (const [system, description] of Object.entries(systemKnowledge)) {
    if (system === 'otherSystems') continue;
    if (description) {
      prompt += `• ${system}: ${description}\n`;
    }
  }
  
  if (Object.keys(systemKnowledge.otherSystems).length > 0) {
    prompt += `\nOther systems:\n`;
    for (const [system, desc] of Object.entries(systemKnowledge.otherSystems)) {
      prompt += `• ${system}: ${desc}\n`;
    }
  }
  
  // Current request
  prompt += `\n=== CURRENT REQUEST ===\n`;
  prompt += `User: "${userPrompt}"\n\n`;
  
  if (context?.selectedObjects?.length > 0) {
    prompt += `📝 SELECTED OBJECTS:\n`;
    context.selectedObjects.forEach(obj => {
      prompt += `• ${obj.Name} (${obj.ClassName})\n`;
    });
    prompt += '\n';
  }
  
  if (shouldExecute) {
    prompt += `=== EXECUTION INSTRUCTIONS ===\n`;
    prompt += `You MUST create a detailed execution plan with specific actions.\n`;
    prompt += `Analyze the user's system description carefully.\n`;
    prompt += `Break it down into actionable steps.\n`;
    prompt += `If the user describes a complex system, create multiple actions.\n\n`;
    
    prompt += `RESPONSE FORMAT:\n`;
    prompt += `{\n`;
    prompt += `  "type": "execution",\n`;
    prompt += `  "message": "Detailed analysis of what you're creating",\n`;
    prompt += `  "analysis": "Break down of the system components",\n`;
    prompt += `  "actions": [\n`;
    prompt += `    {\n`;
    prompt += `      "action": "create/modify/configure",\n`;
    prompt += `      "name": "ObjectName",\n`;
    prompt += `      "classtype": "Script/Part/ModuleScript/etc",\n`;
    prompt += `      "parent": "game.Workspace/game.ServerStorage",\n`;
    prompt += `      "properties": {},\n`;
    prompt += `      "content": "-- Lua code if applicable"\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n\n`;
    
    prompt += `EXAMPLE FOR BAG SYSTEM:\n`;
    prompt += `{\n`;
    prompt += `  "type": "execution",\n`;
    prompt += `  "message": "Creating a complete bag system with capacity display",\n`;
    prompt += `  "analysis": "System includes: 1) StarterBag attribute, 2) Bag attachment, 3) Display BasePart with GUI, 4) Capacity tracking, 5) Price attributes for tools",\n`;
    prompt += `  "actions": [\n`;
    prompt += `    {\n`;
    prompt += `      "action": "create",\n`;
    prompt += `      "name": "BagSystem",\n`;
    prompt += `      "classtype": "ModuleScript",\n`;
    prompt += `      "parent": "game.ServerScriptService",\n`;
    prompt += `      "content": "-- Bag system module code here"\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n`;
  } else {
    prompt += `=== CHAT INSTRUCTIONS ===\n`;
    prompt += `Be friendly, enthusiastic about Roblox, and reference memory when relevant.\n`;
    prompt += `If the user asks about their systems, show you remember them.\n\n`;
    
    prompt += `RESPONSE FORMAT:\n`;
    prompt += `{\n`;
    prompt += `  "type": "chat",\n`;
    prompt += `  "message": "Your friendly response here"\n`;
    prompt += `}\n`;
  }
  
  prompt += `\n=== CRITICAL RULES ===\n`;
  prompt += `1. NEVER say "Working on your request" or "Processing"\n`;
  prompt += `2. ALWAYS return valid JSON\n`;
  prompt += `3. Be specific and detailed\n`;
  prompt += `4. If it's a system description, provide COMPLETE implementation\n`;
  prompt += `5. Reference user's previous systems when relevant\n`;
  
  return prompt;
}

async function processAIRequest(userPrompt, context, sessionId, userId) {
  try {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        userId: userId,
        history: [],
        timestamp: Date.now()
      });
    }
    
    const session = sessions.get(sessionId);
    session.timestamp = Date.now();
    
    // Check if this is a system description to memorize
    if (isSystemDescription(userPrompt)) {
      console.log(`[AI] Detected system description from user ${userId}`);
      systemMemory.addSystemDescription(userId, userPrompt);
      
      // Extract potential system names
      const systemMatches = userPrompt.match(/\b([A-Z][a-z]+[A-Z][a-zA-Z]+|[A-Z]+[a-z]*\s+[Ss]ystem)\b/g);
      if (systemMatches) {
        systemMatches.forEach(system => {
          const cleanSystem = system.replace(/\s+[Ss]ystem$/, '');
          systemMemory.updateSystemKnowledge(cleanSystem, `User described: ${userPrompt.substring(0, 100)}...`);
          systemMemory.addKnownSystem(userId, cleanSystem);
        });
      }
    }
    
    const shouldExecute = isExecutionRequest(userPrompt, context);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: shouldExecute ? 0.3 : 0.7, // More precise for execution
        maxOutputTokens: 4096, // Increased for complex systems
        responseMimeType: 'application/json',
      },
      systemInstruction: shouldExecute ? 
        `You are Acidnade AI, a Roblox Studio system architect.
        
When users describe systems, you MUST:
1. Analyze their description thoroughly
2. Break it down into actionable components
3. Provide complete implementation steps
4. Include all necessary code and configurations
5. Reference their existing systems when relevant

NEVER give generic responses. ALWAYS provide specific execution plans.`
        :
        `You are Acidnade AI, a friendly Roblox Studio assistant with memory.
        
You remember user's systems and previous conversations.
Be enthusiastic, helpful, and reference memory when relevant.`
    });
    
    const prompt = buildPrompt(userPrompt, context, userId, shouldExecute);
    
    console.log(`[AI] Processing for user ${userId}: ${shouldExecute ? 'EXECUTION' : 'CHAT'} - "${userPrompt.substring(0, 100)}..."`);
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      console.error('[AI] Parse error:', error.message);
      if (shouldExecute) {
        response = {
          type: 'execution',
          message: "I'll create that system for you!",
          analysis: "Detected a complex system description",
          actions: [
            {
              action: "create",
              name: "SystemModule",
              classtype: "ModuleScript",
              parent: "game.ServerScriptService",
              content: "-- System implementation will go here"
            }
          ]
        };
      } else {
        response = {
          type: 'chat',
          message: "Hello! I remember our previous chats. What would you like to work on today?"
        };
      }
    }
    
    // Fix generic responses
    if (response.message && 
        (response.message.toLowerCase().includes('working on') || 
         response.message.toLowerCase().includes('processing') ||
         response.message.toLowerCase().includes('please wait'))) {
      
      if (response.type === 'execution') {
        response.message = "I'll create a complete implementation for that system!";
        if (!response.analysis) {
          response.analysis = "Breaking down the system into components...";
        }
      } else {
        response.message = "Hello! I remember your systems. How can I help you today?";
      }
    }
    
    // Ensure required fields for execution
    if (response.type === 'execution') {
      if (!response.analysis) {
        response.analysis = "System implementation plan";
      }
      if (!response.actions || !Array.isArray(response.actions)) {
        response.actions = [
          {
            action: "create",
            name: "SystemImplementation",
            classtype: "ModuleScript",
            parent: "game.ServerScriptService",
            content: "-- Implementation details will be added here"
          }
        ];
      }
    }
    
    // Store conversation
    systemMemory.addConversation(userId, userPrompt, response.message, response.type);
    
    // Track in session
    session.history.push({
      input: userPrompt,
      response: response.message,
      type: response.type,
      timestamp: Date.now()
    });
    
    session.history = session.history.slice(-10);
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'execution',
      message: "I'll help you implement that system!",
      analysis: "System implementation",
      actions: [
        {
          action: "create",
          name: "ErrorRecoveryModule",
          classtype: "ModuleScript",
          parent: "game.ServerScriptService",
          content: "-- Let me help you build that system"
        }
      ]
    };
  }
}

// Main endpoint
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId, userId = 'anonymous' } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Hi! I need a prompt to help you."
      });
    }
    
    console.log(`[Request] User ${userId}: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
    
    const response = await processAIRequest(prompt, context, sessionId, userId);
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      type: 'execution',
      message: "I'll help you build that system!",
      analysis: "System implementation",
      actions: []
    });
  }
});

// Force execution endpoint
app.post('/ai/execute', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId, userId = 'anonymous' } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ 
        type: 'execution',
        message: "What system would you like me to build?",
        analysis: "Awaiting system description",
        actions: []
      });
    }
    
    // Force execution mode
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, a Roblox Studio system architect.
      
The user is describing a system to implement.
Analyze their description and provide a complete implementation plan.
Break it down into actionable steps with code.
Always return execution type with detailed actions.`
    });
    
    const history = systemMemory.getConversationHistory(userId, 3);
    let historyContext = '';
    
    if (history.length > 0) {
      historyContext = `Previous relevant conversations:\n`;
      history.forEach((conv, i) => {
        if (conv.type === 'execution') {
          historyContext += `[Execution] User: ${conv.user}\n`;
          historyContext += `You: ${conv.ai}\n`;
        }
      });
    }
    
    const systemPrompt = `FORCE EXECUTION MODE
User is describing a system to implement:

${prompt}

${historyContext}

Provide a complete implementation plan with:
1. System analysis
2. Component breakdown
3. Step-by-step actions
4. Necessary code

RESPONSE FORMAT:
{
  "type": "execution",
  "message": "Complete system implementation",
  "analysis": "Detailed breakdown",
  "actions": [ ... ]
}`;
    
    const result = await model.generateContent(systemPrompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      response = {
        type: 'execution',
        message: `Implementing: ${prompt.substring(0, 50)}...`,
        analysis: "System implementation plan",
        actions: [
          {
            action: "create",
            name: "SystemModule",
            classtype: "ModuleScript",
            parent: "game.ServerScriptService",
            content: "-- System implementation"
          }
        ]
      };
    }
    
    // Store as system description
    if (prompt.length > 100) {
      systemMemory.addSystemDescription(userId, prompt);
    }
    
    systemMemory.addConversation(userId, prompt, response.message, 'execution');
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({
      type: 'execution',
      message: "System implementation",
      analysis: "Error occurred",
      actions: []
    });
  }
});

// Memory endpoints
app.get('/ai/memory/:userId', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    const memory = systemMemory.getUserMemory(userId);
    const snippets = systemMemory.getUserCodeSnippets(userId);
    const systemDescriptions = systemMemory.getSystemDescriptions(userId);
    
    res.json({
      userId,
      conversations: memory.conversations.slice(-20),
      systemDescriptions: systemDescriptions,
      knownSystems: memory.knownSystems,
      codeSnippets: snippets,
      lastActive: memory.lastActive
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear memory endpoint
app.delete('/ai/memory/:userId', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    systemMemory.userMemories.delete(userId);
    await systemMemory.saveUserMemories();
    
    res.json({
      success: true,
      message: `Cleared memory for user ${userId}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Acidnade AI - Enhanced System Detection',
    sessions: sessions.size,
    usersInMemory: systemMemory.userMemories.size,
    features: [
      'Advanced system description detection',
      'Memory of user systems',
      'Force execution endpoint',
      'File-based persistence'
    ]
  });
});

// Cleanup
setInterval(() => {
  const hourAgo = Date.now() - 3600000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.timestamp < hourAgo) {
      sessions.delete(sessionId);
    }
  }
}, 300000);

// Auto-save
setInterval(() => {
  systemMemory.saveUserMemories();
  systemMemory.saveCodeSnippets();
  systemMemory.saveSystemKnowledge();
  console.log('[Memory] Auto-saved');
}, 300000);

app.listen(PORT, () => {
  console.log('🚀 ACIDNADE AI - ENHANCED SYSTEM DETECTION');
  console.log(`Port: ${PORT}`);
  console.log('\n✨ NEW FEATURES:');
  console.log('• Advanced system description detection');
  console.log('• Force execution endpoint (/ai/execute)');
  console.log('• System analysis in responses');
  console.log('• No more generic "Hello" for system descriptions');
  console.log('\nReady to handle complex systems!');
});
