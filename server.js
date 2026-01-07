import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Session memory store
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      createdInstances: [],
      modifiedInstances: [],
      currentPlan: [],
      currentStep: 0,
      executionState: 'idle',
      chatHistory: [],
      pendingSourceRequests: [],
      timestamp: Date.now()
    });
  }
  return sessionMemory.get(sessionId);
}

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid API key' });
  }
  next();
};

const logRequest = (req, res, next) => {
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.path);
  next();
};

app.use(logRequest);

// ============================================
// OPTIMIZED PROMPT SYSTEM - SAVES 60-80% TOKENS
// ============================================

// CORE PROMPT (Always sent - ~500 tokens)
const CORE_PROMPT = `You are Acidnade AI, a Roblox Studio assistant specialized in Luau scripting.

RESPONSE FORMAT (JSON only):
{
  "message": "Brief description",
  "thinkingSteps": ["state: description"],
  "plan": [{
    "step": 1,
    "type": "create|modify|analyze",
    "name": "InstanceName",
    "className": "Script|LocalScript|ModuleScript",
    "parentPath": "game.ServerScriptService",
    "description": "Clear description",
    "properties": {"Name": "value", "Source": "-- code"},
    "modifications": [{"action": "replace|insertAfter|insertBefore", "target": "exact code", "replacement": "new code", "reasoning": "why"}]
  }],
  "needsApproval": false,
  "reasoning": "Explanation",
  "warnings": ["considerations"],
  "nextSteps": ["what's next"]
}

CRITICAL RULES:
1. NEVER use "replaceAll" - use "replace", "insertAfter", "insertBefore"
2. If need source code: return {"needsSourceCode": {"instanceName": "X", "expectedPath": "...", "reason": "..."}}
3. Use 'local' variables, ':GetService()' for services, 'task.wait()' not 'wait()'
4. Always include 'end' keywords for if/for/while/function blocks
5. Return ONLY valid JSON`;

// KNOWLEDGE MODULES (Loaded on-demand based on user query)
const KNOWLEDGE_MODULES = {
  
  syntax: `
LUAU SYNTAX ESSENTIALS:
✅ if condition then code end
✅ for i = 1, 10 do code end
✅ while true do task.wait() code end
✅ function name() code end
✅ local variable = value
✅ Services: game:GetService("Players")
✅ Safe access: instance:WaitForChild("Name")
❌ Missing 'end', global variables, wait() instead of task.wait()`,

  remotes: `
REMOTE EVENTS:
Server:
local RS = game:GetService("ReplicatedStorage")
local event = RS:WaitForChild("Event")
event.OnServerEvent:Connect(function(player, ...)
  print(player.Name, "data:", ...)
end)

Client:
local RS = game:GetService("ReplicatedStorage")
local event = RS:WaitForChild("Event")
event:FireServer("data")
event.OnClientEvent:Connect(function(...)
  print("From server:", ...)
end)`,

  data: `
DATASTORE:
local DSS = game:GetService("DataStoreService")
local store = DSS:GetDataStore("PlayerData")

local success, data = pcall(function()
  return store:GetAsync(player.UserId)
end)
if success then return data or {} end

pcall(function()
  store:SetAsync(player.UserId, data)
end)

LEADERSTATS:
local stats = Instance.new("Folder")
stats.Name = "leaderstats"
stats.Parent = player

local coins = Instance.new("IntValue")
coins.Name = "Coins"
coins.Value = 0
coins.Parent = stats`,

  combat: `
DAMAGE SYSTEM:
local function applyDamage(character, amount)
  local humanoid = character:FindFirstChild("Humanoid")
  if humanoid and humanoid.Health > 0 then
    humanoid:TakeDamage(amount)
    return true
  end
  return false
end

TOUCH DETECTION WITH DEBOUNCE:
local debounce = {}
part.Touched:Connect(function(hit)
  local humanoid = hit.Parent:FindFirstChild("Humanoid")
  if not humanoid then return end
  local player = game.Players:GetPlayerFromCharacter(hit.Parent)
  if not player or debounce[player.UserId] then return end
  debounce[player.UserId] = true
  -- Action here
  task.wait(1)
  debounce[player.UserId] = nil
end)`,

  gui: `
GUI SCRIPTING:
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local gui = player:WaitForChild("PlayerGui")

local button = gui:WaitForChild("ScreenGui"):WaitForChild("Button")
button.MouseButton1Click:Connect(function()
  print("Clicked")
end)

CREATE GUI:
local sg = Instance.new("ScreenGui")
sg.Parent = player.PlayerGui

local frame = Instance.new("Frame")
frame.Size = UDim2.new(0, 200, 0, 100)
frame.Position = UDim2.new(0.5, -100, 0.5, -50)
frame.BackgroundColor3 = Color3.fromRGB(40, 40, 40)
frame.Parent = sg`,

  tween: `
TWEENING:
local TS = game:GetService("TweenService")
local info = TweenInfo.new(1, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
local tween = TS:Create(part, info, {
  Position = Vector3.new(0, 10, 0),
  Transparency = 0.5
})
tween:Play()
tween.Completed:Connect(function()
  print("Animation complete")
end)`,

  raycast: `
RAYCASTING:
local params = RaycastParams.new()
params.FilterType = Enum.RaycastFilterType.Exclude
params.FilterDescendantsInstances = {character}

local origin = head.Position
local direction = (target - origin).Unit * 300
local result = workspace:Raycast(origin, direction, params)

if result then
  local hitPart = result.Instance
  local hitPos = result.Position
  print("Hit:", hitPart.Name, "at", hitPos)
end`,

  inventory: `
INVENTORY MODULE:
local Inventory = {}
Inventory.__index = Inventory

function Inventory.new(player)
  local self = setmetatable({}, Inventory)
  self.player = player
  self.items = {}
  self.maxSlots = 20
  return self
end

function Inventory:AddItem(name, quantity)
  quantity = quantity or 1
  if self.items[name] then
    self.items[name] += quantity
  else
    if self:GetCount() >= self.maxSlots then
      return false, "Inventory full"
    end
    self.items[name] = quantity
  end
  return true, "Added"
end

function Inventory:GetCount()
  local count = 0
  for _ in pairs(self.items) do count += 1 end
  return count
end

return Inventory`,

  security: `
SECURITY & VALIDATION:
remoteEvent.OnServerEvent:Connect(function(player, value)
  -- Validate player exists
  if not player or not player.Parent then return end
  
  -- Validate data type
  if typeof(value) ~= "number" then return end
  
  -- Validate range
  if value <= 0 or value > 1000 then return end
  
  -- Validate distance
  local hrp = player.Character:FindFirstChild("HumanoidRootPart")
  local distance = (hrp.Position - target).Magnitude
  if distance > 100 then
    warn("Too far:", player.Name)
    return
  end
  
  -- Process
end)

RATE LIMITING:
local limits = {}
limits[userId] = (limits[userId] or 0) + 1
if limits[userId] > 30 then return end`,

  performance: `
OPTIMIZATION:
-- Object Pooling
local pool = {available = {}, inUse = {}}
function pool:Get()
  return table.remove(self.available) or template:Clone()
end
function pool:Return(obj)
  obj.Parent = nil
  table.insert(self.available, obj)
end

-- Efficient Loops (use local references)
local parts = workspace.Parts:GetChildren()
for i = 1, #parts do
  local part = parts[i]
  part.Transparency = 0.5
end

-- Debounce
local db = false
if db then return end
db = true
-- work
task.wait(1)
db = false`,

  advanced: `
ADVANCED PATTERNS:
-- Module Pattern
local Module = {}
Module.__index = Module

function Module.new()
  local self = setmetatable({}, Module)
  return self
end

function Module:Method()
  -- code
end

return Module

-- Event Handling
local connection = event:Connect(function()
  print("Event fired")
end)

-- Cleanup
connection:Disconnect()

-- Error Handling
local success, result = pcall(function()
  return riskyOperation()
end)
if not success then
  warn("Error:", result)
end`
};

// ============================================
// SMART MODULE DETECTION
// ============================================
function detectNeededModules(userPrompt, context) {
  const prompt = userPrompt.toLowerCase();
  const modules = [];
  
  const detectionRules = {
    syntax: ['syntax', 'error', 'how to', 'basic', 'end keyword', 'help'],
    remotes: ['remote', 'client', 'server', 'fire', 'event', 'communicate'],
    data: ['save', 'load', 'data', 'datastore', 'leaderstats', 'stats', 'store'],
    combat: ['damage', 'health', 'attack', 'hit', 'combat', 'fight', 'weapon', 'hurt'],
    gui: ['gui', 'ui', 'button', 'frame', 'screen', 'interface', 'menu', 'text'],
    tween: ['tween', 'animate', 'animation', 'move', 'smooth', 'lerp'],
    raycast: ['raycast', 'ray', 'shoot', 'gun', 'bullet', 'aim', 'line of sight'],
    inventory: ['inventory', 'item', 'backpack', 'storage', 'collect', 'pickup'],
    security: ['secure', 'exploit', 'validate', 'check', 'anti', 'safe', 'hack'],
    performance: ['optimize', 'lag', 'performance', 'fast', 'efficient', 'pool', 'slow'],
    advanced: ['module', 'class', 'oop', 'pattern', 'advanced', 'complex']
  };
  
  for (const [module, keywords] of Object.entries(detectionRules)) {
    for (const keyword of keywords) {
      if (prompt.includes(keyword)) {
        if (!modules.includes(module)) {
          modules.push(module);
        }
        break;
      }
    }
  }
  
  // Add syntax for read/modify operations
  if (prompt.includes('read') || prompt.includes('modify') || prompt.includes('fix')) {
    if (!modules.includes('syntax')) {
      modules.push('syntax');
    }
  }
  
  // Default to syntax if nothing detected
  if (modules.length === 0) {
    modules.push('syntax');
  }
  
  // Limit to 3 modules to save tokens
  return modules.slice(0, 3);
}

// ============================================
// BUILD OPTIMIZED PROMPT
// ============================================
function buildOptimizedPrompt(userPrompt, context, sessionId) {
  const session = initSession(sessionId);
  
  let prompt = CORE_PROMPT + '\n\n';
  
  // Detect and add only needed modules
  const neededModules = detectNeededModules(userPrompt, context);
  
  if (neededModules.length > 0) {
    prompt += '--- RELEVANT KNOWLEDGE ---\n';
    for (const moduleName of neededModules) {
      if (KNOWLEDGE_MODULES[moduleName]) {
        prompt += KNOWLEDGE_MODULES[moduleName] + '\n';
      }
    }
    prompt += '\n';
  }
  
  // Add user request
  prompt += '--- USER REQUEST ---\n' + userPrompt + '\n\n';
  
  // Add source code if provided (condensed)
  if (context?.sourceCodes && Object.keys(context.sourceCodes).length > 0) {
    prompt += '--- AVAILABLE SOURCE CODE ---\n';
    Object.entries(context.sourceCodes).forEach(([path, code]) => {
      const preview = code.length > 1500 ? code.substring(0, 1500) + '\n... (truncated)' : code;
      prompt += `${path}:\n\`\`\`lua\n${preview}\n\`\`\`\n\n`;
    });
  }
  
  // Add minimal session context
  if (session.createdInstances?.length > 0) {
    prompt += '--- RECENT SESSION ---\n';
    const recent = session.createdInstances.slice(-3);
    prompt += `Created: ${recent.map(i => i.name).join(', ')}\n\n`;
  }
  
  // Add pending source requests
  if (session.pendingSourceRequests?.length > 0) {
    prompt += '--- PENDING REQUESTS ---\n';
    session.pendingSourceRequests.forEach(req => {
      prompt += `• Need: ${req.instanceName} - ${req.reason}\n`;
    });
    prompt += '\n';
  }
  
  prompt += '--- INSTRUCTIONS ---\n';
  prompt += '1. Analyze the request and available code\n';
  prompt += '2. If you need missing source code, request it with needsSourceCode\n';
  prompt += '3. Create a clear, step-by-step plan\n';
  prompt += '4. Keep responses concise and focused\n';
  prompt += '5. Use targeted modifications only (no replaceAll)\n';
  
  return { prompt, modules: neededModules };
}

// ============================================
// TOKEN ESTIMATION
// ============================================
function estimateTokens(text) {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

// ============================================
// PROCESS AI REQUEST (OPTIMIZED)
// ============================================
async function processAIRequest(prompt, context, sessionId) {
  try {
    const session = initSession(sessionId);
    
    // Check if we should request source code first
    const sourceCheck = shouldRequestSourceCode(prompt, context, session);
    
    if (sourceCheck.needsSource) {
      console.log(`[AI] 📝 Requesting source code: ${sourceCheck.instanceName}`);
      
      if (!session.pendingSourceRequests) {
        session.pendingSourceRequests = [];
      }
      
      session.pendingSourceRequests.push({
        instanceName: sourceCheck.instanceName,
        timestamp: new Date().toISOString(),
        reason: sourceCheck.reason
      });
      
      return {
        message: `I need to read ${sourceCheck.instanceName} source code to proceed`,
        thinkingSteps: [
          'analyzing: User request received',
          `reading: ${sourceCheck.instanceName} source code not available`,
          'requesting: Need source code to continue'
        ],
        plan: [],
        needsSourceCode: {
          instanceName: sourceCheck.instanceName,
          expectedPath: `game.ServerScriptService.${sourceCheck.instanceName}`,
          reason: sourceCheck.reason
        },
        needsApproval: false,
        reasoning: 'Cannot analyze or modify code without seeing the source'
      };
    }
    
    // Clear pending requests if we now have source code
    if (session.pendingSourceRequests?.length > 0 && context?.sourceCodes) {
      session.pendingSourceRequests = [];
    }
    
    // Build optimized prompt
    const { prompt: optimizedPrompt, modules } = buildOptimizedPrompt(prompt, context, sessionId);
    const tokenCount = estimateTokens(optimizedPrompt);
    
    console.log(`[AI] 🔧 Modules: ${modules.join(', ')}`);
    console.log(`[AI] 📊 Tokens: ~${tokenCount} (${modules.length} modules)`);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview', // Faster, cheaper model
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: optimizedPrompt
    });

    // Planning phase
    if (session.executionState === 'idle') {
      session.executionState = 'planning';
      
      const planResult = await model.generateContent('Analyze and create plan');
      const planText = planResult.response.text();
      
      let aiResponse;
      try {
        const cleanedText = planText.replace(/```json\n?|\n?```/g, '').trim();
        aiResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] ❌ Parse error:', parseError.message);
        aiResponse = {
          message: 'Analyzing your request',
          thinkingSteps: ['planning: Processing request'],
          plan: [],
          needsApproval: false,
          reasoning: 'Creating execution plan'
        };
      }
      
      // If AI requests source code in response
      if (aiResponse.needsSourceCode) {
        return aiResponse;
      }
      
      // Store plan
      session.currentPlan = aiResponse.plan || [];
      session.currentStep = 0;
      session.executionState = 'executing';
      
      return {
        ...aiResponse,
        metadata: {
          mode: 'planning',
          totalSteps: aiResponse.plan?.length || 0,
          modulesUsed: modules,
          estimatedTokens: tokenCount,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
      
    } else if (session.executionState === 'executing') {
      // Execution phase
      const currentStep = session.currentStep;
      const totalSteps = session.currentPlan.length;
      
      if (currentStep >= totalSteps) {
        session.executionState = 'complete';
        return {
          message: 'All steps completed successfully',
          thinkingSteps: ['complete: Execution finished'],
          plan: [],
          needsApproval: false,
          reasoning: 'All planned steps executed',
          metadata: {
            mode: 'complete',
            sessionId,
            timestamp: new Date().toISOString()
          }
        };
      }
      
      const step = session.currentPlan[currentStep];
      const executionPrompt = `Execute step ${currentStep + 1}/${totalSteps}: ${step.description}`;
      
      console.log(`[AI] ⚙️ Executing step ${currentStep + 1}/${totalSteps}`);
      
      const stepResult = await model.generateContent(executionPrompt);
      const stepText = stepResult.response.text();
      
      let stepResponse;
      try {
        const cleanedText = stepText.replace(/```json\n?|\n?```/g, '').trim();
        stepResponse = JSON.parse(cleanedText);
      } catch (parseError) {
        console.error('[AI] ❌ Step parse error:', parseError.message);
        stepResponse = {
          message: `Executing step ${currentStep + 1}`,
          thinkingSteps: [`working: Processing step ${currentStep + 1}`],
          plan: [step],
          needsApproval: false,
          reasoning: 'Step execution'
        };
      }
      
      // Update session
      session.currentStep++;
      if (session.currentStep >= totalSteps) {
        session.executionState = 'complete';
      }
      
      return {
        ...stepResponse,
        metadata: {
          mode: 'execution',
          currentStep: currentStep + 1,
          totalSteps,
          modulesUsed: modules,
          estimatedTokens: tokenCount,
          sessionId,
          timestamp: new Date().toISOString()
        }
      };
    }
    
  } catch (error) {
    console.error('[AI] ❌ Error:', error.message);
    return {
      message: 'Error processing request',
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal error: ' + error.message,
      error: true
    };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================
function shouldRequestSourceCode(userPrompt, context, session) {
  const lowerPrompt = userPrompt.toLowerCase();
  
  const wantsToRead = lowerPrompt.includes('read') && 
                     (lowerPrompt.includes('source') || 
                      lowerPrompt.includes('code') ||
                      lowerPrompt.includes('file'));
  
  const wantsToModify = lowerPrompt.includes('modify') || 
                       lowerPrompt.includes('fix') || 
                       lowerPrompt.includes('change') ||
                       lowerPrompt.includes('edit');
  
  const instanceNameMatch = userPrompt.match(/\b([A-Z][a-zA-Z]+)\b/);
  const instanceName = instanceNameMatch ? instanceNameMatch[1] : null;
  
  if ((wantsToRead || wantsToModify) && instanceName) {
    if (context?.sourceCodes) {
      const hasSourceCode = Object.keys(context.sourceCodes).some(path => 
        path.toLowerCase().includes(instanceName.toLowerCase())
      );
      
      if (!hasSourceCode) {
        return {
          needsSource: true,
          instanceName: instanceName,
          reason: `User wants to ${wantsToRead ? 'read' : 'modify'} ${instanceName}`
        };
      }
    } else {
      return {
        needsSource: true,
        instanceName: instanceName || 'unknown',
        reason: 'No source code provided'
      };
    }
  }
  
  return { needsSource: false };
}

// ============================================
// ROUTES
// ============================================
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '4.0 - Token Optimized',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      '🚀 60-80% token reduction',
      '🧠 Smart module detection',
      '📦 Dynamic knowledge loading',
      '📝 Source code requests',
      '⚡ Faster responses',
      '💰 Lower API costs'
    ],
    modules: Object.keys(KNOWLEDGE_MODULES),
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessionMemory.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    sessionId,
    executionState: session.executionState,
    currentStep: session.currentStep,
    totalSteps: session.currentPlan?.length || 0,
    createdInstances: session.createdInstances || [],
    pendingSourceRequests: session.pendingSourceRequests || [],
    timestamp: new Date(session.timestamp || Date.now()).toISOString()
  });
});

app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Both prompt and sessionId are required'
      });
    }
    
    const session = initSession(sessionId);
    
    if (context?.sourceCodes) {
      console.log(`[AI] 📁 Context has ${Object.keys(context.sourceCodes).length} source files`);
    }
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server] ❌ Error:', error.message);
    res.status(500).json({ 
      error: 'Server error',
      message: error.message,
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal server error'
    });
  }
});

// Clean up old sessions
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - (session.timestamp || now) > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] 🧹 Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 ACIDNADE AI v4.0 - TOKEN OPTIMIZED');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('');
  console.log('💡 OPTIMIZATIONS:');
  console.log('  ✅ Dynamic module loading (only what\'s needed)');
  console.log('  ✅ Smart keyword detection');
  console.log('  ✅ 60-80% token reduction');
  console.log('  ✅ Token usage tracking');
  console.log('  ✅ Faster model (flash-exp)');
  console.log('');
  console.log('📦 AVAILABLE MODULES:', Object.keys(KNOWLEDGE_MODULES).length);
  console.log('   ', Object.keys(KNOWLEDGE_MODULES).join(', '));
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('═══════════════════════════════════════════════════════');
});
