// server.js — Acidnade AI v10.5 (PURE AUTONOMY + INTELLIGENT DECISION MAKING)
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
  
  let text = `WORKSPACE SNAPSHOT:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `• Scripts: ${stats.TotalScripts || 0}\n`;
    text += `• UI Elements: ${stats.TotalUI || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nEXISTING SCRIPTS:\n`;
      scripts.slice(-10).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nSELECTED OBJECTS:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "10.5" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.5'));

// Main endpoint - SIMPLIFIED, NO RULES
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 Hi! What would you like me to do?" 
      });
    }
    
    // Get session data
    const session = sessionId ? (sessionData.get(sessionId) || {}) : {};
    const contextSummary = formatContext(context);
    
    // === PURE AI DECISION MAKING ===
    const systemPrompt = `You are Acidnade, an intelligent AI assistant with Roblox/Luau knowledge.

USER CAN ASK YOU TO:
1. CREATE things (scripts, systems, UI, games, mechanics)
2. EDIT/UPDATE existing things
3. DELETE things
4. FIX/Debug problems
5. EXPLAIN concepts
6. Or just chat

YOUR CAPABILITIES:
• Create/modify/delete any Roblox instances
• Write complete Luau code
• Design game systems
• Create UI dynamically
• Debug and fix issues
• Answer questions

IMPORTANT: Use your OWN intelligence to decide:
• What needs to be created/modified/deleted
• How many steps are needed
• Where to place scripts intelligently
• Whether to use RemoteEvents, Modules, etc. (only if needed)
• Keep things SIMPLE - no unnecessary complexity

CURRENT CONTEXT:
${contextSummary}

USER REQUEST:
"${prompt}"

ANALYZE THE REQUEST AND DECIDE:
1. What exactly does the user want?
2. What's the simplest way to achieve it?
3. What instances need to be created/modified/deleted?
4. How many steps are actually needed?

RESPOND IN THIS FORMAT (JSON only):
{
  "message": "Brief explanation of what you'll do",
  "plan": [
    {
      "step": 1,
      "description": "What you're doing",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript|etc (choose intelligently)",
      "name": "DescriptiveName",
      "parentPath": "Appropriate location (choose intelligently)",
      "properties": {
        "Source": "-- Complete code here"
      }
    }
  ]
}

OR if it's just chat/conversation:
{
  "message": "Your response here"
}

BE INTELLIGENT. BE SIMPLE. BE PRACTICAL.`;
    
    console.log("🤖 Letting AI decide autonomously...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "I'll help you with that! What exactly would you like to accomplish?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("No response from AI");
      return res.json({ 
        message: "Let's work on something! What would you like me to create or help with?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "I'm ready to help! Tell me what you need." 
      });
    }
    
    // Clean response
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed:", parseError.message);
      console.log("Raw response:", response.substring(0, 300));
      
      // Pure AI fallback - let the AI explain what it wants to do
      data = { 
        message: "I understand what you want! I'll create exactly what's needed - no templates, no unnecessary complexity. Just the right solution." 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'll handle that for you!";
    }
    
    // Handle plans intelligently
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      data.sequentialExecution = true;
      
      // Let AI decide if approval is needed (≥3 steps)
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }
      
      console.log(`🤖 AI decided on: ${data.plan.length} steps`);
    }
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps` : 'chat'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "I'm here to help! Tell me what you'd like to create or work on." 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v10.5 — PURE AUTONOMY`);
});
