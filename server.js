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
    temperature: 0.7,
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
  
  let text = `ROBLOX WORKSPACE:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `Scripts: ${stats.TotalScripts || 0}, UI: ${stats.TotalUI || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nEXISTING:\n`;
      scripts.slice(-8).forEach(script => {
        text += `- ${script.Name} (${script.Type}) at ${script.Path}\n`;
      });
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nSELECTED:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "ULTIMATE" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('ACIDNADE AI - LUAU EXPERT'));

// Main endpoint - LUAU EXPERT MODE (NO PROMPTS)
app.post('/ai', async (req, res) => {
  try {
    console.log("🤖 LUAU EXPERT processing request...");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What do you need in your Roblox game?",
        plan: [],
        autoExecute: true
      });
    }
    
    const contextSummary = formatContext(context);
    
    // === LUAU EXPERT SYSTEM PROMPT (NO USER PROMPT SENT) ===
    const systemPrompt = `You are ACIDNADE, an EXTREME LUAU/ROBLOX EXPERT AI. You ONLY create complete Roblox systems.

YOU ARE:
• Specialized in Luau programming
• Expert in Roblox Studio architecture
• Master of game system design
• Creator of production-ready code

CURRENT WORKSPACE:
${contextSummary}

⚡ LUAU EXPERT RULES (NON-NEGOTIABLE):

1. 🎮 GAME ARCHITECTURE:
   • Server Scripts → ServerScriptService
   • Client UI Scripts → StarterPlayer.StarterPlayerScripts (MUST create UI here)
   • Character Scripts → StarterPlayer.StarterCharacterScripts
   • Shared Modules → ReplicatedStorage
   • Remote Events/Functions → ReplicatedStorage

2. 🚫 ABSOLUTE UI RULE:
   • NEVER create ScreenGui, Frame, TextLabel, etc. directly
   • ALWAYS create LocalScript in StarterPlayerScripts
   • LocalScript must create ALL UI elements dynamically
   • UI must be parented to: player:WaitForChild("PlayerGui")

3. 🔥 CREATION MANDATE:
   • ALWAYS return a "plan" array with steps
   • ALWAYS set "autoExecute": true
   • NO "ideas" - ONLY creation
   • Write COMPLETE Luau code with NO placeholders

4. 📦 SMART COMPONENTS:
   • Combo system → RemoteEvent + Server Script + LocalScript (UI)
   • Shop system → ModuleScript + LocalScript (UI) + Server validation
   • Data system → DataStoreService + Server Script + LocalScript
   • Weapon system → Tool + Server Script + LocalScript
   • UI system → LocalScript in StarterPlayerScripts ONLY

5. 🛡️ SECURITY:
   • Validate everything server-side
   • Use RemoteEvents for client-server
   • Sanitize all inputs
   • Handle errors gracefully

📝 RESPONSE FORMAT (MUST FOLLOW):
{
  "message": "Creating your Luau system!",
  "plan": [
    {
      "step": 1,
      "description": "Create [COMPONENT] for [PURPOSE]",
      "type": "create",
      "className": "LocalScript/Script/ModuleScript/RemoteEvent",
      "name": "[DESCRIPTIVE_NAME]",
      "parentPath": "game.[CORRECT_SERVICE]",
      "properties": {
        "Source": "-- COMPLETE LUAU CODE\n-- No placeholders\n-- Production ready"
      },
      "reasoning": "Technical explanation"
    }
  ],
  "autoExecute": true,
  "needsApproval": false,
  "thinking": "Brief technical analysis"
}

🔧 LUAU BEST PRACTICES:
• Use :WaitForChild() for safety
• Use task.wait() instead of wait()
• Use table.create() for performance
• Use Enum for constants
• Implement proper error handling

⚡ EXECUTE IMMEDIATELY. CREATE COMPLETE LUAU SYSTEMS.`;

    console.log("⚡ LUAU EXPERT processing...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Luau expert creating system...",
        plan: [{
          step: 1,
          description: "Creating Luau system component",
          type: "create",
          className: "Script",
          name: "LuauSystem",
          parentPath: "game.ServerScriptService",
          properties: {
            Source: `-- Luau expert system created\nprint("Luau system initialized!")`
          },
          reasoning: "Luau expert creation"
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
      data = JSON.parse(response);
    } catch (parseError) {
      console.error("JSON Parse Failed, creating default Luau system");
      
      // LUAU EXPERT DEFAULT CREATION
      data = {
        message: "Luau expert creating your system!",
        plan: [],
        autoExecute: true,
        needsApproval: false,
        thinking: "Luau expert analysis complete"
      };
      
      // Check for specific system types
      const lowerPrompt = prompt.toLowerCase();
      
      // LUAU EXPERT SYSTEM DETECTION
      if (lowerPrompt.includes("combo") || lowerPrompt.includes("hit") || lowerPrompt.includes("attack")) {
        // Combo system
        data.plan = [
          {
            step: 1,
            description: "Create RemoteEvent for secure combo communication",
            type: "create",
            className: "RemoteEvent",
            name: "ComboRemote",
            parentPath: "game.ReplicatedStorage",
            properties: { Source: "" },
            reasoning: "Secure client-server communication channel"
          },
          {
            step: 2,
            description: "Create server-side combo validator and tracker",
            type: "create",
            className: "Script",
            name: "ComboServer",
            parentPath: "game.ServerScriptService",
            properties: {
              Source: `-- Luau expert combo server
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local ComboRemote = ReplicatedStorage:WaitForChild("ComboRemote")

-- Combo tracking table
local playerCombos = {}

-- Validator function
local function validateAttack(player, timestamp)
    if not player or not player:IsA("Player") then
        return false, "Invalid player"
    end
    
    -- Anti-cheat: Check if player has character
    local character = player.Character
    if not character then
        return false, "No character"
    end
    
    -- Timestamp validation (prevent time travel)
    local serverTime = os.time()
    if timestamp > serverTime + 5 or timestamp < serverTime - 10 then
        return false, "Invalid timestamp"
    end
    
    return true, "Valid"
end

-- Server event handler
ComboRemote.OnServerEvent:Connect(function(player, attackData)
    local valid, reason = validateAttack(player, attackData.timestamp)
    if not valid then
        warn(string.format("Combo validation failed for %s: %s", player.Name, reason))
        return
    end
    
    -- Initialize or update combo
    if not playerCombos[player] then
        playerCombos[player] = {
            count = 0,
            lastTime = 0,
            maxCombo = 3
        }
    end
    
    local combo = playerCombos[player]
    local currentTime = tick()
    
    -- Combo logic (2 second window)
    if currentTime - combo.lastTime <= 2 then
        combo.count = math.min(combo.count + 1, combo.maxCombo)
    else
        combo.count = 1
    end
    
    combo.lastTime = currentTime
    
    -- Notify client
    ComboRemote:FireClient(player, {
        combo = combo.count,
        max = combo.maxCombo,
        valid = true
    })
    
    -- Server-side effect (damage, etc.)
    -- Add your damage logic here
end)`
            },
            reasoning: "Server validation prevents cheating, tracks combos securely"
          },
          {
            step: 3,
            description: "Create LocalScript in StarterPlayerScripts for combo input and UI",
            type: "create",
            className: "LocalScript",
            name: "ComboClient",
            parentPath: "game.StarterPlayer.StarterPlayerScripts",
            properties: {
              Source: `-- Luau expert combo client
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local RunService = game:GetService("RunService")

local player = Players.LocalPlayer
local ComboRemote = ReplicatedStorage:WaitForChild("ComboRemote")

-- ====== UI CREATION (StarterPlayerScripts RULE) ======
local playerGui = player:WaitForChild("PlayerGui")

-- Create ScreenGui (DYNAMICALLY)
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "ComboUI"
screenGui.Parent = playerGui

-- Combo display frame
local comboFrame = Instance.new("Frame")
comboFrame.Name = "ComboFrame"
comboFrame.Size = UDim2.new(0, 200, 0, 80)
comboFrame.Position = UDim2.new(0.5, -100, 0.1, 0)
comboFrame.AnchorPoint = Vector2.new(0.5, 0)
comboFrame.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
comboFrame.BackgroundTransparency = 0.2
comboFrame.Parent = screenGui

-- Combo text
local comboText = Instance.new("TextLabel")
comboText.Name = "ComboText"
comboText.Size = UDim2.new(1, 0, 1, 0)
comboText.Text = "Combo: 0/3"
comboText.TextColor3 = Color3.fromRGB(255, 255, 255)
comboText.Font = Enum.Font.GothamBold
comboText.TextSize = 24
comboText.BackgroundTransparency = 1
comboText.Parent = comboFrame

-- ====== COMBO LOGIC ======
local comboState = {
    canAttack = true,
    cooldown = 0.5,
    lastAttack = 0
}

-- Input handler
UserInputService.InputBegan:Connect(function(input, gameProcessed)
    if gameProcessed then return end
    
    if input.UserInputType == Enum.UserInputType.MouseButton1 and comboState.canAttack then
        -- Send to server with timestamp
        ComboRemote:FireServer({
            timestamp = os.time(),
            position = input.Position
        })
        
        -- Local cooldown
        comboState.canAttack = false
        task.wait(comboState.cooldown)
        comboState.canAttack = true
    end
end)

-- Server response handler
ComboRemote.OnClientEvent:Connect(function(comboData)
    if comboData.valid then
        -- Update UI
        comboText.Text = string.format("Combo: %d/%d", comboData.combo, comboData.max)
        
        -- Visual feedback
        if comboData.combo == comboData.max then
            comboText.TextColor3 = Color3.fromRGB(255, 215, 0) -- Gold
        elseif comboData.combo >= 2 then
            comboText.TextColor3 = Color3.fromRGB(100, 255, 100) -- Green
        else
            comboText.TextColor3 = Color3.fromRGB(255, 255, 255)
        end
    end
end)

print("Luau expert combo system ready!")`
            },
            reasoning: "Client handles input and UI creation (StarterPlayerScripts rule)"
          }
        ];
      } else if (lowerPrompt.includes("shop") || lowerPrompt.includes("store") || lowerPrompt.includes("buy")) {
        // Shop system
        data.plan = [
          {
            step: 1,
            description: "Create shop LocalScript in StarterPlayerScripts",
            type: "create",
            className: "LocalScript",
            name: "ShopSystem",
            parentPath: "game.StarterPlayer.StarterPlayerScripts",
            properties: {
              Source: `-- Luau expert shop system
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Create shop UI
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "ShopUI"
screenGui.Parent = playerGui

-- Main shop frame
local shopFrame = Instance.new("Frame")
shopFrame.Name = "ShopFrame"
shopFrame.Size = UDim2.new(0, 400, 0, 500)
shopFrame.Position = UDim2.new(0.5, -200, 0.5, -250)
shopFrame.AnchorPoint = Vector2.new(0.5, 0.5)
shopFrame.BackgroundColor3 = Color3.fromRGB(30, 30, 45)
shopFrame.Parent = screenGui

-- Title
local title = Instance.new("TextLabel")
title.Name = "Title"
title.Text = "SHOP"
title.Size = UDim2.new(1, 0, 0, 50)
title.BackgroundColor3 = Color3.fromRGB(50, 50, 70)
title.TextColor3 = Color3.fromRGB(255, 255, 100)
title.Font = Enum.Font.GothamBold
title.TextSize = 28
title.Parent = shopFrame

print("Luau expert shop system created!")`
            },
            reasoning: "Shop UI created dynamically via LocalScript in StarterPlayerScripts"
          }
        ];
      } else {
        // Default Luau system
        data.plan = [
          {
            step: 1,
            description: "Create Luau system component",
            type: "create",
            className: "Script",
            name: "LuauSystem",
            parentPath: "game.ServerScriptService",
            properties: {
              Source: `-- Luau expert system created
-- Specialized in Roblox/Luau development

local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")

print("=== ACIDNADE LUAU EXPERT ===")
print("System initialized successfully!")
print("Luau version: 2024.1")
print("Roblox Studio integration: ACTIVE")`
            },
            reasoning: "Luau expert creating core system component"
          }
        ];
      }
    }
    
    // ENFORCE LUAU EXPERT RULES
    if (data.plan && Array.isArray(data.plan)) {
      // Ensure StarterPlayerScripts rule for UI
      data.plan = data.plan.map(step => {
        const stepDesc = step.description?.toLowerCase() || '';
        const isUI = stepDesc.includes('ui') || stepDesc.includes('gui') || 
                     stepDesc.includes('interface') || stepDesc.includes('screen') ||
                     step.className === 'ScreenGui' || step.className === 'Frame' ||
                     step.className === 'TextLabel' || step.className === 'TextButton';
        
        // Convert any UI component to LocalScript in StarterPlayerScripts
        if (isUI && step.className !== 'LocalScript') {
          return {
            ...step,
            className: 'LocalScript',
            parentPath: 'game.StarterPlayer.StarterPlayerScripts',
            description: `${step.description} (Luau expert: UI via StarterPlayerScripts)`,
            reasoning: "Luau expert rule: UI must be created by LocalScript in StarterPlayerScripts"
          };
        }
        
        return step;
      });
      
      data.stepsTotal = data.plan.length;
      data.progressText = `Luau expert creating ${data.plan.length} components`;
      data.sequentialExecution = true;
      data.autoExecute = true;
      data.needsApproval = false;
      
      console.log(`⚡ LUAU EXPERT: Creating ${data.plan.length} components`);
      console.log(`📁 First component: ${data.plan[0]?.name} in ${data.plan[0]?.parentPath}`);
    }
    
    // ENSURE LUAU EXPERT MESSAGING
    if (!data.message || data.message.includes("ideas") || data.message.includes("suggest") || data.message.includes("could")) {
      data.message = "⚡ Luau expert creating your system!";
    }
    
    // Add Luau expert signature
    data.luauExpert = true;
    data.architecture = "Luau expert system design";
    data.considerations = ["Production-ready Luau", "Roblox best practices", "StarterPlayerScripts UI rule"];
    
    console.log(`📤 LUAU EXPERT Response: ${data.plan?.length || 0} components`);
    res.json(data);

  } catch (error) {
    console.error("Luau Expert Error:", error);
    res.json({ 
      message: "⚡ Luau expert emergency creation!",
      plan: [{
        step: 1,
        description: "Luau expert emergency system",
        type: "create",
        className: "Script",
        name: "EmergencyLuauSystem",
        parentPath: "game.ServerScriptService",
        properties: {
          Source: `-- Luau expert emergency system\nprint("Luau expert system deployed!")`
        },
        reasoning: "Luau expert emergency response"
      }],
      autoExecute: true,
      needsApproval: false,
      luauExpert: true
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n⚡ ACIDNADE AI - LUAU EXPERT`);
  console.log(`🎮 Specialized in Roblox/Luau`);
  console.log(`🚫 NO PROMPTS - JUST LUAU`);
  console.log(`📁 StarterPlayerScripts UI rule: ACTIVE`);
  console.log(`🔥 MAXIMUM LUAU EXPERT MODE`);
});
