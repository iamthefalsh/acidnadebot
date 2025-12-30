// server.js — Acidnade AI v9.1 (FORCES CREATION, NO EXPLANATIONS)
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
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// Format context
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE:\n`;
  
  if (context.hierarchy) {
    for (const svc of context.hierarchy.slice(0, 5)) {
      if (svc && svc.name) {
        text += `- ${svc.name}: ${svc.children?.length || 0} items\n`;
      }
    }
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "9.1" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v9.1'));

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request");
    const { prompt, context } = req.body;
    
    const contextSummary = formatContext(context);
    
    const systemPrompt = `You are Acidnade, a Roblox dev AI that CREATES code, not explains it.

CRITICAL RULES:
1. When user asks to CREATE/BUILD/MAKE something, you MUST return a "plan" array with ACTUAL WORKING CODE
2. NEVER just explain how to do it - ALWAYS include the complete code in the plan
3. Keep responses SHORT (1-2 sentences)
4. Talk like a normal helpful dev, not formal, not slang

${contextSummary}

RESPONSE FORMAT:

For questions (what, why, how):
{
  "message": "Short answer here"
}

For creating ANYTHING (ALWAYS do this when user wants something built):
{
  "message": "Creating it now.",
  "plan": [
    {
      "description": "Clear step description",
      "type": "create",
      "className": "LocalScript",
      "name": "ShopUI",
      "parentPath": "game.StarterGui",
      "properties": {
        "Source": "-- COMPLETE WORKING CODE HERE\\nlocal Players = game:GetService(\\"Players\\")\\n..."
      }
    }
  ]
}

EXAMPLES:

User: "make me a shop"
Response: {"message":"Creating shop system.","plan":[{"description":"Create shop UI","type":"create","className":"LocalScript","name":"ShopUI","parentPath":"game.StarterGui","properties":{"Source":"-- Full UI code"}},{"description":"Create shop handler","type":"create","className":"Script","name":"ShopHandler","parentPath":"game.ServerScriptService","properties":{"Source":"-- Full server code"}}]}

User: "what scripts do I have"
Response: {"message":"You have X scripts in your workspace."}

USER REQUEST:
${prompt}

REMEMBER: If they want ANYTHING created, return a plan with complete code. Don't explain, BUILD IT.

Respond with JSON only.`;

    const result = await model.generateContent(systemPrompt);
    let response = result.response.text().trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      console.error("Parse error:", e);
      data = { message: response };
    }
    
    // Ensure valid response
    if (!data.message && !data.plan) {
      data.message = "Done.";
    }
    
    console.log(`✅ ${data.plan ? 'PLAN (' + data.plan.length + ' steps)' : 'MESSAGE'}`);
    res.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v9.1 - FORCES CREATION`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`\n✅ AI now CREATES instead of EXPLAINS`);
  console.log(`\n📡 Ready!\n`);
});
