// server.js — Acidnade AI v8.0 (LEMONADE-STYLE PLAN + NO LAZY CODE)
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

// Format workspace
function formatWorkspaceContext(workspace) {
  if (!workspace || !workspace.scripts) return "No workspace data.";
  
  let context = `WORKSPACE SNAPSHOT:\n`;
  context += `Scripts: ${workspace.scriptCount || 0} | Folders: ${workspace.folderCount || 0} | Remotes: ${workspace.remoteCount || 0}\n\n`;
  
  if (workspace.scripts.length > 0) {
    context += `EXISTING SCRIPTS:\n`;
    for (const script of workspace.scripts.slice(0, 15)) {
      context += `\n${script.name} (${script.type}) - ${script.lines} lines\n`;
      context += `Path: ${script.path}\n`;
      if (script.source) {
        const preview = script.source.split('\n').slice(0, 50).join('\n');
        context += `Source:\n${preview}\n`;
        if (script.lines > 50) context += `... (${script.lines - 50} more lines)\n`;
      }
    }
  }
  
  return context;
}

function formatChatHistory(history) {
  if (!history || history.length === 0) return "No history.";
  return history.slice(-8).map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join('\n');
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "8.0", message: "Lemonade-Style Planning Active" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v8.0'));

// Main AI endpoint - decides if plan is needed
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request");
    const { prompt, workspace, chatHistory } = req.body;
    
    if (!workspace) {
      return res.status(400).json({ error: "Workspace required" });
    }
    
    const workspaceContext = formatWorkspaceContext(workspace);
    const historyContext = formatChatHistory(chatHistory);
    
    const systemPrompt = `You are Acidnade — an ELITE Roblox developer who creates COMPLETE, INTERACTIVE, PRODUCTION-READY systems.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 CRITICAL RULES (NEVER VIOLATE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ⛔ NEVER CREATE CONSOLE-ONLY SCRIPTS
   ❌ BAD: Scripts that only work when you run commands in console
   ✅ GOOD: Fully automated systems with UIs that work immediately

2. ⛔ ALWAYS CREATE COMPLETE INTERACTIVE UIs
   - Every system NEEDS a UI (ScreenGui with buttons/frames)
   - Players must interact via clicking, not console
   - Example: RNG system → Create spin button UI, result display, animations

3. ⛔ NEVER USE WaitForChild() ON NEWLY CREATED INSTANCES
   ❌ BAD: local module = ReplicatedStorage:WaitForChild("NewModule")
   ✅ GOOD: local module = require(ReplicatedStorage.NewModule)

4. ⛔ ALWAYS USE game:GetService()
   ❌ NEVER: game.Workspace, game.Players
   ✅ ALWAYS: game:GetService("Workspace"), game:GetService("Players")

5. ⛔ MODULE SCRIPTS MUST RETURN THEMSELVES
   ALWAYS end with: return ModuleName

6. ⛔ CLIENT-SERVER ARCHITECTURE
   - Server: Game logic, validation, data
   - Client: UI, input, visual effects
   - Communication: RemoteEvents/RemoteFunctions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️ SYSTEM DESIGN PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

When creating ANY system (RNG, pets, shop, inventory, etc):

STEP 1: Data Layer (ModuleScript in ReplicatedStorage)
- Store all configurations, rarities, prices, etc.
- Example: PetData = { {Name="Dog", Rarity="Common", Chance=50}, ... }

STEP 2: Server Logic (Script in ServerScriptService)
- Handle game logic, validation, spawning
- Listen to RemoteEvents
- Process player actions

STEP 3: Client UI (LocalScript in StarterGui)
- Create ScreenGui with buttons, frames, labels
- Handle user input
- Fire RemoteEvents to server
- Show results/animations

STEP 4: Communication (RemoteEvent in ReplicatedStorage)
- Connect client to server
- Example: SpinRNG, BuyPet, EquipItem

EVERY SYSTEM MUST HAVE ALL 4 COMPONENTS!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 WORKSPACE DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${workspaceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 HISTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${historyContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 DECISION LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ANALYZE USER REQUEST:

TYPE 1 - SIMPLE QUESTIONS/SEARCHES:
- "What does X script do?"
- "Show me scripts with RemoteEvents"
- "Explain my spawn system"
→ Respond directly with message (no actions)

TYPE 2 - SMALL EDITS/FIXES:
- "Fix the bug in MainScript"
- "Add a print statement"
- "Change the spawn time to 5 seconds"
→ Respond with update action (no plan needed)

TYPE 3 - COMPLEX SYSTEMS (REQUIRES PLAN):
- "Create an RNG system"
- "Build a pet system with trading"
- "Make a shop with categories"
→ Generate a PLAN with multiple steps

PLAN RULES:
- Only for systems requiring 3+ scripts
- Each step = 1 script/component
- Must include: Data → Server → Client → Remotes
- Steps execute sequentially (one AI call per step)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 USER REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${prompt}

THINK:
1. Is this a question/search? → message only
2. Is this a small fix? → update action
3. Is this a complex system? → requiresPlan = true + plan array

OUTPUT FORMAT (JSON ONLY):

FOR QUESTIONS:
{
  "message": "Your answer with specific references to workspace",
  "requiresPlan": false,
  "actions": []
}

FOR SIMPLE ACTIONS:
{
  "message": "Explanation of what you did",
  "requiresPlan": false,
  "actions": [
    {
      "type": "create" or "update",
      "instanceType": "Script|LocalScript|ModuleScript|RemoteEvent",
      "name": "ScriptName",
      "parentPath": "game.ServerScriptService",
      "properties": { "Source": "complete code" }
    }
  ]
}

FOR COMPLEX SYSTEMS:
{
  "message": "I've created a plan to build this system. Review the steps.",
  "requiresPlan": true,
  "plan": [
    {
      "description": "Create RNGData module with rarities and rewards",
      "instanceType": "ModuleScript"
    },
    {
      "description": "Create RNGManager server script for handling spins",
      "instanceType": "Script"
    },
    {
      "description": "Create SpinRNG RemoteEvent for client-server communication",
      "instanceType": "RemoteEvent"
    },
    {
      "description": "Create RNG UI with spin button and result display",
      "instanceType": "LocalScript"
    }
  ],
  "actions": []
}

Respond with valid JSON (no markdown).`;

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
      data = { message: response, requiresPlan: false, actions: [] };
    }
    
    console.log(`✅ Response: ${data.requiresPlan ? 'PLAN' : 'DIRECT'}`);
    res.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Execute individual plan step
app.post('/execute-step', async (req, res) => {
  try {
    console.log("⚙️ Executing Step");
    const { stepNumber, totalSteps, stepDescription, instanceType, workspace, chatHistory } = req.body;
    
    const workspaceContext = formatWorkspaceContext(workspace);
    const historyContext = formatChatHistory(chatHistory);
    
    const stepPrompt = `You are Acidnade — creating step ${stepNumber}/${totalSteps} of a production system.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CURRENT STEP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step ${stepNumber}/${totalSteps}: ${stepDescription}
Instance Type: ${instanceType}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 CRITICAL REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ⛔ NO CONSOLE-ONLY CODE
   - If this is a client script (LocalScript), it MUST create a full UI
   - UIs must have buttons, frames, labels that players interact with
   - Everything must work automatically (no console commands)

2. ⛔ COMPLETE IMPLEMENTATIONS
   - Write 100% functional code (no TODOs or placeholders)
   - Include all event handlers
   - Add proper error handling

3. ⛔ PROPER ARCHITECTURE
   - ModuleScript: MUST return itself at end
   - Server scripts: Validate everything, handle RemoteEvents
   - Client scripts: Create UI, fire RemoteEvents, show feedback
   - RemoteEvents: Just create the instance (no source needed)

4. ⛔ UI REQUIREMENTS (for LocalScripts):
   Must include:
   - ScreenGui as parent
   - Frame as main container
   - Buttons with click handlers
   - Labels for displaying info
   - Proper positioning (UDim2)
   - Professional styling

5. ⛔ LUAU BEST PRACTICES
   - game:GetService() for all services
   - No WaitForChild() on new instances
   - Use task.spawn(), task.wait()
   - Professional naming (PetShopUI, not script1)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 WORKSPACE (existing code to reference)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${workspaceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💬 HISTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${historyContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 EXAMPLE: RNG UI (LocalScript)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- RNG UI with Spin Button
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Create UI
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "RNGUI"
screenGui.ResetOnSpawn = false
screenGui.Parent = playerGui

local mainFrame = Instance.new("Frame")
mainFrame.Size = UDim2.new(0, 300, 0, 200)
mainFrame.Position = UDim2.new(0.5, -150, 0.5, -100)
mainFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
mainFrame.BorderSizePixel = 0
mainFrame.Parent = screenGui

local spinButton = Instance.new("TextButton")
spinButton.Size = UDim2.new(0.8, 0, 0, 50)
spinButton.Position = UDim2.new(0.1, 0, 0.3, 0)
spinButton.Text = "SPIN RNG"
spinButton.BackgroundColor3 = Color3.fromRGB(0, 170, 255)
spinButton.TextColor3 = Color3.new(1, 1, 1)
spinButton.Font = Enum.Font.GothamBold
spinButton.TextSize = 18
spinButton.Parent = mainFrame

local resultLabel = Instance.new("TextLabel")
resultLabel.Size = UDim2.new(0.8, 0, 0, 40)
resultLabel.Position = UDim2.new(0.1, 0, 0.65, 0)
resultLabel.Text = "Click to spin!"
resultLabel.BackgroundTransparency = 1
resultLabel.TextColor3 = Color3.new(1, 1, 1)
resultLabel.Font = Enum.Font.Gotham
resultLabel.TextSize = 14
resultLabel.Parent = mainFrame

-- Get remote
local spinRemote = ReplicatedStorage:WaitForChild("SpinRNG")

-- Button logic
spinButton.MouseButton1Click:Connect(function()
	spinButton.Text = "Spinning..."
	spinRemote:FireServer()
end)

-- Listen for results
spinRemote.OnClientEvent:Connect(function(result)
	resultLabel.Text = "You got: " .. result.Name .. " (" .. result.Rarity .. ")"
	spinButton.Text = "SPIN AGAIN"
end)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create COMPLETE, PRODUCTION-READY code for: ${stepDescription}

REQUIREMENTS:
- ${instanceType === 'LocalScript' ? 'MUST create full interactive UI with buttons/frames' : 'Server-side logic or data structure'}
- NO placeholders or TODOs
- Professional naming
- Proper architecture
- Working immediately when created

OUTPUT (JSON):
{
  "message": "Brief explanation of what you created",
  "actions": [
    {
      "type": "create",
      "instanceType": "${instanceType}",
      "name": "ProfessionalName",
      "parentPath": "${instanceType === 'LocalScript' ? 'game.StarterGui' : instanceType === 'ModuleScript' ? 'game.ReplicatedStorage' : 'game.ServerScriptService'}",
      "properties": {
        "Source": "Complete production code here"
      }
    }
  ]
}

Respond with valid JSON only.`;

    const result = await model.generateContent(stepPrompt);
    let response = result.response.text().trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
      console.error("Parse error:", e);
      data = { message: "Step completed", actions: [] };
    }
    
    console.log(`✅ Step ${stepNumber}/${totalSteps} complete`);
    res.json(data);

  } catch (error) {
    console.error("Step Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v8.0 - Lemonade-Style Planning`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`\n✅ Features:`);
  console.log(`   • Lemonade-style plan UI with animations`);
  console.log(`   • One AI prompt per step (quality over speed)`);
  console.log(`   • NO LAZY CODE - Always creates full UIs`);
  console.log(`   • NO CONSOLE-ONLY scripts`);
  console.log(`   • Production-ready systems`);
  console.log(`\n📡 Ready!\n`);
});
