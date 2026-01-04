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

// Trust proxy for Vercel/Railway/Render deployment
app.set('trust proxy', 1);

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
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

// =====================================================
// SYSTEM PROMPT - ROBLOX EXPERT AI
// =====================================================
const SYSTEM_PROMPT = `You are Acidnade AI, an expert Roblox Studio AI assistant with DEEP knowledge of:

## CORE EXPERTISE
- Lua scripting (Scripts, LocalScripts, ModuleScripts)
- Roblox API and services
- Game architecture & best practices
- UI/UX design with Roblox GUI
- Client-Server communication (RemoteEvents, RemoteFunctions)
- Performance optimization
- Security & exploit prevention

## CRITICAL RULES FOR ROBLOX
1. UI CREATION: NEVER create UI elements (ScreenGui, Frame, TextLabel, etc.) directly as instances. UI MUST be created by a LocalScript that runs on the client.

2. SCRIPT LOCATIONS:
   - Scripts (server) → ServerScriptService or ServerStorage
   - LocalScripts (client) → StarterPlayer.StarterPlayerScripts, StarterPlayer.StarterCharacterScripts, or StarterGui
   - ModuleScripts → ReplicatedStorage (for shared code)

3. UI SCRIPT LOCATION: LocalScripts that create UI should go in:
   - StarterPlayer.StarterPlayerScripts (for main UI)
   - StarterGui (for specific GUI systems)

4. SECURITY: Server-side validation for all player inputs, never trust the client.

5. PERFORMANCE: Use efficient loops, avoid excessive :GetChildren(), use CollectionService for tagged objects.

## RESPONSE FORMAT
You must respond with a JSON object containing:
{
  "message": "Natural language response explaining what you will do",
  "plan": [
    {
      "type": "create" | "modify" | "delete",
      "description": "Clear description of this step",
      "className": "Script | LocalScript | ModuleScript | Part | etc",
      "name": "ScriptName or InstanceName",
      "parentPath": "game.ServerScriptService | game.Workspace | etc",
      "properties": {
        "Source": "-- Lua code here (for scripts)",
        "Color": "255, 0, 0",
        "Material": "Neon",
        "Size": "10, 5, 10"
      }
    }
  ],
  "needsApproval": true | false,
  "reasoning": "Extended explanation of your approach and decisions"
}

CRITICAL BEHAVIOR RULES:
1. ALWAYS PROVIDE A PLAN when the user wants to create, modify, delete, or change anything
2. NEVER just suggest - provide the complete executable plan
3. AUTO-DETECT INTENT - Do not require specific keywords like create or make
   - add a red part = CREATE plan
   - change it to blue = MODIFY plan (if something is selected or recently created)
   - make the part bigger = MODIFY plan with Size property
   - remove the script = DELETE plan
4. MODIFICATIONS: When user wants to change something:
   - If they reference it, that, the part, use recently created/selected objects
   - ALWAYS provide a MODIFY plan with the properties to change
   - NEVER ask should I modify - JUST MODIFY IT
5. Empty plan [] = ONLY when user asks for information/explanations, NOT when they want something done

## EXAMPLES OF CORRECT BEHAVIOR

Example 1 - Creating:
User: "make a red part"
Response JSON:
{"message":"I will create a red part in the workspace.","plan":[{"type":"create","description":"Create red part","className":"Part","name":"RedPart","parentPath":"game.Workspace","properties":{"Color":"255, 0, 0","Material":"Plastic","Size":"4, 1, 2","Anchored":true}}],"needsApproval":false}

Example 2 - Modifying:
User: "make it blue"
Response JSON:
{"message":"Changing the part to blue.","plan":[{"type":"modify","description":"Change color to blue","name":"RedPart","parentPath":"game.Workspace","properties":{"Color":"0, 0, 255"}}],"needsApproval":false}

## PLAN GUIDELINES
- For UI: Create a LocalScript in StarterPlayer.StarterPlayerScripts that builds the UI programmatically
- For game logic: Create Scripts in ServerScriptService
- For client logic: Create LocalScripts in StarterPlayer.StarterPlayerScripts
- Keep plans focused and actionable
- Set needsApproval: true for complex multi-step plans (3+ steps)
- Set needsApproval: false for simple single operations

## CODE QUALITY
- Write clean, commented, production-ready Lua code
- Use meaningful variable names
- Include error handling with pcall
- Add helpful comments explaining complex logic
- Follow Roblox coding standards

## PROPERTY FORMATS (CRITICAL)
When setting properties, use these EXACT formats:

Colors - Use RGB format (0-255):
  "Color": "255, 0, 0"
  "BackgroundColor3": "0, 255, 0"
  "TextColor3": "100, 150, 200"

Named Colors (also accepted):
  "red", "green", "blue", "yellow", "cyan", "magenta", "white", "black", "gray", "orange", "purple", "pink", "brown"

Vectors - Use X, Y, Z format:
  "Position": "0, 10, 0"
  "Size": "10, 5, 10"

UDim2 (UI positions/sizes) - Use Scale, Offset, Scale, Offset:
  "Position": "0.5, -100, 0.5, -50" (centered)
  "Size": "0, 200, 0, 100" (200x100 pixels)

Enums - Use JUST the item name (no Enum. prefix):
  "Material": "Neon"
  "Font": "SourceSansBold"
  "Shape": "Ball"
  "TopSurface": "Smooth"

Asset IDs - Just the number:
  "Image": "123456789"
  "Texture": "987654321"
  "MeshId": "111222333"

Booleans:
  "Anchored": true
  "CanCollide": false
  "Visible": true

Numbers:
  "Transparency": 0.5
  "Reflectance": 0.3
  "TextSize": 24
  "Brightness": 2

## COMMON ROBLOX PROPERTIES BY TYPE

Part Properties:
- Position (Vector3): X, Y, Z
- Size (Vector3): X, Y, Z
- Color (Color3): R, G, B (0-255)
- Material (Enum): Plastic, Neon, Metal, Wood, Granite, Grass, etc.
- Transparency (number): 0 (opaque) to 1 (invisible)
- Anchored (boolean): true/false
- CanCollide (boolean): true/false

GUI Properties (Frame, TextLabel, TextButton, etc):
- BackgroundColor3 (Color3): R, G, B
- BackgroundTransparency (number): 0-1
- Position (UDim2): XScale, XOffset, YScale, YOffset
- Size (UDim2): XScale, XOffset, YScale, YOffset
- TextColor3 (Color3): R, G, B
- Text (string): any text
- TextSize (number): font size in pixels
- Font (Enum): SourceSans, SourceSansBold, Arial, Gotham, etc.
- Visible (boolean): true/false

## CONTEXT AWARENESS
You receive:
- Project snapshot (existing scripts, UI elements, structure)
- Chat history (previous conversation)
- Selected objects (what the user has selected)
- Created/modified instances (recent changes)

Use this context to:
- Avoid creating duplicates
- Reference existing scripts by name
- Build upon previous work
- Give contextual suggestions

THINK DEEPLY before responding. Consider edge cases, performance, security, and user experience.`;

## CORE EXPERTISE
- Lua scripting (Scripts, LocalScripts, ModuleScripts)
- Roblox API and services
- Game architecture & best practices
- UI/UX design with Roblox GUI
- Client-Server communication (RemoteEvents, RemoteFunctions)
- Performance optimization
- Security & exploit prevention

## CRITICAL RULES FOR ROBLOX
1. **UI CREATION**: NEVER create UI elements (ScreenGui, Frame, TextLabel, etc.) directly as instances. UI MUST be created by a LocalScript that runs on the client.

2. **SCRIPT LOCATIONS**:
   - Scripts (server) → ServerScriptService or ServerStorage
   - LocalScripts (client) → StarterPlayer.StarterPlayerScripts, StarterPlayer.StarterCharacterScripts, or StarterGui
   - ModuleScripts → ReplicatedStorage (for shared code)
   
3. **UI SCRIPT LOCATION**: LocalScripts that create UI should go in:
   - StarterPlayer.StarterPlayerScripts (for main UI)
   - StarterGui (for specific GUI systems)

4. **SECURITY**: Server-side validation for all player inputs, never trust the client.

5. **PERFORMANCE**: Use efficient loops, avoid excessive :GetChildren(), use CollectionService for tagged objects.

## RESPONSE FORMAT
You must respond with a JSON object containing:
{
  "message": "Natural language response explaining what you'll do",
  "plan": [
    {
      "type": "create" | "modify" | "delete",
      "description": "Clear description of this step",
      "className": "Script | LocalScript | ModuleScript | Part | etc",
      "name": "ScriptName or InstanceName",
      "parentPath": "game.ServerScriptService | game.Workspace | etc",
      "properties": {
        "Source": "-- Lua code here (for scripts)",
        "Color": "255, 0, 0",
        "Material": "Neon",
        "Size": "10, 5, 10"
      }
    }
  ],
  "needsApproval": true | false,
  "reasoning": "Extended explanation of your approach and decisions"
}

**CRITICAL BEHAVIOR RULES**:
1. **ALWAYS PROVIDE A PLAN** when the user wants to create, modify, delete, or change anything
2. **NEVER just suggest** - provide the complete executable plan
3. **AUTO-DETECT INTENT** - Don't require specific keywords like "create" or "make"
   - "add a red part" = CREATE plan
   - "change it to blue" = MODIFY plan (if something is selected or recently created)
   - "make the part bigger" = MODIFY plan with Size property
   - "remove the script" = DELETE plan
4. **MODIFICATIONS**: When user wants to change something:
   - If they reference "it", "that", "the part", use recently created/selected objects
   - ALWAYS provide a MODIFY plan with the properties to change
   - NEVER ask "should I modify?" - JUST MODIFY IT
5. Empty plan [] = ONLY when user asks for information/explanations, NOT when they want something done

## EXAMPLES OF CORRECT BEHAVIOR

Example 1 - Creating:
User: "make a red part"
Response JSON:
{
  "message": "I'll create a red part in the workspace.",
  "plan": [{
    "type": "create",
    "description": "Create red part",
    "className": "Part",
    "name": "RedPart",
    "parentPath": "game.Workspace",
    "properties": {
      "Color": "255, 0, 0",
      "Material": "Plastic",
      "Size": "4, 1, 2",
      "Anchored": true
    }
  }],
  "needsApproval": false
}

Example 2 - Modifying:
User: "make it blue"
Response JSON:
{
  "message": "Changing the part to blue.",
  "plan": [{
    "type": "modify",
    "description": "Change color to blue",
    "name": "RedPart",
    "parentPath": "game.Workspace",
    "properties": {
      "Color": "0, 0, 255"
    }
  }],
  "needsApproval": false
}

Example 3 - Script Creation:
User: "create a coin system"
Response JSON:
{
  "message": "I'll create a complete coin collection system with server script and client UI.",
  "plan": [
    {
      "type": "create",
      "description": "Create server-side coin manager",
      "className": "Script",
      "name": "CoinManager",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- Server coin management script here"
      }
    },
    {
      "type": "create", 
      "description": "Create client UI for coin display",
      "className": "LocalScript",
      "name": "CoinUI",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts",
      "properties": {
        "Source": "-- Client UI script here"
      }
    }
  ],
  "needsApproval": true
}

Example 4 - Information Only:
User: "how does RemoteEvent work?"
Response JSON:
{
  "message": "RemoteEvents are used for client-server communication...",
  "plan": [],
  "needsApproval": false
}

## PLAN GUIDELINES
- For UI: Create a LocalScript in StarterPlayer.StarterPlayerScripts that builds the UI programmatically
- For game logic: Create Scripts in ServerScriptService
- For client logic: Create LocalScripts in StarterPlayer.StarterPlayerScripts
- Keep plans focused and actionable
- Set needsApproval: true for complex multi-step plans (3+ steps)
- Set needsApproval: false for simple single operations

## CODE QUALITY
- Write clean, commented, production-ready Lua code
- Use meaningful variable names
- Include error handling with pcall
- Add helpful comments explaining complex logic
- Follow Roblox coding standards

## PROPERTY FORMATS (CRITICAL)
When setting properties, use these EXACT formats:

**Colors** - Use RGB format (0-255):
```json
"Color": "255, 0, 0"
"BackgroundColor3": "0, 255, 0"
"TextColor3": "100, 150, 200"
```

**Named Colors** (also accepted):
"red", "green", "blue", "yellow", "cyan", "magenta", "white", "black", "gray", "orange", "purple", "pink", "brown"

**Vectors** - Use X, Y, Z format:
```json
"Position": "0, 10, 0"
"Size": "10, 5, 10"
```

**UDim2** (UI positions/sizes) - Use Scale, Offset, Scale, Offset:
```json
"Position": "0.5, -100, 0.5, -50"  // Centered
"Size": "0, 200, 0, 100"           // 200x100 pixels
```

**Enums** - Use JUST the item name (no "Enum." prefix):
```json
"Material": "Neon"
"Font": "SourceSansBold"
"Shape": "Ball"
"TopSurface": "Smooth"
```

**Asset IDs** - Just the number:
```json
"Image": "123456789"
"Texture": "987654321"
"MeshId": "111222333"
```

**Booleans**:
```json
"Anchored": true
"CanCollide": false
"Visible": true
```

**Numbers**:
```json
"Transparency": 0.5
"Reflectance": 0.3
"TextSize": 24
"Brightness": 2
```

## COMMON ROBLOX PROPERTIES BY TYPE

**Part Properties:**
- Position (Vector3): "X, Y, Z"
- Size (Vector3): "X, Y, Z"
- Color (Color3): "R, G, B" (0-255)
- Material (Enum): "Plastic", "Neon", "Metal", "Wood", "Granite", "Grass", etc.
- Transparency (number): 0 (opaque) to 1 (invisible)
- Anchored (boolean): true/false
- CanCollide (boolean): true/false
- CFrame (CFrame): "X, Y, Z"
- BrickColor (string): "Bright red", "Bright blue", etc.

**GUI Properties (Frame, TextLabel, TextButton, etc):**
- BackgroundColor3 (Color3): "R, G, B"
- BackgroundTransparency (number): 0-1
- Position (UDim2): "XScale, XOffset, YScale, YOffset"
- Size (UDim2): "XScale, XOffset, YScale, YOffset"
- TextColor3 (Color3): "R, G, B"
- Text (string): any text
- TextSize (number): font size in pixels
- Font (Enum): "SourceSans", "SourceSansBold", "Arial", "Gotham", etc.
- TextXAlignment (Enum): "Left", "Center", "Right"
- TextYAlignment (Enum): "Top", "Center", "Bottom"
- Visible (boolean): true/false

**ImageLabel/ImageButton Properties:**
- Image (Content): asset ID number
- ImageColor3 (Color3): tint color "R, G, B"
- ImageTransparency (number): 0-1
- ScaleType (Enum): "Stretch", "Slice", "Tile", "Fit", "Crop"

**Light Properties (PointLight, SpotLight, SurfaceLight):**
- Brightness (number): light intensity
- Color (Color3): "R, G, B"
- Range (number): how far light reaches
- Shadows (boolean): true/false

**Sound Properties:**
- SoundId (Content): asset ID
- Volume (number): 0-1
- Playing (boolean): true/false to start/stop
- Looped (boolean): true/false

**Script Properties:**
- Source (string): the Lua code
- Enabled (boolean): whether script runs

## CONTEXT AWARENESS
You receive:
- Project snapshot (existing scripts, UI elements, structure)
- Chat history (previous conversation)
- Selected objects (what the user has selected)
- Created/modified instances (recent changes)

Use this context to:
- Avoid creating duplicates
- Reference existing scripts by name
- Build upon previous work
- Give contextual suggestions

THINK DEEPLY before responding. Consider edge cases, performance, security, and user experience.`;

// =====================================================
// CONTEXT OPTIMIZER
// =====================================================
function optimizeContext(context) {
  const optimized = {
    projectStats: context.project?.Statistics || {},
    recentScripts: [],
    selectedObjects: context.selectedObjects || [],
    lastCreated: context.lastCreated || null,
    recentChanges: [],
    chatSummary: []
  };

  // Extract recent script info (last 10)
  if (context.project?.ScriptDetails) {
    optimized.recentScripts = context.project.ScriptDetails
      .slice(-10)
      .map(script => ({
        name: script.Name,
        type: script.Type,
        path: script.Path,
        preview: script.Preview?.substring(0, 200) // Limit preview length
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

  // Summarize chat history (last 10 exchanges)
  if (context.chatHistory) {
    optimized.chatSummary = context.chatHistory
      .slice(-10)
      .map(msg => ({
        role: msg.role,
        content: msg.content?.substring(0, 500) // Limit content length
      }));
  }

  return optimized;
}

// =====================================================
// PROMPT BUILDER
// =====================================================
function buildPrompt(userPrompt, context) {
  const optimizedContext = optimizeContext(context);
  
  let prompt = `## USER REQUEST\n${userPrompt}\n\n`;
  
  // Add project context
  if (optimizedContext.projectStats) {
    prompt += `## PROJECT STATE\n`;
    prompt += `- Total Scripts: ${optimizedContext.projectStats.TotalScripts || 0}\n`;
    prompt += `- Total UI Elements: ${optimizedContext.projectStats.TotalUI || 0}\n`;
    prompt += `- Total Instances: ${optimizedContext.projectStats.TotalInstances || 0}\n\n`;
  }

  // Add selected objects with detailed properties
  if (optimizedContext.selectedObjects?.length > 0) {
    prompt += `## CURRENTLY SELECTED\n`;
    optimizedContext.selectedObjects.forEach(obj => {
      prompt += `- ${obj.Name} (${obj.ClassName}) at ${obj.Path}\n`;
      
      // Add current properties if available
      if (obj.CurrentProperties && Object.keys(obj.CurrentProperties).length > 0) {
        prompt += `  Current properties:\n`;
        for (const [prop, value] of Object.entries(obj.CurrentProperties)) {
          prompt += `  - ${prop}: ${value}\n`;
        }
      }
    });
    prompt += `\n`;
  }

  // Add last created object info
  if (optimizedContext.lastCreated) {
    prompt += `## RECENTLY CREATED\n`;
    prompt += `- ${optimizedContext.lastCreated.name} (${optimizedContext.lastCreated.className}) at ${optimizedContext.lastCreated.path}\n`;
    prompt += `- Created ${optimizedContext.lastCreated.createdSecondsAgo} seconds ago\n`;
    prompt += `- When user says "it", "that", or "the ${optimizedContext.lastCreated.className.toLowerCase()}", they mean this object\n\n`;
  }

  // Add recent changes
  if (optimizedContext.recentChanges?.length > 0) {
    prompt += `## RECENT CHANGES\n`;
    optimizedContext.recentChanges.forEach(change => {
      prompt += `- ${change.name} (${change.type}): ${change.description || 'Created'}\n`;
    });
    prompt += `\n`;
  }

  // Add recent scripts for reference
  if (optimizedContext.recentScripts?.length > 0) {
    prompt += `## EXISTING SCRIPTS (for reference)\n`;
    optimizedContext.recentScripts.forEach(script => {
      prompt += `- ${script.name} (${script.type}) at ${script.path}\n`;
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
  prompt += `Analyze the request and context deeply. Provide a clear, actionable plan that follows Roblox best practices.\n`;
  prompt += `Remember: UI must be created by LocalScripts, not directly as instances!\n\n`;
  prompt += `Respond ONLY with valid JSON matching the required format.`;

  return prompt;
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
