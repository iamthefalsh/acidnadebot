// server.js — Acidnade AI v10.1 (AI-DRIVEN INTENT + NO KEYWORDS)
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
// 🔥 Keep your cutting-edge model name
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
  res.json({ status: "OK", version: "10.1" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v10.1'));

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
    
    // Store the last request for potential debugging
    if (sessionId) {
      session.lastRequest = prompt;
      session.lastContext = context;
      sessionData.set(sessionId, session);
    }

    // === 🧠 FULLY AI-DRIVEN INTENT DETECTION ===
    // No more keyword functions — the model decides everything
    const systemPrompt = `You are Acidnade, an expert Roblox AI assistant fluent in **Luau** and game architecture.

Your job is to **analyze the user's message** and respond appropriately:

- If it's a **greeting, question, or casual chat** → return a friendly message (no plan)
- If it's a **request to create something new** → output a "create" plan
- If it's a **request to edit/modify existing code** → output a "modify" plan with COMPLETE updated source
- If it's a **bug report or "not working"** → treat as debugging: fix the most recent relevant script

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

#### ➤ For code requests (create/edit/debug):
{
  "message": "Brief explanation",
  "needsApproval": true, // if plan has ≥3 steps
  "stepsTotal": N,
  "progressText": "Steps (0/N)",
  "plan": [
    {
      "step": 1,
      "description": "Clear purpose",
      "type": "create|modify|delete",
      "className": "Valid Roblox ClassName (e.g., Script, LocalScript)",
      "name": "ExactInstanceName", // ← critical for modify!
      "parentPath": "game.ServerScriptService.Folder",
      "properties": {
        "Source": "-- FULL LUUAU CODE\\n-- Complete, safe, runnable\\n..."
      }
    }
  ]
}

#### ➤ For chat/greetings/questions:
{
  "message": "Your natural, helpful reply"
}

---

### 🛠️ RULES
- ALWAYS output **complete Luau code** — never snippets or placeholders
- For "modify": **never delete unrelated logic**, add with \`-- ADDED:\` comments
- Use Roblox best practices: pcall, service caching, cleanup
- Never delete unless user **explicitly says "delete" or "remove"**
- If script name is unknown during modify, infer from context (e.g., "shop" → "ShopSystem")
- Prioritize safety: validate players, instances, and inputs

USER MESSAGE:
"${prompt}"

Now respond in **strict JSON only**. No markdown, no extra text.`;

    console.log("🤖 Sending request to Gemini AI (gemini-3-flash-preview)...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("Gemini API Error:", apiError.message);
      return res.json({ 
        message: "Hey! 👋 I'm here to help. Let's build or edit something awesome together. What would you like to work on?" 
      });
    }
    
    if (!result?.response?.text) {
      console.error("Invalid or missing response from model");
      return res.json({ 
        message: "Ready to help! What Roblox feature would you like me to create or improve?" 
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError.message);
      return res.json({ 
        message: "Hi! I'm Acidnade AI. Ready to create or edit amazing Roblox experiences with you!" 
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
      
      // Fallback: assume chat if parse fails
      data = { 
        message: "I'm ready to help! What would you like to build, edit, or fix in your Roblox game?" 
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "What would you like to work on?";
    }
    
    // Normalize plan array
    if (data.plan && !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    // Auto-set metadata for plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps (0/${data.stepsTotal})`;
      
      if (data.plan.length >= 3 && data.needsApproval === undefined) {
        data.needsApproval = true;
      }

      // Track session memory
      data.plan.forEach(step => {
        if (!step.type) step.type = "create";
        
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
    
    console.log(`📤 Response: ${data.plan ? `${data.plan.length} steps` : 'chat'}, needsApproval: ${!!data.needsApproval}`);
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "Hi there! 👋 I'm Acidnade AI. How can I help you build or improve your Roblox game today?" 
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
  console.log(`\n🚀 Acidnade AI v10.1 — PURE AI INTENT ENGINE`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`🔑 API Key: ${process.env.API_KEY ? '✓ Set' : '✗ Missing'}`);
  console.log(`🧠 Model: gemini-3-flash-preview (cutting-edge)`);
  console.log(`\n✅ UPGRADES:`);
  console.log(`   • All keyword logic REMOVED`);
  console.log(`   • AI now 100% decides intent`);
  console.log(`   • Universal Luau-focused prompt`);
  console.log(`   • Smarter session memory`);
  console.log(`   • Safer, cleaner, future-proof`);
  console.log(`\n💻 Ready for intelligent Roblox development!\n`);
});
