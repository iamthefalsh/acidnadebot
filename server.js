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

const sessions = new Map();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '4mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Analyze what type of request this is
function analyzeRequestType(userPrompt) {
  const prompt = userPrompt.toLowerCase();
  
  // System-level requests (needs many parts)
  const systemKeywords = [
    'complete system', 'full system', 'entire system',
    'rpg system', 'inventory system', 'combat system',
    'game framework', 'multiplayer system', 'save system',
    'complete gui', 'entire ui', 'full interface',
    'tool system', 'weapon system', 'ability system',
    'progression system', 'skill tree', 'quest system'
  ];
  
  for (const keyword of systemKeywords) {
    if (prompt.includes(keyword)) {
      return 'system';
    }
  }
  
  // Medium complexity (3-8 parts)
  const mediumKeywords = [
    'and also', 'plus', 'along with',
    'multiple', 'several', 'various',
    'set of', 'collection of', 'group of',
    'with animations', 'with sounds', 'with effects',
    'gui with', 'system with', 'tool with'
  ];
  
  for (const keyword of mediumKeywords) {
    if (prompt.includes(keyword)) {
      return 'medium';
    }
  }
  
  // Simple requests (1-3 parts)
  return 'simple';
}

function buildPrompt(userPrompt, context, requestType) {
  let prompt = `User Request: "${userPrompt}"\n\n`;
  
  // Minimal context
  if (context?.selectedObjects?.length > 0) {
    prompt += `Selected: ${context.selectedObjects.map(o => o.Name).join(', ')}\n\n`;
  }
  
  // CRITICAL: Tell AI to decide action count based on needs
  prompt += `📊 REQUEST TYPE: ${requestType.toUpperCase()}
  
YOU DECIDE how many actions to include:

1. SIMPLE REQUEST (create, fix, modify one thing):
   • Return 1-3 actions
   • Focus on the main request
   • Keep it minimal

2. MEDIUM REQUEST (multiple related things):
   • Return 3-8 actions
   • Include all related components
   • Make a complete feature

3. SYSTEM REQUEST (complete system, framework):
   • Return AS MANY AS NEEDED (5-15+ actions)
   • Create the ENTIRE system
   • Include ALL components, scripts, parts
   • Make it fully functional

EXAMPLES:

Simple: "create red part" → 1 action
Simple: "fix the health script" → 1-2 actions
Medium: "create inventory with slots and items" → 4-6 actions
System: "make complete RPG character system" → 10-15 actions
System: "create full GUI interface for shop" → 8-12 actions

YOUR JOB:
• Analyze what the user REALLY needs
• If they want a complete system → give them EVERYTHING
• If they want one feature → give them just that
• Don't hold back on system requests
• Don't overload simple requests

RESPONSE FORMAT:
{
  "type": "execution",
  "message": "Creating [what you're making]",
  "requestType": "${requestType}",
  "actions": [
    // AS MANY AS NEEDED for complete implementation
  ]
}

IMPORTANT: For SYSTEM requests, include ALL:
• Main scripts
• Module scripts
• GUI elements
• Configuration
• Utilities
• Event handlers
• Everything needed to work`;

  return prompt;
}

async function processAIRequest(userPrompt, context, sessionId) {
  try {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        history: [],
        totalActions: 0,
        systemCreations: [],
        timestamp: Date.now()
      });
    }
    
    const session = sessions.get(sessionId);
    const requestType = analyzeRequestType(userPrompt);
    
    console.log(`[AI] Request Type: ${requestType} - "${userPrompt.substring(0, 60)}..."`);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 4096, // Large for system requests
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - Complete Roblox System Builder.

CRITICAL PHILOSOPHY:
1. If user wants a COMPLETE SYSTEM → Give them EVERYTHING
2. Don't hold back on action count
3. Make systems fully functional
4. Include all necessary components

REQUEST TYPES:

SIMPLE (1-3 actions):
• One-off creations
• Simple fixes
• Minor modifications

MEDIUM (3-8 actions):  
• Features with multiple parts
• GUI with functionality
• Tools with scripts

SYSTEM (5-15+ actions):
• Complete game systems
• Full frameworks
• Entire interfaces
• Multi-script architectures

WHEN TO GO BIG:
• "complete system" → 10+ actions
• "full [something]" → 8+ actions  
• "entire [something]" → 8+ actions
• Complex RPG/Inventory/Combat systems → 12+ actions

ALWAYS return valid JSON.
Make actions COMPLETE and READY TO EXECUTE.`
    });

    const prompt = buildPrompt(userPrompt, context, requestType);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      console.error('[AI] Parse error:', error.message);
      response = {
        type: 'execution',
        message: "Building your system...",
        requestType: requestType,
        actions: []
      };
    }
    
    // Ensure response has requestType
    if (!response.requestType) response.requestType = requestType;
    if (!response.type) response.type = 'execution';
    if (!response.message) response.message = `Creating ${requestType} system`;
    if (!response.actions) response.actions = [];
    
    // Track in session
    session.totalActions += response.actions.length;
    session.history.push({
      input: userPrompt.substring(0, 80),
      type: requestType,
      actionCount: response.actions.length,
      timestamp: Date.now()
    });
    
    // Track system creations
    if (requestType === 'system' && response.actions.length > 5) {
      session.systemCreations.push({
        name: userPrompt.substring(0, 50),
        actionCount: response.actions.length,
        timestamp: Date.now()
      });
    }
    
    // Add stats
    response.stats = {
      requestType: requestType,
      actionCount: response.actions.length,
      sessionTotalActions: session.totalActions,
      systemCreations: session.systemCreations.length,
      recommendation: requestType === 'system' ? 
        "Complete system delivered. May need multiple executions." : 
        "Ready to execute."
    };
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "System error. Please try again.",
      error: true
    };
  }
}

// Smart execution with continuation support
app.post('/ai/execute', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId, continuation = false } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Missing prompt or session"
      });
    }
    
    const session = sessions.get(sessionId) || {
      history: [],
      totalActions: 0,
      systemCreations: [],
      timestamp: Date.now()
    };
    
    // Check if we should continue a system build
    if (continuation && session.history.length > 0) {
      const lastRequest = session.history[session.history.length - 1];
      if (lastRequest.type === 'system') {
        // Continue system building
        const model = genAI.getGenerativeModel({
          model: 'gemini-3-flash-preview',
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3072,
            responseMimeType: 'application/json',
          },
          systemInstruction: `Continue building the system.
Add more components, scripts, or features.
Return 5-10 additional actions.
Make them complete and ready to execute.`
        });
        
        const continuePrompt = `Continue building the system from previous request.
Previous was: "${lastRequest.input}"
Now add: ${prompt}

Return additional actions to complete the system.
Include 5-10 more actions.`;
        
        const result = await model.generateContent(continuePrompt);
        const text = result.response.text();
        
        let response;
        try {
          const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
          response = JSON.parse(cleaned);
        } catch (error) {
          response = { type: 'execution', message: "Continuing system...", actions: [] };
        }
        
        // Track continuation
        session.totalActions += response.actions?.length || 0;
        session.history.push({
          input: `[CONTINUE] ${prompt}`,
          type: 'system',
          actionCount: response.actions?.length || 0,
          continuation: true,
          timestamp: Date.now()
        });
        
        sessions.set(sessionId, session);
        
        response.continuation = true;
        response.previousActionCount = lastRequest.actionCount;
        response.totalSystemActions = session.totalActions;
        
        return res.json(response);
      }
    }
    
    // Normal processing
    const response = await processAIRequest(prompt, context, sessionId);
    sessions.set(sessionId, session);
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({
      type: 'chat',
      message: "Execution error"
    });
  }
});

// Main endpoint (unlimited)
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId, forceSystem = false } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Missing prompt or session"
      });
    }
    
    // Force system mode if requested
    let requestType = analyzeRequestType(prompt);
    if (forceSystem) requestType = 'system';
    
    const session = sessions.get(sessionId) || {
      history: [],
      totalActions: 0,
      timestamp: Date.now()
    };
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI.

BUILDING PHILOSOPHY:
1. Give COMPLETE solutions
2. Don't limit action count
3. If it's a system → build the WHOLE system
4. Include ALL necessary components
5. Make it production-ready

Return JSON with as many actions as needed.
Small requests: 1-3 actions
Medium requests: 3-8 actions  
System requests: 5-20+ actions (whatever it takes)

Example systems that need many actions:
• RPG character system: 12-18 actions
• Inventory system: 10-15 actions
• Combat system: 15-20 actions
• GUI framework: 8-12 actions
• Multiplayer lobby: 10-14 actions`
    });
    
    const aiPrompt = `User Request: "${prompt}"
    
Request Analysis: ${requestType.toUpperCase()}

${requestType === 'system' ? 
'THIS IS A COMPLETE SYSTEM REQUEST. BUILD THE ENTIRE THING.' : 
'Build what is requested.'}

Include ALL necessary:
• Scripts (LocalScript, Script, ModuleScript)
• GUI elements
• Parts and models
• Configuration
• Utilities
• Event systems
• Everything needed to work

Return as many actions as needed for a COMPLETE implementation.`;
    
    console.log(`[AI] Processing ${requestType} request...`);
    
    const result = await model.generateContent(aiPrompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      response = { type: 'execution', message: "Building...", actions: [] };
    }
    
    // Track
    const actionCount = response.actions?.length || 0;
    session.totalActions += actionCount;
    session.history.push({
      input: prompt.substring(0, 100),
      type: requestType,
      actionCount: actionCount,
      timestamp: Date.now()
    });
    
    sessions.set(sessionId, session);
    
    // Add info
    response.requestType = requestType;
    response.actionCount = actionCount;
    response.sessionStats = {
      totalActions: session.totalActions,
      systemRequests: session.history.filter(h => h.type === 'system').length
    };
    
    if (actionCount > 10) {
      response.note = "Large system delivered. May need multiple execution passes.";
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Server error"
    });
  }
});

// System builder endpoint (explicitly for large systems)
app.post('/ai/system', authenticateRequest, async (req, res) => {
  try {
    const { systemName, requirements, components, sessionId } = req.body;
    
    if (!systemName || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Missing system name or session"
      });
    }
    
    const session = sessions.get(sessionId) || {
      history: [],
      totalActions: 0,
      systemCreations: [],
      timestamp: Date.now()
    };
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 6144, // Even larger for explicit systems
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are building a COMPLETE ROBLOX SYSTEM.
Return 15-25+ actions if needed.
Make EVERY component.
Include ALL scripts, GUIs, modules, configurations.
Build a PRODUCTION-READY system.
Don't hold back - give them everything.`
    });
    
    const systemPrompt = `BUILD COMPLETE SYSTEM: ${systemName}
    
Requirements: ${requirements || 'Standard implementation'}
Components: ${components || 'All necessary components'}

Build the ENTIRE system including:
1. Main controller scripts
2. Data management
3. GUI interfaces
4. Configuration modules
5. Utility functions
6. Event systems
7. Networking (if multiplayer)
8. Error handling
9. Performance optimizations
10. Everything else needed

Return a COMPLETE system with 15-25+ actions if needed.`;
    
    console.log(`[SYSTEM] Building: ${systemName}`);
    
    const result = await model.generateContent(systemPrompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      response = { type: 'execution', message: "Building system...", actions: [] };
    }
    
    // Track as major system
    const actionCount = response.actions?.length || 0;
    session.totalActions += actionCount;
    session.systemCreations.push({
      name: systemName,
      actionCount: actionCount,
      timestamp: Date.now()
    });
    
    sessions.set(sessionId, session);
    
    response.systemBuilt = systemName;
    response.actionCount = actionCount;
    response.note = actionCount > 15 ? 
      "Major system built. Execute in batches if needed." :
      "System built successfully.";
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({
      type: 'chat',
      message: "System build failed"
    });
  }
});

// Get system stats
app.get('/session/:sessionId/systems', authenticateRequest, (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    totalSystems: session.systemCreations.length,
    systems: session.systemCreations,
    totalActions: session.totalActions,
    averageActionsPerSystem: session.systemCreations.length > 0 ?
      session.totalActions / session.systemCreations.length : 0
  });
});

// Cleanup
setInterval(() => {
  const dayAgo = Date.now() - 86400000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.history.length === 0 || 
        session.history[session.history.length - 1].timestamp < dayAgo) {
      sessions.delete(sessionId);
    }
  }
}, 3600000);

app.listen(PORT, () => {
  console.log('🚀 ACIDNADE AI - UNLIMITED SYSTEM BUILDER');
  console.log(`Port: ${PORT}`);
  console.log('Features:');
  console.log('  • Unlimited actions for systems');
  console.log('  • Smart request type detection');
  console.log('  • System builder endpoint (15-25+ actions)');
  console.log('  • Continuation support for large builds');
  console.log('  • Production-ready systems');
  console.log('Ready to build ANYTHING!');
});
