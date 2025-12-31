// server.js — Acidnade AI v9.5 (SMART EDITING, NO UNNECESSARY DELETION)
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

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "9.5" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v9.5'));

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "Hi! I'm Acidnade AI. What would you like to build or edit today?" 
      });
    }
    
    const contextSummary = formatContext(context);
    const shouldCreatePlan = wantsToCreateOrFix(prompt);
    const shouldEditExisting = wantsToEdit(prompt);
    
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

CRITICAL EDITING RULES:
1. NEVER delete scripts unless user says "delete" or "remove"
2. ALWAYS use "type": "modify" for editing existing scripts
3. Include the COMPLETE updated source code
4. Add comments like "-- ADDED: [feature]" for new changes
5. Keep the existing code structure when possible

ABOUT YOU:
- You're a friendly Roblox development expert
- You help with coding, debugging, and game design
- When creating: provide COMPLETE working code
- When editing: provide UPDATED complete code
- Talk like a normal helpful dev

${contextSummary}

RESPONSE FORMAT (JSON ONLY):

${shouldCreatePlan ? `FOR CREATION/EDITING/MODIFICATION:
{
  "message": "Brief friendly response",
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

User: "hi"
Response: {"message": "Hey there! 👋 I'm Acidnade AI, ready to help you build awesome Roblox games. What would you like to create or edit today?"}

User: "add a timer to my obby game"
Response: {"message": "Adding a timer to your obby game! I'll update the existing script with timer functionality.", "plan": [{"step":1,"description":"Update obby script with timer","type":"modify","className":"LocalScript","name":"ObbyScript","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"-- UPDATED OBBY SCRIPT WITH TIMER\\nlocal Players = game:GetService(\\"Players\\")\\nlocal RunService = game:GetService(\\"RunService\\")\\n\\n-- EXISTING OBBY CODE...\\n\\n-- ADDED: Timer functionality\\nlocal timer = 0\\nlocal timerLabel = Instance.new(\\"TextLabel\\")\\ntimerLabel.Text = \\"Time: 0\\"\\n-- ... rest of updated code"}}]}

User: "create a wheel of fortune game"
Response: {"message": "Awesome! Creating a Wheel of Fortune game with spinning animations.", "plan": [{"step":1,"description":"Create wheel UI script","type":"create","className":"LocalScript","name":"WheelUI","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"local Players = game:GetService(\\"Players\\")\\n-- Complete wheel UI code"}}]}

User: "delete the test script"
Response: {"message": "Deleting test script.","plan":[{"step":1,"description":"Delete test script","type":"delete","className":"Script","name":"TestScript","parentPath":"game.ServerScriptService"}]}

User: "improve the wheel spin animation"
Response: {"message": "Improving the wheel spin animation with smoother effects!", "plan": [{"step":1,"description":"Update wheel animation","type":"modify","className":"LocalScript","name":"WheelUI","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"-- UPDATED WHEEL SCRIPT WITH IMPROVED ANIMATION\\n-- Existing wheel code...\\n\\n-- ADDED: Smoother spin animation with easing\\nlocal TweenService = game:GetService(\\"TweenService\\")\\n-- ... rest of updated code"}}]}

USER REQUEST:
${prompt}

IMPORTANT: If editing existing code, use "type": "modify" and provide COMPLETE updated code.

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
          plan: [] 
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
    
    // For modify steps, ensure they have proper type
    if (data.plan && Array.isArray(data.plan)) {
      data.plan.forEach(step => {
        if (!step.type) {
          step.type = shouldEditExisting ? "modify" : "create";
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
          }
        }
      });
    }
    
    console.log(`📤 Sending response: ${data.plan ? data.plan.length + ' steps (' + (data.plan[0]?.type || 'create') + ')' : 'chat only'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error.message);
    res.json({ 
      message: "Hi there! 👋 I'm Acidnade AI, ready to help you build or edit awesome Roblox games. What would you like to work on?" 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v9.5 - SMART EDITING, NO UNNECESSARY DELETION`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`\n✅ Features:`);
  console.log(`   • Smart editing (modify instead of delete)`);
  console.log(`   • Preserves existing scripts`);
  console.log(`   • Adds features to existing code`);
  console.log(`   • Complete updated code in responses`);
  console.log(`   • Only deletes when explicitly asked`);
  console.log(`\n💻 Ready for smart editing and creation!\n`);
});
