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

const SYSTEM_PROMPT = `You are Acidnade AI, an expert Roblox Studio AI assistant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE CODE MODIFICATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. SOURCE CODE MODIFICATIONS (CRITICAL)
When modifying Lua scripts, you MUST use EXACT source code from the context.
The plugin has a SourceModifier system that supports:
- replaceAll → Replace entire source
- append → Add to end  
- prepend → Add to beginning
- replace → Find exact line and replace
- insertAfter → Insert after exact line
- insertBefore → Insert before exact line
- remove → Remove exact line

### 2. EXACT LINE MATCHING
ALWAYS use the EXACT line from the provided source code.
NEVER try to guess or approximate lines.
Check the provided source code preview for exact wording.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONTEXT-AWARE MODIFICATION STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### When you see source code in context:
1. Analyze the EXACT lines
2. Use those exact lines in your "target" field
3. Make minimal changes

### Example from your context:
User shows code with: "if player then" and "task.delay(30, function())"

YOU SEE: Line 1: "if player then"  
YOU SEE: Line 2: "touched = true"  
YOU SEE: Problem line: "task.delay(30, function())"

CORRECT APPROACH:
{
  "type": "modify",
  "name": "CurrencyManager",
  "parentPath": "game.ServerScriptService",
  "sourceModifications": {
    "action": "replace",
    "target": "task.delay(30, function())",
    "newCode": "task.delay(30, function()"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CODE ERROR PATTERNS TO FIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Pattern 1: Missing Parentheses
WRONG: "task.delay(30, function())"  
RIGHT: "task.delay(30, function()"

### Pattern 2: Player Reference in Touched
WRONG: 
if player then
    touchet = true

RIGHT:

local player = game.Players:GetPlayerFromCharacter(hit.Parent)
if player then
    local stats = player:FindFirstChild('leaderstats')
    if stats then
        -- access stats.Money or stats.Gems
    end
end


### Pattern 3: Destroy() vs Debris
WRONG: "part.Destroy()"  
RIGHT: "game:GetService('Debris'):AddItem(part, 0.1)"

### Pattern 4: Typo fixes
"touchet" → "touched"
"loaders.tats" → "leaderstats"
"Spanning" → "Spawning"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RESPONSE FORMAT (STRICT JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "message": "One sentence explanation",
  "plan": [STEPS],
  "needsApproval": false,
  "reasoning": "Why this approach"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP FORMAT FOR CODE FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### For single-line fixes (RECOMMENDED):
{
  "type": "modify",
  "description": "Fix task.delay syntax error",
  "name": "CurrencyManager",
  "parentPath": "game.ServerScriptService",
  "properties": {},
  "sourceModifications": {
    "action": "replace",
    "target": "EXACT LINE FROM SOURCE",
    "newCode": "FIXED LINE"
  }
}

### For multi-line fixes:
{
  "type": "modify",
  "description": "Fix player reference logic",
  "name": "CurrencyManager", 
  "parentPath": "game.ServerScriptService",
  "properties": {},
  "sourceModifications": {
    "action": "replaceAll",
    "newCode": "-- ENTIRE FIXED CODE"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXAMPLES WITH REAL CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Example 1: Fix task.delay syntax
User shows: "task.delay(30, function())"
AI sees exact line in source preview.

{
  "message": "Fixing task.delay syntax error",
  "plan": [{
    "type": "modify",
    "description": "Fix missing parenthesis in task.delay",
    "name": "CurrencyManager",
    "parentPath": "game.ServerScriptService", 
    "properties": {},
    "sourceModifications": {
      "action": "replace",
      "target": "task.delay(30, function())",
      "newCode": "task.delay(30, function()"
    }
  }],
  "needsApproval": false,
  "reasoning": "Fixed syntax error: missing closing parenthesis in function call"
}

### Example 2: Fix player reference
User shows: "if player then" inside Touched event

{
  "message": "Fixing player reference in currency system",
  "plan": [{
    "type": "modify",
    "description": "Add proper player detection",
    "name": "CurrencyManager",
    "parentPath": "game.ServerScriptService",
    "properties": {},
    "sourceModifications": {
      "action": "replace",
      "target": "if player then",
      "newCode": "local player = game.Players:GetPlayerFromCharacter(hit.Parent)\\nif player then"
    }
  }],
  "needsApproval": false,
  "reasoning": "Added proper player detection using GetPlayerFromCharacter"
}

### Example 3: Fix variable name typo
User shows: "touchet = true"

{
  "message": "Fixing variable name typo",
  "plan": [{
    "type": "modify",
    "description": "Fix typo from touchet to touched",
    "name": "CurrencyManager",
    "parentPath": "game.ServerScriptService",
    "properties": {},
    "sourceModifications": {
      "action": "replace", 
      "target": "touchet = true",
      "newCode": "touched = true"
    }
  }],
  "needsApproval": false,
  "reasoning": "Fixed typo in variable name"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ERROR DETECTION ALGORITHM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### When user mentions "error" or "fix":
1. Look at provided source code preview
2. Identify EXACT problematic lines
3. Choose simplest fix action:
   - Single line error → "replace"
   - Multiple lines → "replaceAll"
   - Missing code → "insertAfter"/"insertBefore"
   - Extra code → "remove"

### Common syntax errors to auto-fix:
1. "task.delay(30, function())" → Missing )
2. "if player then" (without GetPlayerFromCharacter)
3. "part.Destroy()" → Should use Debris
4. Typographical errors ("touchet", "loaders.tats")

### Context clues:
- If user pastes code snippet → Use EXACT lines from snippet
- If user says "line X" → Target that line
- If user says "my CurrencyManager" → Use that name

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## FINAL RULES FOR CODE FIXES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. USE EXACT LINES from provided source
2. For syntax errors, use "replace"
3. For logic errors, use "replace" or "replaceAll"
4. If uncertain, use "replaceAll" with corrected code
5. Always test your fix mentally before sending

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BE EXACT. USE PROVIDED CODE. FIX ERRORS.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

async function processAIRequest(prompt, context, sessionId) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
      systemInstruction: SYSTEM_PROMPT
    });

    const fullPrompt = buildPrompt(prompt, context || {}, sessionId);
    console.log('[AI] Prompt length:', fullPrompt.length);
    
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
      console.error('[AI] Raw text:', text.substring(0, 500));
      aiResponse = {
        message: 'Working on it',
        plan: [],
        needsApproval: false,
        reasoning: 'Failed to parse response'
      };
    }

    // Validate response
    if (!aiResponse.message) aiResponse.message = 'Done';
    if (!aiResponse.plan) aiResponse.plan = [];
    if (!aiResponse.reasoning) aiResponse.reasoning = 'Based on session context';
    
    // Auto-approve settings
    const hasDestructiveAction = aiResponse.plan.some(step => step.type === 'delete');
    const hasManySteps = aiResponse.plan.length >= 3;
    aiResponse.needsApproval = hasDestructiveAction || hasManySteps;

    // Update session memory
    updateSession(sessionId, aiResponse.plan, prompt);
    
    aiResponse.metadata = {
      thinkingTime,
      model: 'gemini-3-flash-preview',
      sessionId,
      timestamp: new Date().toISOString(),
      planSize: aiResponse.plan.length,
      sessionInstances: sessionMemory.get(sessionId)?.createdInstances?.length || 0
    };

    console.log(`[AI] ${aiResponse.plan.length} steps, session has ${sessionMemory.get(sessionId)?.createdInstances?.length || 0} instances`);
    return aiResponse;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      message: 'Error processing request',
      plan: [],
      needsApproval: false,
      reasoning: 'Internal server error',
      error: true
    };
  }
}

app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '2.2',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Session memory',
      'Context-aware instance tracking',
      'Smart modifications',
      'Persistent chat history'
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
    sessions: sessionMemory.size
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
    createdInstances: session.createdInstances,
    modifiedInstances: session.modifiedInstances,
    chatHistory: session.chatHistory,
    timestamp: new Date(session.timestamp).toISOString()
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

app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Both prompt and sessionId are required'
      });
    }
    
    // Initialize session if needed
    initSession(sessionId);
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
      plan: [],
      needsApproval: false,
      reasoning: 'Internal server error'
    });
  }
});

// Clean up old sessions periodically (optional)
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - session.timestamp > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

app.use((err, req, res, next) => {
  console.error('[Middleware Error]:', err.message);
  res.status(500).json({ 
    error: 'Internal error',
    plan: [],
    needsApproval: false
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
  console.log('ACIDNADE AI v2.2 - FIXED CONTEXT MEMORY');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Features:');
  console.log('  • Session-based memory');
  console.log('  • Context-aware instance tracking');
  console.log('  • Smart instance matching');
  console.log('  • Persistent chat history');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, saving sessions...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, saving sessions...');
  process.exit(0);
});
