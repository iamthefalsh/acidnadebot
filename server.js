// server.js — Acidnade AI v10.2 (SMART + FLEXIBLE + BETTER SCRIPT PLACEMENT)
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

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "10.2" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.2'));

// Enhanced knowledge base for Roblox development
const ROBOX_KNOWLEDGE_BASE = `
ROBLOX DEVELOPMENT BEST PRACTICES:

1. INTELLIGENT SCRIPT PLACEMENT RULES:
   - Script (server-side): game.ServerScriptService
   - ModuleScript (shared code): game.ReplicatedStorage.Modules
   - RemoteEvent/RemoteFunction: game.ReplicatedStorage.Remotes
   - LocalScript RULES:
     * If it creates/controls UI: game.StarterPlayer.StarterPlayerScripts
     * If it's for character/player controls: game.StarterPlayer.StarterCharacterScripts
     * If it's for client-side game logic: game.ReplicatedStorage.Client
     * If it's tool-related: game.ReplicatedStorage.Tools
     * If user specifies location: use their specified location
   - ScreenGui: game.StarterGui
   - Folder: Organize by purpose (e.g., "Systems", "UI", "Data")

2. SMART SCRIPT ORGANIZATION:
   - Don't always follow the same template (Remote + Module + Script + LocalScript)
   - Choose the simplest solution for the task
   - If it's a small feature, one script might be enough
   - If it's complex, break into logical components

3. SECURITY PATTERNS:
   - Always validate input with pcall()
   - Never trust client data - validate on server
   - Use :FindFirstChild() before accessing children
   - Implement rate limiting for remote events

4. PERFORMANCE PATTERNS:
   - Cache services: local ReplicatedStorage = game:GetService("ReplicatedStorage")
   - Use task.spawn() for non-critical async operations
   - Debounce rapid-fire events (clicks, input)
   - Clean up connections with :Disconnect()

5. COMMON PATTERNS:
   - DataStores: Use UpdateAsync with retry logic
   - PlayerData: Use profiles with ProfileService
   - GUIs: Use ScreenGuis with AutoLocalize enabled
   - Animations: Use AnimationController with Humanoid
   - Sounds: Use SoundGroups for organization

6. ERROR HANDLING:
   - Always wrap in pcall() for risky operations
   - Use warn() for non-critical errors
   - Implement try-catch for data stores
   - Validate player existence before operations
`;

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 Hi! I'm Acidnade AI. I can help you with Roblox development or just chat about anything. What's on your mind?" 
      });
    }
    
    // Get or create session data
    const session = sessionId ? (sessionData.get(sessionId) || {}) : {};
    if (!session.previousSteps) session.previousSteps = [];
    if (!session.createdInstances) session.createdInstances = [];
    
    const contextSummary = formatContext(context);
    
    // Store the last request for potential debugging
    if (sessionId) {
      session.lastRequest = prompt;
      session.lastContext = context;
      sessionData.set(sessionId, session);
    }

    // === 🧠 SMART CONTEXT-AWARE AI ===
    const systemPrompt = `You are Acidnade, a friendly and knowledgeable AI assistant with expertise in Roblox development (Luau).

${ROBOX_KNOWLEDGE_BASE}

## 🤔 HOW TO RESPOND:

### 1. ROBLOX DEVELOPMENT REQUESTS (Output a plan):
- When user wants to CREATE, BUILD, MAKE, EDIT, FIX, or MODIFY anything in Roblox
- When user describes a game feature, system, or mechanic
- When user asks "how to" implement something in Roblox
- When user mentions specific Roblox classes or scripts

### 2. GENERAL CONVERSATION (Chat response only):
- Greetings, casual chat, life questions
- General knowledge questions
- Philosophical discussions
- When user just wants to talk
- Questions about yourself or your capabilities

### 3. INTELLIGENT SCRIPT PLACEMENT:
- DON'T always use the same template (Remote+Module+Script+LocalScript)
- Choose the MINIMAL setup needed for the task
- For LocalScripts:
  • UI-related → StarterPlayer.StarterPlayerScripts (unless user specifies)
  • Character controls → StarterPlayer.StarterCharacterScripts
  • Client logic → ReplicatedStorage.Client
  • Tool scripts → ReplicatedStorage.Tools
- Keep it SIMPLE and ORGANIZED

Use this context:

WORKSPACE:
${contextSummary}

SESSION HISTORY (last 5 actions):
${session.previousSteps.length > 0 
  ? session.previousSteps.slice(-5).map((s, i) => `${i + 1}. ${s.description}`).join('\n')
  : 'No prior actions in this session.'}

RECENTLY CREATED INSTANCES (last 3):
${session.createdInstances.length > 0
  ? session.createdInstances.slice(-3).map(i => `- ${i.name} (${i.className}) @ ${i.path}`).join('\n')
  : 'None'}

---

### 📤 OUTPUT FORMAT

#### ➤ For Roblox development requests:
{
  "message": "I'll help you with that! Here's my plan:",
  "needsApproval": true, // if plan has ≥3 steps
  "stepsTotal": N,
  "progressText": "Steps (0/N)",
  "sequentialExecution": true,
  "plan": [
    {
      "step": 1,
      "description": "Clear, concise description",
      "type": "create|modify|delete",
      "className": "Valid Roblox ClassName",
      "name": "DescriptiveName",
      "parentPath": "Intelligent location based on purpose",
      "properties": {
        "Source": "-- Complete, runnable Luau code\\n-- With comments\\n..."
      },
      "requiresConfirmation": false,
      "timeout": 5
    }
  ]
}

#### ➤ For general conversation:
{
  "message": "Your friendly, helpful response here"
}

---

### 🎯 CRITICAL RULES
1. BE FLEXIBLE: Adjust script placement intelligently
2. BE SIMPLE: Don't over-engineer solutions
3. BE FRIENDLY: Chat naturally when appropriate
4. BE HELPFUL: Provide complete code when needed
5. BE SMART: Understand the user's actual needs

USER MESSAGE:
"${prompt}"

Now respond in **strict JSON only**. No markdown, no extra text.`;

    console.log("🤖 Sending request to Gemini AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError.message);
      return res.json({ 
        message: "Hey there! 😊 I'm here to help with Roblox development or just have a chat. What would you like to do?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("Invalid or missing response from model");
      return res.json({ 
        message: "Ready to assist! I can help with Roblox development or answer questions. What would you like?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError.message);
      return res.json({ 
        message: "Hello! I'm Acidnade AI. I can help you build amazing Roblox games or chat about anything!" 
      });
    }
    
    // Clean potential markdown fences
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed:", parseError.message);
      console.log("Raw response preview:", response.substring(0, 250));
      
      // Fallback: Friendly chat response
      data = { 
        message: "I'm here to help! I can assist with Roblox development or answer general questions. What would you like to do?" 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'm ready to help! What would you like to work on or talk about?";
    }
    
    // Normalize plan array
    if (data.plan && !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    // Auto-set metadata for plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      
      // Force sequential execution for safety
      if (!data.sequentialExecution) {
        data.sequentialExecution = true;
      }
      
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }

      // Track session memory
      data.plan.forEach(step => {
        if (!step.type) step.type = "create";
        
        // Ensure sequential execution flags
        if (!step.hasOwnProperty('requiresConfirmation')) {
          step.requiresConfirmation = false;
        }
        if (!step.hasOwnProperty('timeout')) {
          step.timeout = 5;
        }
        
        // INTELLIGENT SCRIPT PLACEMENT VALIDATION
        if (step.className === "LocalScript") {
          // Check if user specified location
          if (!step.parentPath || 
              (!step.parentPath.includes("StarterPlayer") && 
               !step.parentPath.includes("ReplicatedStorage") &&
               !step.parentPath.includes("Workspace") &&
               !step.parentPath.includes("Server"))) {
            
            // Default to StarterPlayer for UI-related LocalScripts
            if (step.description && (
                step.description.toLowerCase().includes("ui") ||
                step.description.toLowerCase().includes("gui") ||
                step.description.toLowerCase().includes("interface") ||
                step.description.toLowerCase().includes("screen") ||
                step.description.toLowerCase().includes("button") ||
                step.description.toLowerCase().includes("label"))) {
              step.parentPath = "game.StarterPlayer.StarterPlayerScripts";
            }
            // Default to ReplicatedStorage for client logic
            else {
              step.parentPath = "game.ReplicatedStorage.Client";
            }
          }
        }
        
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
          while (session.previousSteps.length > 10) session.previousSteps.shift();
          while (session.createdInstances.length > 10) session.createdInstances.shift();
        }
      });
      
      sessionData.set(sessionId, session);
    }
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps` : 'chat'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "Hi! 😊 I'm Acidnade AI. Whether you need help with Roblox development or just want to chat, I'm here for you!" 
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
  console.log(`\n🚀 Acidnade AI v10.2 — SMART + FLEXIBLE + BETTER PLACEMENT`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`🧠 Model: gemini-3-flash-preview`);
  console.log(`\n✅ KEY UPGRADES:`);
  console.log(`   • Conversational for general chat/questions`);
  console.log(`   • Intelligent LocalScript placement`);
  console.log(`   • No rigid templates (Remote+Module+Script+LocalScript)`);
  console.log(`   • UI LocalScripts → StarterPlayer.StarterPlayerScripts`);
  console.log(`   • Client logic → ReplicatedStorage.Client`);
  console.log(`   • Flexible and user-friendly`);
  console.log(`\n💬 Ready for development help or friendly chat!\n`);
});
