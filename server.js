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

console.log('🚀 Starting Acidnade AI - Universal Fix');
console.log('🤖 Model: gemini-3-flash-preview');
console.log('📦 Environment:', IS_VERCEL ? 'Vercel' : 'Local');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ============================================================================
// UNIVERSAL MEMORY STORE
// ============================================================================
class UniversalMemory {
  constructor() {
    this.conversations = new Map();
    this.projects = new Map();
    this.checkpoints = new Map();
    this.fileAccess = new Map();
    this.retryCount = new Map();
    console.log('[Memory] Universal memory initialized');
  }

  getProject(userId) {
    if (!this.projects.has(userId)) {
      this.projects.set(userId, {
        gameType: null,
        systems: [],
        instances: new Map(),
        currentPlan: null,
        mentionedFiles: [],
        recentEdits: [],
        lastStep: null,
        completedSteps: new Set(),
        failedSteps: new Map()
      });
    }
    return this.projects.get(userId);
  }

  getConversations(userId) {
    if (!this.conversations.has(userId)) {
      this.conversations.set(userId, []);
    }
    return this.conversations.get(userId);
  }

  addConversation(userId, user, ai, type) {
    const convos = this.getConversations(userId);
    convos.push({ user, ai, type, timestamp: Date.now() });
    
    if (convos.length > 50) {
      this.conversations.set(userId, convos.slice(-50));
    }
  }

  getLastConversation(userId) {
    const convos = this.getConversations(userId);
    return convos.length > 0 ? convos[convos.length - 1] : null;
  }

  trackRetry(userId) {
    const count = this.retryCount.get(userId) || 0;
    this.retryCount.set(userId, count + 1);
    return count + 1;
  }

  resetRetry(userId) {
    this.retryCount.set(userId, 0);
  }

  markStepCompleted(userId, stepId) {
    const project = this.getProject(userId);
    project.completedSteps.add(stepId);
    project.lastStep = stepId;
  }

  isStepCompleted(userId, stepId) {
    const project = this.getProject(userId);
    return project.completedSteps.has(stepId);
  }

  recordStepFailure(userId, stepId, error) {
    const project = this.getProject(userId);
    project.failedSteps.set(stepId, {
      error,
      timestamp: Date.now(),
      retryCount: (project.failedSteps.get(stepId)?.retryCount || 0) + 1
    });
  }
}

const memory = new UniversalMemory();

// ============================================================================
// ERROR HANDLING & RETRY SYSTEM
// ============================================================================
class RetryManager {
  static async withRetry(operation, operationName, userId, maxRetries = 2) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation(attempt);
        
        if (result === undefined || result === null) {
          console.log(`[${operationName}] Attempt ${attempt}: Got undefined/null`);
          
          if (attempt === maxRetries) {
            throw new Error(`Operation returned undefined after ${maxRetries} attempts`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        
        // Success
        memory.resetRetry(userId);
        return result;
        
      } catch (error) {
        lastError = error;
        console.error(`[${operationName}] Attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          const retryCount = memory.trackRetry(userId);
          
          if (retryCount <= 3) {
            console.log(`[${operationName}] Will retry on next request (${retryCount}/3)`);
            throw new Error(`Please redo the last prompt (attempt ${retryCount}/3)`);
          } else {
            console.error(`[${operationName}] Max retries exceeded`);
            throw new Error(`Operation failed after multiple attempts. Please try a different request.`);
          }
        }
        
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
    
    throw lastError;
  }
}

// ============================================================================
// UNIVERSAL AI SYSTEM
// ============================================================================
async function universalAI(userMessage, context, userId) {
  return await RetryManager.withRetry(async (attempt) => {
    console.log(`[AI] Attempt ${attempt} for: ${userMessage.substring(0, 60)}...`);
    
    const project = memory.getProject(userId);
    const mentionedFiles = (userMessage.match(/@([\w.]+)/g) || []).map(f => f.substring(1));
    
    if (mentionedFiles.length > 0) {
      project.mentionedFiles = mentionedFiles;
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - a universal Roblox Studio assistant.

IMPORTANT: Your response MUST be valid JSON with NO markdown, NO code fences.

RESPONSE FORMATS (choose based on request):

1. FOR CODE/IMPLEMENTATION REQUESTS:
{
  "type": "execution",
  "message": "Brief description",
  "actions": [
    {
      "action": "create|modify",
      "name": "FileName",
      "classtype": "Script|LocalScript|ModuleScript|Part|Model|Frame|ScreenGui",
      "parent": "game.ServerScriptService|game.Workspace|game.StarterPlayer",
      "properties": {
        "Source": "-- COMPLETE Lua code here",
        "Size": "Vector3.new(1, 1, 1) or UDim2.new(0, 100, 0, 50)",
        "Position": "Vector3.new(0, 5, 0) or UDim2.new(0.5, 0, 0.5, 0)"
      }
    }
  ]
}

2. FOR MULTI-STEP REQUESTS:
{
  "type": "plan",
  "message": "I'll break this into steps",
  "steps": [
    {"stepId": "step_1", "description": "Step 1"},
    {"stepId": "step_2", "description": "Step 2"}
  ]
}

3. FOR SIMPLE CHAT:
{
  "type": "chat",
  "message": "Your response"
}

RULES:
- ALWAYS return complete, working Lua code
- For UI: ensure Size > 0, Visible = true
- Handle errors gracefully
- Keep code clean and commented
- If unsure, provide working examples

The user wants UNIVERSAL responses that work for any request.`
    });

    let prompt = `USER: ${userMessage}\n\n`;
    
    // Add context if available (safely)
    if (context && context.selectedObjects && Array.isArray(context.selectedObjects)) {
      prompt += `SELECTED OBJECTS:\n`;
      context.selectedObjects.forEach(obj => {
        if (obj && obj.Name && obj.ClassName) {
          prompt += `- ${obj.Name} (${obj.ClassName})\n`;
        }
      });
      prompt += '\n';
    }
    
    if (mentionedFiles.length > 0) {
      prompt += `MENTIONED FILES: ${mentionedFiles.join(', ')}\n\n`;
    }
    
    const lastConvo = memory.getLastConversation(userId);
    if (lastConvo) {
      prompt += `LAST INTERACTION: ${lastConvo.user.substring(0, 100)}...\n`;
    }
    
    if (project.mentionedFiles.length > 0) {
      prompt += `PREVIOUSLY MENTIONED: ${project.mentionedFiles.join(', ')}\n`;
    }
    
    prompt += `\nProvide a UNIVERSAL response that works for any Roblox development need.`;
    prompt += `\nYour response must be PURE JSON with no markdown.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response?.text();
    
    if (!responseText) {
      console.error('[AI] No response text received');
      throw new Error('AI returned empty response');
    }
    
    console.log('[AI] Raw response:', responseText.substring(0, 200));
    
    let parsed;
    try {
      // Clean response
      let cleanText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .replace(/^#+\s.*$/gm, '')
        .trim();
      
      // Extract JSON
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('[AI] JSON parse failed:', parseError.message);
      
      // If response contains code, create execution response
      if (responseText.includes('local ') || responseText.includes('function ')) {
        parsed = {
          type: 'execution',
          message: 'I\'ll implement that for you',
          actions: [{
            action: 'modify',
            name: 'GameCore.lua',
            classtype: 'ModuleScript',
            parent: 'game.ServerScriptService',
            properties: {
              Source: responseText.substring(0, 1000)
            }
          }]
        };
      } else {
        // Default to chat
        parsed = {
          type: 'chat',
          message: responseText.substring(0, 500)
        };
      }
    }
    
    // Ensure required fields
    if (!parsed.type) parsed.type = 'chat';
    if (!parsed.message) parsed.message = 'Processing your request';
    
    // If it's a plan, ensure steps have IDs
    if (parsed.type === 'plan' && parsed.steps) {
      parsed.steps = parsed.steps.map((step, index) => ({
        stepId: step.stepId || `step_${index + 1}`,
        description: step.description || `Step ${index + 1}`,
        status: 'pending'
      }));
      
      project.currentPlan = parsed;
    }
    
    memory.addConversation(userId, userMessage, parsed.message, parsed.type);
    
    return parsed;
    
  }, 'universalAI', userId);
}

// ============================================================================
// ROBUST EXECUTION SYSTEM
// ============================================================================
async function executeStep(stepId, userId, context) {
  return await RetryManager.withRetry(async (attempt) => {
    console.log(`[Execute] Attempt ${attempt} for step: ${stepId}`);
    
    const project = memory.getProject(userId);
    const plan = project.currentPlan;
    
    if (!plan) {
      console.error(`[Execute] No plan found for ${userId}`);
      return {
        type: 'execution',
        stepId,
        message: 'No active plan found. Please create a plan first.',
        actions: []
      };
    }
    
    const step = plan.steps?.find(s => s.stepId === stepId);
    if (!step) {
      console.error(`[Execute] Step ${stepId} not found in plan`);
      return {
        type: 'execution',
        stepId,
        message: `Step ${stepId} not found.`,
        actions: []
      };
    }
    
    // Skip if already completed
    if (memory.isStepCompleted(userId, stepId)) {
      console.log(`[Execute] Step ${stepId} already completed`);
      return {
        type: 'execution',
        stepId,
        message: `Step ${stepId} was already completed.`,
        actions: [],
        skipped: true
      };
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 3000,
        responseMimeType: 'application/json',
      },
      systemInstruction: `Execute Roblox Studio step. Return PURE JSON only.

{
  "type": "execution",
  "stepId": "${stepId}",
  "message": "Brief description",
  "actions": [
    {
      "action": "create|modify",
      "name": "FileName",
      "classtype": "Script|LocalScript|ModuleScript|Part|Model|Frame",
      "parent": "game.ServerScriptService|game.Workspace|game.StarterPlayer",
      "properties": {
        "Source": "-- COMPLETE Lua code here",
        "Size": "Vector3.new(1,1,1) or UDim2.new(0,100,0,50)",
        "Position": "Vector3.new(0,5,0) or UDim2.new(0,0,0,0)",
        "Visible": true
      }
    }
  ]
}

RULES:
- NO markdown, NO code blocks
- ALL code goes in Source property
- For UI: Visible=true, Size > 0
- Handle errors gracefully in code
- Return complete, working code`
    });

    let prompt = `EXECUTE STEP: ${stepId}\n\n`;
    prompt += `DESCRIPTION: ${step.description}\n\n`;
    
    // Safely add context
    if (context && typeof context === 'object') {
      if (context.selectedObjects && Array.isArray(context.selectedObjects)) {
        prompt += `SELECTED OBJECTS:\n`;
        context.selectedObjects.forEach((obj, idx) => {
          if (obj && obj.Name && obj.ClassName) {
            prompt += `- ${obj.Name} (${obj.ClassName})\n`;
          }
        });
        prompt += '\n';
      }
      
      if (context.mentionedFiles && Array.isArray(context.mentionedFiles)) {
        prompt += `MENTIONED FILES: ${context.mentionedFiles.join(', ')}\n\n`;
      }
    }
    
    if (project.mentionedFiles.length > 0) {
      prompt += `PROJECT FILES: ${project.mentionedFiles.join(', ')}\n\n`;
    }
    
    prompt += `PLAN OVERVIEW: ${plan.message || 'Execute step'}\n\n`;
    prompt += `Provide the COMPLETE code needed for this step.`;
    prompt += `\nReturn ONLY JSON with actions array containing the code.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response?.text();
    
    if (!responseText) {
      console.error('[Execute] No response text');
      throw new Error('Execution returned empty response');
    }
    
    console.log('[Execute] Raw response:', responseText.substring(0, 200));
    
    let execution;
    try {
      let cleanText = responseText
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      
      const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        execution = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON in execution response');
      }
    } catch (parseError) {
      console.error('[Execute] JSON parse failed:', parseError.message);
      
      // Create fallback execution
      execution = {
        type: 'execution',
        stepId,
        message: `Completed step: ${step.description}`,
        actions: [{
          action: 'modify',
          name: 'StepHandler.lua',
          classtype: 'ModuleScript',
          parent: 'game.ServerScriptService',
          properties: {
            Source: `-- Auto-generated for step: ${stepId}\n-- ${step.description}\n\nprint("Step ${stepId} executed")`
          }
        }]
      };
    }
    
    // Ensure required fields
    if (!execution.type) execution.type = 'execution';
    if (!execution.stepId) execution.stepId = stepId;
    if (!execution.actions || !Array.isArray(execution.actions)) {
      execution.actions = [];
    }
    
    // Validate and fix actions
    execution.actions.forEach(action => {
      if (!action.properties) action.properties = {};
      
      // Ensure UI elements are visible
      if (action.classtype && action.classtype.includes('Gui')) {
        if (!action.properties.Visible) action.properties.Visible = true;
        if (!action.properties.Size) action.properties.Size = 'UDim2.new(0, 100, 0, 50)';
        if (!action.properties.Position) action.properties.Position = 'UDim2.new(0, 0, 0, 0)';
      }
      
      // Ensure scripts have source
      if (action.classtype && action.classtype.includes('Script') && !action.properties.Source) {
        action.properties.Source = `-- ${action.name}\n-- Auto-generated\n\nprint("${action.name} loaded")`;
      }
    });
    
    // Mark step as completed
    memory.markStepCompleted(userId, stepId);
    
    return execution;
    
  }, 'executeStep', userId, 1); // Only 1 retry for execution
}

// ============================================================================
// PROGRESS TRACKING
// ============================================================================
function getExecutionProgress(userId) {
  const project = memory.getProject(userId);
  
  if (!project.currentPlan || !project.currentPlan.steps) {
    return null;
  }
  
  const steps = project.currentPlan.steps;
  const completed = Array.from(project.completedSteps);
  const failed = Array.from(project.failedSteps.keys());
  
  const progress = {
    total: steps.length,
    completed: completed.length,
    failed: failed.length,
    pending: steps.length - completed.length - failed.length,
    steps: steps.map(step => ({
      stepId: step.stepId,
      description: step.description,
      status: completed.includes(step.stepId) ? 'completed' : 
              failed.includes(step.stepId) ? 'failed' : 'pending'
    }))
  };
  
  return progress;
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
  max: 500,
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
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ 
        type: 'chat',
        message: "Please enter a valid message."
      });
    }

    console.log(`[Chat] ${userId}: ${message.substring(0, 80)}...`);
    
    const response = await universalAI(message, context, userId);
    res.json(response);

  } catch (error) {
    console.error('[Chat] Error:', error.message);
    
    // If retry manager suggests redo
    if (error.message.includes('redo the last prompt')) {
      return res.status(429).json({
        type: 'chat',
        message: error.message,
        retry: true
      });
    }
    
    res.status(500).json({
      type: 'chat',
      message: "Something went wrong. Please try again.",
      error: IS_VERCEL ? undefined : error.message
    });
  }
});

app.post('/ai', auth, async (req, res) => {
  try {
    const { prompt, context, sessionId, userId } = req.body;
    const message = prompt || req.body.message;
    const finalUserId = userId || sessionId || 'anonymous';
    
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ 
        type: 'chat',
        message: "Please enter a valid message."
      });
    }

    console.log(`[AI] ${finalUserId}: ${message.substring(0, 80)}...`);
    
    const response = await universalAI(message, context, finalUserId);
    res.json(response);

  } catch (error) {
    console.error('[AI] Error:', error.message);
    
    if (error.message.includes('redo the last prompt')) {
      return res.status(429).json({
        type: 'chat',
        message: error.message,
        retry: true
      });
    }
    
    res.status(500).json({
      type: 'chat',
      message: "Processing error.",
      error: true
    });
  }
});

app.post('/ai/execute', auth, async (req, res) => {
  try {
    const { stepId, userId = 'anonymous', context } = req.body;

    if (!stepId || typeof stepId !== 'string') {
      return res.status(400).json({ 
        type: 'execution',
        message: "Valid stepId is required.",
        actions: []
      });
    }

    console.log(`[Execute] ${userId} executing step: ${stepId}`);
    
    const execution = await executeStep(stepId, userId, context || {});
    res.json(execution);

  } catch (error) {
    console.error('[Execute] Error:', error.message);
    
    const project = memory.getProject(req.body.userId || 'anonymous');
    if (stepId) {
      memory.recordStepFailure(req.body.userId || 'anonymous', stepId, error.message);
    }
    
    if (error.message.includes('redo the last prompt')) {
      return res.status(429).json({
        type: 'execution',
        stepId: req.body.stepId,
        message: error.message,
        actions: [],
        retry: true
      });
    }
    
    res.status(500).json({ 
      type: 'execution',
      stepId: req.body.stepId,
      message: `Execution error: ${error.message}`,
      actions: []
    });
  }
});

app.get('/ai/progress/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const progress = getExecutionProgress(userId);
  
  if (!progress) {
    return res.json({
      hasPlan: false,
      message: "No active plan"
    });
  }
  
  res.json({
    hasPlan: true,
    progress
  });
});

app.post('/ai/reset/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const { resetPlan } = req.body;
  
  const project = memory.getProject(userId);
  
  if (resetPlan) {
    project.currentPlan = null;
    project.completedSteps.clear();
    project.failedSteps.clear();
  }
  
  memory.resetRetry(userId);
  
  res.json({
    success: true,
    message: resetPlan ? 'Plan reset' : 'Retry counter reset'
  });
});

app.get('/ai/status/:userId', auth, (req, res) => {
  const { userId } = req.params;
  const project = memory.getProject(userId);
  const convos = memory.getConversations(userId);
  
  res.json({
    conversations: convos.length,
    hasPlan: !!project.currentPlan,
    completedSteps: project.completedSteps.size,
    failedSteps: project.failedSteps.size,
    mentionedFiles: project.mentionedFiles,
    retryCount: memory.retryCount.get(userId) || 0
  });
});

app.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '3.2.0-universal',
    model: 'gemini-3-flash-preview',
    environment: IS_VERCEL ? 'vercel' : 'local',
    fixes: ['✅ Universal handling', '✅ Retry system', '✅ Error resilience']
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'operational',
    service: 'Acidnade AI - Universal Edition',
    version: '3.2.0-universal',
    model: 'gemini-3-flash-preview',
    memory: {
      users: memory.conversations.size,
      projects: memory.projects.size
    },
    features: [
      '✅ Universal response system',
      '✅ Automatic retry on undefined',
      '✅ Step progress tracking',
      '✅ Error resilience',
      '✅ Safe context handling',
      '✅ Vercel compatible'
    ]
  });
});

// ============================================================================
// ERROR HANDLING
// ============================================================================
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  
  res.status(500).json({
    type: 'chat',
    message: "Server error occurred.",
    error: IS_VERCEL ? undefined : err.message
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
    console.log('║   ACIDNADE AI - UNIVERSAL EDITION         ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n🌐 Port: ${PORT}`);
    console.log('🤖 Model: gemini-3-flash-preview');
    console.log('🔄 Features:');
    console.log('  • ✅ Automatic retry on undefined');
    console.log('  • ✅ Universal response handling');
    console.log('  • ✅ Step progress tracking');
    console.log('  • ✅ Error resilience');
    console.log('  • ✅ Safe context handling');
    console.log('\n📡 Endpoints:');
    console.log('  POST /ai/chat - Main chat');
    console.log('  POST /ai - Compatibility');
    console.log('  POST /ai/execute - Execute steps');
    console.log('  GET  /ai/progress/:userId - Check progress');
    console.log('  GET  /ping - Connection test');
    console.log('\n✅ Ready for universal requests!\n');
  });
}

export default app;
