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

// Initialize Gemini AI with Extended Thinking
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Security & Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/ai', limiter);

// Authentication Middleware
const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Invalid API key' 
    });
  }
  
  next();
};

// Logging Middleware
const logRequest = (req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Session: ${req.body?.sessionId || 'N/A'}`);
  next();
};

app.use(logRequest);

const SYSTEM_PROMPT = `
You are Acidnade AI, an expert Roblox Studio AI assistant.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CORE EXPERTISE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Lua scripting (Script, LocalScript, ModuleScript)
- Roblox services & APIs
- ALL Roblox instance types (Parts, Models, Tools, Sounds, Lights, etc.)
- Client-server architecture
- UI systems built programmatically
- Security & exploit prevention
- Performance optimization

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. UI CREATION (CRITICAL)
❌ NEVER create UI instances directly (ScreenGui, Frame, TextLabel, etc).
✅ ALL UI must be created **inside a LocalScript** using Instance.new.

The plan MUST:
- Create a **LocalScript**
- That LocalScript creates all UI instances

### 2. INSTANCE CREATION RULES
- Part/Model/Tool → game.Workspace or game.ServerStorage
- Script → game.ServerScriptService
- LocalScript → game.StarterPlayer.StarterPlayerScripts
- ModuleScript → game.ReplicatedStorage
- Sound → game.Workspace or game.ServerStorage
- Light → game.Workspace
- Folder → Anywhere needed
- RemoteEvent/RemoteFunction → game.ReplicatedStorage

❌ NEVER place executable scripts in ServerStorage.

### 3. INSTANCE SEARCH FUNCTIONALITY
When user mentions an existing object (like "health bar", "door", "coin"):
1. First search for existing instances with similar names
2. If found, consider modifying it instead of creating new
3. Reference found objects in your response

### 4. SECURITY
- Never trust client input
- Server validates everything
- RemoteEvents are REQUIRED for client → server communication

### 5. PERFORMANCE
- Avoid unnecessary loops
- Avoid GetChildren spam
- Prefer events and CollectionService

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SCRIPT PLACEMENT INTELLIGENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BE SMART about where scripts go:

### SINGLE INSTANCE (Self-contained objects)
→ Put script INSIDE the object itself
→ Example: Killbrick → Script as child of the Part
→ Example: Door → Script as child of the Model
→ This makes the object self-contained and easy to duplicate

### MULTIPLE INSTANCES (System that handles many objects)
→ Create ONE handler script in ServerScriptService
→ Handler finds and manages all objects by name/tag
→ Example: "Make all parts named Killbrick kill players" → Handler in ServerScriptService
→ Uses CollectionService or :GetDescendants() to find objects
→ Tag system (CollectionService) is preferred for scalability

### UI SYSTEMS
→ ALWAYS LocalScript in StarterPlayer.StarterPlayerScripts
→ NEVER create UI instances directly in plan
→ UI must be dynamically created at runtime

### SHARED LOGIC
→ ModuleScript in ReplicatedStorage
→ For code reused by multiple scripts
→ For client-server shared utilities

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RESPONSE FORMAT (JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "message": "Short explanation of what will be built (ONE SENTENCE ONLY)",
  "plan": [
    {
      "type": "create | modify | delete",
      "description": "What this step does",
      "className": "Script | LocalScript | ModuleScript | Part | Model | Tool | Sound | etc.",
      "name": "DescriptiveUniqueName",
      "parentPath": "game.ServerScriptService | game.StarterPlayer.StarterPlayerScripts | game.Workspace | etc.",
      "properties": {
        "Source": "-- Full Lua source code (for scripts)",
        "Color": "255, 0, 0",
        "Size": "5, 5, 5",
        ... other properties ...
      }
    }
  ],
  "needsApproval": true | false,
  "reasoning": "Why this approach was chosen (concise)"
}

RULES:
1. ALWAYS provide plan array when user wants to create/modify/delete
2. NEVER explain plan in message - message should be SHORT (one sentence)
3. Plan array contains the executable steps
4. Empty plan [] = only for explanations/questions
5. NEVER invent extra fields
6. If explaining only → plan MUST be empty []

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PLAN SAFETY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- UI requests → LocalScript ONLY
- Server logic → Script ONLY
- Shared logic → ModuleScript ONLY
- Parts/Models → game.Workspace ONLY
- No random or generic names
- No duplicate instances
- Destructive actions → needsApproval = true
- Script inside object for single instances
- Handler in ServerScriptService for systems

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PROPERTY FORMAT (DATA ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ IMPORTANT:
Property values are **DATA REPRESENTATIONS ONLY**.
The plugin/runtime will convert them to real Roblox types.

### Color3
"255, 0, 0" or "red"

### Vector3
"X, Y, Z"

### UDim2
"XScale, XOffset, YScale, YOffset"

### Enums
"Neon", "SourceSansBold", "Center" (no Enum. prefix)

### Asset IDs
"123456789"

### Booleans
true / false

### Numbers
24, 0.5, 100

### Strings
"Hello World"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONTEXT AWARENESS & SEARCH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You will receive:
- Existing instances (list of names, class names, and paths)
- Selected instances
- Project structure
- Previous actions

You MUST:
1. SEARCH FIRST: When user mentions something (like "health bar"), look for existing instances with similar names
2. USE FOUND INSTANCES: If found, modify instead of create
3. REFERENCE BY NAME: Use exact instance names in your plan
4. AVOID DUPLICATES: Check existing names before creating
5. CONSIDER REPLACING: If similar instance exists, ask if user wants to replace or modify

Example user request: "Update my health bar and make it green"
Your action: 
1. Search for "health bar" in existing instances
2. If found HealthBarUI, modify its color property
3. If not found, create new

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ACTION-ORIENTED EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Example 1: Single Instance (Killbrick)
User: "make a killbrick"
{
  "message": "Creating self-contained killbrick",
  "plan": [
    {
      "type": "create",
      "description": "Red kill brick part",
      "className": "Part",
      "name": "Killbrick",
      "parentPath": "game.Workspace",
      "properties": {
        "Color": "255, 0, 0",
        "Size": "10, 1, 10",
        "Anchored": true,
        "Position": "0, 5, 0"
      }
    },
    {
      "type": "create",
      "description": "Kill script inside brick",
      "className": "Script",
      "name": "KillScript",
      "parentPath": "game.Workspace.Killbrick",
      "properties": {
        "Source": "script.Parent.Touched:Connect(function(hit)\n  local humanoid = hit.Parent:FindFirstChild('Humanoid')\n  if humanoid then\n    humanoid.Health = 0\n  end\nend)"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Self-contained killbrick with script inside for easy duplication"
}

### Example 2: Multiple Instance System
User: "create a system where all parts named Danger kill players"
{
  "message": "Creating danger zone handler system",
  "plan": [
    {
      "type": "create",
      "description": "Handler for all danger parts",
      "className": "Script",
      "name": "DangerZoneHandler",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "local CollectionService = game:GetService('CollectionService')\nlocal TAG_NAME = 'Danger'\n\n-- Function to setup danger part\nlocal function setupDangerPart(part)\n  part.Touched:Connect(function(hit)\n    local humanoid = hit.Parent:FindFirstChild('Humanoid')\n    if humanoid then\n      humanoid.Health = 0\n    end\n  end)\nend\n\n-- Setup existing parts\nfor _, part in pairs(workspace:GetDescendants()) do\n  if part:IsA('Part') and part.Name == 'Danger' then\n    setupDangerPart(part)\n  end\nend\n\n-- Listen for new parts\nworkspace.DescendantAdded:Connect(function(descendant)\n  if descendant:IsA('Part') and descendant.Name == 'Danger' then\n    setupDangerPart(descendant)\n  end\nend)"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Single handler script manages all danger parts dynamically"
}

### Example 3: UI System
User: "add a health bar UI"
{
  "message": "Creating dynamic health bar UI",
  "plan": [
    {
      "type": "create",
      "description": "Health bar UI LocalScript",
      "className": "LocalScript",
      "name": "HealthBarUI",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts",
      "properties": {
        "Source": "local Players = game:GetService('Players')\nlocal player = Players.LocalPlayer\nlocal character = player.Character or player.CharacterAdded:Wait()\nlocal humanoid = character:WaitForChild('Humanoid')\n\n-- Create UI\nlocal screenGui = Instance.new('ScreenGui')\nscreenGui.Name = 'HealthBarGui'\nscreenGui.Parent = player.PlayerGui\n\nlocal background = Instance.new('Frame')\nbackground.Name = 'Background'\nbackground.Size = UDim2.new(0.3, 0, 0.05, 0)\nbackground.Position = UDim2.new(0.35, 0, 0.9, 0)\nbackground.BackgroundColor3 = Color3.fromRGB(50, 50, 50)\nbackground.BorderSizePixel = 2\nbackground.Parent = screenGui\n\nlocal healthBar = Instance.new('Frame')\nhealthBar.Name = 'HealthBar'\nhealthBar.Size = UDim2.new(1, 0, 1, 0)\nhealthBar.BackgroundColor3 = Color3.fromRGB(255, 0, 0)\nhealthBar.BorderSizePixel = 0\nhealthBar.Parent = background\n\n-- Update function\nlocal function updateHealth()\n  local healthPercent = humanoid.Health / humanoid.MaxHealth\n  healthBar.Size = UDim2.new(healthPercent, 0, 1, 0)\n  \n  -- Color gradient\n  if healthPercent > 0.5 then\n    healthBar.BackgroundColor3 = Color3.fromRGB(0, 255, 0)\n  elseif healthPercent > 0.25 then\n    healthBar.BackgroundColor3 = Color3.fromRGB(255, 255, 0)\n  else\n    healthBar.BackgroundColor3 = Color3.fromRGB(255, 0, 0)\n  end\nend\n\n-- Connect events\nhumanoid.HealthChanged:Connect(updateHealth)\nupdateHealth()"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Dynamic UI created at runtime with color gradient based on health"
}

### Example 4: Modify Existing
User: "make the floor slippery"
{
  "message": "Modifying floor with slippery physics",
  "plan": [
    {
      "type": "modify",
      "description": "Add slippery material to floor",
      "className": "Part",
      "name": "Baseplate",
      "parentPath": "game.Workspace",
      "properties": {
        "Material": "Ice",
        "Friction": 0.1
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Modified existing floor with ice material for slippery effect"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## COMMON INSTANCE TYPES & PROPERTIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Part
- className: "Part"
- parentPath: "game.Workspace"
- properties: { "Color": "0, 255, 0", "Size": "5, 5, 5", "Position": "0, 10, 0", "Material": "Concrete" }

### Model
- className: "Model"
- parentPath: "game.Workspace"
- properties: { "PrimaryPart": "PartName" }

### Tool
- className: "Tool"
- parentPath: "game.StarterPack" or "game.ServerStorage"
- properties: { "CanBeDropped": true, "RequiresHandle": true, "ToolTip": "Sword" }

### Sound
- className: "Sound"
- parentPath: "game.Workspace"
- properties: { "SoundId": "rbxassetid://123456", "Volume": 0.5, "Looped": true }

### PointLight
- className: "PointLight"
- parentPath: "game.Workspace"
- properties: { "Brightness": 2, "Range": 20, "Color": "255, 255, 255" }

### Folder (for organization)
- className: "Folder"
- parentPath: "game.Workspace" or "game.ServerStorage"
- properties: {}

### RemoteEvent (Client-Server Communication)
- className: "RemoteEvent"
- parentPath: "game.ReplicatedStorage"
- properties: {}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## BEHAVIOR GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. BE ACTION-ORIENTED: Users expect you to BUILD, not explain
2. BE SMART: Choose script placement based on context (single vs multiple instances)
3. BE EFFICIENT: Use appropriate data structures and patterns
4. BE SECURE: Always validate on server, never trust client
5. BE CLEAR: Message is one sentence, reasoning is concise
6. BE CONTEXT-AWARE: Search first, then create/modify
7. BE PRACTICAL: Create systems that are easy to maintain and scale
8. BE PRECISE: Use exact property formats as specified

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THINK CAREFULLY. EXECUTE PRECISELY.
You are expected to BUILD ROBLOX EXPERIENCES, not speculate.
When in doubt, follow the examples and rules above.s
`;

// =====================================================
// ENHANCED CONTEXT OPTIMIZER WITH INSTANCE SEARCH
// =====================================================
function optimizeContext(context) {
  const optimized = {
    projectStats: context.project?.Statistics || {},
    recentScripts: [],
    selectedObjects: context.selectedObjects || [],
    recentChanges: [],
    chatSummary: [],
    existingInstances: [], // NEW: All instances for search
    foundInstances: []     // NEW: Instances found based on user query
  };

  // Extract all instances for search functionality
  if (context.project?.AllInstances) {
    optimized.existingInstances = context.project.AllInstances
      .map(instance => ({
        name: instance.Name,
        className: instance.ClassName,
        path: instance.Path,
        properties: instance.Properties || {}
      }));
  }

  // Extract recent script info
  if (context.project?.ScriptDetails) {
    optimized.recentScripts = context.project.ScriptDetails
      .slice(-10)
      .map(script => ({
        name: script.Name,
        type: script.Type,
        path: script.Path,
        preview: script.Preview?.substring(0, 200)
      }));
  }

  // Extract recent changes
  if (context.createdInstances) {
    optimized.recentChanges = context.createdInstances
      .slice(-5)
      .map(item => ({
        name: item.name,
        type: item.className,
        path: item.parentPath,
        description: item.description
      }));
  }

  // Summarize chat history
  if (context.chatHistory) {
    optimized.chatSummary = context.chatHistory
      .slice(-10)
      .map(msg => ({
        role: msg.role,
        content: msg.content?.substring(0, 500)
      }));
  }

  return optimized;
}

// =====================================================
// ENHANCED PROMPT BUILDER WITH INSTANCE SEARCH
// =====================================================
function buildPrompt(userPrompt, context) {
  const optimizedContext = optimizeContext(context);
  
  let prompt = `## USER REQUEST\n${userPrompt}\n\n`;
  
  // SEARCH FOR INSTANCES MENTIONED IN USER PROMPT
  const searchTerms = extractSearchTerms(userPrompt);
  const foundInstances = searchInstances(searchTerms, optimizedContext.existingInstances);
  
  prompt += `## SEARCH RESULTS FOR "${searchTerms.join(', ')}"\n`;
  if (foundInstances.length > 0) {
    prompt += `Found ${foundInstances.length} matching instance(s):\n`;
    foundInstances.forEach(instance => {
      prompt += `- ${instance.name} (${instance.className}) at ${instance.path}\n`;
    });
    prompt += `\nRECOMMENDATION: Consider modifying these existing instances instead of creating new ones.\n\n`;
  } else {
    prompt += `No existing instances found matching your request. Will create new instances.\n\n`;
  }

  // Add project context
  if (optimizedContext.projectStats) {
    prompt += `## PROJECT STATE\n`;
    prompt += `- Total Instances: ${optimizedContext.projectStats.TotalInstances || 0}\n`;
    prompt += `- Total Scripts: ${optimizedContext.projectStats.TotalScripts || 0}\n`;
    prompt += `- Total UI Elements: ${optimizedContext.projectStats.TotalUI || 0}\n\n`;
  }

  // Add selected objects
  if (optimizedContext.selectedObjects?.length > 0) {
    prompt += `## CURRENTLY SELECTED\n`;
    optimizedContext.selectedObjects.forEach(obj => {
      prompt += `- ${obj.Name} (${obj.ClassName}) at ${obj.Path}\n`;
    });
    prompt += `\n`;
  }

  // Add recent changes
  if (optimizedContext.recentChanges?.length > 0) {
    prompt += `## RECENT CHANGES\n`;
    optimizedContext.recentChanges.forEach(change => {
      prompt += `- ${change.name} (${change.type}): ${change.description || 'Created'}\n`;
    });
    prompt += `\n`;
  }

  // Add chat history summary
  if (optimizedContext.chatSummary?.length > 0) {
    prompt += `## RECENT CONVERSATION\n`;
    optimizedContext.chatSummary.forEach(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n`;
    });
    prompt += `\n`;
  }

  prompt += `## INSTRUCTIONS\n`;
  prompt += `Analyze the request and search results. If instances were found, MODIFY them instead of creating new ones.\n`;
  prompt += `Remember: UI must be created by LocalScripts, not directly as instances!\n`;
  prompt += `Provide specific property changes for modifications.\n\n`;
  prompt += `Respond ONLY with valid JSON matching the required format.`;

  return prompt;
}

// =====================================================
// SEARCH FUNCTIONS
// =====================================================
function extractSearchTerms(userPrompt) {
  const terms = [];
  const lowerPrompt = userPrompt.toLowerCase();
  
  // Common Roblox object keywords
  const keywords = [
    'health', 'bar', 'gui', 'ui', 'door', 'coin', 'money', 'score',
    'platform', 'wall', 'floor', 'light', 'sound', 'music', 'particle',
    'button', 'lever', 'switch', 'teleporter', 'spawn', 'checkpoint',
    'weapon', 'tool', 'gun', 'sword', 'armor', 'shield', 'powerup',
    'enemy', 'boss', 'npc', 'player', 'character', 'vehicle', 'car',
    'plane', 'boat', 'train', 'elevator', 'ladder', 'stairs', 'ramp'
  ];
  
  keywords.forEach(keyword => {
    if (lowerPrompt.includes(keyword)) {
      terms.push(keyword);
    }
  });
  
  // Add any capitalized words that might be instance names
  const words = userPrompt.split(/\s+/);
  words.forEach(word => {
    if (word.length > 2 && /^[A-Z][a-z]+/.test(word)) {
      terms.push(word);
    }
  });
  
  return [...new Set(terms)]; // Remove duplicates
}

function searchInstances(terms, instances) {
  if (!terms.length || !instances?.length) return [];
  
  const found = [];
  const lowerTerms = terms.map(t => t.toLowerCase());
  
  instances.forEach(instance => {
    const lowerName = instance.name.toLowerCase();
    
    // Check if any term matches the instance name
    for (const term of lowerTerms) {
      if (lowerName.includes(term) || 
          instance.className.toLowerCase().includes(term) ||
          instance.path.toLowerCase().includes(term)) {
        found.push(instance);
        break;
      }
    }
  });
  
  return found.slice(0, 10); // Limit to 10 results
}

// =====================================================
// AI REQUEST HANDLER WITH EXTENDED THINKING
// =====================================================
async function processAIRequest(prompt, context, sessionId) {
  try {
    console.log(`[AI] Processing request for session: ${sessionId}`);
    console.log(`[AI] Prompt length: ${prompt.length} chars`);

    // Initialize model with GEMINI 3 FLASH PREVIEW
    const MODEL_NAME = "gemini-3-flash-preview";
    
    const model = genAI.getGenerativeModel({
      model: MODEL_NAME,
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
      systemInstruction: SYSTEM_PROMPT
    });

    // Build optimized prompt
    const fullPrompt = buildPrompt(prompt, context);
    
    console.log(`[AI] Sending to Gemini with extended thinking mode...`);
    const startTime = Date.now();

    // Send request with thinking mode
    const result = await model.generateContent(fullPrompt);
    const response = result.response;
    const thinkingTime = Date.now() - startTime;

    console.log(`[AI] Response received in ${thinkingTime}ms`);

    // Extract thinking process if available
    let thinkingProcess = null;
    if (response.candidates?.[0]?.content?.parts) {
      const parts = response.candidates[0].content.parts;
      const thinkingPart = parts.find(part => part.thought === true);
      if (thinkingPart) {
        thinkingProcess = thinkingPart.text;
        console.log(`[AI] Extended thinking captured (${thinkingProcess.length} chars)`);
      }
    }

    // Get the main response
    const text = response.text();
    console.log(`[AI] Response length: ${text.length} chars`);

    // Parse JSON response
    let aiResponse;
    try {
      // Clean potential markdown code blocks
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      aiResponse = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('[AI] JSON parse error:', parseError);
      console.error('[AI] Raw response:', text.substring(0, 500));
      
      // Fallback response
      aiResponse = {
        message: text.substring(0, 500) || "I understand your request. Let me help you with that.",
        plan: [],
        needsApproval: false,
        reasoning: "Response parsing error - displaying raw AI response"
      };
    }

    // Validate response structure
    if (!aiResponse.message) {
      aiResponse.message = "I'm working on your request...";
    }
    if (!aiResponse.plan) {
      aiResponse.plan = [];
    }
    if (typeof aiResponse.needsApproval === 'undefined') {
      aiResponse.needsApproval = aiResponse.plan.length >= 3;
    }

    // Add metadata
    aiResponse.metadata = {
      thinkingTime: thinkingTime,
      model: MODEL_NAME,
      sessionId: sessionId,
      timestamp: new Date().toISOString(),
      hadExtendedThinking: !!thinkingProcess
    };

    if (NODE_ENV === 'development' && thinkingProcess) {
      aiResponse.thinkingProcess = thinkingProcess.substring(0, 1000); // Include in dev mode
    }

    console.log(`[AI] Generated ${aiResponse.plan.length} step(s)`);
    console.log(`[AI] Needs approval: ${aiResponse.needsApproval}`);

    return aiResponse;

  } catch (error) {
    console.error('[AI] Error:', error);
    
    // Detailed error response
    return {
      message: `Error: ${error.message || 'Unknown error occurred'}`,
      plan: [],
      needsApproval: false,
      error: true,
      reasoning: NODE_ENV === 'development' ? error.stack : 'An error occurred while processing your request'
    };
  }
}

// =====================================================
// ROUTES
// =====================================================

// Root Route - API Info
app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI Server',
    version: '1.4',
    status: 'online',
    model: 'gemini-3-flash-preview',
    endpoints: {
      'GET /': 'API information',
      'GET /ping': 'Health check',
      'POST /ai': 'AI request processing (requires authentication)'
    },
    documentation: 'https://github.com/your-repo/acidnade-ai',
    timestamp: new Date().toISOString()
  });
});

// Health Check
app.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.4',
    model: 'gemini-3-flash-preview'
  });
});

// Main AI Endpoint
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;

    // Validation
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Prompt is required and must be a string' 
      });
    }

    if (!sessionId) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Session ID is required' 
      });
    }

    console.log(`[Request] Processing AI request for session: ${sessionId}`);
    console.log(`[Request] Prompt: ${prompt.substring(0, 100)}...`);

    // Process with AI
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);

    // Send response
    res.json(aiResponse);

  } catch (error) {
    console.error('[Error] Request processing failed:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: NODE_ENV === 'development' ? error.message : 'An error occurred',
      plan: [],
      needsApproval: false
    });
  }
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('[Error]', err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    message: `Route ${req.path} not found`
  });
});

// =====================================================
// START SERVER
// =====================================================
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🚀 ACIDNADE AI SERVER STARTED');
  console.log('='.repeat(50));
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log(`🤖 Model: gemini-3-flash-preview`);
  console.log(`🧠 Extended Thinking: ENABLED`);
  console.log(`🔒 Auth: ${process.env.ACIDNADE_API_KEY ? 'CONFIGURED' : 'NOT SET'}`);
  console.log(`✅ Ready to accept requests!`);
  console.log('='.repeat(50));
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('⚠️  SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('⚠️  SIGINT received, shutting down gracefully...');
  process.exit(0);
});
