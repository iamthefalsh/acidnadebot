// server.js — Acidnade AI v10.3 (MEMORY + SMART OPERATIONS)
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

// Session memory storage
const sessionMemory = new Map();

// Format context with memory
function formatContext(context) {
  if (!context) return "No context available.";
  
  let text = `SESSION CONTEXT:\n\n`;
  
  // Project stats
  if (context.project) {
    text += `PROJECT STATE:\n`;
    text += `- Scripts: ${context.project.TotalScripts || 0}\n`;
    text += `- UI Elements: ${context.project.TotalUI || 0}\n\n`;
  }
  
  // Session stats
  if (context.stats) {
    text += `SESSION STATS:\n`;
    text += `- Created: ${context.stats.totalCreated || 0} items\n`;
    text += `- Modified: ${context.stats.totalModified || 0} items\n`;
    text += `- Deleted: ${context.stats.totalDeleted || 0} items\n\n`;
  }
  
  // Recent creations
  if (context.created && context.created.length > 0) {
    text += `RECENTLY CREATED:\n`;
    context.created.forEach((item, i) => {
      text += `${i + 1}. ${item.Name || item.name} (${item.ClassName || item.className}) at ${item.Path || item.path}\n`;
    });
    text += '\n';
  }
  
  // Recent modifications
  if (context.modified && context.modified.length > 0) {
    text += `RECENTLY MODIFIED:\n`;
    context.modified.forEach((item, i) => {
      text += `${i + 1}. ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
    text += '\n';
  }
  
  // Recent deletions
  if (context.deleted && context.deleted.length > 0) {
    text += `RECENTLY DELETED:\n`;
    context.deleted.forEach((item, i) => {
      text += `${i + 1}. ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
    text += '\n';
  }
  
  // Chat history (last 5 messages)
  if (context.chatHistory && context.chatHistory.length > 0) {
    text += `CONVERSATION HISTORY (last ${Math.min(5, context.chatHistory.length)} messages):\n`;
    const recent = context.chatHistory.slice(-5);
    recent.forEach(msg => {
      const role = msg.role === 'user' ? 'USER' : 'AI';
      const content = (msg.content || '').substring(0, 100);
      text += `${role}: ${content}${content.length >= 100 ? '...' : ''}\n`;
    });
    text += '\n';
  }
  
  // Current selection
  if (context.selected && context.selected.length > 0) {
    text += `CURRENT SELECTION:\n`;
    context.selected.forEach(obj => {
      text += `- ${obj.Name} (${obj.ClassName})\n`;
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

// Main AI endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request received");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "Hi! I'm Acidnade AI. What would you like to create today?" 
      });
    }
    
    // Store session memory
    if (sessionId) {
      if (!sessionMemory.has(sessionId)) {
        sessionMemory.set(sessionId, {
          created: [],
          modified: [],
          deleted: [],
          history: []
        });
      }
      
      const memory = sessionMemory.get(sessionId);
      
      // Update memory from context
      if (context.created) {
        context.created.forEach(item => {
          if (!memory.created.find(c => c.path === item.path)) {
            memory.created.push(item);
          }
        });
        // Keep last 20
        if (memory.created.length > 20) {
          memory.created = memory.created.slice(-20);
        }
      }
    }
    
    const contextSummary = formatContext(context);
    
    // Enhanced AI prompt with memory awareness
    const systemPrompt = `You are Acidnade AI, an expert Roblox development assistant with PERFECT MEMORY.

CRITICAL MEMORY RULES:
1. YOU REMEMBER EVERYTHING from this session
2. Check "RECENTLY CREATED" before creating - DON'T duplicate
3. For MODIFY requests - look in "RECENTLY CREATED" or "RECENTLY MODIFIED" for the script name
4. For DELETE requests - find the exact name from context
5. ALWAYS reference what you've already created when relevant

${contextSummary}

RESPONSE FORMAT:

For development tasks (create/modify/delete):
{
  "message": "Brief friendly response acknowledging what you'll do",
  "needsApproval": true,  // if 3+ steps
  "stepsTotal": N,
  "plan": [
    {
      "step": 1,
      "description": "Clear description",
      "type": "create|modify|delete",
      "className": "Script/LocalScript/ModuleScript/ScreenGui/etc",
      "name": "ExactName",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- Complete working code\\n..."
      }
    }
  ]
}

For chat/questions:
{
  "message": "Your helpful response"
}

CRITICAL OPERATION RULES:

CREATE:
- ALWAYS check RECENTLY CREATED first - don't duplicate!
- If script exists, say "I already created X for you"
- Use descriptive names
- Place scripts intelligently:
  * Server logic → game.ServerScriptService
  * UI LocalScripts → game.StarterPlayer.StarterPlayerScripts
  * Client logic → game.ReplicatedStorage.Client
  * Modules → game.ReplicatedStorage.Modules
  * RemoteEvents → game.ReplicatedStorage.Remotes

MODIFY:
- Type MUST be "modify"
- Look in RECENTLY CREATED or chat history for script name
- Provide COMPLETE updated source code
- Use comments like "-- MODIFIED:", "-- ADDED:"
- parentPath should be the PARENT container
- name should be EXACT script name

DELETE:
- Type MUST be "delete"
- Find exact name from context
- Confirm what you're deleting
- parentPath and name must match existing item

USER REQUEST:
"${prompt}"

Respond in STRICT JSON only. No markdown.`;

    console.log("🤖 Sending to Gemini...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError.message);
      return res.json({ 
        message: "I'm here to help! What would you like to build?" 
      });
    }
    
    if (!result?.response?.text) {
      return res.json({ 
        message: "Ready to help! What would you like to create?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      return res.json({ 
        message: "Hello! I'm Acidnade AI, ready to help you build amazing Roblox experiences!" 
      });
    }
    
    // Clean markdown fences
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed:", parseError.message);
      console.log("Raw response preview:", response.substring(0, 300));
      
      data = { 
        message: "I'm ready to help! What would you like to create or modify?" 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'm here to help!";
    }
    
    // Normalize plan
    if (data.plan && !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    // Set metadata for plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }
      
      // Validate each step
      data.plan.forEach(step => {
        if (!step.type) step.type = "create";
        
        // Ensure proper fields
        if (!step.description) {
          step.description = `${step.type} ${step.name || 'item'}`;
        }
        
        // Intelligent LocalScript placement
        if (step.className === "LocalScript" && !step.parentPath.includes("StarterPlayer")) {
          if (step.description && (
            step.description.toLowerCase().includes("ui") ||
            step.description.toLowerCase().includes("gui") ||
            step.description.toLowerCase().includes("interface")
          )) {
            step.parentPath = "game.StarterPlayer.StarterPlayerScripts";
          }
        }
      });
    }
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps` : 'chat'}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "Hi! I'm Acidnade AI. I'm here to help you build amazing Roblox games!" 
    });
  }
});

// Session cleanup endpoint
app.post('/session/clear', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId && sessionMemory.has(sessionId)) {
    sessionMemory.delete(sessionId);
  }
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v10.3 — MEMORY + SMART OPERATIONS`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`🧠 Model: gemini-3-flash-preview`);
  console.log(`\n✅ KEY FEATURES:`);
  console.log(`   • Full memory system - remembers everything`);
  console.log(`   • Smart duplicate prevention`);
  console.log(`   • Working modify & delete operations`);
  console.log(`   • Context-aware responses`);
  console.log(`   • Intelligent script placement`);
  console.log(`\n💬 Ready for intelligent development!\n`);
});
