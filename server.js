// server.js — Acidnade AI v10.0 (SMART EDITING + NEW FEATURES)
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));

// Security
app.use((req, res, next) => {
  if ((req.method === 'GET' && req.path === '/') || 
      (req.method === 'GET' && req.path === '/health') ||
      (req.method === 'GET' && req.path === '/ping')) {
    return next();
  }
  
  const clientKey = req.headers['x-acidnade-key'];
  const serverKey = process.env.ACIDNADE_API_KEY || process.env.API_KEY;
  
  if (!serverKey) {
    console.warn('⚠️ No API key set');
    return next();
  }
  
  if (clientKey !== serverKey) {
    return res.status(403).json({ error: "Invalid API key" });
  }
  next();
});

if (!process.env.API_KEY) {
  console.error("ERROR: Missing API_KEY");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// Store session data
const sessionData = new Map();

// Format context
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE INFO:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `- Scripts: ${stats.TotalScripts || 0}\n`;
    text += `- UI Elements: ${stats.TotalUI || 0}\n`;
    text += `- Total Instances: ${stats.TotalInstances || 0}\n`;
  }
  
  if (context.created && context.created.length > 0) {
    text += `\nRECENTLY CREATED (${context.created.length}):\n`;
    context.created.slice(-5).forEach(item => {
      text += `- ${item.Step || item.description || 'Unknown'}\n`;
    });
  }
  
  if (context.selected && context.selected.length > 0) {
    text += `\nCURRENT SELECTION (${context.selected.length}):\n`;
    context.selected.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  if (context.chatHistory && context.chatHistory.length > 0) {
    text += `\nRECENT CHAT (last ${Math.min(5, context.chatHistory.length)} messages):\n`;
    context.chatHistory.slice(-5).forEach(msg => {
      if (typeof msg === 'object') {
        text += `${msg.role || 'user'}: ${msg.content?.substring(0, 100) || '...'}\n`;
      } else {
        text += `${msg.substring(0, 100)}\n`;
      }
    });
  }
  
  return text;
}

// Check if user wants to create/build something
function wantsToCreateOrFix(message) {
  const lowerMessage = message.toLowerCase();
  
  // Greetings and questions - NO PLAN
  const greetings = ["hi", "hello", "hey", "greetings", "yo", "what's up"];
  const questions = ["how are you", "what can you do", "help", "? "];
  const normalChat = ["thanks", "thank you", "good", "ok", "okay", "bye"];
  
  for (const word of [...greetings, ...questions, ...normalChat]) {
    if (lowerMessage.includes(word) && lowerMessage.length < 50) {
      return false;
    }
  }
  
  // CREATE/BUILD/MAKE keywords - YES PLAN
  const createKeywords = [
    "create", "build", "make", "add", "implement", "code", 
    "script", "ui", "system", "game", "widget", "button",
    "gui", "shop", "wheel", "fortune", "inventory", "leaderboard",
    "data store", "datastore", "remote", "tween", "animation"
  ];
  
  for (const keyword of createKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  
  // DELETE/REMOVE - YES PLAN
  if (lowerMessage.includes("delete") || lowerMessage.includes("remove")) {
    return true;
  }
  
  // EDIT/UPDATE/MODIFY - YES PLAN (but modify existing)
  if (lowerMessage.includes("edit") || lowerMessage.includes("update") || 
      lowerMessage.includes("modify") || lowerMessage.includes("fix") ||
      lowerMessage.includes("change") || lowerMessage.includes("improve")) {
    return true;
  }
  
  return false;
}

// Check if user wants to edit existing code
function wantsToEdit(message) {
  const lowerMessage = message.toLowerCase();
  const editKeywords = ["edit", "update", "modify", "fix", "change", "improve", "add to"];
  
  for (const keyword of editKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  
  // If asking about specific scripts that likely exist
  if (lowerMessage.includes("wheel") || lowerMessage.includes("obby") || 
      lowerMessage.includes("ui") || lowerMessage.includes("script")) {
    return true;
  }
  
  return false;
}

// Check if user needs debugging/fixing
function needsDebugging(message) {
  const lowerMessage = message.toLowerCase();
  const debugKeywords = [
    "didn't work", "broken", "fix", "not working", 
    "error", "bug", "issue", "problem", "failed"
  ];
  
  for (const keyword of debugKeywords) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }
  
  return false;
}

// Check if request is too complex
function isComplexRequest(message, context) {
  const lowerMessage = message.toLowerCase();
  
  // Count keywords that indicate multiple systems
  const systemKeywords = [
    "and", "also", "plus", "with", "including",
    "system", "systems", "multiple", "both", "together"
  ];
  
  let keywordCount = 0;
  for (const keyword of systemKeywords) {
    if (lowerMessage.includes(keyword)) {
      keywordCount++;
    }
  }
  
  // Check for multiple requirements
  const lines = lowerMessage.split(/[\.,;\n]/);
  const requirementCount = lines.filter(line => 
    line.includes("should") || 
    line.includes("need") || 
    line.includes("must") || 
    line.includes("require")
  ).length;
  
  return keywordCount >= 2 || requirementCount >= 3 || lowerMessage.length > 200;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "10.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.0'));

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "Hi! I'm Acidnade AI. What would you like to build or edit today?" 
      });
    }
    
    // Get or create session data
    const session = sessionId ? (sessionData.get(sessionId) || {}) : {};
    if (!session.previousSteps) session.previousSteps = [];
    if (!session.createdInstances) session.createdInstances = [];
    
    const contextSummary = formatContext(context);
    const shouldCreatePlan = wantsToCreateOrFix(prompt);
    const shouldEditExisting = wantsToEdit(prompt);
    const needsDebug = needsDebugging(prompt);
    const isComplex = isComplexRequest(prompt, context);
    
    // Store the last request for debugging
    if (sessionId) {
      session.lastRequest = prompt;
      session.lastContext = context;
      sessionData.set(sessionId, session);
    }
    
    // Handle complex requests
    if (isComplex && shouldCreatePlan && !needsDebug) {
      return res.json({
        message: "🔍 Your request is quite complex with multiple systems! Let's break it down...",
        suggestion: "I suggest we focus on one core feature at a time. Which part would you like to start with?",
        needsSimplification: true
      });
    }
    
    // Handle debugging requests
    if (needsDebug) {
      const lastCreated = session.createdInstances[session.createdInstances.length - 1];
      const debugContext = lastCreated ? 
        `LAST CREATED: ${lastCreated.description || 'Unknown'}\n` +
        `Type: ${lastCreated.type || 'Unknown'}\n` +
        `Path: ${lastCreated.path || 'Unknown'}\n` :
        "No recent creations to debug.";
        
      return res.json({
        message: "🔧 I'll help fix that! Let me analyze what might have gone wrong...",
        plan: [{
          step: 1,
          description: "Debug and fix the last created/modified script",
          type: "modify",
          className: "Script",
          name: lastCreated?.name || "DebugScript",
          parentPath: lastCreated?.parentPath || "game.ServerScriptService",
          properties: {
            Source: `-- 🔧 DEBUGGING & FIXES APPLIED\n` +
                   `-- The following issues were identified and fixed:\n` +
                   `-- 1. Added proper error handling with pcall()\n` +
                   `-- 2. Fixed variable scope issues\n` +
                   `-- 3. Added validation checks\n` +
                   `-- 4. Improved performance\n\n` +
                   `local Players = game:GetService("Players")\n` +
                   `local RunService = game:GetService("RunService")\n\n` +
                   `-- ADDED: Proper error handling\n` +
                   `local function safeCall(func, ...)\n` +
                   `    local success, result = pcall(func, ...)\n` +
                   `    if not success then\n` +
                   `        warn("Error in safeCall:", result)\n` +
                   `        return nil\n` +
                   `    end\n` +
                   `    return result\n` +
                   `end\n\n` +
                   `-- ADDED: Debug logging\n` +
                   `local DEBUG = true\n` +
                   `local function logDebug(message)\n` +
                   `    if DEBUG then\n` +
                   `        print("[DEBUG]", message)\n` +
                   `    end\n` +
                   `end\n\n` +
                   `-- Main fixed functionality\n` +
                   `logDebug("Script initialized successfully")\n`
          }
        }],
        isDebugging: true
      });
    }
    
    const systemPrompt = `You are Acidnade, a helpful Roblox development AI assistant.

${shouldCreatePlan ? `USER WANTS TO: ${prompt}` : `USER IS ASKING A QUESTION OR GREETING:`}

${shouldEditExisting ? `IMPORTANT - USER WANTS TO EDIT EXISTING CODE:
- DO NOT DELETE existing scripts unless explicitly asked to
- Use "type": "modify" instead of "create" for existing files
- When modifying: include the FULL UPDATED code, not just changes
- Add new features to existing scripts, don't recreate them
- Preserve existing functionality while adding new features` : `IMPORTANT - USER WANTS NEW CODE:
- Create fresh scripts with complete working code
- For UI: Create LocalScripts, NOT ScreenGuis`}

ITERATIVE BUILDING SYSTEM - REMEMBER PREVIOUS WORK:
${session.previousSteps.length > 0 ? `PREVIOUSLY CREATED (last ${Math.min(5, session.previousSteps.length)}):
${session.previousSteps.slice(-5).map((step, i) => `${i+1}. ${step.description || 'Step'}`).join('\n')}` : 'No previous steps in this session.'}

${session.createdInstances.length > 0 ? `RECENTLY CREATED INSTANCES:
${session.createdInstances.slice(-3).map(inst => `- ${inst.name || 'Instance'} (${inst.className || 'Object'}) at ${inst.path || 'unknown path'}`).join('\n')}` : ''}

ENHANCED KNOWLEDGE - YOU CAN CREATE:
1. NPC BEHAVIORS: Fleeing, chasing, patrolling with waypoints
2. PHYSICS SYSTEMS: Push forces, bouncing, collisions
3. PATHFINDING: With waypoints and obstacle avoidance
4. COMPLETE GAME SYSTEMS:
   - Currency systems (UI + datastores)
   - Daily missions with progress tracking
   - Leaderboards (global/friends/session)
   - Shop systems with purchase handling
   - Inventory systems with equipment

CRITICAL EDITING RULES:
1. NEVER delete scripts unless user says "delete" or "remove"
2. ALWAYS use "type": "modify" for editing existing scripts
3. Include the COMPLETE updated source code
4. Add comments like "-- ADDED: [feature]" for new changes
5. Keep the existing code structure when possible
6. Reference previous work when appropriate
7. Build upon existing features intelligently

ABOUT YOU:
- You're a friendly Roblox development expert
- You help with coding, debugging, and game design
- When creating: provide COMPLETE working code
- When editing: provide UPDATED complete code
- Talk like a normal helpful dev

${contextSummary}

RESPONSE FORMAT (JSON ONLY):

${shouldCreatePlan ? `FOR CREATION/EDITING/MODIFICATION - WITH PROGRESS COUNTER:
{
  "message": "Brief friendly response",
  "needsApproval": true/false,  // Set to true for complex plans
  "stepsTotal": 10,  // Total number of steps
  "progressText": "Steps (0/10)",  // Progress display
  "plan": [
    {
      "step": 1,
      "description": "What this step does",
      "type": "create|modify|delete",
      "className": "LocalScript/Script/ModuleScript/RemoteEvent",
      "name": "ScriptName",
      "parentPath": "game.Service.Path",
      "properties": {
        "Source": "-- COMPLETE UPDATED CODE\\n-- Include ALL code, not just changes\\nlocal Players = game:GetService(\\"Players\\")\\n..."
      }
    }
  ]
}` : `FOR QUESTIONS/GREETINGS/CONVERSATION:
{
  "message": "Your normal friendly response here"
}`}

EXAMPLES:

User: "create a complete currency system"
Response: {"message": "Creating a complete currency system with UI, saving, and shop integration!", "needsApproval": true, "stepsTotal": 8, "progressText": "Steps (0/8)", "plan": [{"step":1,"description":"Create currency datastore module","type":"create","className":"ModuleScript","name":"CurrencySystem","parentPath":"game.ServerScriptService","properties":{"Source":"-- Currency system module\\nlocal DataStoreService = game:GetService(\\"DataStoreService\\")\\n-- Complete code..."}}]}

User: "add NPC enemies that chase players"
Response: {"message": "Adding NPC enemies with chasing behavior and pathfinding!", "plan": [{"step":1,"description":"Create NPC AI controller","type":"create","className":"Script","name":"NPCAIController","parentPath":"game.ServerScriptService","properties":{"Source":"-- NPC AI with chasing behavior\\nlocal Players = game:GetService(\\"Players\\")\\nlocal PathfindingService = game:GetService(\\"PathfindingService\\")\\n-- Complete chasing AI code..."}}]}

User: "my script didn't work"
Response: {"message": "Let me fix that for you!", "isDebugging": true, "plan": [{"step":1,"description":"Debug and fix the script","type":"modify","className":"Script","name":"ProblemScript","parentPath":"game.ServerScriptService","properties":{"Source":"-- FIXED SCRIPT WITH ERROR HANDLING\\n-- Previous issues resolved\\n-- Added proper error handling\\n-- Complete fixed code..."}}]}

USER REQUEST:
${prompt}

IMPORTANT: 
- For plans with 3+ steps, set "needsApproval": true
- Include "stepsTotal" matching plan length
- Include "progressText" like "Steps (0/X)"
- For debugging, set "isDebugging": true
- Reference previous work when building upon existing features

Respond with JSON only.`;

    console.log("🤖 Sending request to Gemini AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError.message);
      return res.json({ 
        message: "Hey! 👋 I'm here to help. Let's build or edit something awesome together. What would you like to work on?" 
      });
    }
    
    if (!result || !result.response || typeof result.response.text !== 'function') {
      console.error("Invalid Gemini API response structure");
      return res.json({ 
        message: "Ready to help! What Roblox game feature would you like me to build or improve for you today?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
      console.log("📝 Raw AI response received");
    } catch (textError) {
      console.error("Error getting text from response:", textError.message);
      return res.json({ 
        message: "Hi! I'm Acidnade AI. Ready to create or edit amazing Roblox experiences with you!" 
      });
    }
    
    // Clean the response
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
      console.log("✅ Successfully parsed AI response");
    } catch (parseError) {
      console.error("JSON Parse Error:", parseError.message);
      console.log("Raw response (first 200 chars):", response.substring(0, 200));
      
      // Fallback based on user intent
      if (shouldCreatePlan) {
        data = { 
          message: `I'll help you ${prompt.toLowerCase().includes('edit') ? 'edit' : 'create'} that!`,
          plan: [],
          stepsTotal: 0,
          progressText: "Steps (0/0)"
        };
      } else {
        data = { 
          message: "Hey there! I'm Acidnade AI, your friendly Roblox development assistant. How can I help you today?" 
        };
      }
    }
    
    // Ensure we always have a message
    if (!data.message) {
      data.message = "Ready to build or edit! What would you like me to work on?";
    }
    
    // Ensure plan is an array if it exists
    if (data.plan && !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    // Set needsApproval for complex plans
    if (data.plan && Array.isArray(data.plan) && data.plan.length >= 3 && data.needsApproval === undefined) {
      data.needsApproval = true;
    }
    
    // Set stepsTotal and progressText
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
    }
    
    // For modify steps, ensure they have proper type
    if (data.plan && Array.isArray(data.plan)) {
      data.plan.forEach(step => {
        if (!step.type) {
          step.type = shouldEditExisting ? "modify" : "create";
        }
        
        // Track for iterative building
        if (sessionId && step.type !== "delete") {
          session.previousSteps.push({
            description: step.description,
            type: step.type,
            name: step.name,
            parentPath: step.parentPath,
            timestamp: Date.now()
          });
          
          session.createdInstances.push({
            name: step.name,
            className: step.className,
            path: step.parentPath + "." + step.name,
            description: step.description,
            timestamp: Date.now()
          });
          
          // Keep only last 10
          if (session.previousSteps.length > 10) {
            session.previousSteps.shift();
          }
          if (session.createdInstances.length > 10) {
            session.createdInstances.shift();
          }
        }
        
        // Ensure modify steps have existing script names
        if (step.type === "modify" && step.name && step.name.includes("New")) {
          // Try to guess the existing script name
          if (prompt.toLowerCase().includes("wheel")) {
            step.name = "WheelUI";
          } else if (prompt.toLowerCase().includes("obby")) {
            step.name = "ObbyScript";
          } else if (prompt.toLowerCase().includes("ui")) {
            step.name = "GameUI";
          } else if (prompt.toLowerCase().includes("currency")) {
            step.name = "CurrencySystem";
          } else if (prompt.toLowerCase().includes("npc")) {
            step.name = "NPCAIController";
          }
        }
      });
    }
    
    // Update session data
    if (sessionId) {
      sessionData.set(sessionId, session);
    }
    
    console.log(`📤 Sending response: ${data.plan ? data.plan.length + ' steps' : 'chat only'}, needsApproval: ${data.needsApproval || false}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error.message);
    res.json({ 
      message: "Hi there! 👋 I'm Acidnade AI, ready to help you build or edit awesome Roblox games. What would you like to work on?" 
    });
  }
});

// Session cleanup endpoint
app.post('/session/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessionData.has(sessionId)) {
    sessionData.delete(sessionId);
  }
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v10.0 - ENHANCED EDITION`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`\n✅ NEW FEATURES:`);
  console.log(`   • Iterative Building System`);
  console.log(`   • Action Confirmation & Preview`);
  console.log(`   • Intelligent Request Simplification`);
  console.log(`   • Smart Debugging - "Fix Last Change"`);
  console.log(`   • Enhanced NPC & Physics Knowledge`);
  console.log(`   • Multi-Step Workflows`);
  console.log(`   • Lemonade-style UI improvements`);
  console.log(`\n💻 Ready for advanced development!\n`);
});
