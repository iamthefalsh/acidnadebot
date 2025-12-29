// server.js — Autonomous AI Server v7.0
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));

// Security middleware
app.use((req, res, next) => {
  if ((req.method === 'GET' && req.path === '/') || 
      (req.method === 'GET' && req.path === '/health') ||
      (req.method === 'GET' && req.path === '/ping')) {
    return next();
  }
  
  const clientKey = req.headers['x-acidnade-key'];
  const serverKey = process.env.ACIDNADE_API_KEY || process.env.API_KEY;
  
  if (!serverKey) {
    console.warn('⚠️ No API key set - allowing all requests');
    return next();
  }
  
  if (clientKey !== serverKey) {
    return res.status(403).json({ error: "Invalid API key" });
  }
  next();
});

// Initialize Gemini
if (!process.env.API_KEY) {
  console.error("ERROR: Missing API_KEY in environment variables");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// Helper: Format workspace data for AI
function formatWorkspaceContext(workspace) {
  if (!workspace || !workspace.scripts) return "No workspace data available.";
  
  let context = `WORKSPACE OVERVIEW:\n`;
  context += `Total Scripts: ${workspace.scriptCount || 0}\n`;
  context += `Total Folders: ${workspace.folderCount || 0}\n`;
  context += `Total Remotes: ${workspace.remoteCount || 0}\n\n`;
  
  context += `AVAILABLE SCRIPTS:\n`;
  for (const script of workspace.scripts) {
    context += `\n📄 ${script.name} (${script.type})\n`;
    context += `   Path: ${script.path}\n`;
    context += `   Parent: ${script.parent}\n`;
    context += `   Lines: ${script.lines}\n`;
    if (script.source) {
      // Include first 100 lines of each script for context
      const lines = script.source.split('\n').slice(0, 100);
      context += `   Source:\n${lines.map(l => '   ' + l).join('\n')}\n`;
      if (script.lines > 100) {
        context += `   ... (${script.lines - 100} more lines)\n`;
      }
    }
  }
  
  return context;
}

// Helper: Format chat history
function formatChatHistory(history) {
  if (!history || history.length === 0) return "No previous conversation.";
  const recentHistory = history.slice(-8);
  return recentHistory.map(msg => {
    const role = msg.role === "user" ? "User" : "Assistant";
    return `${role}: ${msg.content}`;
  }).join('\n');
}

// Public endpoints
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: "OK", 
    message: "Acidnade AI Server v7.0 - Autonomous Mode",
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.send('PONG');
});

app.get('/', (req, res) => {
  res.send('Acidnade AI Server v7.0 - Autonomous Intelligence');
});

// Main AI endpoint with full workspace access
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request Received");
    const { prompt, workspace, chatHistory } = req.body;
    
    if (!workspace) {
      return res.status(400).json({ error: "Workspace data required" });
    }
    
    const workspaceContext = formatWorkspaceContext(workspace);
    const historyContext = formatChatHistory(chatHistory);
    
    const systemPrompt = `You are Acidnade — an autonomous AI assistant with FULL access to the user's Roblox Studio workspace.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 YOUR CAPABILITIES (AUTONOMOUS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have COMPLETE visibility into the workspace. You can:
- Read ANY script's source code (all sources are provided)
- Search through all scripts to find specific code or functionality
- Understand the architecture and relationships between scripts
- Create new instances (Script, LocalScript, ModuleScript, RemoteEvent, etc.)
- Update existing scripts
- Delete instances when needed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 WORKSPACE ACCESS (LIVE DATA)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${workspaceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 CONVERSATION HISTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${historyContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 BEHAVIOR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. AUTONOMOUS SEARCH: When user asks about a script (e.g., "Can you see the lemonade script?"):
   - Search through the workspace data above
   - Find the script by name (case-insensitive)
   - Read its source code
   - Explain what it does
   - NO special syntax required from user

2. NATURAL INTERACTION: Respond conversationally:
   - "I found the LemonadeScript in Workspace. It handles..."
   - "Looking at your MainScript, I can see it..."
   - "I don't see a script called 'xyz' in your workspace. Did you mean..."

3. PROACTIVE EXPLORATION: If user asks about functionality:
   - Search ALL scripts for relevant code
   - Example: "How does player spawning work?" → Search for "spawn", "character", "respawn" in all sources

4. CODE QUALITY: When creating scripts:
   - Use game:GetService() (never game.Workspace)
   - Professional naming (e.g., "PlayerDataManager", not "Script1")
   - Include documentation comments
   - Production-ready code

5. RESPONSE FORMAT: Return JSON with:
   {
     "message": "Your natural language response explaining what you found/did",
     "actions": [
       {
         "type": "create",
         "instanceType": "Script|LocalScript|ModuleScript|RemoteEvent|etc",
         "name": "ScriptName",
         "parentPath": "game.ServerScriptService" or null,
         "properties": {
           "Source": "-- code here"
         }
       },
       {
         "type": "update",
         "path": "game.ServerScriptService.ExistingScript",
         "name": "ExistingScript",
         "source": "-- updated code"
       },
       {
         "type": "delete",
         "path": "game.ServerScriptService.OldScript",
         "name": "OldScript"
       }
     ]
   }

6. INSTANCE TYPES: You can create ANY of these:
   - Script, LocalScript, ModuleScript
   - RemoteEvent, RemoteFunction
   - BindableEvent, BindableFunction
   - Folder, Configuration
   - StringValue, IntValue, BoolValue, NumberValue, ObjectValue

7. PARENT PATHS: Common parent locations:
   - Server scripts: "game.ServerScriptService"
   - Client scripts: "game.StarterPlayer.StarterPlayerScripts"
   - Shared modules: "game.ReplicatedStorage"
   - UI scripts: "game.StarterGui"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 CRITICAL: NO SPECIAL SYNTAX NEEDED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The user does NOT need to use @ mentions or special commands.
You automatically have access to everything.

Examples:
- "Can you see the lemonade script?" → Search workspace, find it, read it, explain
- "What scripts handle player data?" → Search all scripts for data-related code
- "Fix the bug in MainScript" → Read MainScript, identify issue, update it
- "Create a shop system" → Build ModuleScript + RemoteEvent + UI script

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 USER REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${prompt}

Think step-by-step:
1. Do I need to search for existing scripts? If yes, search the workspace data
2. Do I need to create new code? If yes, include in actions array
3. Do I need to modify existing code? If yes, include update action
4. Write a natural, helpful message explaining what I found/did

Respond with valid JSON (no markdown).`;

    const result = await model.generateContent(systemPrompt);
    let response = result.response.text().trim();
    
    // Clean markdown formatting
    response = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Parse JSON response
    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Fallback: treat as plain text message
      data = {
        message: response,
        actions: []
      };
    }
    
    // Ensure actions array exists
    if (!data.actions) {
      data.actions = [];
    }
    
    console.log(`✅ AI Response: ${data.actions.length} actions`);
    res.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ 
      error: error.message,
      message: "AI processing failed. Please try again."
    });
  }
});

// Legacy compatibility endpoints (optional - keep for backward compatibility)
app.post('/chat', async (req, res) => {
  console.log("⚠️ Legacy /chat endpoint called - redirecting to /ai");
  req.body.workspace = req.body.context?.workspace || { scripts: [], scriptCount: 0 };
  return app._router.handle(
    Object.assign(req, { url: '/ai', originalUrl: '/ai' }), 
    res
  );
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI Server v7.0 - Autonomous Mode`);
  console.log(`🌍 Listening on http://0.0.0.0:${PORT}`);
  console.log(`\n✅ Endpoints:`);
  console.log(`   GET  /health     - Health check`);
  console.log(`   POST /ai         - Autonomous AI with full workspace access`);
  console.log(`\n🔑 Security: ${process.env.ACIDNADE_API_KEY ? 'Enabled' : 'Disabled'}`);
  console.log(`🧠 Model: Gemini 2.0 Flash (Experimental)`);
  console.log(`\n🎯 Features:`);
  console.log(`   • Autonomous script reading`);
  console.log(`   • Workspace-wide search`);
  console.log(`   • Natural language interaction`);
  console.log(`   • No special syntax required`);
  console.log(`\n📡 Ready for requests!\n`);
});
