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
const NODE_ENV = process.env.NODE_ENV || 'development';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Session memory
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      createdInstances: [],
      chatHistory: [],
      tokenUsage: 0,
      timestamp: Date.now()
    });
  }
  return sessionMemory.get(sessionId);
}

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
  }
  next();
};

const logRequest = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
};

app.use(logRequest);

// SMART SYSTEM PROMPT - Handles chat and code
const SYSTEM_PROMPT = `You are Acidnade AI, a Roblox Studio assistant.

RESPOND IN JSON ONLY.

DETECT REQUEST TYPE:

1. NORMAL CHAT (greetings, questions, help):
{
  "type": "chat",
  "message": "Friendly response here",
  "actions": []
}

2. CODE/CREATION REQUEST (when user wants to build something):
{
  "type": "execution",
  "message": "Brief description of what will be created",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script/Part/TextLabel/etc",
      "properties": {
        "Position": "0,5,0",
        "Size": "5,5,5",
        "Color": "255,0,0"
      },
      "parent": "game.Workspace",
      "content": "-- Lua code here"
    },
    {
      "action": "modify",
      "type": "multiedit",
      "name": "EXACT_NAME",
      "parent": "EXACT_PATH",
      "sourceModifications": {
        "action": "replace lines 5-9",
        "newCode": "-- new code"
      }
    }
  ]
}

DETECTION RULES:
- Chat: hi, hello, how are you, help, what can you do
- Execution: create, make, build, fix, modify, add, remove, change
- If uncertain, treat as execution

ALWAYS:
- Include multiple actions in one response when related
- For complex requests, break into logical steps
- Keep messages brief
- Use exact names/paths from context`;

// Detect if user wants code or just chat
function detectRequestType(userPrompt, context) {
  const lowerPrompt = userPrompt.toLowerCase().trim();
  
  // Chat patterns
  const chatPatterns = [
    /^hi$|^hello$|^hey$|^greetings$/i,
    /how are you/i,
    /what can you do/i,
    /^help$/i,
    /^thanks|thank you/i,
    /^ok$|^okay$/i,
    /^bye$|goodbye/i
  ];
  
  // Code/execution patterns (but NO keywords like "code" required)
  const executionPatterns = [
    /\b(create|make|build|add)\b/i,
    /\b(fix|modify|change|edit|update)\b/i,
    /\b(remove|delete|destroy)\b/i,
    /\b(part|script|gui|ui|model)\b/i,
    /\b(color|size|position)\b/i,
    /\b(health|damage|money|currency)\b/i,
    /\b(system|manager|handler|controller)\b/i,
    /\b(button|text|label|frame)\b/i
  ];
  
  // Check for chat first
  for (const pattern of chatPatterns) {
    if (pattern.test(lowerPrompt)) {
      return 'chat';
    }
  }
  
  // Check for execution patterns
  let executionScore = 0;
  for (const pattern of executionPatterns) {
    const matches = lowerPrompt.match(pattern);
    if (matches) {
      executionScore += matches.length;
    }
  }
  
  // If user mentions specific instances or has context, likely execution
  if (context?.selectedObjects?.length > 0) {
    executionScore += 2;
  }
  
  if (context?.sourceCodes && Object.keys(context.sourceCodes).length > 0) {
    executionScore += 1;
  }
  
  // Check for technical terms (even without keywords)
  const technicalTerms = ['lua', 'function', 'variable', 'module', 'service', 'event'];
  for (const term of technicalTerms) {
    if (lowerPrompt.includes(term)) {
      executionScore += 1;
    }
  }
  
  // Default to execution if score > 0, otherwise chat
  return executionScore > 0 ? 'execution' : 'chat';
}

// Build smart prompt based on request type
function buildPrompt(userPrompt, context, sessionId) {
  const session = initSession(sessionId);
  const requestType = detectRequestType(userPrompt, context);
  
  let prompt = '';
  
  if (requestType === 'chat') {
    // Simple chat prompt
    prompt = `User: ${userPrompt}\n\n`;
    prompt += 'This is a normal conversation. Respond friendly and helpfully.\n';
    
  } else {
    // Execution prompt - include context efficiently
    prompt = `User Request: ${userPrompt}\n\n`;
    
    // Add minimal context
    if (session.createdInstances?.length > 0) {
      prompt += 'Recently created:\n';
      session.createdInstances.slice(-3).forEach(inst => {
        prompt += `- ${inst.name} (${inst.type}) at ${inst.parent}\n`;
      });
      prompt += '\n';
    }
    
    // Add selected objects if any
    if (context?.selectedObjects?.length > 0) {
      prompt += 'Selected objects:\n';
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName}) at ${obj.Path}\n`;
      });
      prompt += '\n';
    }
    
    // Add source code ONLY if mentioned
    if (context?.sourceCodes) {
      const lowerPrompt = userPrompt.toLowerCase();
      const mentionedInstances = [];
      
      // Find instances mentioned in prompt
      Object.keys(context.sourceCodes).forEach(path => {
        const instanceName = path.split('.').pop().toLowerCase();
        if (lowerPrompt.includes(instanceName)) {
          mentionedInstances.push({ path, code: context.sourceCodes[path] });
        }
      });
      
      if (mentionedInstances.length > 0) {
        prompt += 'Relevant source code:\n';
        mentionedInstances.forEach(({ path, code }) => {
          prompt += `--- ${path} ---\n`;
          prompt += code.substring(0, 800) + (code.length > 800 ? '...' : '') + '\n\n';
        });
      }
    }
    
    prompt += 'Instructions:\n';
    prompt += '1. Analyze the full request\n';
    prompt += '2. Return MULTIPLE actions if needed\n';
    prompt += '3. Each action must be complete\n';
    prompt += '4. Use exact names/paths\n';
    prompt += '5. Include all necessary properties\n';
  }
  
  // Add token usage tracking
  session.tokenUsage = (session.tokenUsage || 0) + prompt.length;
  
  return { prompt, requestType };
}

// Process AI request
async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: SYSTEM_PROMPT
    });

    // Build prompt with detection
    const { prompt: aiPrompt, requestType } = buildPrompt(prompt, context, sessionId);
    
    console.log(`[AI] Request type: ${requestType}, Prompt length: ${aiPrompt.length}`);
    
    const startTime = Date.now();
    const result = await model.generateContent(aiPrompt);
    const responseTime = Date.now() - startTime;
    
    const text = result.response.text();
    let aiResponse;
    
    try {
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      aiResponse = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('[AI] Parse error:', parseError.message);
      
      // Fallback based on request type
      if (requestType === 'chat') {
        aiResponse = {
          type: 'chat',
          message: 'Hello! How can I help you with Roblox Studio today?',
          actions: []
        };
      } else {
        aiResponse = {
          type: 'execution',
          message: 'Processing your request...',
          actions: []
        };
      }
    }
    
    // Validate response
    if (!aiResponse.type) {
      aiResponse.type = requestType;
    }
    
    if (!aiResponse.message) {
      aiResponse.message = requestType === 'chat' ? 'Hello!' : 'Processing request';
    }
    
    if (!aiResponse.actions) {
      aiResponse.actions = [];
    }
    
    // Track created instances
    if (aiResponse.type === 'execution' && aiResponse.actions?.length > 0) {
      aiResponse.actions.forEach(action => {
        if (action.action === 'create') {
          session.createdInstances.push({
            name: action.name || 'unknown',
            type: action.classtype || 'unknown',
            parent: action.parent || 'game.Workspace',
            timestamp: new Date().toISOString()
          });
        }
      });
    }
    
    // Update chat history
    session.chatHistory.push({
      user: prompt.substring(0, 100),
      ai: aiResponse.message.substring(0, 100),
      type: aiResponse.type,
      timestamp: new Date().toISOString()
    });
    
    // Keep history small
    session.chatHistory = session.chatHistory.slice(-10);
    session.createdInstances = session.createdInstances.slice(-20);
    
    // Add metadata
    aiResponse.metadata = {
      requestType,
      responseTime,
      tokenUsage: text.length,
      actionsCount: aiResponse.actions?.length || 0,
      sessionId,
      timestamp: new Date().toISOString()
    };
    
    return aiResponse;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: 'I encountered an error. Please try again.',
      actions: [],
      error: true
    };
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '5.0',
    status: 'online',
    features: [
      'Smart request detection',
      'Multiple actions per request',
      'Natural conversation',
      'Code generation without keywords',
      'Low token usage'
    ],
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'prompt and sessionId are required'
      });
    }
    
    console.log(`[AI Request] Session: ${sessionId}, Prompt: "${prompt.substring(0, 80)}..."`);
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
    res.status(500).json({ 
      type: 'chat',
      message: 'Server error occurred. Please try again.',
      actions: [],
      error: true
    });
  }
});

// Session cleanup
setInterval(() => {
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - session.timestamp > twoHours) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] Removed session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('==========================================');
  console.log('ACIDNADE AI v5.0 - SMART DETECTION');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Features:');
  console.log('  • ✅ Smart request detection');
  console.log('  • ✅ Multiple actions per response');
  console.log('  • ✅ Natural chat conversations');
  console.log('  • ✅ Code without keywords');
  console.log('  • ✅ Efficient context usage');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});
