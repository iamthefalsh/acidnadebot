// server.js — Acidnade AI v10.3 (FIXED DUPLICATION + PROPER MEMORY)
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

// Format context - IMPROVED with better memory
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `📊 WORKSPACE STATE:\n`;
  
  // Project statistics
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `• Scripts: ${stats.TotalScripts || 0}\n`;
    text += `• UI Elements: ${stats.TotalUI || 0}\n`;
    text += `• Total Instances: ${stats.TotalInstances || 0}\n`;
  }
  
  // Existing scripts - IMPORTANT for avoiding duplication
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\n📁 EXISTING SCRIPTS (${scripts.length}):\n`;
      // Show recent scripts first
      scripts.slice(-15).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  // Recently created by THIS SESSION
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `\n🆕 RECENTLY CREATED IN THIS SESSION:\n`;
    context.createdInstances.slice(-10).forEach(item => {
      text += `- ${item.name} (${item.className}) in ${item.parentPath || 'unknown'}\n`;
    });
  }
  
  // Current selection
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\n🎯 CURRENT SELECTION:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  // Chat history
  if (context.chatHistory && context.chatHistory.length > 0) {
    text += `\n💬 RECENT CONVERSATION:\n`;
    // Show last 6 messages
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
  res.json({ status: "OK", version: "10.3" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.3'));

// Enhanced knowledge base
const ROBOX_KNOWLEDGE_BASE = `
ROBLOX DEVELOPMENT RULES:

1. CRITICAL - CHECK EXISTING SCRIPTS FIRST:
   • ALWAYS check "EXISTING SCRIPTS" list before creating anything
   • If a script with similar name/purpose exists → MODIFY it instead
   • NEVER create duplicates of the same script
   • Use descriptive, unique names (e.g., "PlayerDataManager" not "Script")

2. INTELLIGENT SCRIPT PLACEMENT:
   • LocalScripts for UI → game.StarterPlayer.StarterPlayerScripts
   • LocalScripts for tools/mechanics → game.ReplicatedStorage.Client
   • Scripts (server) → game.ServerScriptService
   • ModuleScripts → game.ReplicatedStorage.Modules
   • RemoteEvents → game.ReplicatedStorage.Remotes

3. MODIFICATION OVER CREATION:
   • When user says "add to", "update", "fix", "improve" → MODIFY existing
   • When editing existing features → Find the script first, then modify
   • Always preserve existing functionality unless asked to remove

4. MEMORY & CONTEXT:
   • Remember what was created/mentioned recently
   • Reference previous steps when continuing work
   • Avoid repeating the same actions
`;

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 Hi! I'm Acidnade AI. Ready to help with Roblox or just chat!" 
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
    
    // Store session
    sessionData.set(sessionId, session);

    // === 🧠 SMART AI WITH MEMORY ===
    const systemPrompt = `You are Acidnade, a friendly AI with Roblox expertise.

${ROBOX_KNOWLEDGE_BASE}

## 🎯 HOW TO RESPOND:

### 1. DEVELOPMENT REQUESTS (Output plan):
- When user wants to CREATE, BUILD, MAKE, EDIT, FIX, or MODIFY anything
- When user describes game features or mechanics
- When user mentions specific scripts or objects
- When continuing previous work

### 2. CHAT REQUESTS (Chat only):
- Greetings and casual conversation
- General knowledge questions
- Life advice or philosophical discussions
- Questions about yourself

### 3. CRITICAL RULES:
1. CHECK EXISTING SCRIPTS: Before creating, check if similar script exists
2. NO DUPLICATION: Never create the same script twice
3. MODIFY FIRST: If script exists, modify it instead of creating new
4. USE CONTEXT: Reference previous steps and created items

CURRENT CONTEXT:
${contextSummary}

---

## 📤 OUTPUT FORMAT

### For Development:
{
  "message": "Brief explanation of what I'll do",
  "needsApproval": true, // true if ≥3 steps
  "stepsTotal": N,
  "progressText": "Steps (0/N)",
  "sequentialExecution": true,
  "plan": [
    {
      "step": 1,
      "description": "Clear description",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript|etc",
      "name": "DescriptiveUniqueName",
      "parentPath": "game.ServerScriptService", // Appropriate location
      "properties": {
        "Source": "-- Complete Luau code\\n-- With comments\\n..."
      },
      "requiresConfirmation": false,
      "timeout": 5
    }
  ]
}

### For Chat:
{
  "message": "Your friendly, helpful response"
}

---

## 🚨 IMPORTANT GUIDELINES:
1. If user mentions existing script (like "DebugGUI"), MODIFY it
2. If creating similar to existing script, MODIFY instead
3. Use names that don't conflict with existing scripts
4. Remember what was created in this session
5. For UI LocalScripts: game.StarterPlayer.StarterPlayerScripts
6. For client logic: game.ReplicatedStorage.Client
7. Keep code clean and well-commented

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
        message: "Hello! I'm here to help. What would you like to work on?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("No response from AI");
      return res.json({ 
        message: "Ready to assist! I can help with Roblox development or chat." 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "Hi there! How can I help you today?" 
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
      
      // Fallback with memory
      const lastMessage = session.chatHistory[session.chatHistory.length - 2];
      const lastContent = lastMessage?.content || "";
      
      if (lastContent.toLowerCase().includes("create") || 
          lastContent.toLowerCase().includes("make") ||
          lastContent.toLowerCase().includes("build")) {
        data = { 
          message: "I'll help you create that! But I need you to be more specific. What exactly should I build?" 
        };
      } else {
        data = { 
          message: "I'm here to help! Tell me what you'd like to work on." 
        };
      }
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "Let me help with that!";
    }
    
    // Track AI response in history
    session.chatHistory.push({ role: 'assistant', content: data.message });
    
    // Handle plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      
      if (!data.sequentialExecution) data.sequentialExecution = true;
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }
      
      // Track in session
      data.plan.forEach(step => {
        if (!step.type) step.type = "create";
        if (!step.requiresConfirmation) step.requiresConfirmation = false;
        if (!step.timeout) step.timeout = 5;
        
        // Smart LocalScript placement
        if (step.className === "LocalScript") {
          const desc = (step.description || "").toLowerCase();
          if (desc.includes("ui") || desc.includes("gui") || desc.includes("button") || 
              desc.includes("screen") || desc.includes("interface")) {
            if (!step.parentPath.includes("StarterPlayer")) {
              step.parentPath = "game.StarterPlayer.StarterPlayerScripts";
            }
          } else if (!step.parentPath.includes("ReplicatedStorage") && 
                     !step.parentPath.includes("Workspace")) {
            step.parentPath = "game.ReplicatedStorage.Client";
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
      message: "Hi! 😊 I'm Acidnade AI. Ready to help you build amazing things!" 
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

// Session info endpoint
app.get('/session/:id', (req, res) => {
  const sessionId = req.params.id;
  const session = sessionData.get(sessionId);
  
  if (session) {
    res.json({
      exists: true,
      steps: session.previousSteps?.length || 0,
      chatHistory: session.chatHistory?.length || 0,
      createdInstances: session.createdInstances?.length || 0
    });
  } else {
    res.json({ exists: false });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v10.3 — FIXED MEMORY & DUPLICATION`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`🧠 Model: gemini-3-flash-preview`);
  console.log(`\n✅ FIXES:`);
  console.log(`   • Proper chat history memory`);
  console.log(`   • Checks existing scripts before creating`);
  console.log(`   • No more duplication`);
  console.log(`   • Can modify existing scripts`);
  console.log(`   • Better LocalScript placement`);
  console.log(`   • Session persistence`);
  console.log(`\n💬 Ready for intelligent development!\n`);
});
