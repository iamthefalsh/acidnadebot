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

// Initialize data directory
await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// MEMORY SYSTEM - Persistent storage for conversations and context
// ============================================================================
class SystemMemory {
  constructor() {
    this.conversations = new Map();
    this.userContext = new Map();
    this.loadMemory();
  }

  async loadMemory() {
    try {
      const convPath = path.join(DATA_DIR, 'conversations.json');
      const data = await fs.readFile(convPath, 'utf-8').catch(() => '{}');
      const parsed = JSON.parse(data);
      this.conversations = new Map(Object.entries(parsed));
    } catch (error) {
      console.log('[Memory] Starting fresh');
    }
  }

  async saveMemory() {
    try {
      const convPath = path.join(DATA_DIR, 'conversations.json');
      const obj = Object.fromEntries(this.conversations);
      await fs.writeFile(convPath, JSON.stringify(obj, null, 2));
    } catch (error) {
      console.error('[Memory] Save error:', error.message);
    }
  }

  getUserHistory(userId, limit = 10) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }
    const history = this.conversations.get(userId);
    return history.slice(-limit);
  }

  addMessage(userId, userMsg, aiResponse, context = {}) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }
    
    const history = this.conversations.get(userId);
    history.push({
      user: userMsg,
      ai: aiResponse,
      context: context,
      timestamp: Date.now()
    });
    
    // Keep last 50 messages
    if (history.length > 50) {
      this.conversations.set(userId, history.slice(-50));
    }
    
    this.saveMemory();
  }

  setUserContext(userId, context) {
    this.userContext.set(userId, {
      ...context,
      lastUpdate: Date.now()
    });
  }

  getUserContext(userId) {
    return this.userContext.get(userId) || {};
  }
}

const memory = new SystemMemory();

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
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticate = (req, res, next) => {
  const key = req.headers['x-acidnade-key'];
  if (!key || key !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// ============================================================================
// CORE AI SYSTEM - Pure AI decision making
// ============================================================================

async function chatWithAI(userMessage, context, userId) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, an autonomous Roblox Studio assistant.

YOUR CORE PHILOSOPHY:
You make ALL decisions autonomously. No keyword matching. No pattern detection.
You understand context, intent, and nuance. You decide everything based on pure reasoning.

DECISION MAKING:
- Analyze user's message deeply
- Consider conversation history
- Understand implicit and explicit intent
- Decide whether to chat or execute
- Plan system architecture when needed

RESPONSE TYPES:

1. CHAT MODE - For conversations, questions, greetings, clarifications
{
  "type": "chat",
  "message": "Your conversational response"
}

2. PLAN MODE - When user wants you to create/modify systems
Create a high-level plan WITHOUT code. Keep it token-efficient.
{
  "type": "plan",
  "message": "What I'll create for you",
  "understanding": "Brief analysis of requirements",
  "steps": [
    {
      "stepId": "step_1",
      "description": "Brief description of what this step does",
      "estimatedComplexity": "simple|medium|complex"
    }
  ]
}

3. READY FOR EXECUTION - When plan is approved or direct creation requested
{
  "type": "ready",
  "message": "Ready to execute the plan",
  "nextStep": "step_1"
}

KEY PRINCIPLES:
- Plans are lightweight (no code, just architecture)
- Each step executes independently with its own AI call
- You remember context across conversations
- Parent references use UniqueID, not paths
- Be natural, intelligent, and autonomous`
    });

    const history = memory.getUserHistory(userId, 8);
    const userCtx = memory.getUserContext(userId);

    let contextPrompt = `USER: ${userMessage}\n\n`;

    if (history.length > 0) {
      contextPrompt += `CONVERSATION HISTORY:\n`;
      history.forEach(conv => {
        contextPrompt += `User: ${conv.user}\n`;
        contextPrompt += `You: ${conv.ai}\n\n`;
      });
    }

    if (context?.selectedObjects?.length > 0) {
      contextPrompt += `SELECTED OBJECTS:\n`;
      context.selectedObjects.forEach(obj => {
        contextPrompt += `- ${obj.Name} (${obj.ClassName}) [UID: ${obj.UniqueId}]\n`;
      });
      contextPrompt += '\n';
    }

    if (context?.workspaceInfo) {
      contextPrompt += `WORKSPACE INFO:\n${JSON.stringify(context.workspaceInfo, null, 2)}\n\n`;
    }

    if (userCtx.currentPlan) {
      contextPrompt += `CURRENT PLAN:\n${JSON.stringify(userCtx.currentPlan, null, 2)}\n\n`;
    }

    contextPrompt += `Analyze and respond appropriately. Make autonomous decisions.`;

    const result = await model.generateContent(contextPrompt);
    const response = JSON.parse(result.response.text());

    // Store plan in context if created
    if (response.type === 'plan') {
      memory.setUserContext(userId, {
        currentPlan: response,
        planActive: true
      });
    }

    // Store conversation
    memory.addMessage(userId, userMessage, response.message, { type: response.type });

    return response;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "I encountered an error processing your request. Could you rephrase that?"
    };
  }
}

async function executeStep(stepId, plan, context, userId) {
  try {
    const step = plan.steps.find(s => s.stepId === stepId);
    if (!step) {
      throw new Error('Step not found');
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 6000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are executing a specific step in a Roblox Studio plan.

EXECUTION FORMAT:
{
  "type": "execution",
  "stepId": "step_1",
  "message": "Brief update on what you're creating",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "ModuleScript|Script|LocalScript|Part|Frame|TextLabel|etc",
      "parent": "UNIQUE_ID_HERE",
      "properties": {
        "Color": [255, 0, 0],
        "Position": "UDim2.new(0, 0, 0, 0)",
        "Size": "UDim2.new(0, 100, 0, 50)",
        "Text": "Hello"
      },
      "content": "-- Full Lua code here (for scripts only)"
    },
    {
      "action": "modify",
      "name": "ExistingInstance",
      "parent": "UNIQUE_ID_OR_PATH",
      "properties": {
        "Color": [0, 255, 0]
      },
      "sourceModifications": {
        "action": "replace_lines",
        "startLine": 5,
        "endLine": 9,
        "newCode": "-- Updated code"
      }
    }
  ]
}

RULES:
- Generate COMPLETE, PRODUCTION-READY code
- Use UniqueID for parent when available
- Include all necessary properties
- Scripts must be fully functional
- Be specific and detailed
- Each action creates/modifies ONE instance`
    });

    let prompt = `EXECUTE STEP: ${stepId}\n\n`;
    prompt += `STEP DESCRIPTION: ${step.description}\n\n`;
    prompt += `FULL PLAN CONTEXT:\n${JSON.stringify(plan, null, 2)}\n\n`;
    
    if (context?.selectedObjects?.length > 0) {
      prompt += `SELECTED OBJECTS:\n`;
      context.selectedObjects.forEach(obj => {
        prompt += `- ${obj.Name} (${obj.ClassName}) [UID: ${obj.UniqueId}]\n`;
      });
      prompt += '\n';
    }

    prompt += `Generate the complete implementation for this step.`;

    const result = await model.generateContent(prompt);
    const execution = JSON.parse(result.response.text());

    return execution;

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    throw error;
  }
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

// Main chat endpoint - AI decides everything
app.post('/ai/chat', authenticate, async (req, res) => {
  try {
    const { message, context, userId = 'anonymous' } = req.body;

    if (!message) {
      return res.status(400).json({ 
        type: 'chat',
        message: "I need a message to respond to."
      });
    }

    console.log(`[${userId}] ${message.substring(0, 80)}${message.length > 80 ? '...' : ''}`);

    const response = await chatWithAI(message, context, userId);
    res.json(response);

  } catch (error) {
    console.error('[Chat] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong. Please try again."
    });
  }
});

// Execute a specific step from plan
app.post('/ai/execute', authenticate, async (req, res) => {
  try {
    const { stepId, userId = 'anonymous', context } = req.body;

    const userCtx = memory.getUserContext(userId);
    const plan = userCtx.currentPlan;

    if (!plan || plan.type !== 'plan') {
      return res.status(400).json({
        error: 'No active plan found. Chat first to create a plan.'
      });
    }

    if (!stepId) {
      return res.status(400).json({
        error: 'stepId required'
      });
    }

    console.log(`[${userId}] Executing: ${stepId}`);

    const execution = await executeStep(stepId, plan, context, userId);
    res.json(execution);

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

// Execute entire plan at once
app.post('/ai/execute-all', authenticate, async (req, res) => {
  try {
    const { userId = 'anonymous', context } = req.body;

    const userCtx = memory.getUserContext(userId);
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

// Get current plan
app.get('/ai/plan/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const userCtx = memory.getUserContext(userId);
    
    res.json({
      hasPlan: !!userCtx.currentPlan,
      plan: userCtx.currentPlan || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear plan
app.delete('/ai/plan/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    memory.setUserContext(userId, { currentPlan: null, planActive: false });
    
    res.json({
      success: true,
      message: 'Plan cleared'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get conversation history
app.get('/ai/history/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const history = memory.getUserHistory(userId, limit);
    
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
app.delete('/ai/history/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    memory.conversations.delete(userId);
    memory.userContext.delete(userId);
    await memory.saveMemory();
    
    res.json({
      success: true,
      message: `Cleared history for ${userId}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Pure Autonomous',
    version: '2.0.0',
    features: [
      'Pure AI decision making',
      'No keyword detection',
      'Two-phase execution (plan → execute)',
      'Low token usage for planning',
      'Full code generation on execution',
      'UniqueID-based parent references',
      'Context-aware conversations',
      'Multi-step plan support'
    ],
    users: memory.conversations.size
  });
});

// ============================================================================
// STARTUP
// ============================================================================
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   ACIDNADE AI - PURE AUTONOMOUS        ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\n🚀 Port: ${PORT}`);
  console.log('\n✨ Features:');
  console.log('  • 100% AI-driven decisions');
  console.log('  • No keyword matching');
  console.log('  • Plan → Execute workflow');
  console.log('  • Low token planning');
  console.log('  • Full code on execution');
  console.log('  • Context memory');
  console.log('\n📡 Endpoints:');
  console.log('  POST /ai/chat - Main interaction');
  console.log('  POST /ai/execute - Execute step');
  console.log('  POST /ai/execute-all - Execute full plan');
  console.log('  GET  /ai/plan/:userId - Get current plan');
  console.log('  GET  /health - System status');
  console.log('\n✅ Ready for autonomous operation\n');
});
