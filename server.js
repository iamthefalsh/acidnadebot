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
  res.json({ status: "OK", version: "11.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v11.0 - Fully Autonomous'));

// Main endpoint - FULLY AUTONOMOUS WITH SCREENGUI RULES
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
    
    // === FULLY AUTONOMOUS AI WITH SCREENGUI RULES ===
    const systemPrompt = `You are Acidnade, a FULLY AUTONOMOUS AI assistant with deep Roblox/Luau expertise.

YOU HAVE COMPLETE FREEDOM TO:
• Decide what to create, modify, or delete
• Choose script types (Script, LocalScript, ModuleScript)
• Design architectures and systems
• Create any game mechanics
• Make ALL technical decisions
• Execute multi-step plans automatically

🎯 MANDATORY SCREENGUI RULES:
1. ALL ScreenGuis MUST go in "StarterGui" (for persistent UI)
2. For player-specific UI, create in "game.Players.LocalPlayer.PlayerGui" via LocalScript
3. NEVER put ScreenGuis in Workspace, ReplicatedStorage, or ServerScriptService
4. UI LocalScripts should ALWAYS be inside the ScreenGui or its children

CURRENT CONTEXT:
${contextSummary}

USER REQUEST:
"${prompt}"

YOUR AUTONOMOUS DECISION PROCESS:
1. Analyze what the user wants
2. Design the optimal solution (simple but effective)
3. Decide ALL technical details yourself:
   - Where to place scripts
   - What type of scripts to use
   - Whether to use RemoteEvents/Functions
   - How to structure the code
   - Number of steps needed
4. Execute without asking for permission (you're autonomous)

RESPOND IN JSON FORMAT:

For implementations (creating/modifying):
{
  "message": "Brief explanation of your autonomous decision",
  "plan": [
    {
      "step": 1,
      "description": "What this step does",
      "type": "create|modify|delete",
      "className": "ClassName",
      "name": "InstanceName",
      "parentPath": "Parent.Path.Here",
      "properties": {
        "Source": "-- Your complete code",
        "OtherProperty": "value"
      }
    }
  ],
  "autoExecute": true
}

For conversations/questions:
{
  "message": "Your helpful response"
}

IMPORTANT AUTONOMOUS BEHAVIORS:
• You decide EVERYTHING - no templates, no asking
• Keep solutions elegant but simple
• For ScreenGuis: ALWAYS use StarterGui
• For UI scripts: ALWAYS use LocalScript inside the ScreenGui
• Don't over-engineer - make smart, practical choices
• Auto-execute all plans (set autoExecute: true)
• Only ask for approval if it's a destructive operation (deleting many things)

BE BOLD. BE SMART. BE AUTONOMOUS.`;
    
    console.log("🤖 AI making fully autonomous decisions...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "I'm ready to autonomously create whatever you need! What would you like?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("No response from AI");
      return res.json({ 
        message: "Let me autonomously build that for you! What's your vision?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "I'm your autonomous AI assistant. Tell me what to create!" 
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
      
      data = { 
        message: "I'll autonomously create the perfect solution for you. Let me design it intelligently!" 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'll handle that autonomously!";
    }
    
    // Handle plans with full autonomy
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Auto-executing ${data.stepsTotal} steps`;
      data.sequentialExecution = true;
      
      // FULL AUTONOMY: Auto-execute by default
      if (data.autoExecute === undefined) {
        data.autoExecute = true;
      }
      
      // Only need approval for destructive operations with 5+ deletions
      const deletionCount = data.plan.filter(step => step.type === 'delete').length;
      if (deletionCount >= 5) {
        data.needsApproval = true;
        data.autoExecute = false;
        data.message = `⚠️ This will delete ${deletionCount} items. Please review and approve.`;
      } else {
        data.needsApproval = false;
      }
      
      // Validate ScreenGui placements
      data.plan = data.plan.map(step => {
        if (step.className === 'ScreenGui') {
          // Enforce ScreenGui rules
          if (!step.parentPath || 
              (!step.parentPath.includes('StarterGui') && 
               !step.parentPath.includes('PlayerGui'))) {
            console.log(`🔧 Auto-correcting ScreenGui placement: ${step.name}`);
            step.parentPath = 'StarterGui';
            step.description += ' (Auto-placed in StarterGui per rules)';
          }
        }
        return step;
      });
      
      console.log(`🤖 AI autonomous plan: ${data.plan.length} steps | Auto-execute: ${data.autoExecute}`);
    }
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps (autonomous)` : 'chat'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "I'm your fully autonomous AI! Tell me what you want to build." 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v11.0 — FULLY AUTONOMOUS MODE`);
  console.log(`✅ ScreenGui rules enforced`);
  console.log(`✅ Auto-execution enabled`);
  console.log(`✅ Smart decision making active`);
});
