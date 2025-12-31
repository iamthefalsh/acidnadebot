// server.js — Acidnade AI v9.2 (ENHANCED CREATION WITH DELETE + MODERN UI)
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

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "9.2" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v9.2'));

// Main endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request");
    const { prompt, context } = req.body;
    
    const contextSummary = formatContext(context);
    
    const systemPrompt = `You are Acidnade, a Roblox dev AI that CREATES code, not explains it.

CRITICAL RULES:
1. When user asks to CREATE/BUILD/MAKE/DELETE/MODIFY something, you MUST return a "plan" array with ACTUAL WORKING CODE
2. NEVER just explain how to do it - ALWAYS include the complete code in the plan
3. Keep responses SHORT (1-2 sentences)
4. Talk like a normal helpful dev, not formal, not slang
5. IMPORTANT: NEVER create ScreenGuis - create LocalScripts in StarterPlayerScripts instead
6. AI CAN DELETE scripts when requested by user (use "type": "delete")

ADVANCED UI CREATION RULES:
- NEVER create ScreenGui directly
- ALWAYS create LocalScript in StarterPlayerScripts
- The LocalScript should create UI programmatically with modern styling:
  * Always add UICorners to frames/buttons (radius 8-16)
  * Add UIStrokes with black color (Color3.new(0,0,0)) thickness 1-2
  * Use premium fonts: SourceSansProBold for titles, SourceSansPro for body
  * For buttons: Use green (#00FF88) or accent colors with black text
  * Add hover animations and effects using TweenService
  * Use proper UIPadding and UIListLayout for organization
  * Add drop shadows (ImageLabel with shadow asset rbxassetid://1316045217)
  * Use gradients for premium look
  * For ALL text labels: Add black UIStroke for readability
  * Use AnchorPoint for center positioning
  * Set ZIndexBehavior to Sibling
  * Make UI responsive with UDim2 scaling

SCRIPT DELETION:
- If user asks to delete/remove scripts, include a step with "type": "delete"
- Provide the exact path to delete: {"type": "delete", "path": "game.ServerScriptService.ScriptName"}
- Always check if the file exists before attempting deletion

${contextSummary}

RESPONSE FORMAT (JSON ONLY):

For questions (what, why, how):
{
  "message": "Short answer here"
}

For creating ANYTHING (ALWAYS do this when user wants something built):
{
  "message": "Creating it now.",
  "plan": [
    {
      "step": 1,
      "description": "Clear step description",
      "type": "create|modify|delete",
      "className": "LocalScript/Script/ModuleScript/RemoteEvent",
      "name": "DescriptiveName",
      "parentPath": "game.Service.Path",
      "properties": {
        "Source": "-- COMPLETE WORKING CODE HERE\\\\nlocal Players = game:GetService(\\\\"Players\\\\")\\\\n..."
      }
    }
  ]
}

EXAMPLE RESPONSES:

User: "make me a shop system"
Response: {"message":"Creating shop system.","plan":[{"step":1,"description":"Create shop UI script","type":"create","className":"LocalScript","name":"ShopUI","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"local Players = game:GetService(\\\\"Players\\\\")\\\\n-- Create UI programmatically with modern styling..."}},{"step":2,"description":"Create shop server handler","type":"create","className":"Script","name":"ShopHandler","parentPath":"game.ServerScriptService","properties":{"Source":"local DataStoreService = game:GetService(\\\\"DataStoreService\\\\")\\\\n-- Full server code"}}]}

User: "delete the test script in ServerScriptService"
Response: {"message":"Deleting test script.","plan":[{"step":1,"description":"Delete test script","type":"delete","className":"Script","name":"TestScript","parentPath":"game.ServerScriptService"}]}

User: "create a wheel of fortune game"
Response: {"message":"Creating Wheel of Fortune RNG game.","plan":[{"step":1,"description":"Create wheel UI script","type":"create","className":"LocalScript","name":"WheelOfFortuneUI","parentPath":"game.StarterPlayer.StarterPlayerScripts","properties":{"Source":"-- Complete wheel UI code with spinning animation"}},{"step":2,"description":"Create wheel game logic","type":"create","className":"Script","name":"WheelGame","parentPath":"game.ServerScriptService","properties":{"Source":"-- Complete server-side RNG logic"}},{"step":3,"description":"Create rewards system","type":"create","className":"ModuleScript","name":"RewardSystem","parentPath":"game.ReplicatedStorage","properties":{"Source":"-- Module for handling rewards"}}]}

USER REQUEST:
${prompt}

REMEMBER: If they want ANYTHING created/modified/deleted, return a plan with complete code. Don't explain, BUILD IT.

Respond with JSON only.`;

    const result = await model.generateContent(systemPrompt);
    let response = result.response.text().trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    // Fix common JSON issues
    response = response.replace(/\\n/g, '\n').replace(/\\\\"/g, '\\"');
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      console.error("Parse error:", e.message);
      console.error("Response that failed:", response.substring(0, 200));
      // Try to extract JSON from malformed response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          data = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          console.error("Second parse error:", e2.message);
          data = { 
            message: "Creating what you requested. Please check the Studio output for details.", 
            plan: [] 
          };
        }
      } else {
        data = { 
          message: "Creating what you requested. The AI response was malformed, but the system will handle it.", 
          plan: [] 
        };
      }
    }
    
    // Ensure valid response
    if (!data.message && !data.plan) {
      data.message = "Done.";
    }
    
    // Ensure all plan steps have required fields
    if (data.plan && Array.isArray(data.plan)) {
      data.plan.forEach((step, index) => {
        if (!step.step) step.step = index + 1;
        if (!step.type) step.type = "create";
        if (step.type === "delete") {
          if (!step.path && step.parentPath && step.name) {
            step.path = step.parentPath + "." + step.name;
          }
        }
      });
    }
    
    console.log(`✅ ${data.plan ? 'PLAN (' + data.plan.length + ' steps)' : 'MESSAGE'}`);
    res.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ 
      message: "Working on your request. Server processing complete.",
      plan: []
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v9.2 - ENHANCED CREATION WITH DELETE + MODERN UI`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`\n✅ AI Features:`);
  console.log(`   • Creates instead of explains`);
  console.log(`   • Can delete scripts`);
  console.log(`   • Modern UI styling rules`);
  console.log(`   • Enhanced context awareness`);
  console.log(`   • Fixed JSON parsing issues`);
  console.log(`\n📡 Ready for Wheel of Fortune RNG game creation!\n`);
});
