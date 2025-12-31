// server.js — Acidnade AI v9.4 (ROBUST ERROR HANDLING)
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
  
  // Error reports - NO PLAN (just conversation)
  if (lowerMessage.includes("error") || lowerMessage.includes("fix this") || 
      lowerMessage.includes("not working") || lowerMessage.includes("issue")) {
    return false;
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
  
  return false;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "9.4" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v9.4'));

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "Hi! I'm Acidnade AI. What would you like to build today?" 
      });
    }
    
    const contextSummary = formatContext(context);
    const shouldCreatePlan = wantsToCreateOrFix(prompt);
    
    const systemPrompt = `You are Acidnade, a helpful Roblox development AI assistant.

${shouldCreatePlan ? `USER WANTS TO CREATE/MODIFY/DELETE SOMETHING:
- They want to: ${prompt}
- YOU MUST return a "plan" array with ACTUAL WORKING CODE
- Include complete code in the properties.Source field
- For UI: Create LocalScripts, NOT ScreenGuis
- For deletion: use "type": "delete"` : `USER IS ASKING A QUESTION OR GREETING:
- Respond naturally and helpfully
- Keep it brief and friendly
- NO PLAN needed for greetings/questions`}

ABOUT YOU:
- You're a friendly Roblox development expert
- You help with coding, debugging, and game design
- When creating: provide COMPLETE working code
- When asked: explain concepts clearly
- Make UI modern: black strokes, corners, gradients
- Talk like a normal helpful dev

${contextSummary}

RESPONSE FORMAT (JSON ONLY):

${shouldCreatePlan ? `FOR CREATION/DELETION/MODIFICATION:
{
  "message": "Brief friendly response about what you're doing",
  "plan": [
    {
      "step": 1,
      "description": "What this step does",
      "type": "create|modify|delete",
      "className": "LocalScript/Script/ModuleScript/RemoteEvent",
      "name": "DescriptiveName",
      "parentPath": "game.Service.Path",
      "properties": {
        "Source": "-- COMPLETE WORKING CODE\\nlocal Players = game:GetService(\\"Players\\")\\n..."
      }
    }
  ]
}` : `FOR QUESTIONS/GREETINGS/CONVERSATION:
{
  "message": "Your normal friendly response here"
}`}

EXAMPLES:

User: "hi"
Response: {"message": "Hey there! 👋 I'm Acidnade AI, ready to help you build awesome Roblox games. What would you like to create today?"}

User: "OnServerInvoke is not a valid member of RemoteEvent"
Response: {"message": "Ah, that's a common error! \`OnServerInvoke\` was used in older Roblox versions. You should use \`OnServerEvent\` instead for RemoteEvents. Want me to fix that script for you?"}

User: "create a wheel of fortune game"
Response: {"message": "Awesome! Let me build you a complete Wheel of Fortune game with spinning animations and rewards.", "plan": [{"step":1,"description":"Create wheel UI script","type":"create","className":"LocalScript","name":"WheelUI","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"local Players = game:GetService(\\"Players\\")\\n-- Modern wheel UI code here"}}, {"step":2,"description":"Create wheel logic","type":"create","className":"Script","name":"WheelManager","parentPath":"game.ServerScriptService","properties":{"Source":"local RemoteEvent = game:GetService(\\"ReplicatedStorage\\"):WaitForChild(\\"WheelEvent\\")\\n-- Server logic here"}}]}

User: "what can you do?"
Response: {"message": "I can help you build Roblox games! I create scripts, UI systems, game mechanics, fix errors, and more. Just tell me what you want to build and I'll write the complete code for you. 😊"}

USER REQUEST:
${prompt}

Respond with JSON only.`;

    console.log("🤖 Sending request to Gemini AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError.message);
      return res.json({ 
        message: "Hey! 👋 I'm here to help. Let's build something awesome together. What would you like to create?" 
      });
    }
    
    // FIXED: Check if response exists and has text()
    if (!result || !result.response || typeof result.response.text !== 'function') {
      console.error("Invalid Gemini API response structure");
      return res.json({ 
        message: "Ready to help! What Roblox game feature would you like me to build for you today?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
      console.log("📝 Raw AI response received");
    } catch (textError) {
      console.error("Error getting text from response:", textError.message);
      return res.json({ 
        message: "Hi! I'm Acidnade AI. Ready to create amazing Roblox experiences with you!" 
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
          message: `I'll help you ${prompt.toLowerCase().includes('create') ? 'create' : 'fix'} that! The AI had a hiccup, but I'm ready to assist. Could you describe what you want in simpler terms?`,
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
      data.message = "Ready to build! What would you like me to create?";
    }
    
    // Ensure plan is an array if it exists
    if (data.plan && !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    console.log(`📤 Sending response: ${data.plan ? data.plan.length + ' steps' : 'chat only'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error.message);
    // Always return a valid response
    res.json({ 
      message: "Hi there! 👋 I'm Acidnade AI, ready to help you build awesome Roblox games. What would you like to create?" 
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v9.4 - ROBUST ERROR HANDLING`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`\n✅ Features:`);
  console.log(`   • Improved error handling`);
  console.log(`   • Better Gemini API response validation`);
  console.log(`   • Smart conversation detection`);
  console.log(`   • Always returns valid responses`);
  console.log(`   • Detailed logging for debugging`);
  console.log(`\n💬 Ready for chat and game creation!\n`);
});
