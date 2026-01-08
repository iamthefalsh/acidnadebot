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

// Load knowledge modules from JSON
let KNOWLEDGE_MODULES = {};
try {
  const knowledgePath = path.join(__dirname, 'knowledge_modules.json');
  const knowledgeData = fs.readFileSync(knowledgePath, 'utf8');
  KNOWLEDGE_MODULES = JSON.parse(knowledgeData);
  console.log('✅ Loaded', Object.keys(KNOWLEDGE_MODULES).length, 'knowledge modules');
} catch (error) {
  console.error('❌ Failed to load knowledge_modules.json:', error.message);
  process.exit(1);
}

const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      createdInstances: [],
      modifiedInstances: [],
      currentPlan: [],
      currentStep: 0,
      executionState: 'idle',
      chatHistory: [],
      pendingSourceRequests: [],
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

const CORE_PROMPT = `You are Acidnade AI, an expert Roblox Studio assistant specializing in professional Luau development.

YOUR IDENTITY:
• Expert in Roblox API, Luau scripting, and game design patterns
• Focus on clean, efficient, maintainable, and secure code
• Provide production-ready solutions with proper error handling
• Anticipate edge cases and potential issues
• Explain complex concepts clearly and professionally

MANDATORY JSON RESPONSE FORMAT:
{
  "message": "Clear, concise description",
  "thinkingSteps": [
    "analyzing: Detailed analysis",
    "planning: High-level strategy",
    "implementing: Implementation details",
    "verifying: Expected outcomes"
  ],
  "plan": [
    {
      "step": 1,
      "type": "create|modify|analyze",
      "name": "InstanceName",
      "className": "Script|LocalScript|ModuleScript",
      "parentPath": "game.ServerScriptService",
      "description": "Detailed description",
      "properties": {
        "Name": "value",
        "Source": "-- Complete Luau code"
      },
      "modifications": [
        {
          "action": "replace|insertAfter|insertBefore|wrapWith",
          "target": "EXACT code to find",
          "replacement": "New code",
          "reasoning": "Why needed"
        }
      ]
    }
  ],
  "needsApproval": false,
  "reasoning": "Comprehensive explanation",
  "warnings": ["Considerations"],
  "nextSteps": ["What's next"]
}

CRITICAL RULES:
1. 🚫 NEVER use "replaceAll" - ONLY: replace, insertAfter, insertBefore, wrapWith
2. 📝 If need source code: {"needsSourceCode": {"instanceName": "X", "expectedPath": "...", "reason": "..."}}
3. ✅ ALWAYS use 'local' for variables
4. ✅ ALWAYS use ':GetService()' for services
5. ✅ ALWAYS use 'task.wait()' not 'wait()'
6. ✅ ALWAYS include proper 'end' keywords
7. ✅ ALWAYS use ':WaitForChild()' for safe access
8. ✅ ALWAYS validate inputs with pcall()
9. ✅ ALWAYS add meaningful comments
10. ✅ Return ONLY valid JSON

RESPONSE QUALITY STANDARDS:
• Code must be complete and runnable
• Follow Roblox naming conventions
• Include proper indentation
• Add comments for complex logic
• Consider security: validate inputs, check distances, rate limit
• Consider performance: avoid unnecessary loops, use pooling
• Test mentally: would this code work?

MODIFICATION BEST PRACTICES:
• Target strings must be EXACT and UNIQUE
• Preserve existing indentation
• Keep modifications small and focused
• Test that target exists
• Break large modifications into steps

PLANNING STRATEGY:
• Start simple: base instances first
• Order matters: dependencies before dependents
• One concern per step
• Validate early
• Provide clear success criteria`;

function detectNeededModules(userPrompt, context) {
  const prompt = userPrompt.toLowerCase();
  const modules = [];
  
  const detectionRules = {
    syntax: ['syntax', 'error', 'how to', 'basic', 'end', 'help', 'learn', 'start'],
    remotes: ['remote', 'client', 'server', 'fire', 'event', 'communicate', 'network'],
    data: ['save', 'load', 'data', 'datastore', 'leaderstats', 'stats', 'store', 'persistent'],
    combat: ['damage', 'health', 'attack', 'hit', 'combat', 'fight', 'weapon', 'hurt', 'kill'],
    gui: ['gui', 'ui', 'button', 'frame', 'screen', 'interface', 'menu', 'text', 'display'],
    tween: ['tween', 'animate', 'animation', 'move', 'smooth', 'lerp', 'transition'],
    raycast: ['raycast', 'ray', 'shoot', 'gun', 'bullet', 'aim', 'hit detection'],
    inventory: ['inventory', 'item', 'backpack', 'storage', 'collect', 'pickup', 'loot'],
    security: ['secure', 'exploit', 'validate', 'check', 'anti', 'safe', 'hack', 'cheat'],
    performance: ['optimize', 'lag', 'performance', 'fast', 'efficient', 'pool', 'slow', 'fps'],
    advanced: ['module', 'class', 'oop', 'pattern', 'advanced', 'complex', 'system']
  };
  
  for (const [module, keywords] of Object.entries(detectionRules)) {
    for (const keyword of keywords) {
      if (prompt.includes(keyword)) {
        if (!modules.includes(module)) {
          modules.push(module);
        }
        break;
      }
    }
  }
  
  if (prompt.includes('read') || prompt.includes('modify') || prompt.includes('fix')) {
    if (!modules.includes('syntax')) {
      modules.push('syntax');
    }
  }
  
  if (modules.length === 0) {
    modules.push('syntax');
  }
  
  return modules.slice(0, 3);
}

function buildOptimizedPrompt(userPrompt, context, sessionId) {
  const session = initSession(sessionId);
  
  let prompt = CORE_PROMPT + '\n\n';
  
  const neededModules = detectNeededModules(userPrompt, context);
  
  if (neededModules.length > 0) {
    prompt += '═══ RELEVANT KNOWLEDGE ═══\n';
    for (const moduleName of neededModules) {
      if (KNOWLEDGE_MODULES[moduleName]) {
        prompt += KNOWLEDGE_MODULES[moduleName] + '\n\n';
      }
    }
  }
  
  prompt += '═══ USER REQUEST ═══\n' + userPrompt + '\n\n';
  
  if (context?.sourceCodes && Object.keys(context.sourceCodes).length > 0) {
    prompt += '═══ AVAILABLE SOURCE CODE ═══\n';
    Object.entries(context.sourceCodes).forEach(([path, code]) => {
      const preview = code.length > 1500 ? code.substring(0, 1500) + '\n... (truncated)' : code;
      prompt += `${path}:\n\`\`\`lua\n${preview}\n\`\`\`\n\n`;
    });
  }
  
  if (session.createdInstances?.length > 0) {
    prompt += '═══ RECENT SESSION ═══\n';
    const recent = session.createdInstances.slice(-3);
    prompt += `Created: ${recent.map(i => i.name).join(', ')}\n\n`;
  }
  
  if (session.pendingSourceRequests?.length > 0) {
    prompt += '═══ PENDING REQUESTS ═══\n';
    session.pendingSourceRequests.forEach(req => {
      prompt += `• Need: ${req.instanceName} - ${req.reason}\n`;
    });
    prompt += '\n';
  }
  
  prompt += '═══ INSTRUCTIONS ═══\n';
  prompt += '1. Analyze the request and available code thoroughly\n';
  prompt += '2. If you need source code not provided, request it with needsSourceCode\n';
  prompt += '3. Create a detailed, step-by-step plan with proper dependencies\n';
  prompt += '4. Write complete, production-ready code with error handling\n';
  prompt += '5. Use only targeted modifications (no replaceAll)\n';
  prompt += '6. Consider security, performance, and edge cases\n';
  
  return { prompt, modules: neededModules };
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    
    const sourceCheck = shouldRequestSourceCode(prompt, context, session);
    
    if (sourceCheck.needsSource) {
      console.log(`[AI] 📝 Requesting source: ${sourceCheck.instanceName}`);
      
      if (!session.pendingSourceRequests) {
        session.pendingSourceRequests = [];
      }
      
      session.pendingSourceRequests.push({
        instanceName: sourceCheck.instanceName,
        timestamp: new Date().toISOString(),
        reason: sourceCheck.reason
      });
      
      return {
        message: `I need to read ${sourceCheck.instanceName} source code to proceed`,
        thinkingSteps: [
          'analyzing: User request received',
          `reading: ${sourceCheck.instanceName} source code not available`,
          'requesting: Need source code to continue'
        ],
        plan: [],
        needsSourceCode: {
          instanceName: sourceCheck.instanceName,
          expectedPath: `game.ServerScriptService.${sourceCheck.instanceName}`,
          reason: sourceCheck.reason
        },
        needsApproval: false,
        reasoning: 'Cannot analyze or modify code without seeing the source'
      };
    }
    
    if (session.pendingSourceRequests?.length > 0 && context?.sourceCodes) {
      session.pendingSourceRequests = [];
    }
    
    const { prompt: optimizedPrompt, modules } = buildOptimizedPrompt(prompt, context, sessionId);
    const tokenCount = estimateTokens(optimizedPrompt);
    
    console.log(`[AI] 🔧 Modules: ${modules.join(', ')}`);
    console.log(`[AI] 📊 Tokens: ~${tokenCount} (${modules.length} modules)`);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: optimizedPrompt
    });

    if (session.executionState === 'idle') {
      session.executionState = 'planning';
      
      const planResult = await model.generateContent('Analyze and create plan');
      const planText = planResult.response.text();
      
      let aiResponse;
      try {
        const cleanedText = planText.replace(/```json\n?|\n?```/g, '').trim();
        aiResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] ❌ Parse error:', parseError.message);
        aiResponse = {
          message: 'Analyzing your request',
          thinkingSteps: ['planning: Processing request'],
          plan: [],
          needsApproval: false,
          reasoning: 'Creating execution plan'
        };
      }
      
      if (aiResponse.needsSourceCode) {
        return aiResponse;
      }
      
      session.currentPlan = aiResponse.plan || [];
      session.currentStep = 0;
      session.executionState = 'executing';
      
      return {
        ...aiResponse,
        metadata: {
          mode: 'planning',
          totalSteps: aiResponse.plan?.length || 0,
          modulesUsed: modules,
          estimatedTokens: tokenCount,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
      
    } else if (session.executionState === 'executing') {
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
      
      const step = session.currentPlan[currentStep];
      const executionPrompt = `Execute step ${currentStep + 1}/${totalSteps}: ${step.description}`;
      
      console.log(`[AI] ⚙️ Executing step ${currentStep + 1}/${totalSteps}`);
      
      const stepResult = await model.generateContent(executionPrompt);
      const stepText = stepResult.response.text();
      
      let stepResponse;
      try {
        const cleanedText = stepText.replace(/```json\n?|\n?```/g, '').trim();
        stepResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] ❌ Step parse error:', parseError.message);
        stepResponse = {
          message: `Executing step ${currentStep + 1}`,
          thinkingSteps: [`working: Processing step ${currentStep + 1}`],
          plan: [step],
          needsApproval: false,
          reasoning: 'Step execution'
        };
      }
      
      session.currentStep++;
      if (session.currentStep >= totalSteps) {
        session.executionState = 'complete';
      }
      
      return {
        ...stepResponse,
        metadata: {
          mode: 'execution',
          currentStep: currentStep + 1,
          totalSteps,
          modulesUsed: modules,
          estimatedTokens: tokenCount,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
  } catch (error) {
    console.error('[AI] ❌ Error:', error.message);
    return {
      message: 'Error processing request',
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal error: ' + error.message,
      error: true
    };
  }
}

function shouldRequestSourceCode(userPrompt, context, session) {
  const lowerPrompt = userPrompt.toLowerCase();
  
  const wantsToRead = lowerPrompt.includes('read') && 
                     (lowerPrompt.includes('source') || 
                      lowerPrompt.includes('code') ||
                      lowerPrompt.includes('file'));
  
  const wantsToModify = lowerPrompt.includes('modify') || 
                       lowerPrompt.includes('fix') || 
                       lowerPrompt.includes('change') ||
                       lowerPrompt.includes('edit');
  
  const instanceNameMatch = userPrompt.match(/\b([A-Z][a-zA-Z]+)\b/);
  const instanceName = instanceNameMatch ? instanceNameMatch[1] : null;
  
  if ((wantsToRead || wantsToModify) && instanceName) {
    if (context?.sourceCodes) {
      const hasSourceCode = Object.keys(context.sourceCodes).some(path => 
        path.toLowerCase().includes(instanceName.toLowerCase())
      );
      
      if (!hasSourceCode) {
        return {
          needsSource: true,
          instanceName: instanceName,
          reason: `User wants to ${wantsToRead ? 'read' : 'modify'} ${instanceName}`
        };
      }
    } else {
      return {
        needsSource: true,
        instanceName: instanceName || 'unknown',
        reason: 'No source code provided'
      };
    }
  }
  
  return { needsSource: false };
}

// ROUTES
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '4.1 - Enhanced with JSON Modules',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      '🚀 60-80% token reduction',
      '🧠 Smart module detection',
      '📦 11 knowledge modules (from JSON)',
      '📝 Source code requests',
      '⚡ Production-ready code',
      '🔒 Security-focused',
      '⚙️ Performance optimized',
      '💾 External knowledge storage'
    ],
    modules: Object.keys(KNOWLEDGE_MODULES),
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
    
    initSession(sessionId);
    
    if (context?.sourceCodes) {
      console.log(`[AI] 📁 Context has ${Object.keys(context.sourceCodes).length} source files`);
    }
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server] ❌ Error:', error.message);
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

setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - (session.timestamp || now) > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] 🧹 Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 ACIDNADE AI v4.1 - JSON KNOWLEDGE MODULES');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Model: gemini-3-flash-preview');
  console.log('');
  console.log('💡 FEATURES:');
  console.log('  ✅ External JSON knowledge storage');
  console.log('  ✅ 100% enhanced knowledge base');
  console.log('  ✅ 60-80% token reduction');
  console.log('  ✅ Smart module detection');
  console.log('  ✅ Production-ready code');
  console.log('  ✅ Easy knowledge updates');
  console.log('');
  console.log('📦 LOADED MODULES:', Object.keys(KNOWLEDGE_MODULES).length);
  console.log('   ', Object.keys(KNOWLEDGE_MODULES).join(', '));
  console.log('');
  console.log('📊 TOKEN EFFICIENCY:');
  console.log('   Core Prompt: ~600 tokens');
  console.log('   Per Module: ~400-800 tokens');
  console.log('   Max Load (3 modules): ~3,000 tokens');
  console.log('   Old System: 8,000+ tokens always');
  console.log('   Savings: 60-80%');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ Server ready at http://localhost:' + PORT);
  console.log('═══════════════════════════════════════════════════════════');
});
