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

// Session memory store - optimized for low memory usage
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      currentPlan: [],           // Steps to execute
      currentStep: 0,            // Current step index
      executionState: 'idle',    // idle, planning, executing, complete
      createdInstances: [],      // Instances created in this session
      modifiedInstances: [],     // Instances modified in this session
      pendingActions: [],        // Actions waiting for execution
      timestamp: Date.now(),
      tokenUsage: 0
    });
  }
  return sessionMemory.get(sessionId);
}

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' })); // Reduced from 10mb
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200, // Increased for more frequent small requests
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
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${req.ip}`);
  next();
};

app.use(logRequest);

// Optimized System Prompt - Minimal token usage
const SYSTEM_PROMPT = `You are Acidnade AI, a Roblox Studio assistant. Respond in JSON only.

RESPONSE FORMATS:

1. PLANNING (when asked to do multiple things):
{
  "mode": "plan",
  "message": "Brief description of plan",
  "plan": [
    {
      "stepId": 1,
      "action": "create/modify",
      "description": "Short description",
      "target": "instance name if known"
    }
  ],
  "reasoning": "Short explanation"
}

2. CREATE ACTION (when creating something):
{
  "mode": "execute",
  "action": "create",
  "message": "Creating [instance]",
  "data": {
    "name": "InstanceName",
    "classtype": "Script/LocalScript/ModuleScript/Part/TextLabel/etc",
    "properties": {
      "Position": "0, 5, 0",
      "Size": "5, 5, 5",
      "Color": "255, 0, 0"
    },
    "parent": "game.Workspace",
    "content": "-- Lua code here (for scripts)"
  },
  "reasoning": "Why this is needed"
}

3. MODIFY ACTION (when changing existing):
{
  "mode": "execute",
  "action": "modify",
  "message": "Modifying [instance]",
  "data": {
    "type": "multiedit",
    "name": "EXACT_NAME_FROM_MATCHES",
    "parent": "EXACT_PATH_FROM_MATCHES",
    "properties": {
      "Color": "0, 255, 0"
    },
    "sourceModifications": {
      "action": "select lines 5-9 and replace",
      "newCode": "-- new code here"
    }
  },
  "reasoning": "Why this change"
}

4. NEED INFO (when you need source code):
{
  "mode": "request",
  "message": "I need to read [filename]",
  "needs": {
    "type": "source_code",
    "instanceName": "FieldSystem",
    "reason": "To understand image loading"
  },
  "reasoning": "Cannot proceed without this"
}

RULES:
1. Keep responses minimal - use few tokens
2. For multi-step requests, first return a plan
3. Execute one action per response
4. Only include source code when absolutely necessary
5. Use "request" mode to ask for missing info
6. Never use replaceAll - use targeted modifications`;

// Build optimized prompt - minimal token usage
function buildPrompt(userPrompt, context, sessionId, mode = 'planning') {
  const session = initSession(sessionId);
  let prompt = '';
  
  // Track token usage
  session.tokenUsage = (session.tokenUsage || 0) + userPrompt.length;
  
  if (mode === 'planning') {
    // Ultra-minimal planning prompt
    prompt = `User: ${userPrompt}\n\n`;
    
    // Add only essential context
    if (session.createdInstances?.length > 0) {
      prompt += 'Recent creations: ';
      session.createdInstances.slice(-3).forEach(inst => {
        prompt += `${inst.name}(${inst.type}), `;
      });
      prompt += '\n';
    }
    
    if (context?.selectedObjects?.length > 0) {
      prompt += `Selected: ${context.selectedObjects.map(o => o.Name).join(', ')}\n`;
    }
    
    prompt += 'Instructions:\n';
    prompt += '1. If multiple actions needed, return plan mode\n';
    prompt += '2. If single action, return execute mode\n';
    prompt += '3. Be brief, use few tokens\n';
    prompt += '4. If missing info, use request mode\n';
    
  } else if (mode === 'execution') {
    // Execution prompt - minimal
    const currentStep = session.currentStep;
    const step = session.currentPlan?.[currentStep];
    
    prompt = `Execute step ${currentStep + 1}: ${step?.description || 'unknown'}\n`;
    
    if (step?.target) {
      prompt += `Target: ${step.target}\n`;
    }
    
    // Only include source code if provided and relevant
    if (context?.sourceCodes && step?.target) {
      const targetName = step.target.toLowerCase();
      for (const [path, code] of Object.entries(context.sourceCodes)) {
        if (path.toLowerCase().includes(targetName)) {
          prompt += `Source (${path}):\n${code.substring(0, 500)}...\n`;
          break;
        }
      }
    }
    
    prompt += 'Instructions: Return execute mode with full details.\n';
  }
  
  return prompt;
}

// Process AI request with step-by-step execution
async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024, // Reduced for efficiency
        responseMimeType: 'application/json',
      },
      systemInstruction: SYSTEM_PROMPT
    });

    // Determine mode based on conversation state
    let mode = 'planning';
    const lowerPrompt = prompt.toLowerCase();
    
    // Check if we're executing a step
    if (session.executionState === 'executing' && session.currentPlan?.length > 0) {
      mode = 'execution';
    }
    // Check if this is a simple single action
    else if (lowerPrompt.includes('create') || lowerPrompt.includes('add') || 
             lowerPrompt.includes('make') || lowerPrompt.includes('build')) {
      mode = 'execution';
    }
    // Check if user is asking for analysis/planning
    else if (lowerPrompt.includes('plan') || lowerPrompt.includes('how to') || 
             lowerPrompt.includes('multiple') || lowerPrompt.includes('several')) {
      mode = 'planning';
    }

    const aiPrompt = buildPrompt(prompt, context, sessionId, mode);
    console.log(`[AI] Mode: ${mode}, Prompt length: ${aiPrompt.length}`);
    
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
      aiResponse = {
        mode: 'error',
        message: 'Processing error',
        error: parseError.message
      };
    }

    // Handle different response modes
    switch (aiResponse.mode) {
      case 'plan':
        // Store plan for step-by-step execution
        session.currentPlan = aiResponse.plan || [];
        session.currentStep = 0;
        session.executionState = 'executing';
        
        // Auto-execute first step if plan is small
        if (session.currentPlan.length === 1) {
          session.currentStep = 1; // Mark as completed
          return {
            ...aiResponse,
            autoExecute: true,
            metadata: {
              planSteps: session.currentPlan.length,
              nextAction: 'Execute first step automatically'
            }
          };
        }
        
        return {
          ...aiResponse,
          metadata: {
            planSteps: session.currentPlan.length,
            nextAction: 'Ready to execute step by step'
          }
        };
        
      case 'execute':
        // Update session with executed action
        if (aiResponse.action === 'create') {
          session.createdInstances.push({
            name: aiResponse.data?.name || 'unknown',
            type: aiResponse.data?.classtype || 'unknown',
            parent: aiResponse.data?.parent || 'unknown',
            timestamp: new Date().toISOString()
          });
        } else if (aiResponse.action === 'modify') {
          session.modifiedInstances.push({
            name: aiResponse.data?.name || 'unknown',
            changes: aiResponse.data?.sourceModifications?.action || 'unknown',
            timestamp: new Date().toISOString()
          });
        }
        
        // Check if we have more steps in plan
        if (session.executionState === 'executing' && session.currentStep < session.currentPlan.length) {
          session.currentStep++;
          
          if (session.currentStep >= session.currentPlan.length) {
            session.executionState = 'complete';
          }
        }
        
        return {
          ...aiResponse,
          metadata: {
            responseTime,
            tokenUsage: text.length,
            sessionStep: session.currentStep,
            totalSteps: session.currentPlan.length,
            executionState: session.executionState
          }
        };
        
      case 'request':
        // AI needs information - store request
        session.pendingActions = session.pendingActions || [];
        session.pendingActions.push({
          type: aiResponse.needs?.type || 'unknown',
          instanceName: aiResponse.needs?.instanceName,
          reason: aiResponse.needs?.reason,
          timestamp: new Date().toISOString()
        });
        
        return {
          ...aiResponse,
          metadata: {
            needsInfo: true,
            requestedItem: aiResponse.needs?.instanceName
          }
        };
        
      default:
        return {
          mode: 'execute',
          action: 'create',
          message: 'Processing your request',
          data: {
            name: 'Placeholder',
            classtype: 'Part',
            properties: {},
            parent: 'game.Workspace',
            content: '-- Processing...'
          },
          reasoning: 'Default response'
        };
    }
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      mode: 'error',
      message: 'AI processing failed',
      error: error.message,
      metadata: { error: true }
    };
  }
}

// Enhanced instance finding with exact matching
function findExactInstance(instanceName, context) {
  if (!instanceName || !context) return null;
  
  const nameLower = instanceName.toLowerCase();
  
  // Check in existing instances
  if (context.existingInstances && Array.isArray(context.existingInstances)) {
    for (const inst of context.existingInstances) {
      if (inst.Name && inst.Name.toLowerCase() === nameLower) {
        return {
          name: inst.Name,
          className: inst.ClassName,
          path: inst.Path,
          fullObject: inst
        };
      }
    }
  }
  
  // Check in source codes keys
  if (context.sourceCodes) {
    for (const path of Object.keys(context.sourceCodes)) {
      const parts = path.split('.');
      const lastPart = parts[parts.length - 1];
      if (lastPart.toLowerCase() === nameLower) {
        return {
          name: lastPart,
          path: path,
          hasSource: true
        };
      }
    }
  }
  
  return null;
}

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI v4.0',
    version: '4.0',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Step-by-step execution',
      'Low token usage',
      'Real-time instance creation',
      'Smart planning system',
      'No replaceAll - targeted edits only'
    ],
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    model: 'gemini-3-flash-preview',
    uptime: process.uptime(),
    sessions: sessionMemory.size,
    memory: process.memoryUsage()
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
    createdInstances: session.createdInstances?.length || 0,
    modifiedInstances: session.modifiedInstances?.length || 0,
    tokenUsage: session.tokenUsage || 0,
    pendingActions: session.pendingActions?.length || 0,
    timestamp: new Date(session.timestamp).toISOString()
  });
});

app.delete('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const deleted = sessionMemory.delete(sessionId);
  
  res.json({
    success: deleted,
    message: deleted ? 'Session cleared' : 'Session not found',
    remainingSessions: sessionMemory.size
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
    
    console.log(`[Request] Session: ${sessionId}, Prompt: "${prompt.substring(0, 50)}..."`);
    
    // Process the request
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    
    // Add session info to response
    const session = sessionMemory.get(sessionId);
    if (session) {
      aiResponse.sessionInfo = {
        state: session.executionState,
        step: session.currentStep,
        totalSteps: session.currentPlan?.length || 0,
        createdCount: session.createdInstances?.length || 0
      };
    }
    
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
    res.status(500).json({ 
      mode: 'error',
      message: 'Server error',
      error: error.message,
      metadata: { serverError: true }
    });
  }
});

// Session cleanup
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  let cleaned = 0;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - session.timestamp > oneHour) {
      sessionMemory.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[Cleanup] Removed ${cleaned} old sessions`);
  }
}, 30 * 60 * 1000);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Middleware Error]:', err.stack);
  res.status(500).json({ 
    mode: 'error',
    message: 'Internal server error',
    error: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    mode: 'error',
    message: 'Route not found',
    path: req.path
  });
});

app.listen(PORT, () => {
  console.log('==========================================');
  console.log('ACIDNADE AI v4.0 - OPTIMIZED EXECUTION');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Optimizations:');
  console.log('  • ✅ Step-by-step execution');
  console.log('  • ✅ Ultra-low token usage');
  console.log('  • ✅ Real-time instance creation');
  console.log('  • ✅ Smart mode detection');
  console.log('  • ✅ No unnecessary source code');
  console.log('  • ✅ Auto-plan for multi-step requests');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});
