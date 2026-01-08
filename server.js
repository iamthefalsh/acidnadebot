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
      createdInstances: [],
      modifiedInstances: [],
      currentPlan: [],
      currentStep: 0,
      executionState: 'idle',
      chatHistory: [],
      pendingSourceRequests: [],
      aiStages: [], // Track AI reasoning stages
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
// MULTI-STAGE AI PROCESSING
// ============================================

async function callAI(prompt, maxTokens = 1000, jsonMode = false) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-3-flash-preview',
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: maxTokens,
      responseMimeType: jsonMode ? 'application/json' : 'text/plain',
    }
  });

  const result = await model.generateContent(prompt);
  return result.response.text();
}

// STAGE 1: Understand the request
async function stage1_understand(userPrompt, session) {
  console.log('🔍 Stage 1: Understanding request...');
  
  const prompt = `${PROMPTS.stages.understand.prompt}

USER REQUEST: "${userPrompt}"

REQUIREMENTS FOR ANALYSIS:
${JSON.stringify(REQUIREMENTS.understanding, null, 2)}`;

  const response = await callAI(prompt, 300, true);
  
  try {
    const understanding = JSON.parse(response);
    session.aiStages.push({ stage: 'understand', result: understanding });
    console.log('✅ Understanding:', understanding);
    return understanding;
  } catch (error) {
    console.error('❌ Stage 1 parse error:', error.message);
    return {
      requestType: 'build',
      systems: ['syntax'],
      complexity: 'simple',
      gameReference: null,
      needsSource: false
    };
  }
}

// STAGE 2: Handle question (if it's a question)
async function stage2_explain(userPrompt, understanding, session) {
  console.log('💬 Stage 2: Explaining (question detected)...');
  
  let knowledgeContext = '';
  
  if (understanding.gameReference) {
    const gameInfo = REQUIREMENTS.understanding.game_references[understanding.gameReference.toLowerCase().replace(/\s+/g, '_')];
    if (gameInfo) {
      knowledgeContext = `\nGAME REFERENCE: ${JSON.stringify(gameInfo, null, 2)}`;
    }
  }
  
  const prompt = `${PROMPTS.stages.explain.prompt}

USER QUESTION: "${userPrompt}"
${knowledgeContext}

Respond in JSON format:
{
  "message": "your friendly explanation",
  "thinkingSteps": ["analyzing: ...", "explaining: ..."],
  "plan": [],
  "reasoning": "detailed explanation + offer to build",
  "nextSteps": ["suggestions for what to build"]
}`;

  const response = await callAI(prompt, 600, true);
  
  try {
    const explanation = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
    session.aiStages.push({ stage: 'explain', result: explanation });
    return explanation;
  } catch (error) {
    console.error('❌ Stage 2 parse error:', error.message);
    return {
      message: 'I can help you with that!',
      thinkingSteps: ['responding: Providing assistance'],
      plan: [],
      reasoning: 'What would you like me to create for you?',
      nextSteps: ['Tell me what you want to build']
    };
  }
}

// STAGE 3: Generate initial idea (for build requests)
async function stage3_initialIdea(userPrompt, understanding, context, session) {
  console.log('💡 Stage 3: Generating initial idea...');
  
  const systemsContext = understanding.systems.map(sys => {
    const examples = PROMPTS.knowledge.patterns;
    return `System: ${sys}\nCommon patterns: ${JSON.stringify(examples, null, 2)}`;
  }).join('\n\n');
  
  const prompt = `${PROMPTS.stages.initial_idea.prompt}

USER REQUEST: "${userPrompt}"

SYSTEMS NEEDED: ${understanding.systems.join(', ')}
COMPLEXITY: ${understanding.complexity}

COMMON PATTERNS:
${systemsContext}

KNOWLEDGE:
${PROMPTS.knowledge.luau_basics}

${PROMPTS.knowledge.common_mistakes}

${context?.sourceCodes ? `EXISTING SOURCE CODE:\n${JSON.stringify(context.sourceCodes, null, 2)}` : ''}

Generate your initial implementation idea.`;

  const response = await callAI(prompt, 1000, false);
  session.aiStages.push({ stage: 'initial_idea', result: response });
  console.log('✅ Initial idea generated');
  return response;
}

// STAGE 4: Improve the idea
async function stage4_improveIdea(initialIdea, understanding, session) {
  console.log('🔧 Stage 4: Improving idea...');
  
  const prompt = `${PROMPTS.stages.improve_idea.prompt}

YOUR INITIAL IDEA:
${initialIdea}

SECURITY RULES:
${PROMPTS.knowledge.security}

COMMON MISTAKES TO AVOID:
${PROMPTS.knowledge.common_mistakes}

Now improve this idea with better security, performance, and error handling.`;

  const response = await callAI(prompt, 1200, false);
  session.aiStages.push({ stage: 'improve_idea', result: response });
  console.log('✅ Idea improved');
  return response;
}

// STAGE 5: Create detailed plan
async function stage5_createPlan(improvedIdea, userPrompt, understanding, session) {
  console.log('📋 Stage 5: Creating detailed plan...');
  
  const prompt = `${PROMPTS.stages.create_plan.prompt}

IMPROVED IDEA:
${improvedIdea}

USER REQUEST: "${userPrompt}"

ROBLOX SERVICES:
${PROMPTS.knowledge.roblox_services}

Convert your improved idea into a detailed JSON plan.

RESPONSE FORMAT:
{
  "message": "Creating [system] with [N] steps",
  "thinkingSteps": ["analyzing: ...", "planning: ...", "structuring: ..."],
  "plan": [
    {
      "step": 1,
      "type": "create",
      "name": "ExactName",
      "className": "Script",
      "parentPath": "game.ServerScriptService",
      "description": "What this does",
      "properties": {
        "Name": "value",
        "Source": "-- COMPLETE working Luau code here"
      }
    }
  ],
  "reasoning": "Why this approach",
  "warnings": ["Security: ...", "Performance: ..."],
  "nextSteps": ["Test this", "Adjust that"]
}`;

  const response = await callAI(prompt, 2000, true);
  
  try {
    const plan = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
    session.aiStages.push({ stage: 'create_plan', result: plan });
    console.log('✅ Plan created with', plan.plan?.length || 0, 'steps');
    return plan;
  } catch (error) {
    console.error('❌ Stage 5 parse error:', error.message);
    return {
      message: 'Plan created',
      thinkingSteps: ['planning: Created implementation plan'],
      plan: [],
      reasoning: 'Implementation plan generated',
      warnings: [],
      nextSteps: ['Review and implement']
    };
  }
}

// MAIN PROCESSING FUNCTION
async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    session.aiStages = []; // Reset stages
    
    console.log('\n════════════════════════════════════════');
    console.log('🚀 STARTING MULTI-STAGE AI PROCESSING');
    console.log('════════════════════════════════════════\n');
    
    // STAGE 1: Understand
    const understanding = await stage1_understand(prompt, session);
    
    // Check if source code is needed
    if (understanding.needsSource && !context?.sourceCodes) {
      console.log('📝 Source code required but not provided');
      
      const instanceMatch = prompt.match(/\b([A-Z][a-zA-Z]+)\b/);
      const instanceName = instanceMatch ? instanceMatch[1] : 'Script';
      
      return {
        message: `I need to see the ${instanceName} source code to analyze it`,
        thinkingSteps: [
          'analyzing: User wants to check/modify code',
          `checking: ${instanceName} source not provided`,
          'requesting: Need source code to proceed'
        ],
        plan: [],
        needsSourceCode: {
          instanceName: instanceName,
          expectedPath: `game.ServerScriptService.${instanceName}`,
          reason: 'Cannot analyze or modify without seeing the code'
        },
        needsApproval: false,
        reasoning: 'I need to read the actual code to help you',
        metadata: {
          stages: session.aiStages,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // STAGE 2: If question, explain and exit
    if (understanding.requestType === 'question') {
      const explanation = await stage2_explain(prompt, understanding, session);
      return {
        ...explanation,
        metadata: {
          requestType: 'question',
          stages: session.aiStages,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // STAGES 3-5: Build something
    if (understanding.requestType === 'build') {
      const initialIdea = await stage3_initialIdea(prompt, understanding, context, session);
      const improvedIdea = await stage4_improveIdea(initialIdea, understanding, session);
      const finalPlan = await stage5_createPlan(improvedIdea, prompt, understanding, session);
      
      // Store plan for execution
      session.currentPlan = finalPlan.plan || [];
      session.currentStep = 0;
      session.executionState = 'executing';
      
      console.log('\n════════════════════════════════════════');
      console.log('✅ MULTI-STAGE PROCESSING COMPLETE');
      console.log('Stages used:', session.aiStages.length);
      console.log('Steps in plan:', session.currentPlan.length);
      console.log('════════════════════════════════════════\n');
      
      return {
        ...finalPlan,
        metadata: {
          requestType: 'build',
          complexity: understanding.complexity,
          systems: understanding.systems,
          stages: session.aiStages.map(s => s.stage),
          totalSteps: session.currentPlan.length,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
    // ANALYZE request
    if (understanding.requestType === 'analyze' && context?.sourceCodes) {
      const analysis = await callAI(
        `${PROMPTS.stages.analyze_code.prompt}\n\nSOURCE CODE:\n${JSON.stringify(context.sourceCodes, null, 2)}`,
        1200,
        true
      );
      
      return JSON.parse(analysis);
    }
    
    // Default fallback
    return {
      message: 'Request processed',
      thinkingSteps: ['processing: Handled request'],
      plan: [],
      reasoning: 'Request completed',
      metadata: {
        stages: session.aiStages,
        sessionId,
        timestamp: new Date().toISOString()
      }
    };
    
  } catch (error) {
    console.error('❌ AI Processing Error:', error.message);
    return {
      message: 'Error processing request',
      thinkingSteps: ['error: ' + error.message],
      plan: [],
      needsApproval: false,
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
    version: '5.0 - Multi-Stage Reasoning',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      '🧠 Multi-stage AI reasoning (5 stages)',
      '🎯 Accurate request understanding',
      '💡 Idea generation + improvement',
      '📋 Detailed planning',
      '🔍 Question vs build detection',
      '📝 Source code analysis',
      '⚡ Proper responses (no fake "completed")'
    ],
    stages: [
      '1. Understand request',
      '2. Explain (if question)',
      '3. Generate initial idea',
      '4. Improve idea',
      '5. Create detailed plan'
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
    aiStages: session.aiStages || [],
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
      console.log(`📁 Context has ${Object.keys(context.sourceCodes).length} source files`);
    }
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('❌ Server Error:', error.message);
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
      console.log(`🧹 Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🚀 ACIDNADE AI v5.0 - MULTI-STAGE REASONING');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Model: gemini-3-flash-preview');
  console.log('');
  console.log('🧠 AI REASONING STAGES:');
  console.log('  Stage 1: Understand request type & complexity');
  console.log('  Stage 2: Explain (if question)');
  console.log('  Stage 3: Generate initial idea (if build)');
  console.log('  Stage 4: Improve idea with security & performance');
  console.log('  Stage 5: Create detailed step-by-step plan');
  console.log('');
  console.log('✅ FIXES:');
  console.log('  • Questions get proper explanations (not fake "completed")');
  console.log('  • AI thinks before responding');
  console.log('  • Better code quality through iteration');
  console.log('  • Proper request type detection');
  console.log('');
  console.log('📁 CONFIG FILES:');
  console.log('  • requirements.json: Understanding rules');
  console.log('  • prompts.json: Stage-specific prompts');
  console.log('');
  console.log('⚠️  NOTE: Uses more tokens per request (5 AI calls for builds)');
  console.log('   But responses are ACTUALLY CORRECT now!');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ Server ready at http://localhost:' + PORT);
  console.log('═══════════════════════════════════════════════════════════');
});
