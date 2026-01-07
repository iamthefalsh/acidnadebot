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

// Session memory store
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      createdInstances: [],      // Instances created in this session
      modifiedInstances: [],     // Instances modified in this session
      currentPlan: [],           // Current execution plan
      currentStep: 0,            // Current step in execution
      executionState: 'idle',    // idle, planning, executing, complete
      chatHistory: [],           // Conversation history
      pendingSourceRequests: [], // Files AI needs to read
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

// NEW: Optimized prompt that allows AI to request source code
const SYSTEM_PROMPT = `You are Acidnade AI, a Roblox Studio assistant. Provide JSON responses only.

RESPONSE FORMAT:
{
  "message": "Brief description",
  "thinkingSteps": ["state: description"],
  "plan": [{step1}, {step2}],
  "needsApproval": false,
  "reasoning": "Brief explanation"
}

CRITICAL RULES:
1. NEVER use "replaceAll" - use "replace", "insertAfter", "insertBefore"
2. If you need to read source code, add a "needsSourceCode" request
3. Break complex tasks into steps
4. Keep responses concise

SOURCE CODE REQUEST FORMAT:
If you need to read a specific file to understand it before modifying:
{
  "message": "I need to read FieldSystem to understand the code",
  "thinkingSteps": ["planning: Need to analyze FieldSystem"],
  "plan": [],
  "needsSourceCode": {
    "instanceName": "FieldSystem",
    "expectedPath": "game.ServerScriptService.FieldSystem or similar",
    "reason": "To identify image loading logic and UI creation steps"
  },
  "needsApproval": false,
  "reasoning": "Cannot modify without understanding existing code"
}

WORKFLOW:
1. If user asks to read/modify a file and you don't have it, request it
2. Once source code is provided, analyze it and create plan
3. Use targeted modifications only`;

// NEW: Helper to find instance by name
function findInstanceByName(instanceName, existingInstances, session) {
  if (!instanceName) return null;
  
  const nameLower = instanceName.toLowerCase();
  
  // Check session instances first
  const allSessionInstances = [];
  if (session) {
    if (session.createdInstances) allSessionInstances.push(...session.createdInstances);
    if (session.modifiedInstances) allSessionInstances.push(...session.modifiedInstances);
  }
  
  for (const inst of allSessionInstances) {
    if (inst.name && inst.name.toLowerCase() === nameLower) {
      return { name: inst.name, path: inst.path, className: inst.className, source: 'session' };
    }
  }
  
  // Check existing instances
  if (existingInstances && Array.isArray(existingInstances)) {
    for (const inst of existingInstances) {
      if (inst && inst.Name && inst.Name.toLowerCase() === nameLower) {
        return { name: inst.Name, path: inst.Path, className: inst.ClassName, source: 'project' };
      }
    }
  }
  
  return null;
}

// NEW: Build prompt that tells AI what files are available
function buildPrompt(userPrompt, context, sessionId, mode = 'planning') {
  const session = initSession(sessionId);
  
  let prompt = '';
  
  if (mode === 'planning') {
    prompt = `USER REQUEST: ${userPrompt}\n\n`;
    
    // Check if user wants to read a specific file
    const wantsToRead = userPrompt.toLowerCase().includes('read') && 
                       (userPrompt.toLowerCase().includes('source') || 
                        userPrompt.toLowerCase().includes('code') ||
                        userPrompt.toLowerCase().includes('file'));
    
    if (wantsToRead) {
      // User wants to read a file - list available files
      prompt += 'USER WANTS TO READ A FILE. AVAILABLE SOURCE CODES:\n';
      
      if (context?.sourceCodes && Object.keys(context.sourceCodes).length > 0) {
        Object.keys(context.sourceCodes).forEach((path, index) => {
          // Extract instance name from path
          const parts = path.split('.');
          const name = parts[parts.length - 1];
          prompt += `${index + 1}. ${name} at ${path}\n`;
        });
        prompt += '\n';
        
        prompt += 'IF YOU NEED TO READ ONE OF THESE:\n';
        prompt += '1. Use "reading: Reading [name] at [path]" in thinkingSteps\n';
        prompt += '2. Analyze the code shown below\n';
        prompt += '3. Provide summary or plan based on code\n\n';
        
        // Include the source code for analysis
        Object.entries(context.sourceCodes).forEach(([path, code]) => {
          prompt += `--- ${path} ---\n`;
          prompt += '```lua\n';
          prompt += code.length > 2000 ? code.substring(0, 2000) + '...' : code;
          prompt += '\n```\n\n';
        });
      } else {
        prompt += 'NO SOURCE CODE PROVIDED. You can request it by returning:\n';
        prompt += '{\n';
        prompt += '  "needsSourceCode": {\n';
        prompt += '    "instanceName": "FieldSystem",\n';
        prompt += '    "expectedPath": "game.ServerScriptService.FieldSystem",\n';
        prompt += '    "reason": "To analyze the code structure"\n';
        prompt += '  }\n';
        prompt += '}\n\n';
      }
    }
    
    // Add session context briefly
    if (session.createdInstances?.length > 0) {
      prompt += 'RECENTLY CREATED:\n';
      session.createdInstances.slice(-3).forEach(inst => {
        prompt += `- ${inst.name} at ${inst.path}\n`;
      });
      prompt += '\n';
    }
    
    // Check for pending source requests
    if (session.pendingSourceRequests?.length > 0) {
      prompt += 'PENDING SOURCE REQUESTS:\n';
      session.pendingSourceRequests.forEach(req => {
        prompt += `- ${req.instanceName} at ${req.expectedPath || 'unknown'}\n`;
      });
      prompt += '\n';
    }
    
    prompt += 'INSTRUCTIONS:\n';
    prompt += '1. If source code is shown above, analyze it\n';
    prompt += '2. If no source code, request it with needsSourceCode\n';
    prompt += '3. Create a plan with steps\n';
    prompt += '4. Keep plan concise\n';
    
  } else if (mode === 'execution') {
    const currentStep = session.currentStep || 0;
    const step = session.currentPlan?.[currentStep];
    
    prompt = `EXECUTING STEP ${currentStep + 1}: ${step?.description || 'Unknown step'}\n\n`;
    
    if (step?.type === 'modify' && context?.sourceCodes) {
      // Find source code for this specific step
      let sourceCode = null;
      Object.entries(context.sourceCodes).forEach(([path, code]) => {
        if (path.includes(step.name) || (step.parentPath && path.includes(step.parentPath))) {
          sourceCode = code;
        }
      });
      
      if (sourceCode) {
        prompt += `SOURCE CODE for ${step.name}:\n`;
        prompt += '```lua\n';
        prompt += sourceCode.length > 1500 ? sourceCode.substring(0, 1500) + '...' : sourceCode;
        prompt += '\n```\n\n';
      }
    }
    
    prompt += `ACTION: ${step?.type || 'create'}\n`;
    prompt += `TARGET: ${step?.name || 'New instance'} at ${step?.parentPath || 'game.Workspace'}\n\n`;
    prompt += 'INSTRUCTIONS:\n';
    prompt += '1. Implement ONLY this step\n';
    prompt += '2. Use targeted modifications\n';
    prompt += '3. Provide code changes\n';
  }
  
  return prompt;
}

// NEW: Check if AI needs to request source code
function shouldRequestSourceCode(userPrompt, context, session) {
  const lowerPrompt = userPrompt.toLowerCase();
  
  // Check for read requests
  const wantsToRead = lowerPrompt.includes('read') && 
                     (lowerPrompt.includes('source') || 
                      lowerPrompt.includes('code') ||
                      lowerPrompt.includes('file'));
  
  // Check for modification requests that need code
  const wantsToModify = lowerPrompt.includes('modify') || 
                       lowerPrompt.includes('fix') || 
                       lowerPrompt.includes('change') ||
                       lowerPrompt.includes('edit');
  
  // Extract potential instance names
  const instanceNameMatch = userPrompt.match(/\b([A-Z][a-zA-Z]+)\b/);
  const instanceName = instanceNameMatch ? instanceNameMatch[1] : null;
  
  // If user wants to read/modify a specific instance but we don't have source code
  if ((wantsToRead || wantsToModify) && instanceName) {
    // Check if we have source code for this instance
    if (context?.sourceCodes) {
      const hasSourceCode = Object.keys(context.sourceCodes).some(path => 
        path.toLowerCase().includes(instanceName.toLowerCase())
      );
      
      if (!hasSourceCode) {
        return {
          needsSource: true,
          instanceName: instanceName,
          reason: `User wants to ${wantsToRead ? 'read' : 'modify'} ${instanceName} but source code not provided`
        };
      }
    } else {
      return {
        needsSource: true,
        instanceName: instanceName || 'unknown',
        reason: 'No source code provided at all'
      };
    }
  }
  
  return { needsSource: false };
}

// NEW: Process AI request with source code handling
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

    // Check if we should request source code
    const sourceCheck = shouldRequestSourceCode(prompt, context, session);
    
    if (sourceCheck.needsSource) {
      console.log(`[AI] Need source code for: ${sourceCheck.instanceName}`);
      
      // Add to pending requests
      if (!session.pendingSourceRequests) {
        session.pendingSourceRequests = [];
      }
      
      session.pendingSourceRequests.push({
        instanceName: sourceCheck.instanceName,
        timestamp: new Date().toISOString(),
        reason: sourceCheck.reason
      });
      
      // Return request for source code
      return {
        message: `I need to read ${sourceCheck.instanceName} source code to proceed`,
        thinkingSteps: [
          'planning: Analyzing user request',
          `reading: Source code for ${sourceCheck.instanceName} not provided`,
          'working: Requesting source code from user'
        ],
        plan: [],
        needsSourceCode: {
          instanceName: sourceCheck.instanceName,
          expectedPath: `game.ServerScriptService.${sourceCheck.instanceName}`,
          reason: sourceCheck.reason
        },
        needsApproval: false,
        reasoning: 'Cannot analyze or modify code without seeing the source first'
      };
    }
    
    // Clear pending requests if we now have source code
    if (session.pendingSourceRequests?.length > 0 && context?.sourceCodes) {
      session.pendingSourceRequests = [];
    }

    // Check execution state
    if (session.executionState === 'idle') {
      // Planning phase
      session.executionState = 'planning';
      const planningPrompt = buildPrompt(prompt, context, sessionId, 'planning');
      
      console.log('[AI] Planning phase, prompt length:', planningPrompt.length);
      
      const planResult = await model.generateContent(planningPrompt);
      const planText = planResult.response.text();
      
      let aiResponse;
      try {
        const cleanedText = planText.replace(/```json\n?|\n?```/g, '').trim();
        aiResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] Parse error:', parseError.message);
        aiResponse = {
          message: 'Analyzing your request',
          thinkingSteps: ['planning: Processing request'],
          plan: [],
          needsApproval: false,
          reasoning: 'Creating execution plan'
        };
      }
      
      // If AI requests source code in response
      if (aiResponse.needsSourceCode) {
        return aiResponse;
      }
      
      // Store plan
      session.currentPlan = aiResponse.plan || [];
      session.currentStep = 0;
      session.executionState = 'executing';
      
      return {
        message: aiResponse.message || 'Plan created',
        thinkingSteps: aiResponse.thinkingSteps || ['planning: Request analyzed'],
        plan: aiResponse.plan || [],
        needsApproval: aiResponse.needsApproval || false,
        reasoning: aiResponse.reasoning || 'Ready to execute',
        metadata: {
          mode: 'planning',
          totalSteps: aiResponse.plan?.length || 0,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
      
    } else if (session.executionState === 'executing') {
      // Execute current step
      const currentStep = session.currentStep;
      const totalSteps = session.currentPlan.length;
      
      if (currentStep >= totalSteps) {
        session.executionState = 'complete';
        return {
          message: 'All steps completed successfully',
          thinkingSteps: ['complete: Execution finished'],
          plan: [],
          needsApproval: false,
          reasoning: 'All planned steps executed',
          metadata: {
            mode: 'complete',
            sessionId,
            timestamp: new Date().toISOString()
          }
        };
      }
      
      const executionPrompt = buildPrompt(prompt, context, sessionId, 'execution');
      
      console.log(`[AI] Executing step ${currentStep + 1}/${totalSteps}`);
      
      const stepResult = await model.generateContent(executionPrompt);
      const stepText = stepResult.response.text();
      
      let stepResponse;
      try {
        const cleanedText = stepText.replace(/```json\n?|\n?```/g, '').trim();
        stepResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] Step parse error:', parseError.message);
        stepResponse = {
          message: `Executing step ${currentStep + 1}`,
          thinkingSteps: [`working: Processing step ${currentStep + 1}`],
          plan: [session.currentPlan[currentStep]],
          needsApproval: false,
          reasoning: 'Step execution'
        };
      }
      
      // Update session
      session.currentStep++;
      if (session.currentStep >= totalSteps) {
        session.executionState = 'complete';
      }
      
      return {
        message: stepResponse.message || `Step ${currentStep + 1} executed`,
        thinkingSteps: stepResponse.thinkingSteps || [`working: Completed step ${currentStep + 1}`],
        plan: stepResponse.plan || [],
        needsApproval: stepResponse.needsApproval || false,
        reasoning: stepResponse.reasoning || 'Step completed',
        metadata: {
          mode: 'execution',
          currentStep: currentStep + 1,
          totalSteps,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      message: 'Error processing request',
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal error',
      error: true
    };
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '3.1',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Source code request system',
      'File reading capability',
      'Step-by-step execution',
      'Targeted modifications only',
      'Context-aware file finding'
    ],
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
    createdInstances: session.createdInstances || [],
    pendingSourceRequests: session.pendingSourceRequests || [],
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
    
    // Initialize session
    const session = initSession(sessionId);
    
    // If context has source codes, log what's available
    if (context?.sourceCodes) {
      console.log(`[AI] Context has ${Object.keys(context.sourceCodes).length} source files`);
      Object.keys(context.sourceCodes).forEach(path => {
        console.log(`  - ${path}: ${context.sourceCodes[path].length} chars`);
      });
    }
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal server error'
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
      console.log(`[Cleanup] Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('==========================================');
  console.log('ACIDNADE AI v3.1 - SOURCE CODE READER');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('NEW FEATURES:');
  console.log('  • ✅ AI can request specific source files');
  console.log('  • ✅ Shows available files in context');
  console.log('  • ✅ Detects read/modify requests');
  console.log('  • ✅ Pending source request tracking');
  console.log('  • ✅ Better file path detection');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});
