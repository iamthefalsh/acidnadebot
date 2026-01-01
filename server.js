// server.js — Acidnade AI v10.4 (NO DIRECT UI CREATION)
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
  
  let text = `📊 WORKSPACE STATE:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `• Scripts: ${stats.TotalScripts || 0}\n`;
    text += `• UI Elements: ${stats.TotalUI || 0}\n`;
    text += `• Total Instances: ${stats.TotalInstances || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\n📁 EXISTING SCRIPTS (${scripts.length}):\n`;
      scripts.slice(-15).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `\n🆕 RECENTLY CREATED:\n`;
    context.createdInstances.slice(-10).forEach(item => {
      text += `- ${item.name} (${item.className}) in ${item.parentPath || 'unknown'}\n`;
    });
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\n🎯 SELECTED:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  if (context.chatHistory && context.chatHistory.length > 0) {
    text += `\n💬 RECENT CHAT:\n`;
    const recentMessages = context.chatHistory.slice(-6);
    recentMessages.forEach(msg => {
      if (typeof msg === 'object') {
        const role = msg.role === 'user' ? 'You' : 'AI';
        const content = msg.content?.substring(0, 80) || '...';
        text += `${role}: ${content}\n`;
      }
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "10.4" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.4'));

// Enhanced knowledge base
const ROBOX_KNOWLEDGE_BASE = `
CRITICAL RULES FOR UI CREATION:

1. NO DIRECT UI INSTANCE CREATION:
   • NEVER create ScreenGui, Frame, TextLabel, TextButton, ImageLabel, or any UI instances directly
   • ALL UI must be created DYNAMICALLY by a LocalScript
   • UI instances should exist ONLY in code, not as separate instances

2. CORRECT APPROACH FOR UI:
   • Create ONE LocalScript in game.StarterPlayer.StarterPlayerScripts
   • That LocalScript should create ALL UI elements programmatically
   • Example: Create ScreenGui, then Frame, then buttons inside the LocalScript code
   • This ensures UI is properly parented and managed

3. SCRIPT PLACEMENT:
   • LocalScripts for UI → game.StarterPlayer.StarterPlayerScripts (ALWAYS)
   • Scripts (server) → game.ServerScriptService
   • ModuleScripts → game.ReplicatedStorage.Modules
   • RemoteEvents → game.ReplicatedStorage.Remotes

4. AVOID DUPLICATION:
   • Check existing scripts before creating
   • Modify existing scripts instead of creating duplicates
`;

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 Hi! I'm Acidnade AI. Ready to help!" 
      });
    }
    
    // Get or create session data
    const session = sessionId ? (sessionData.get(sessionId) || {}) : {};
    if (!session.previousSteps) session.previousSteps = [];
    if (!session.createdInstances) session.createdInstances = [];
    if (!session.chatHistory) session.chatHistory = [];
    
    // Add to chat history
    session.chatHistory.push({ role: 'user', content: prompt });
    if (session.chatHistory.length > 20) {
      session.chatHistory = session.chatHistory.slice(-20);
    }
    
    const contextSummary = formatContext({
      ...context,
      chatHistory: session.chatHistory
    });
    
    sessionData.set(sessionId, session);

    // === 🧠 SMART AI WITH UI RULES ===
    const systemPrompt = `You are Acidnade, a friendly AI with Roblox expertise.

${ROBOX_KNOWLEDGE_BASE}

## 🚨 CRITICAL UI RULE:
DO NOT CREATE UI INSTANCES (ScreenGui, Frame, TextLabel, etc) AS SEPARATE STEPS.
ALL UI must be created INSIDE a LocalScript's code.

## 🎯 HOW TO HANDLE UI REQUESTS:
1. User wants a UI (menu, HUD, buttons, etc)
2. Create ONE LocalScript in game.StarterPlayer.StarterPlayerScripts
3. That LocalScript creates ALL UI elements programmatically
4. Example LocalScript should include code like:
   local screenGui = Instance.new("ScreenGui")
   local frame = Instance.new("Frame")
   -- etc

## 📤 OUTPUT FORMAT
For UI requests, output ONE LocalScript that creates everything:

{
  "message": "I'll create a UI game!",
  "needsApproval": false,
  "stepsTotal": 1,
  "progressText": "Steps (0/1)",
  "sequentialExecution": true,
  "plan": [
    {
      "step": 1,
      "description": "Create UI game with dynamic UI creation",
      "type": "create",
      "className": "LocalScript",
      "name": "GameNameClient",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts",
      "properties": {
        "Source": "-- This script creates ALL UI elements\\nlocal Players = game:GetService('Players')\\nlocal player = Players.LocalPlayer\\nlocal playerGui = player:WaitForChild('PlayerGui')\\n\\n-- Create ScreenGui\\nlocal screenGui = Instance.new('ScreenGui')\\nscreenGui.Name = 'GameGui'\\nscreenGui.Parent = playerGui\\n\\n-- Create Frame\\nlocal mainFrame = Instance.new('Frame')\\n-- ... and so on"
      }
    }
  ]
}

CURRENT CONTEXT:
${contextSummary}

USER REQUEST:
"${prompt}"

Now respond in STRICT JSON only.`;
    
    console.log("🤖 Sending to AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Hello! Ready to create something awesome." 
      });
    }
    
    if (!result?.response?.text) {
      console.error("No response from AI");
      return res.json({ 
        message: "Ready to help with your game!" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "Hi there! What game would you like to make?" 
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
        message: "I'll help you create that game! I'll make sure all UI is created properly inside a LocalScript." 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "Creating your game with proper UI setup!";
    }
    
    // Track AI response
    session.chatHistory.push({ role: 'assistant', content: data.message });
    
    // Handle plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      
      if (!data.sequentialExecution) data.sequentialExecution = true;
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }
      
      // ENFORCE UI RULES
      data.plan.forEach(step => {
        if (!step.type) step.type = "create";
        if (!step.requiresConfirmation) step.requiresConfirmation = false;
        if (!step.timeout) step.timeout = 5;
        
        // PREVENT DIRECT UI INSTANCE CREATION
        const uiClasses = ["ScreenGui", "Frame", "TextLabel", "TextButton", "ImageLabel", "ScrollingFrame", "TextBox", "UIListLayout", "UIPadding", "UICorner", "UIStroke"];
        if (uiClasses.includes(step.className)) {
          console.log(`🚫 BLOCKED UI Creation: ${step.className}`);
          // Convert to LocalScript that creates the UI
          step.className = "LocalScript";
          step.name = step.name.replace("Gui", "Client").replace("Frame", "Client").replace("Label", "Client").replace("Button", "Client");
          step.parentPath = "game.StarterPlayer.StarterPlayerScripts";
          
          // Update description
          step.description = "Create UI elements programmatically: " + step.description;
          
          // Update source to create UI
          if (step.properties && step.properties.Source) {
            const originalSource = step.properties.Source;
            step.properties.Source = `-- This LocalScript creates UI elements dynamically\nlocal Players = game:GetService("Players")\nlocal player = Players.LocalPlayer\nlocal playerGui = player:WaitForChild("PlayerGui")\n\n-- Create UI elements here\n-- Original plan was to create: ${step.className} "${step.name}"\n-- ${originalSource}`;
          }
        }
        
        // Force LocalScripts to StarterPlayerScripts
        if (step.className === "LocalScript") {
          if (!step.parentPath.includes("StarterPlayer")) {
            step.parentPath = "game.StarterPlayer.StarterPlayerScripts";
          }
        }
        
        // Add to session memory
        if (step.type !== "delete") {
          session.previousSteps.push({
            description: step.description,
            type: step.type,
            name: step.name,
            parentPath: step.parentPath,
            timestamp: Date.now()
          });
          
          if (session.previousSteps.length > 15) {
            session.previousSteps = session.previousSteps.slice(-15);
          }
        }
      });
    }
    
    // Update session
    sessionData.set(sessionId, session);
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps` : 'chat'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "Hi! 😊 Let's create an amazing game together!" 
    });
  }
});

// Session cleanup
app.post('/session/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessionData.has(sessionId)) {
    sessionData.delete(sessionId);
  }
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v10.4 — NO DIRECT UI CREATION`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`🧠 Model: gemini-3-flash-preview`);
  console.log(`\n✅ NEW RULE:`);
  console.log(`   • NO ScreenGui/Frame/TextLabel as separate instances`);
  console.log(`   • All UI created inside LocalScripts`);
  console.log(`   • LocalScripts always in StarterPlayerScripts`);
  console.log(`   • Cleaner workspace, proper UI parenting`);
  console.log(`\n🎮 Ready for better game creation!\n`);
});
