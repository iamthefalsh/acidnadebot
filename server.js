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
      createdInstances: [],
      modifiedInstances: [],
      chatHistory: [],
      currentPlan: null,
      currentStepIndex: 0,
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

// UPDATED SYSTEM PROMPT - EMPHASIZES FIXING AND STEP-BY-STEP
const SYSTEM_PROMPT = `You are Acidnade AI, an expert Roblox Studio AI assistant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CORE MISSION: FIX FIRST, CREATE SECOND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**PRIORITY ORDER:**
1. 🔧 **FIX existing code** (bugs, errors, improvements)
2. 🛠️ **MODIFY existing instances** (change properties, update logic)
3. ➕ **CREATE new instances** (only if nothing exists to fix/modify)

When user says "fix", "broken", "not working", "error":
- ALWAYS prioritize modifying existing code
- NEVER create new scripts if one exists
- Request source code if you need to see what's wrong

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP-BY-STEP EXECUTION MODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You work in STEPS, not all at once:

**PHASE 1: PLANNING**
- Analyze the request
- Create a plan with numbered steps
- Return the plan WITHOUT executing

**PHASE 2: EXECUTION**
- Execute ONE step at a time
- If you need source code, REQUEST it (don't assume you have it)
- Wait for step result before continuing

**PHASE 3: ITERATION**
- Process step result
- Continue to next step or finish

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RESPONSE FORMATS (STRICT JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Format 1: PLANNING (First response)
{
  "mode": "planning",
  "message": "I'll fix the CurrencyManager in 3 steps",
  "plan": [
    {
      "stepNumber": 1,
      "description": "Read CurrencyManager source code",
      "action": "requestSource",
      "target": {
        "name": "CurrencyManager",
        "path": "game.ServerScriptService"
      }
    },
    {
      "stepNumber": 2,
      "description": "Fix the spawning logic bug",
      "action": "modify"
    },
    {
      "stepNumber": 3,
      "description": "Test the fix",
      "action": "test"
    }
  ],
  "totalSteps": 3,
  "reasoning": "Need to read source code first to understand the bug"
}

### Format 2: REQUESTING SOURCE CODE
{
  "mode": "requestSource",
  "message": "I need to see the CurrencyManager code to fix it",
  "request": {
    "name": "CurrencyManager",
    "path": "game.ServerScriptService",
    "reason": "To analyze the spawning logic bug"
  },
  "currentStep": 1,
  "totalSteps": 3
}

### Format 3: EXECUTING STEP
{
  "mode": "executing",
  "message": "Fixing the spawning logic in CurrencyManager",
  "currentStep": 2,
  "totalSteps": 3,
  "actions": [
    {
      "type": "modify",
      "description": "Fix spawn rate check",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "replace",
        "target": "if spawnRate > 0 then",
        "newCode": "if spawnRate > 0 and currentCount < maxCount then"
      }
    }
  ],
  "reasoning": "Fixed the condition to check max count"
}

### Format 4: COMPLETION
{
  "mode": "complete",
  "message": "CurrencyManager bug fixed successfully",
  "summary": "Fixed spawning logic to respect max count limit",
  "totalStepsCompleted": 3
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## REQUESTING SOURCE CODE (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**When to request source code:**
- User mentions a bug or error
- User wants to fix existing script
- You need to see the code to modify it
- You're not sure what the current code does

**How to request:**
{
  "mode": "requestSource",
  "request": {
    "name": "ScriptName",
    "path": "game.ServerScriptService",
    "reason": "To understand the bug and fix it"
  }
}

**NEVER assume you have source code!**
**ALWAYS request it if you need it!**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## TARGETED MODIFICATIONS (NO REPLACEALL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use these actions IN ORDER:
1. **replace** - Change specific line(s)
2. **insertAfter** - Add code after line
3. **insertBefore** - Add code before line
4. **append** - Add to end
5. **prepend** - Add to beginning
6. **remove** - Delete line(s)

**FORBIDDEN:** replaceAll (deletes entire script)

Example:
{
  "sourceModifications": {
    "action": "replace",
    "target": "local maxGold = 1000",
    "newCode": "local maxGold = 100  -- Reduced limit"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## KEEP IT EFFICIENT (SAVE TOKENS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- ONE step at a time
- Request ONLY the source code you need
- Keep responses concise
- Don't repeat information

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **FIX BEFORE CREATE** - Always try to fix existing code first
2. **REQUEST SOURCE CODE** - Don't assume you have it
3. **ONE STEP AT A TIME** - Don't execute entire plan at once
4. **NO REPLACEALL** - Use targeted modifications
5. **SAVE TOKENS** - Be efficient with your responses
6. **BE SPECIFIC** - "Fixing spawn logic bug" not "Done"`;

// Build minimal prompt (NO SOURCE CODES UNLESS REQUESTED)
function buildPrompt(userPrompt, context, sessionId, requestedSource = null) {
  const session = initSession(sessionId);
  
  let prompt = 'USER REQUEST: ' + userPrompt + '\n\n';
  
  // Add session context (brief)
  if (session.createdInstances && session.createdInstances.length > 0) {
    prompt += 'CREATED IN SESSION:\n';
    session.createdInstances.slice(-5).forEach(inst => {
      prompt += `- ${inst.name} (${inst.className}) at ${inst.path}\n`;
    });
    prompt += '\n';
  }
  
  if (session.modifiedInstances && session.modifiedInstances.length > 0) {
    prompt += 'MODIFIED IN SESSION:\n';
    session.modifiedInstances.slice(-5).forEach(inst => {
      prompt += `- ${inst.name} at ${inst.path}\n`;
    });
    prompt += '\n';
  }
  
  // Add current plan if exists
  if (session.currentPlan) {
    prompt += `CURRENT PLAN (Step ${session.currentStepIndex}/${session.currentPlan.totalSteps}):\n`;
    prompt += JSON.stringify(session.currentPlan, null, 2) + '\n\n';
  }
  
  // Add requested source code ONLY if provided
  if (requestedSource) {
    prompt += `📜 REQUESTED SOURCE CODE:\n`;
    prompt += `Name: ${requestedSource.name}\n`;
    prompt += `Path: ${requestedSource.path}\n`;
    prompt += `\`\`\`lua\n${requestedSource.source}\n\`\`\`\n\n`;
    prompt += '⚠️ Use targeted modifications (replace, insertAfter) NOT replaceAll\n\n';
  }
  
  // Add BRIEF instance list (just names, no details)
  if (context && context.existingInstances && context.existingInstances.length > 0) {
    prompt += 'AVAILABLE INSTANCES (brief list):\n';
    const keywords = userPrompt.toLowerCase().split(/\s+/);
    const relevant = context.existingInstances.filter(inst => 
      inst && inst.Name && keywords.some(k => 
        k.length > 3 && inst.Name.toLowerCase().includes(k)
      )
    ).slice(0, 10);
    
    if (relevant.length > 0) {
      relevant.forEach(inst => {
        prompt += `- ${inst.Name} (${inst.ClassName}) at ${inst.Path}\n`;
      });
    } else {
      // Show first 5 if no relevant matches
      context.existingInstances.slice(0, 5).forEach(inst => {
        prompt += `- ${inst.Name} (${inst.ClassName}) at ${inst.Path}\n`;
      });
    }
    prompt += '\n';
  }
  
  // Add execution mode instructions
  if (!session.currentPlan) {
    prompt += 'MODE: PLANNING\n';
    prompt += 'Create a step-by-step plan. Do NOT execute yet.\n';
    prompt += 'If you need source code, include "requestSource" action in plan.\n';
  } else if (requestedSource) {
    prompt += 'MODE: EXECUTING\n';
    prompt += `Execute step ${session.currentStepIndex} of ${session.currentPlan.totalSteps}\n`;
    prompt += 'You now have the source code. Implement the fix.\n';
  } else {
    prompt += 'MODE: CONTINUE\n';
    prompt += `Continue with step ${session.currentStepIndex} of ${session.currentPlan.totalSteps}\n`;
  }
  
  return prompt;
}

async function processAIRequest(prompt, context, sessionId, requestedSource = null) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096,  // Reduced from 8192
        responseMimeType: 'application/json',
      },
      systemInstruction: SYSTEM_PROMPT
    });

    const fullPrompt = buildPrompt(prompt, context || {}, sessionId, requestedSource);
    console.log('[AI] Prompt length:', fullPrompt.length, 'characters');
    
    const startTime = Date.now();
    const result = await model.generateContent(fullPrompt);
    const thinkingTime = Date.now() - startTime;
    
    const text = result.response.text();
    let aiResponse;
    
    try {
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      aiResponse = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('[AI] Parse error:', parseError.message);
      aiResponse = {
        mode: 'error',
        message: 'Failed to parse AI response',
        error: true
      };
    }

    // Validate response
    if (!aiResponse.mode) aiResponse.mode = 'unknown';
    if (!aiResponse.message) aiResponse.message = 'Processing request';
    
    // Update session based on response mode
    const session = sessionMemory.get(sessionId);
    
    if (aiResponse.mode === 'planning') {
      session.currentPlan = aiResponse;
      session.currentStepIndex = 1;
    } else if (aiResponse.mode === 'complete') {
      session.currentPlan = null;
      session.currentStepIndex = 0;
    } else if (aiResponse.mode === 'executing') {
      session.currentStepIndex += 1;
    }
    
    aiResponse.metadata = {
      thinkingTime,
      model: 'gemini-2.0-flash-exp',
      sessionId,
      timestamp: new Date().toISOString(),
      promptLength: fullPrompt.length,
      tokensSaved: 'Not sending all source codes at once'
    };

    console.log(`[AI] Mode: ${aiResponse.mode}, Message: "${aiResponse.message}"`);
    return aiResponse;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      mode: 'error',
      message: 'Internal server error',
      error: true
    };
  }
}

app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI v3.0',
    status: 'online',
    model: 'gemini-2.0-flash-exp',
    features: [
      '🔧 FIX-FIRST approach',
      '📋 Step-by-step execution',
      '📜 On-demand source code requests',
      '💾 Token-efficient (no bulk source code)',
      '🎯 Targeted modifications only',
      '🚫 NO replaceAll by default'
    ],
    modes: [
      'planning - Create step-by-step plan',
      'requestSource - Request specific source code',
      'executing - Execute current step',
      'complete - Task finished'
    ],
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    model: 'gemini-2.0-flash-exp',
    uptime: process.uptime(),
    sessions: sessionMemory.size
  });
});

// NEW ENDPOINT: Provide source code when AI requests it
app.post('/ai/provide-source', authenticateRequest, async (req, res) => {
  try {
    const { sessionId, name, path, source } = req.body;
    
    if (!sessionId || !name || !path || !source) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Need: sessionId, name, path, source'
      });
    }
    
    const session = sessionMemory.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Continue with the AI, now providing the source code
    const aiResponse = await processAIRequest(
      `Continue with the plan. I've provided the source code for ${name}.`,
      {},
      sessionId,
      { name, path, source }
    );
    
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Provide Source Error]:', error.message);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
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
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message
    });
  }
});

app.get('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessionMemory.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId,
    createdInstances: session.createdInstances || [],
    modifiedInstances: session.modifiedInstances || [],
    currentPlan: session.currentPlan || null,
    currentStepIndex: session.currentStepIndex || 0,
    chatHistory: session.chatHistory || [],
    timestamp: new Date(session.timestamp || Date.now()).toISOString()
  });
});

app.delete('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const deleted = sessionMemory.delete(sessionId);
  
  res.json({
    success: deleted,
    message: deleted ? 'Session cleared' : 'Session not found'
  });
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

app.use((err, req, res, next) => {
  console.error('[Middleware Error]:', err.message);
  res.status(500).json({ 
    mode: 'error',
    error: 'Internal error',
    message: err.message
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'Route does not exist'
  });
});

app.listen(PORT, () => {
  console.log('==========================================');
  console.log('ACIDNADE AI v3.0 - STEP-BY-STEP MODE');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('');
  console.log('KEY CHANGES:');
  console.log('  🔧 FIX-FIRST: Prioritizes fixing over creating');
  console.log('  📋 STEP-BY-STEP: Executes one step at a time');
  console.log('  📜 ON-DEMAND: Requests source code only when needed');
  console.log('  💾 TOKEN-EFFICIENT: No bulk source code sending');
  console.log('  🎯 TARGETED: No replaceAll by default');
  console.log('');
  console.log('RESPONSE MODES:');
  console.log('  • planning - Creates execution plan');
  console.log('  • requestSource - Asks for specific source code');
  console.log('  • executing - Runs current step');
  console.log('  • complete - Task finished');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
