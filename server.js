// server.js — Acidnade AI v8.1 (PROFESSIONAL UI GENERATOR)
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
  res.json({ status: "OK", version: "8.1", message: "Professional UI Generator" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v8.1 - Professional UI'));

// Main AI endpoint
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request");
    const { prompt, workspace, chatHistory } = req.body;
    
    if (!workspace) {
      return res.status(400).json({ error: "Workspace required" });
    }
    
    const workspaceContext = formatWorkspaceContext(workspace);
    const historyContext = formatChatHistory(chatHistory);
    
    const systemPrompt = `You are Acidnade — an ELITE Roblox UI/UX developer who creates STUNNING, PROFESSIONAL interfaces.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 CRITICAL UI RULES (NEVER VIOLATE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ⛔ NEVER DUPLICATE UI ELEMENTS
   - Create each button/frame ONCE
   - Store references in variables
   - Reuse elements, don't recreate

2. ⛔ ALWAYS USE MODERN PROFESSIONAL STYLING
   - Rounded corners (UICorner with CornerRadius)
   - Gradients (UIGradient) for depth
   - Shadows/strokes for polish
   - Consistent color scheme
   - Proper padding (UIPadding)

3. ⛔ ALWAYS ADD ANIMATIONS
   - Button hover effects (TweenService)
   - Smooth transitions
   - Loading spinners
   - Result pop-ups
   - All animations must be smooth (0.2-0.4 seconds)

4. ⛔ PROPER POSITIONING
   - Use UDim2.new(0.5, -width/2, 0.5, -height/2) for centering
   - Set AnchorPoint = Vector2.new(0.5, 0.5) for center anchoring
   - NO overlapping elements
   - Clean spacing between items

5. ⛔ HIERARCHY STRUCTURE
   ScreenGui (parent)
   └─ MainFrame (container)
      ├─ TitleLabel
      ├─ Button1
      ├─ Button2
      └─ ResultFrame
   
   NEVER create duplicate ScreenGuis or MainFrames!

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

ANALYZE REQUEST:
- Question/search? → message only
- Small fix? → update action
- Complex system? → requiresPlan = true + plan

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 USER REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${prompt}

OUTPUT (JSON):
{
  "message": "explanation",
  "requiresPlan": false or true,
  "plan": [...] (if complex),
  "actions": [...] (if simple)
}`;

    const result = await model.generateContent(systemPrompt);
    let response = result.response.text().trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
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
    
    const stepPrompt = `You are Acidnade — creating PROFESSIONAL, POLISHED Roblox UI code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 STEP ${stepNumber}/${totalSteps}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task: ${stepDescription}
Type: ${instanceType}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 EXISTING CODE (DO NOT DUPLICATE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${workspaceContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 MANDATORY UI TEMPLATE (for LocalScripts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USE THIS EXACT STRUCTURE (modify for your needs):

-- Professional Pet Shop UI with Animations
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

-- Colors (MODERN PALETTE)
local COLORS = {
    Background = Color3.fromRGB(20, 20, 30),
    Card = Color3.fromRGB(30, 30, 45),
    Primary = Color3.fromRGB(100, 80, 255),
    Success = Color3.fromRGB(0, 200, 100),
    Text = Color3.fromRGB(255, 255, 255),
    TextDim = Color3.fromRGB(180, 180, 200)
}

-- Helper: Create rounded corners
local function addCorners(element, radius)
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, radius or 12)
    corner.Parent = element
end

-- Helper: Add gradient
local function addGradient(element, color1, color2)
    local gradient = Instance.new("UIGradient")
    gradient.Color = ColorSequence.new({
        ColorSequenceKeypoint.new(0, color1),
        ColorSequenceKeypoint.new(1, color2)
    })
    gradient.Parent = element
end

-- Helper: Tween animation
local function tweenButton(button, hover)
    local info = TweenInfo.new(0.2, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
    local goal = hover and {Size = button.Size + UDim2.new(0, 4, 0, 4)} or {Size = button.Size}
    local tween = TweenService:Create(button, info, goal)
    tween:Play()
end

-- STEP 1: Create ScreenGui (DO THIS ONCE)
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "PetShopUI"
screenGui.ResetOnSpawn = false
screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
screenGui.Parent = playerGui

-- STEP 2: Create Main Container
local mainFrame = Instance.new("Frame")
mainFrame.Name = "MainFrame"
mainFrame.Size = UDim2.new(0, 400, 0, 500)
mainFrame.Position = UDim2.new(0.5, -200, 0.5, -250)
mainFrame.AnchorPoint = Vector2.new(0.5, 0.5)
mainFrame.BackgroundColor3 = COLORS.Background
mainFrame.BorderSizePixel = 0
mainFrame.Parent = screenGui
addCorners(mainFrame, 16)

-- Add stroke
local stroke = Instance.new("UIStroke")
stroke.Color = COLORS.Primary
stroke.Thickness = 2
stroke.Transparency = 0.5
stroke.Parent = mainFrame

-- STEP 3: Title
local titleLabel = Instance.new("TextLabel")
titleLabel.Name = "Title"
titleLabel.Size = UDim2.new(1, -40, 0, 50)
titleLabel.Position = UDim2.new(0, 20, 0, 20)
titleLabel.BackgroundTransparency = 1
titleLabel.Text = "🐾 PET SHOP"
titleLabel.TextColor3 = COLORS.Text
titleLabel.Font = Enum.Font.GothamBlack
titleLabel.TextSize = 24
titleLabel.TextXAlignment = Enum.TextXAlignment.Left
titleLabel.Parent = mainFrame

-- STEP 4: Buy Button (CREATE ONCE!)
local buyButton = Instance.new("TextButton")
buyButton.Name = "BuyButton"
buyButton.Size = UDim2.new(0.9, 0, 0, 60)
buyButton.Position = UDim2.new(0.05, 0, 0, 90)
buyButton.BackgroundColor3 = COLORS.Primary
buyButton.Text = "🎲 ROLL PET (50 Coins)"
buyButton.TextColor3 = COLORS.Text
buyButton.Font = Enum.Font.GothamBold
buyButton.TextSize = 18
buyButton.BorderSizePixel = 0
buyButton.Parent = mainFrame
addCorners(buyButton, 12)
addGradient(buyButton, COLORS.Primary, Color3.fromRGB(80, 60, 200))

-- STEP 5: Result Display
local resultFrame = Instance.new("Frame")
resultFrame.Name = "ResultFrame"
resultFrame.Size = UDim2.new(0.9, 0, 0, 150)
resultFrame.Position = UDim2.new(0.05, 0, 0, 170)
resultFrame.BackgroundColor3 = COLORS.Card
resultFrame.BorderSizePixel = 0
resultFrame.Visible = false
resultFrame.Parent = mainFrame
addCorners(resultFrame, 12)

local resultLabel = Instance.new("TextLabel")
resultLabel.Size = UDim2.new(1, -20, 1, -20)
resultLabel.Position = UDim2.new(0, 10, 0, 10)
resultLabel.BackgroundTransparency = 1
resultLabel.Text = "Result appears here..."
resultLabel.TextColor3 = COLORS.TextDim
resultLabel.Font = Enum.Font.Gotham
resultLabel.TextSize = 16
resultLabel.TextWrapped = true
resultLabel.Parent = resultFrame

-- STEP 6: Animations
buyButton.MouseEnter:Connect(function()
    tweenButton(buyButton, true)
    buyButton.BackgroundColor3 = Color3.fromRGB(120, 100, 255)
end)

buyButton.MouseLeave:Connect(function()
    tweenButton(buyButton, false)
    buyButton.BackgroundColor3 = COLORS.Primary
end)

-- STEP 7: Connect to Server
local buyRemote = ReplicatedStorage:WaitForChild("BuyPetRemote")

buyButton.MouseButton1Click:Connect(function()
    buyButton.Text = "🔄 Rolling..."
    buyRemote:FireServer()
end)

buyRemote.OnClientEvent:Connect(function(petData)
    resultFrame.Visible = true
    resultLabel.Text = "You got: " .. petData.Name .. "\\n(" .. petData.Rarity .. ")"
    buyButton.Text = "🎲 ROLL AGAIN (50 Coins)"
    
    -- Animate result
    resultFrame.Size = UDim2.new(0.9, 0, 0, 0)
    local tween = TweenService:Create(
        resultFrame,
        TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out),
        {Size = UDim2.new(0.9, 0, 0, 150)}
    )
    tween:Play()
end)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CRITICAL CHECKS BEFORE SUBMITTING CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Did I create each UI element ONCE? (no duplicates)
2. Did I add UICorner to all frames/buttons?
3. Did I add hover animations to all buttons?
4. Did I use professional colors?
5. Did I center elements properly with AnchorPoint?
6. Is the UI hierarchy clean (ScreenGui → Frame → Elements)?
7. Did I avoid WaitForChild() on new instances?
8. Did I use TweenService for animations?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Create code for: ${stepDescription}

REQUIREMENTS:
✅ Follow the template structure above
✅ Modern colors and styling
✅ Smooth animations (TweenService)
✅ NO duplicate elements
✅ Clean, organized code
✅ Professional naming
✅ Works immediately

OUTPUT (JSON):
{
  "message": "Created professional ${instanceType} for ${stepDescription}",
  "actions": [
    {
      "type": "create",
      "instanceType": "${instanceType}",
      "name": "ProfessionalName",
      "parentPath": "${instanceType === 'LocalScript' ? 'game.StarterGui' : instanceType === 'ModuleScript' ? 'game.ReplicatedStorage' : 'game.ServerScriptService'}",
      "properties": {
        "Source": "-- Complete code following template above"
      }
    }
  ]
}`;

    const result = await model.generateContent(stepPrompt);
    let response = result.response.text().trim()
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    let data;
    try {
      data = JSON.parse(response);
    } catch (e) {
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
  console.log(`\n🚀 Acidnade AI v8.1 - PROFESSIONAL UI GENERATOR`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`\n✅ Features:`);
  console.log(`   • NO duplicate elements`);
  console.log(`   • Modern rounded UI with gradients`);
  console.log(`   • Smooth TweenService animations`);
  console.log(`   • Professional color schemes`);
  console.log(`   • Complete UI templates`);
  console.log(`\n📡 Ready!\n`);
});
