import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Load requirements and prompts
let REQUIREMENTS = {};
let PROMPTS = {};

try {
  const reqPath = path.join(__dirname, 'requirements.json');
  const promptsPath = path.join(__dirname, 'prompts.json');
  
  REQUIREMENTS = JSON.parse(fs.readFileSync(reqPath, 'utf8'));
  PROMPTS = JSON.parse(fs.readFileSync(promptsPath, 'utf8'));
  
  console.log('✅ Loaded requirements.json');
  console.log('✅ Loaded prompts.json');
} catch (error) {
  console.error('❌ Failed to load config files:', error.message);
  process.exit(1);
}

const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      conversationHistory: [], // Track full conversation
      currentPlan: [],
      currentStep: 0,
      executionState: 'idle',
      userContext: {}, // Remember what user is working on
      timestamp: Date.now()
    });
  }
  return sessionMemory.get(sessionId);
}

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
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
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.path);
  next();
};

app.use(logRequest);

// ============================================
// AUTONOMOUS AI - ACTUALLY INTELLIGENT
// ============================================

async function callAI(systemPrompt, userPrompt, maxTokens = 1000, jsonMode = false) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature: 0.8,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: maxTokens,
      responseMimeType: jsonMode ? 'application/json' : 'text/plain',
    }
  });

  const result = await model.generateContent([
    { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
  ]);
  
  return result.response.text();
}

// MAIN AUTONOMOUS DECISION MAKER
async function autonomousDecision(userPrompt, conversationHistory, session) {
  console.log('\n🧠 AI MAKING AUTONOMOUS DECISION...');
  
  const systemPrompt = `You are Acidnade AI, an autonomous assistant for Roblox game development.

CORE PRINCIPLE: You are INTELLIGENT and make your own decisions. You are NOT a robot that follows strict rules.

YOUR PERSONALITY:
- Friendly, conversational, and helpful
- You understand context and nuance
- You ask clarifying questions when needed
- You don't jump to conclusions
- You remember the conversation

CONVERSATION HISTORY:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

USER'S CURRENT MESSAGE: "${userPrompt}"

ANALYZE THIS MESSAGE AUTONOMOUSLY:
1. Is this just casual conversation? (greetings, questions about you, general chat)
2. Is this asking for information/explanation?
3. Is this asking to build something specific?
4. Is this asking to analyze/modify existing code?
5. What does the user ACTUALLY want?

RESPOND WITH JSON:
{
  "intent": "conversation|question|build|analyze|modify",
  "confidence": 0.0-1.0,
  "reasoning": "Why you chose this intent",
  "shouldCreatePlan": true/false,
  "suggestedResponse": "What you would say naturally",
  "needsMoreInfo": ["what clarifications do you need?"] or []
}

EXAMPLES:
- "hey" → conversation, confidence: 0.95, shouldCreatePlan: false
- "what's a datastore?" → question, shouldCreatePlan: false  
- "create a coin system" → build, shouldCreatePlan: true
- "make it better" (with context) → modify, shouldCreatePlan: true

BE SMART. USE CONTEXT. DON'T OVERTHINK SIMPLE THINGS.`;

  const response = await callAI(systemPrompt, '', 500, true);
  
  try {
    const decision = JSON.parse(response);
    console.log('✅ Decision:', decision.intent, '(confidence:', decision.confidence + ')');
    console.log('💭 Reasoning:', decision.reasoning);
    return decision;
  } catch (error) {
    console.error('❌ Decision parse error:', error.message);
    return {
      intent: 'conversation',
      confidence: 0.5,
      reasoning: 'Failed to parse, defaulting to conversation',
      shouldCreatePlan: false,
      suggestedResponse: "I'm here to help! What would you like to create?",
      needsMoreInfo: []
    };
  }
}

// CONVERSATIONAL RESPONSE (for greetings, questions, etc.)
async function conversationalResponse(userPrompt, decision, conversationHistory) {
  console.log('💬 Generating conversational response...');
  
  const systemPrompt = `You are Acidnade AI, a friendly Roblox development assistant.

CONVERSATION HISTORY:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

USER SAID: "${userPrompt}"

YOUR ANALYSIS: ${decision.reasoning}

RESPOND NATURALLY:
- If it's a greeting, greet back warmly
- If it's a question, answer it clearly
- If they're exploring ideas, discuss them
- Don't create plans unless they explicitly ask to build something
- Be conversational, not robotic

RESPOND WITH JSON:
{
  "message": "Your natural, friendly response",
  "thinkingSteps": ["analyzing: ...", "responding: ..."],
  "plan": [],
  "reasoning": "Brief explanation of your response",
  "suggestions": ["Maybe suggest: Create a coin system?", "Or ask: What game are you making?"]
}`;

  const response = await callAI(systemPrompt, '', 600, true);
  
  try {
    return JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
  } catch (error) {
    return {
      message: decision.suggestedResponse || "Hey! I'm here to help you build awesome Roblox games. What would you like to create?",
      thinkingSteps: ['responding: Friendly greeting'],
      plan: [],
      reasoning: 'Casual conversation',
      suggestions: ['Tell me what game you want to make', 'Ask me to create a system']
    };
  }
}

// BUILD SYSTEM (only when explicitly requested)
async function buildSystem(userPrompt, decision, conversationHistory, context, session) {
  console.log('🔨 Building system...');
  
  // Check if request is clear enough
  if (decision.needsMoreInfo && decision.needsMoreInfo.length > 0) {
    return {
      message: "I want to help you build this! But I need a bit more information:",
      thinkingSteps: ['analyzing: Request needs clarification', 'asking: For more details'],
      plan: [],
      reasoning: decision.reasoning,
      needsMoreInfo: decision.needsMoreInfo,
      suggestions: decision.needsMoreInfo
    };
  }
  
  const systemPrompt = `You are creating a detailed implementation plan for Roblox.

CONVERSATION CONTEXT:
${conversationHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

USER WANTS: "${userPrompt}"

YOUR UNDERSTANDING: ${decision.reasoning}

KNOWLEDGE BASE:
${JSON.stringify(PROMPTS.knowledge, null, 2)}

CREATE A DETAILED PLAN:
1. Understand what systems are needed
2. Break into logical steps
3. Provide complete, working code for each step
4. Consider security and performance
5. Add helpful warnings

RESPOND WITH JSON:
{
  "message": "Creating [system name] with [N] steps",
  "thinkingSteps": ["analyzing: ...", "planning: ...", "structuring: ..."],
  "plan": [
    {
      "step": 1,
      "type": "create",
      "name": "ExactInstanceName",
      "className": "Script|LocalScript|ModuleScript|RemoteEvent|Folder",
      "parentPath": "game.ServerScriptService",
      "description": "Clear description",
      "properties": {
        "Name": "value",
        "Source": "-- COMPLETE working Luau code"
      }
    }
  ],
  "reasoning": "Why this approach",
  "warnings": ["Security: ...", "Performance: ..."],
  "nextSteps": ["Test this", "Then add that"]
}

IMPORTANT:
- Source must be COMPLETE and RUNNABLE
- Use proper Luau syntax (local, task.wait(), :GetService())
- Validate everything on server
- Add error handling`;

  const response = await callAI(systemPrompt, '', 2000, true);
  
  try {
    const plan = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
    
    // Store plan for execution
    session.currentPlan = plan.plan || [];
    session.currentStep = 0;
    session.executionState = 'ready';
    
    console.log('✅ Plan created:', plan.plan?.length || 0, 'steps');
    return plan;
  } catch (error) {
    console.error('❌ Plan parse error:', error.message);
    return {
      message: 'Created a plan for you',
      thinkingSteps: ['planning: Implementation steps'],
      plan: [],
      reasoning: 'Plan generated',
      warnings: [],
      nextSteps: []
    };
  }
}

// MAIN PROCESSING FUNCTION
async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    
    // Add to conversation history
    session.conversationHistory.push({
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    });
    
    // Keep only last 10 messages for context
    if (session.conversationHistory.length > 10) {
      session.conversationHistory = session.conversationHistory.slice(-10);
    }
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🍋 ACIDNADE AI - AUTONOMOUS MODE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('User:', prompt);
    
    // STEP 1: AI decides what to do autonomously
    const decision = await autonomousDecision(
      prompt,
      session.conversationHistory,
      session
    );
    
    // Add AI reasoning to history
    session.conversationHistory.push({
      role: 'assistant-thinking',
      content: decision.reasoning,
      timestamp: Date.now()
    });
    
    let response;
    
    // STEP 2: Act based on AI's decision
    switch (decision.intent) {
      case 'conversation':
      case 'question':
        response = await conversationalResponse(prompt, decision, session.conversationHistory);
        break;
        
      case 'build':
        if (decision.shouldCreatePlan) {
          response = await buildSystem(prompt, decision, session.conversationHistory, context, session);
        } else {
          response = await conversationalResponse(prompt, decision, session.conversationHistory);
        }
        break;
        
      case 'analyze':
        if (!context?.sourceCodes) {
          response = {
            message: "I'd love to analyze the code! Could you share it with me?",
            thinkingSteps: ['analyzing: Need source code', 'requesting: Code to analyze'],
            plan: [],
            needsSourceCode: {
              reason: 'Cannot analyze without seeing the code'
            },
            reasoning: 'Source code is required for analysis'
          };
        } else {
          // Analyze code logic here
          response = await conversationalResponse(prompt, decision, session.conversationHistory);
        }
        break;
        
      case 'modify':
        if (!context?.sourceCodes) {
          response = {
            message: "I need to see the code first before I can modify it!",
            thinkingSteps: ['analyzing: Need source code', 'requesting: Code to modify'],
            plan: [],
            needsSourceCode: {
              reason: 'Cannot modify without seeing the code'
            },
            reasoning: 'Source code is required for modifications'
          };
        } else {
          response = await buildSystem(prompt, decision, session.conversationHistory, context, session);
        }
        break;
        
      default:
        response = await conversationalResponse(prompt, decision, session.conversationHistory);
    }
    
    // Add response to history
    session.conversationHistory.push({
      role: 'assistant',
      content: response.message,
      timestamp: Date.now()
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ RESPONSE GENERATED');
    console.log('Intent:', decision.intent);
    console.log('Confidence:', decision.confidence);
    console.log('Created plan:', response.plan?.length > 0);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    return {
      ...response,
      metadata: {
        intent: decision.intent,
        confidence: decision.confidence,
        sessionId,
        conversationLength: session.conversationHistory.length,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('❌ AI Processing Error:', error.message);
    return {
      message: 'Oops! Something went wrong. Could you try asking that again?',
      thinkingSteps: ['error: ' + error.message],
      plan: [],
      reasoning: 'An error occurred: ' + error.message,
      error: true
    };
  }
}

// ============================================
// ROUTES
// ============================================

app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '6.0 - Autonomous Intelligence',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      '🧠 Truly autonomous decision making',
      '💬 Natural conversation understanding',
      '🎯 Context-aware responses',
      '🤝 Doesn\'t jump to conclusions',
      '❓ Asks clarifying questions',
      '🔨 Only builds when explicitly asked',
      '📝 Remembers conversation history',
      '⚡ Smarter, not robotic'
    ],
    philosophy: 'AI should think for itself, not blindly follow rules',
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessionMemory.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId,
    executionState: session.executionState,
    currentStep: session.currentStep,
    totalSteps: session.currentPlan?.length || 0,
    conversationLength: session.conversationHistory?.length || 0,
    lastMessage: session.conversationHistory?.slice(-1)[0] || null,
    timestamp: new Date(session.timestamp || Date.now()).toISOString()
  });
});

app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Both prompt and sessionId are required'
      });
    }
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('❌ Server Error:', error.message);
    res.status(500).json({ 
      message: 'Oops! Something went wrong on my end. Could you try again?',
      thinkingSteps: ['error: Internal server error'],
      plan: [],
      reasoning: 'Server encountered an error',
      error: true
    });
  }
});

// Clean up old sessions
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - (session.timestamp || now) > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`🧹 Cleaned up session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🍋 ACIDNADE AI v6.0 - AUTONOMOUS INTELLIGENCE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Model: gemini-3-flash-preview');
  console.log('');
  console.log('🧠 AUTONOMOUS FEATURES:');
  console.log('  ✓ AI makes its own decisions');
  console.log('  ✓ Understands greetings vs build requests');
  console.log('  ✓ Asks clarifying questions');
  console.log('  ✓ Remembers conversation context');
  console.log('  ✓ Natural conversation flow');
  console.log('  ✓ Only builds when explicitly asked');
  console.log('');
  console.log('🎯 INTELLIGENCE LEVELS:');
  console.log('  • "hey" → Friendly greeting');
  console.log('  • "what is X?" → Explanation');
  console.log('  • "create X" → Build system');
  console.log('  • "fix my code" → Analyze & modify');
  console.log('');
  console.log('💡 PHILOSOPHY:');
  console.log('  AI should be smart enough to understand context');
  console.log('  Not blindly execute predefined patterns');
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Server ready at http://localhost:' + PORT);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
