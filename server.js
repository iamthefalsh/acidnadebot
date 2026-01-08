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

// Load system memory from filesystem
class SystemMemory {
  constructor() {
    this.userMemories = new Map();
    this.codeSnippets = new Map(); // Code by user
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
      // Load user memories
      const memoryPath = path.join(DATA_DIR, 'user_memories.json');
      try {
        const data = await fs.readFile(memoryPath, 'utf-8');
        const memories = JSON.parse(data);
        this.userMemories = new Map(Object.entries(memories));
      } catch (error) {
        // File doesn't exist yet
      }

      // Load code snippets
      const codePath = path.join(DATA_DIR, 'code_snippets.json');
      try {
        const data = await fs.readFile(codePath, 'utf-8');
        const snippets = JSON.parse(data);
        this.codeSnippets = new Map(Object.entries(snippets));
      } catch (error) {
        // File doesn't exist yet
      }

      // Load system knowledge
      const sysPath = path.join(DATA_DIR, 'system_knowledge.json');
      try {
        const data = await fs.readFile(sysPath, 'utf-8');
        this.systemKnowledge = JSON.parse(data);
      } catch (error) {
        // Initialize with default systems mentioned
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
      console.error('[Memory] Save user memories error:', error.message);
    }
  }

  async saveCodeSnippets() {
    try {
      const codePath = path.join(DATA_DIR, 'code_snippets.json');
      const obj = Object.fromEntries(this.codeSnippets);
      await fs.writeFile(codePath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[Memory] Save code snippets error:', error.message);
    }
  }

  async saveSystemKnowledge() {
    try {
      const sysPath = path.join(DATA_DIR, 'system_knowledge.json');
      await fs.writeFile(sysPath, JSON.stringify(this.systemKnowledge, null, 2));
    } catch (error) {
      console.error('[Memory] Save system knowledge error:', error.message);
    }
  }

  getUserMemory(userId) {
    if (!this.userMemories.has(userId)) {
      this.userMemories.set(userId, {
        conversations: [],
        preferences: {},
        lastActive: Date.now(),
        knownSystems: []
      });
    }
    return this.userMemories.get(userId);
  }

  addConversation(userId, userMessage, aiResponse) {
    const memory = this.getUserMemory(userId);
    memory.conversations.push({
      user: userMessage,
      ai: aiResponse,
      timestamp: Date.now()
    });
    // Keep last 100 conversations
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

function buildPrompt(userPrompt, context, userId) {
  // Get conversation history
  const history = systemMemory.getConversationHistory(userId, 5);
  
  // Get user's code snippets
  const userSnippets = systemMemory.getUserCodeSnippets(userId);
  
  // Get system knowledge
  const systemKnowledge = systemMemory.getSystemKnowledge();
  
  let prompt = `USER ID: ${userId}\n`;
  
  // Add conversation history
  if (history.length > 0) {
    prompt += `\n=== PREVIOUS CONVERSATION ===\n`;
    history.forEach((conv, i) => {
      prompt += `User: ${conv.user}\n`;
      prompt += `You: ${conv.ai}\n`;
    });
    prompt += `\n`;
  }
  
  // Add user's code knowledge
  if (Object.keys(userSnippets).length > 0) {
    prompt += `=== USER'S CODE SNIPPETS ===\n`;
    for (const [name, snippet] of Object.entries(userSnippets)) {
      prompt += `[${name}]:\n${snippet.code}\n\n`;
    }
  }
  
  // Add system knowledge
  prompt += `=== KNOWN SYSTEMS ===\n`;
  for (const [system, description] of Object.entries(systemKnowledge)) {
    if (system === 'otherSystems') continue;
    if (description) {
      prompt += `${system}: ${description}\n`;
    }
  }
  
  if (Object.keys(systemKnowledge.otherSystems).length > 0) {
    prompt += `\nOther systems:\n`;
    for (const [system, desc] of Object.entries(systemKnowledge.otherSystems)) {
      prompt += `${system}: ${desc}\n`;
    }
  }
  
  // Current user message and context
  prompt += `\n=== CURRENT REQUEST ===\n`;
  prompt += `User message: "${userPrompt}"\n\n`;
  
  if (context?.selectedObjects?.length > 0) {
    prompt += `User has selected in Roblox Studio:\n`;
    context.selectedObjects.forEach(obj => {
      prompt += `- ${obj.Name} (${obj.ClassName})\n`;
    });
    prompt += '\n';
  }
  
  prompt += `\n=== YOUR INSTRUCTIONS ===\n`;
  prompt += `YOU MUST DECIDE: Is this a friendly chat or work request?

LOOK AT THE USER'S MESSAGE:
• If it's a greeting (hi, hello, hey, greetings) → CHAT
• If it's a simple question (how are you, what's up, help) → CHAT  
• If it's a thank you (thanks, thank you, ty) → CHAT
• If it's just talking (yes, no, maybe, okay) → CHAT
• If user wants to CREATE/MODIFY/FIX anything → EXECUTION
• If user mentions scripts, parts, GUI, code → EXECUTION
• If user has selected objects → EXECUTION

IMPORTANT: REMEMBER THE USER'S SYSTEMS!
User mentioned these systems: GameCore, Gameinitializer, GooTypes, ToolConfigs
Refer to these when relevant. Ask about them if user needs help with them.

EXAMPLES:
"hi" → CHAT
"hello there" → CHAT  
"how are you?" → CHAT
"thanks for helping" → CHAT
"ok" → CHAT
"help" → CHAT
"create a red part" → EXECUTION
"make a script" → EXECUTION
"fix the health bar" → EXECUTION
"add button to GUI" → EXECUTION
"player should take damage" → EXECUTION
"tell me about my GameCore system" → CHAT (with memory recall)

RESPONSE FORMATS:

For CHAT (friendly conversation with memory):
{
  "type": "chat",
  "message": "Your friendly response here. Reference previous conversations if relevant!"
}

For EXECUTION (creating/modifying):
{
  "type": "execution",
  "message": "Brief description of what will be created",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script/Part/TextLabel/etc",
      "parent": "game.Workspace",
      "properties": {
        "Position": "0,5,0",
        "Size": "5,5,5"
      },
      "content": "-- Lua code here"
    }
  ]
}

IMPORTANT RULES:
1. NEVER return "Working on your request" or "Processing" - be specific
2. For CHAT: Be friendly, helpful, enthusiastic about Roblox
3. For EXECUTION: Include all necessary actions
4. ALWAYS return valid JSON
5. REFERENCE MEMORY: Mention previous conversations or systems when relevant
6. LEARN: If user teaches you code, remember it for next time`;

  return prompt;
}

async function processAIRequest(userPrompt, context, sessionId, userId) {
  try {
    // Store in session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        userId: userId,
        history: [],
        timestamp: Date.now()
      });
    }
    
    const session = sessions.get(sessionId);
    session.timestamp = Date.now();
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048, // Increased for memory context
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, a friendly Roblox Studio assistant with MEMORY.

You remember:
1. Previous conversations with this user
2. Code snippets the user has shown you
3. User's systems: GameCore, Gameinitializer, GooTypes, ToolConfigs
4. User preferences and patterns

ALWAYS:
1. Return valid JSON
2. Be specific in messages
3. Never say "Working on it" or "Processing"
4. Reference memory when relevant
5. Learn from user's code examples
6. Ask about their systems if they need help

When user shares code, memorize it for future reference.
When user mentions their systems, show you remember them.`
    });

    const prompt = buildPrompt(userPrompt, context, userId);
    
    console.log(`[AI] Processing for user ${userId}: "${userPrompt}"`);
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      console.error('[AI] Parse error:', error.message);
      response = {
        type: 'chat',
        message: "Hello! I'm Acidnade AI, your Roblox Studio assistant! I remember our previous chats. How can I help you today?"
      };
    }
    
    // Fix generic responses
    if (response.message && 
        (response.message.toLowerCase().includes('working on') || 
         response.message.toLowerCase().includes('processing') ||
         response.message.toLowerCase().includes('please wait'))) {
      
      if (response.type === 'chat') {
        response.message = "Hello! I'm Acidnade AI. I remember our previous conversations! How can I help you today?";
      } else {
        response.message = "I'll create that for you right now! Based on what we've worked on before...";
      }
    }
    
    // Ensure required fields
    if (!response.type) response.type = 'execution';
    if (!response.message) {
      response.message = response.type === 'chat' 
        ? "Hi there! I remember our last chat. Ready to build something awesome?"
        : "Creating your request now! Using what I remember from before...";
    }
    if (response.type === 'execution' && !response.actions) {
      response.actions = [];
    }
    
    // Check if user is sharing code to memorize
    const codePatterns = [
      /here('s| is) (my |the )?code/i,
      /memorize (this|that|my) code/i,
      /save (this|that) code/i,
      /remember (this|that) code/i,
      /look at my code/i
    ];
    
    const hasCodePattern = codePatterns.some(pattern => pattern.test(userPrompt));
    
    if (hasCodePattern || userPrompt.includes('code')) {
      // Extract potential code block from response
      const codeMatch = text.match(/```(?:lua)?\n([\s\S]*?)\n```/);
      if (codeMatch) {
        const codeName = `snippet_${Date.now()}`;
        systemMemory.addCodeSnippet(userId, codeName, codeMatch[1]);
        response.message += `\n\n✅ I've memorized this code for future reference!`;
      }
    }
    
    // Check if user is talking about their systems
    const systemNames = ['GameCore', 'Gameinitializer', 'GooTypes', 'ToolConfigs'];
    const mentionedSystem = systemNames.find(sys => 
      userPrompt.toLowerCase().includes(sys.toLowerCase())
    );
    
    if (mentionedSystem) {
      systemMemory.addKnownSystem(userId, mentionedSystem);
      if (!response.message.includes(mentionedSystem)) {
        response.message += `\n\n🔍 I remember you mentioned your ${mentionedSystem} system!`;
      }
    }
    
    // Store conversation in memory
    systemMemory.addConversation(userId, userPrompt, response.message);
    
    // Track in session
    session.history.push({
      input: userPrompt,
      response: response.message,
      type: response.type,
      timestamp: Date.now()
    });
    
    // Keep session history small
    session.history = session.history.slice(-10);
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "Hi! I'm having a little trouble right now. But I remember our previous chats! Try asking me about your systems or code."
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
        message: "Hi! I need a prompt and session ID to help you."
      });
    }
    
    console.log(`[Request] User ${userId}, Session ${sessionId}: "${prompt}"`);
    
    const response = await processAIRequest(prompt, context, sessionId, userId);
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Oops! Something went wrong. But I still remember our previous conversations!"
    });
  }
});

// Chat-only endpoint with memory
app.post('/ai/chat', authenticateRequest, async (req, res) => {
  try {
    const { message, sessionId, userId = 'anonymous' } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Hello! What would you like to chat about? I remember our previous conversations."
      });
    }
    
    // Get conversation history for context
    const history = systemMemory.getConversationHistory(userId, 3);
    let historyContext = '';
    
    if (history.length > 0) {
      historyContext = `\nPrevious conversation:\n`;
      history.forEach((conv, i) => {
        historyContext += `User: ${conv.user}\n`;
        historyContext += `You: ${conv.ai}\n`;
      });
    }
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - a friendly, enthusiastic Roblox Studio assistant WITH MEMORY.

You remember previous conversations with this user.
You know about their systems: GameCore, Gameinitializer, GooTypes, ToolConfigs.
Reference this memory when relevant.

Always be helpful, excited about Roblox, and offer assistance.
Never say "Working on it" or "Processing".
Always return: {"type": "chat", "message": "Your friendly response here"}`
    });
    
    const prompt = `User: ${userId}
${historyContext}
Current message: "${message}"

Respond friendly and helpfully. Reference memory if relevant.
Example responses:
• "Hi again! I remember we talked about ${history.length > 0 ? history[history.length-1].user.substring(0,20)+'...' : 'Roblox'}!"
• "Hello! Based on our last chat, I think you'd like..."
• "Hey there! I remember your GameCore system. Want to work on it?"`;
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      response = {
        type: 'chat',
        message: `Hello! I remember you! You said: "${message}". How can I help you with Roblox Studio today?`
      };
    }
    
    // Store in memory
    systemMemory.addConversation(userId, message, response.message);
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({
      type: 'chat',
      message: "Hello! I remember you! Let's chat about Roblox development!"
    });
  }
});

// Memory management endpoints
app.get('/ai/memory/:userId', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    const memory = systemMemory.getUserMemory(userId);
    const snippets = systemMemory.getUserCodeSnippets(userId);
    
    res.json({
      userId,
      conversations: memory.conversations,
      preferences: memory.preferences,
      knownSystems: memory.knownSystems,
      codeSnippets: snippets,
      lastActive: memory.lastActive
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/memory/code', authenticateRequest, async (req, res) => {
  try {
    const { userId, name, code } = req.body;
    
    if (!userId || !name || !code) {
      return res.status(400).json({ error: 'Missing userId, name, or code' });
    }
    
    systemMemory.addCodeSnippet(userId, name, code);
    
    res.json({
      success: true,
      message: `Code snippet "${name}" saved for user ${userId}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/ai/memory/system', authenticateRequest, async (req, res) => {
  try {
    const { system, description } = req.body;
    
    if (!system) {
      return res.status(400).json({ error: 'Missing system name' });
    }
    
    systemMemory.updateSystemKnowledge(system, description || 'User mentioned this system');
    
    res.json({
      success: true,
      message: `System "${system}" knowledge updated`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Acidnade AI with Memory is running!',
    sessions: sessions.size,
    usersInMemory: systemMemory.userMemories.size,
    codeSnippets: systemMemory.codeSnippets.size
  });
});

// Cleanup old sessions
setInterval(() => {
  const hourAgo = Date.now() - 3600000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.timestamp < hourAgo) {
      sessions.delete(sessionId);
    }
  }
}, 300000);

// Periodic memory save
setInterval(() => {
  systemMemory.saveUserMemories();
  systemMemory.saveCodeSnippets();
  systemMemory.saveSystemKnowledge();
  console.log('[Memory] Auto-saved all memory data');
}, 300000); // Every 5 minutes

app.listen(PORT, () => {
  console.log('🧠 ACIDNADE AI - WITH MEMORY');
  console.log(`Port: ${PORT}`);
  console.log('Memory Features:');
  console.log('  • Remembers conversations per user');
  console.log('  • Memorizes code snippets');
  console.log('  • Knows your systems: GameCore, Gameinitializer, GooTypes, ToolConfigs');
  console.log('  • Saves everything to filesystem');
  console.log('  • References previous chats');
  console.log('Ready to remember and help!');
});
