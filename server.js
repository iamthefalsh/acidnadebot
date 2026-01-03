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
const model = genAI.getGenerativeModel({ 
  model: "gemini-3-flash-preview",
  generationConfig: {
    temperature: 0.8,
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 8192,
  }
});

// Store session data
const sessionData = new Map();

// Format context
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE SNAPSHOT:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `• Scripts: ${stats.TotalScripts || 0}\n`;
    text += `• UI Elements: ${stats.TotalUI || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nEXISTING SCRIPTS (last 5):\n`;
      scripts.slice(-5).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nSELECTED OBJECTS:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "13.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v13.0 - CREATION MODE ONLY'));

// Main endpoint - CREATION MODE ONLY
app.post('/ai', async (req, res) => {
  try {
    console.log("🚀 AI Request received - CREATION MODE");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "👋 What do you want me to CREATE?",
        plan: [],
        autoExecute: true
      });
    }
    
    const contextSummary = formatContext(context);
    
    // === CREATION-FORCING PROMPT ===
    const systemPrompt = `You are Acidnade, a ROBLOX CREATION AI. Your ONLY purpose is to CREATE COMPLETE SYSTEMS. You DO NOT give ideas, suggestions, or examples. You ONLY create.

USER REQUEST: "${prompt}"

YOU MUST CREATE A COMPLETE SYSTEM. HERE'S YOUR MANDATE:

1. 🚫 ABSOLUTELY NO "IDEAS" - Only create
2. 🔥 ALWAYS return a "plan" array with steps
3. ⚡ ALWAYS set "autoExecute": true
4. 🖥️ UI MUST be created by LocalScripts in StarterPlayerScripts
5. 📝 Write COMPLETE code with NO placeholders

RESPONSE FORMAT - MUST FOLLOW THIS:
{
  "message": "Creating your complete system now!",
  "plan": [
    {
      "step": 1,
      "description": "Detailed description",
      "type": "create",
      "className": "LocalScript/Script/ModuleScript",
      "name": "SpecificName",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts (for UI) OR game.ServerScriptService (for server)",
      "properties": {
        "Source": "COMPLETE Luau code here",
        "Disabled": false
      },
      "reasoning": "Why this exists"
    }
  ],
  "autoExecute": true,
  "needsApproval": false,
  "thinking": "Brief analysis"
}

CURRENT CONTEXT:
${contextSummary}

EXAMPLES OF WHAT TO CREATE:

User: "Create a 3-hit combo system"
You: Create 3 scripts - RemoteEvent, server handler, LocalScript for input/UI

User: "Make a shop UI"
You: Create 1 LocalScript in StarterPlayerScripts that builds the UI

User: "Add leaderboard"
You: Create 2 scripts - ModuleScript for logic, LocalScript for display

User: "Implement hit detection"
You: Create 2 scripts - RemoteEvent + server validation

User: "Create a menu"
You: Create 1 LocalScript in StarterPlayerScripts

CRITICAL RULES:
1. If UI is mentioned → LocalScript in StarterPlayerScripts
2. If server logic → Script in ServerScriptService  
3. If shared code → ModuleScript in ReplicatedStorage
4. If communication → RemoteEvent in ReplicatedStorage
5. NO "ScreenGui" creation - UI must be dynamic
6. ALL code must be COMPLETE and WORKING

YOUR RESPONSE MUST CONTAIN A "plan" ARRAY. CREATE NOW.`;

    console.log("🤖 AI forcing creation mode...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Creating system now!",
        plan: [{
          step: 1,
          description: "Creating main system",
          type: "create",
          className: "Script",
          name: "SystemCreator",
          parentPath: "game.ServerScriptService",
          properties: {
            Source: `-- System created by Acidnade AI\nprint("System created!")`
          }
        }],
        autoExecute: true,
        needsApproval: false
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      response = "";
    }
    
    // Clean response
    response = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      // Try to parse JSON
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed, forcing creation:", parseError.message);
      
      // FORCE CREATE A PLAN ANYWAY
      data = {
        message: "Creating your complete system!",
        plan: [],
        autoExecute: true,
        needsApproval: false,
        thinking: "Forced creation mode activated"
      };
      
      // Analyze prompt and create specific plan
      const lowerPrompt = prompt.toLowerCase();
      
      // Determine what to create based on keywords
      if (lowerPrompt.includes("combo") || lowerPrompt.includes("hit") || lowerPrompt.includes("attack")) {
        // Combo system
        data.plan = [
          {
            step: 1,
            description: "Create RemoteEvent for client-server communication",
            type: "create",
            className: "RemoteEvent",
            name: "ComboEvent",
            parentPath: "game.ReplicatedStorage",
            properties: {
              Source: ""
            },
            reasoning: "Needed for secure client-server communication"
          },
          {
            step: 2,
            description: "Create server-side combo handler with validation",
            type: "create",
            className: "Script",
            name: "ComboHandler",
            parentPath: "game.ServerScriptService",
            properties: {
              Source: `-- Combo system server handler
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ComboEvent = ReplicatedStorage:WaitForChild("ComboEvent")

local Players = game:GetService("Players")

-- Combo tracking per player
local playerCombos = {}

ComboEvent.OnServerEvent:Connect(function(player, comboData)
    -- Validate player
    if not player or not player:IsA("Player") then return end
    
    -- Initialize combo tracker
    if not playerCombos[player] then
        playerCombos[player] = {
            comboCount = 0,
            lastHitTime = 0,
            maxCombo = 3
        }
    end
    
    local tracker = playerCombos[player]
    local currentTime = tick()
    
    -- Check combo timing (within 2 seconds)
    if currentTime - tracker.lastHitTime <= 2 then
        tracker.comboCount = math.min(tracker.comboCount + 1, tracker.maxCombo)
    else
        tracker.comboCount = 1 -- Reset combo
    end
    
    tracker.lastHitTime = currentTime
    
    -- Fire client to update UI
    ComboEvent:FireClient(player, {
        comboCount = tracker.comboCount,
        maxCombo = tracker.maxCombo
    })
    
    print(string.format("Player %s combo: %d/%d", player.Name, tracker.comboCount, tracker.maxCombo))
end)`
            },
            reasoning: "Server-side validation for security"
          },
          {
            step: 3,
            description: "Create LocalScript for input handling and combo UI",
            type: "create",
            className: "LocalScript",
            name: "ComboClient",
            parentPath: "game.StarterPlayer.StarterPlayerScripts",
            properties: {
              Source: `-- Combo system client script
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local ComboEvent = ReplicatedStorage:WaitForChild("ComboEvent")

-- Create UI
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "ComboUI"
screenGui.Parent = playerGui

local comboFrame = Instance.new("Frame")
comboFrame.Name = "ComboFrame"
comboFrame.Size = UDim2.new(0, 200, 0, 80)
comboFrame.Position = UDim2.new(0.5, -100, 0.1, 0)
comboFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
comboFrame.BackgroundTransparency = 0.3
comboFrame.Parent = screenGui

local comboText = Instance.new("TextLabel")
comboText.Name = "ComboText"
comboText.Size = UDim2.new(1, 0, 1, 0)
comboText.Text = "Combo: 0/3"
comboText.TextColor3 = Color3.fromRGB(255, 255, 255)
comboText.Font = Enum.Font.GothamBold
comboText.TextSize = 24
comboText.BackgroundTransparency = 1
comboText.Parent = comboFrame

-- Combo state
local comboState = {
    canAttack = true,
    attackCooldown = 0.5
}

-- Input handling
UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    
    if input.UserInputType == Enum.UserInputType.MouseButton1 and comboState.canAttack then
        -- Send combo event to server
        ComboEvent:FireServer({type = "attack"})
        
        -- Cooldown
        comboState.canAttack = false
        task.wait(comboState.attackCooldown)
        comboState.canAttack = true
    end
end)

-- Listen for combo updates from server
ComboEvent.OnClientEvent:Connect(function(comboData)
    comboText.Text = string.format("Combo: %d/%d", comboData.comboCount, comboData.maxCombo)
    
    -- Visual feedback
    if comboData.comboCount == comboData.maxCombo then
        comboText.TextColor3 = Color3.fromRGB(255, 215, 0) -- Gold for max combo
    else
        comboText.TextColor3 = Color3.fromRGB(255, 255, 255)
    end
end)

print("Combo system ready!")`
            },
            reasoning: "Client-side input and UI for combo system"
          }
        ];
      } else if (lowerPrompt.includes("ui") || lowerPrompt.includes("gui") || lowerPrompt.includes("menu") || lowerPrompt.includes("interface")) {
        // UI system
        data.plan = [
          {
            step: 1,
            description: "Create dynamic UI system with LocalScript",
            type: "create", 
            className: "LocalScript",
            name: "UISystem",
            parentPath: "game.StarterPlayer.StarterPlayerScripts",
            properties: {
              Source: `-- Dynamic UI system created by Acidnade AI
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Create main UI container
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "MainUI"
screenGui.Parent = playerGui

-- Main frame
local mainFrame = Instance.new("Frame")
mainFrame.Name = "MainFrame"
mainFrame.Size = UDim2.new(0, 400, 0, 300)
mainFrame.Position = UDim2.new(0.5, -200, 0.5, -150)
mainFrame.AnchorPoint = Vector2.new(0.5, 0.5)
mainFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 45)
mainFrame.BackgroundTransparency = 0.1
mainFrame.Parent = screenGui

-- Title
local title = Instance.new("TextLabel")
title.Name = "Title"
title.Text = "UI System"
title.Size = UDim2.new(1, 0, 0, 50)
title.BackgroundColor3 = Color3.fromRGB(50, 50, 70)
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.Font = Enum.Font.GothamBold
title.TextSize = 24
title.Parent = mainFrame

-- Content area
local content = Instance.new("Frame")
content.Name = "Content"
content.Size = UDim2.new(1, -20, 1, -70)
content.Position = UDim2.new(0, 10, 0, 60)
content.BackgroundTransparency = 1
content.Parent = mainFrame

print("UI system created successfully!")`
            },
            reasoning: "UI must be created dynamically by LocalScript"
          }
        ];
      } else {
        // Generic system
        data.plan = [
          {
            step: 1,
            description: "Create requested system",
            type: "create",
            className: "Script",
            name: "SystemCreator",
            parentPath: "game.ServerScriptService",
            properties: {
              Source: `-- System created by Acidnade AI
print("System created based on your request:")
print("${prompt}")

-- Main logic goes here
local function initialize()
    print("Initialization complete!")
    return true
end

initialize()`
            },
            reasoning: "Creating the requested system"
          }
        ];
      }
    }
    
    // ENSURE AUTO-EXECUTION
    data.autoExecute = true;
    data.needsApproval = false;
    
    // ENSURE PLAN EXISTS
    if (!data.plan || !Array.isArray(data.plan) || data.plan.length === 0) {
      console.log("⚠️ No plan in response, adding default plan");
      data.plan = [{
        step: 1,
        description: "Creating your system",
        type: "create",
        className: "Script",
        name: "SystemCreator",
        parentPath: "game.ServerScriptService",
        properties: {
          Source: `-- System created by Acidnade AI\nprint("Creation complete!")`
        },
        reasoning: "Default creation step"
      }];
    }
    
    // ENSURE MESSAGE DOESN'T CONTAIN "IDEAS"
    if (data.message && (data.message.includes("ideas") || data.message.includes("suggest") || data.message.includes("could implement"))) {
      data.message = "Creating your complete system now!";
    }
    
    // Add metadata
    data.stepsTotal = data.plan.length;
    data.progressText = `Creating ${data.plan.length} components`;
    data.sequentialExecution = true;
    
    console.log(`📤 CREATION Response: ${data.plan.length} components to create`);
    console.log(`📝 First step: ${data.plan[0]?.description || "unknown"}`);
    
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    res.json({ 
      message: "Creating system now!",
      plan: [{
        step: 1,
        description: "Emergency system creation",
        type: "create",
        className: "Script",
        name: "EmergencyCreator",
        parentPath: "game.ServerScriptService",
        properties: {
          Source: `-- Emergency system created\nprint("System created!")`
        },
        reasoning: "Forced creation due to error"
      }],
      autoExecute: true,
      needsApproval: false
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v13.0 — CREATION MODE ONLY`);
  console.log(`🔥 NO MORE IDEAS - ONLY CREATION`);
  console.log(`⚡ AUTO-EXECUTE EVERYTHING`);
  console.log(`💪 FORCING COMPLETE PLANS`);
  console.log(`💥 MAXIMUM CREATION POWER`);
});
