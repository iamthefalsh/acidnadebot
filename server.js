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

// Define initSession BEFORE any functions that use it
function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      createdInstances: [],      // Instances created in this session
      modifiedInstances: [],     // Instances modified in this session
      mentionedInstances: [],    // Instances mentioned in chat
      chatHistory: [],           // Conversation history
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

const SYSTEM_PROMPT = `You are Acidnade AI, an expert Roblox Studio AI assistant.

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
## NEW RESPONSE FORMAT (STRICT JSON ONLY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "message": "One sentence summary of what will be done",
  "thinkingSteps": [
    "planning: Planning completed successfully",
    "reading: Reading ReplicatedFirst/Acidnade/Main",
    "working: Created Script at ReplicatedStorage/AIKnowledge",
    "complete: Task completed successfully"
  ],
  "plan": [STEPS],
  "needsApproval": false,
  "reasoning": "Why this approach was chosen"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## THINKING STEPS FORMAT (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST include "thinkingSteps" array with these state formats:

1. PLANNING: Analysis and planning phase
   Format: "planning: [description]"
   Examples: 
   - "planning: Planning completed successfully"
   - "planning: Analyzing CurrencyManager structure"
   - "planning: Planning the modifications"

2. READING: Reading files, docs, or existing code
   Format: "reading: [description]"
   Examples:
   - "reading: Reading ReplicatedFirst/Acidnade/Main"
   - "reading: Searched Roblox docs: 'ModuleScript dependency injection project structure best practices'"
   - "reading: Reading existing CurrencyManager script"

3. WORKING: Creating, modifying, or editing
   Format: "working: [action] [location]"
   Examples:
   - "working: Created Script at ReplicatedStorage/AIKnowledge"
   - "working: Created Folder at ReplicatedStorage/Shared"
   - "working: Created Script at ReplicatedStorage/Shared/ModuleLoader"
   - "working: Created Script at ReplicatedStorage/Shared/WeatherSovereign"
   - "working: Edited Script at ReplicatedFirst/Acidnade/Main"

4. TESTING: Running tests or validations
   Format: "testing: [description]"
   Examples:
   - "testing: Agent testing game (10s duration)"
   - "testing: Validating script changes"

5. COMPLETE: Final state, success or completion
   Format: "complete: [description]"
   Examples:
   - "complete: Tests passed: 1 test successful"
   - "complete: Task completed successfully"
   - "complete: Modification successful"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. CONTEXT AWARENESS (CRITICAL)
You MUST remember instances created in this chat session.
When user refers to "my", "the", "it", "that" instance, you MUST:
1. Check SESSION HISTORY for previously created/modified instances
2. Use exact names from session history
3. NEVER invent names - use what exists in session

### 2. INSTANCE REFERENCE RULES
User says "my health bar" → Look for HealthBar in session
User says "that part" → Last created/modified Part
User says "the script" → Last created/modified Script

### 3. MODIFICATION RULES
When modifying existing instances:
1. FIRST check if instance exists in session history
2. Use exact name and path from session
3. If not found, check "existingInstances" in context
4. If still not found, ask for clarification

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## STEP TYPES & FORMATS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. CREATE (New instances):
{
  "type": "create",
  "description": "What this creates",
  "className": "Part|Script|LocalScript|Model|Tool|Sound|etc",
  "name": "UniqueName",
  "parentPath": "game.Workspace|game.ServerScriptService|etc",
  "properties": {
    "Color": "255, 0, 0",
    "Size": "10, 5, 10",
    "Source": "-- Full Lua code here"
  }
}

### 2. MODIFY (Change existing instances):
{
  "type": "modify",
  "description": "What changes",
  "name": "EXACT_NAME_FROM_SESSION",  // <-- CRITICAL: Must match existing name
  "parentPath": "EXACT_PATH_FROM_SESSION",  // <-- CRITICAL: Must match existing path
  "properties": {
    "Color": "0, 255, 0"
  },
  "sourceModifications": {
    "action": "replace|append|prepend|insertAfter|insertBefore|remove|replaceAll",
    "target": "-- line to find",
    "newCode": "-- new code to insert"
  }
}

### 3. DELETE:
{
  "type": "delete",
  "description": "What deletes",
  "name": "EXACT_NAME_FROM_SESSION",
  "parentPath": "EXACT_PATH_FROM_SESSION"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONTEXT AWARENESS SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You will receive SESSION HISTORY containing:
- All instances created in this chat
- All instances modified in this chat
- All instances mentioned in this chat

SESSION HISTORY FORMAT:
[
  {
    "name": "HealthBarHandler",
    "className": "LocalScript",
    "path": "game.StarterPlayer.StarterPlayerScripts",
    "action": "created|modified",
    "timestamp": "when it happened"
  },
  {
    "name": "KillBrick",
    "className": "Part", 
    "path": "game.Workspace",
    "action": "created",
    "timestamp": "when it happened"
  }
]

RULES:
1. ALWAYS check SESSION HISTORY before creating new instances
2. When user says "update my health bar" → Look for HealthBar* in session
3. Use EXACT names and paths from session
4. If multiple matches, use the most recent one

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## INTELLIGENT SCRIPT PLACEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### SINGLE INSTANCE
→ Script inside the object (self-contained)
→ Example: Killbrick with Script child

### MULTIPLE INSTANCES
→ Handler in ServerScriptService
→ Uses CollectionService or GetDescendants

### UI SYSTEMS
→ LocalScript in StarterPlayer.StarterPlayerScripts
→ UI created at runtime with Instance.new

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## SIMPLE CONVERSATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If user says "Hello", "Hi", or just casual conversation:
{
  "message": "Hello! I'm Acidnade AI, your Roblox Studio assistant. How can I help you build today?",
  "thinkingSteps": [],
  "plan": [],
  "needsApproval": false,
  "reasoning": "Simple greeting response"
}

If user asks for help or what you can do:
{
  "message": "I can create parts, scripts, models, tools, sounds, lights, UI, and modify existing instances! Try asking me to create something.",
  "thinkingSteps": [],
  "plan": [],
  "needsApproval": false,
  "reasoning": "Help response"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MENTION SYSTEM SUPPORT (@)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The user can type '@' to mention existing instances. The system shows ALL instance types:
- Script, LocalScript, ModuleScript (all locations)
- Parts, Models, Tools, Sounds, Lights
- UI elements, Folders, Values

IMPORTANT FOR MODIFICATIONS:
1. When user mentions an instance with '@', use that EXACT name
2. Don't add prefixes/suffixes to mentioned names
3. Search in ALL services, not just common ones

EXAMPLE:
User types: "modify @CurrencyManager"
→ Look for ANY instance named "CurrencyManager" in the entire game
→ Common locations: ServerScriptService, ServerStorage, Workspace
→ Use the found instance's exact path

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EFFICIENT SCRIPT MODIFICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### QUICK MODIFICATION RULES:
1. Use "replaceAll" for COMPLETE rewrites
2. Use "append" for adding NEW functions to end
3. Use "insertAfter/insertBefore" for SPECIFIC line changes
4. Keep modifications SMALL and FOCUSED
5. Always include line breaks (\n)

### SPEED OPTIMIZATIONS:
1. Modify scripts INSTANTLY without delays
2. Use direct source replacement when possible
3. For small changes, use targeted modifications
4. NEVER wait or add artificial delays

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PROPERTY FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Colors: "255, 0, 0" or "red"
Vectors: "10, 5, 10"
Enums: "Neon" (no Enum. prefix)
Booleans: true/false

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXAMPLES WITH THINKING STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Example 1: Simple Greeting
User: "Hello"
{
  "message": "Hello! I'm Acidnade AI, ready to help you build in Roblox Studio!",
  "thinkingSteps": [],
  "plan": [],
  "needsApproval": false,
  "reasoning": "Greeting response"
}

### Example 2: Creating a Part
User: "Create a red brick"
{
  "message": "Creating a red brick in Workspace",
  "thinkingSteps": [
    "planning: Planning completed successfully",
    "working: Created Part at game.Workspace",
    "complete: Red brick created successfully"
  ],
  "plan": [
    {
      "type": "create",
      "description": "Red brick",
      "className": "Part",
      "name": "RedBrick",
      "parentPath": "game.Workspace",
      "properties": {
        "Color": "255, 0, 0",
        "Size": "4, 1.2, 2",
        "Material": "Brick"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Simple part creation"
}

### Example 3: Modifying CurrencyManager
User: "Fix the currency spawning logic in CurrencyManager"

{
  "message": "Fixing currency spawning logic in CurrencyManager",
  "thinkingSteps": [
    "planning: Planning completed successfully",
    "reading: Searched Roblox docs: 'ModuleScript dependency injection project structure best practices'",
    "reading: Reading ReplicatedFirst/Acidnade/Main",
    "working: Created Script at ReplicatedStorage/AIKnowledge",
    "reading: Reading ReplicatedFirst/Acidnade/Main",
    "working: Created Folder at ReplicatedStorage/Shared",
    "working: Created Script at ReplicatedStorage/Shared/ModuleLoader",
    "working: Created Script at ReplicatedStorage/Shared/WeatherSovereign",
    "working: Edited Script at ReplicatedFirst/Acidnade/Main",
    "testing: Agent testing game (10s duration)",
    "complete: Tests passed: 1 test successful"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Fix currency spawning logic in CurrencyManager",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "replaceAll",
        "newCode": "-- Fixed CurrencyManager script\nlocal CurrencyManager = {}\n\nfunction CurrencyManager.spawnGold()\n  -- Fixed gold spawning logic\n  local gold = Instance.new('Part')\n  gold.Name = 'Gold'\n  gold.Parent = workspace\n  gold.Position = Vector3.new(0, 10, 0)\nend\n\nreturn CurrencyManager"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Complete rewrite of CurrencyManager to fix spawning logic"
}

### Example 4: Modifying Existing Part
Session History: [{"name": "RedBrick", "className": "Part", "path": "game.Workspace", "action": "created"}]

User: "make it spin"
{
  "message": "Adding spin script to RedBrick",
  "thinkingSteps": [
    "planning: Planning the spin modification for RedBrick",
    "reading: Reading the existing RedBrick properties",
    "working: Adding spin script to RedBrick",
    "complete: Spin script added successfully"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Add spin to RedBrick",
      "name": "RedBrick",
      "parentPath": "game.Workspace",
      "sourceModifications": {
        "action": "append",
        "target": "",
        "newCode": "local spin = Instance.new('Script')\\nspin.Parent = script.Parent\\nspin.Source = [[while true do\\n  script.Parent.CFrame = script.Parent.CFrame * CFrame.Angles(0, math.rad(2), 0)\\n  wait(0.03)\\nend]]"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Modified existing RedBrick from session history"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CRITICAL RULES - ENHANCED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ALWAYS include "thinkingSteps" array with planning, reading, working, testing, complete
2. ALWAYS check SESSION HISTORY first
3. Use EXACT names and paths from session
4. Message = one sentence summary
5. For modifications, use sourceModifications for scripts
6. UI = LocalScript creating UI at runtime
7. Never assume - check session first
8. For greetings: return empty thinkingSteps and plan with friendly message

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PERFORMANCE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### FAST EXECUTION:
- Complete modifications in under 5 seconds
- Use "replaceAll" for complete script rewrites
- Keep property changes minimal
- Batch modifications in single steps when possible

### INSTANCE LOCATION:
- Scripts: ServerScriptService, ReplicatedStorage, StarterPack
- LocalScripts: StarterPlayerScripts, StarterGui, Workspace
- Models/Parts: Workspace
- Tools: StarterPack
- Sounds: SoundService, Workspace
- Lights: Lighting, Workspace

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BE PRECISE. USE THINKING STEPS. BUILD ROBLOX. EXECUTE FAST.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

// Update session with new instances
function updateSession(sessionId, plan, userPrompt) {
  const session = sessionMemory.get(sessionId);
  if (!session) return;
  
  const timestamp = new Date().toISOString();
  
  // Track created instances
  if (plan && Array.isArray(plan)) {
    plan.filter(step => step && step.type === 'create').forEach(step => {
      const existing = session.createdInstances.find(i => 
        i.name === step.name && i.parentPath === step.parentPath
      );
      
      if (!existing) {
        session.createdInstances.push({
          name: step.name,
          className: step.className,
          path: step.parentPath,
          action: 'created',
          timestamp,
          properties: step.properties
        });
      }
    });
    
    // Track modified instances
    plan.filter(step => step && step.type === 'modify').forEach(step => {
      const existing = session.modifiedInstances.find(i => 
        i.name === step.name && i.path === step.parentPath
      );
      
      if (!existing) {
        session.modifiedInstances.push({
          name: step.name,
          className: step.className || 'Unknown',
          path: step.parentPath,
          action: 'modified',
          timestamp,
          changes: step.properties,
          sourceModifications: step.sourceModifications
        });
      }
    });
  }
  
  // Update chat history
  session.chatHistory.push({
    role: 'user',
    content: userPrompt,
    timestamp
  });
  
  // Keep only last 20 items
  session.createdInstances = session.createdInstances.slice(-20);
  session.modifiedInstances = session.modifiedInstances.slice(-20);
  session.mentionedInstances = session.mentionedInstances.slice(-20);
  session.chatHistory = session.chatHistory.slice(-20);
}

// Build session context for AI
function buildSessionContext(session) {
  const context = [];
  
  if (session.createdInstances && session.createdInstances.length > 0) {
    context.push('CREATED IN THIS SESSION:');
    session.createdInstances.forEach(inst => {
      if (inst && inst.name) {
        context.push(`- ${inst.name} (${inst.className || 'Unknown'}) at ${inst.path || 'Unknown'} [${inst.action || 'created'}]`);
      }
    });
    context.push('');
  }
  
  if (session.modifiedInstances && session.modifiedInstances.length > 0) {
    context.push('MODIFIED IN THIS SESSION:');
    session.modifiedInstances.forEach(inst => {
      if (inst && inst.name) {
        context.push(`- ${inst.name} at ${inst.path || 'Unknown'} [${inst.action || 'modified'}]`);
      }
    });
    context.push('');
  }
  
  if (session.chatHistory && session.chatHistory.length > 0) {
    context.push('RECENT CHAT:');
    session.chatHistory.slice(-3).forEach(msg => {
      if (msg && msg.content) {
        const prefix = msg.role === 'user' ? 'U' : 'A';
        context.push(`${prefix}: ${msg.content.substring(0, 80)}${msg.content.length > 80 ? '...' : ''}`);
      }
    });
    context.push('');
  }
  
  return context.join('\n');
}

// Smart instance matching with null safety
function findInstanceInContext(userPrompt, session, existingInstances) {
  if (!userPrompt) return [];
  
  const promptLower = userPrompt.toLowerCase();
  const matches = [];
  
  // Keywords that might refer to instances
  const keywords = promptLower.match(/\b(\w+)\b/g) || [];
  
  // Search in session first
  const allSessionInstances = [];
  if (session) {
    if (session.createdInstances) allSessionInstances.push(...session.createdInstances);
    if (session.modifiedInstances) allSessionInstances.push(...session.modifiedInstances);
  }
  
  allSessionInstances.forEach(inst => {
    if (!inst || !inst.name) return;
    
    const nameLower = inst.name.toLowerCase();
    const classNameLower = (inst.className || '').toLowerCase();
    
    // Check if any keyword matches
    keywords.forEach(keyword => {
      if (nameLower.includes(keyword) || classNameLower.includes(keyword)) {
        matches.push({
          source: 'session',
          name: inst.name,
          className: inst.className || 'Unknown',
          path: inst.path || 'Unknown',
          score: (nameLower.includes(keyword) ? 2 : 0) + (classNameLower.includes(keyword) ? 1 : 0)
        });
      }
    });
  });
  
  // Search in existing instances
  (existingInstances || []).forEach(inst => {
    if (!inst || typeof inst !== 'object') return;
    
    const nameLower = (inst.Name || '').toLowerCase();
    const classNameLower = (inst.ClassName || '').toLowerCase();
    
    keywords.forEach(keyword => {
      if (nameLower.includes(keyword) || classNameLower.includes(keyword)) {
        matches.push({
          source: 'project',
          name: inst.Name || 'Unknown',
          className: inst.ClassName || 'Unknown',
          path: inst.Path || 'Unknown',
          score: (nameLower.includes(keyword) ? 2 : 0) + (classNameLower.includes(keyword) ? 1 : 0)
        });
      }
    });
  });
  
  // Sort by score and return unique
  const uniqueMatches = [];
  const seen = new Set();
  
  matches
    .sort((a, b) => b.score - a.score)
    .forEach(match => {
      const key = `${match.name}|${match.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMatches.push(match);
      }
    });
  
  return uniqueMatches.slice(0, 10);
}

function buildPrompt(userPrompt, context, sessionId) {
  const session = initSession(sessionId);
  const sessionContext = buildSessionContext(session);
  
  // Find potential instance matches
  const instanceMatches = findInstanceInContext(
    userPrompt, 
    session, 
    (context && context.existingInstances) ? context.existingInstances : []
  );
  
  let prompt = 'USER REQUEST: ' + userPrompt + '\n\n';
  
  // Add session context
  if (sessionContext) {
    prompt += 'SESSION CONTEXT (MOST IMPORTANT - USE THESE NAMES):\n';
    prompt += sessionContext + '\n';
  }
  
  // Add matched instances
  if (instanceMatches.length > 0) {
    prompt += 'MATCHING INSTANCES FOUND:\n';
    instanceMatches.forEach((match, i) => {
      prompt += `${i + 1}. ${match.name} (${match.className}) at ${match.path} [from ${match.source}]\n`;
    });
    prompt += '\n';
  }
  
  // Add selected objects with null safety
  if (context && context.selectedObjects && Array.isArray(context.selectedObjects) && context.selectedObjects.length > 0) {
    prompt += 'SELECTED OBJECTS:\n';
    const validObjects = context.selectedObjects.filter(obj => obj && typeof obj === 'object');
    validObjects.forEach(obj => {
      prompt += `- ${obj.Name || 'Unknown'} (${obj.ClassName || 'Unknown'}) at ${obj.Path || 'Unknown'}\n`;
    });
    prompt += '\n';
  }
  
  // Add existing instances with null safety
  if (context && context.existingInstances && Array.isArray(context.existingInstances) && context.existingInstances.length > 0) {
    prompt += 'PROJECT INSTANCES (search if not in session):\n';
    const validInstances = context.existingInstances.filter(inst => inst && typeof inst === 'object');
    
    // Show instances similar to request
    const relevantInstances = validInstances.filter(inst => {
      if (!inst || !inst.Name) return false;
      const nameLower = (inst.Name || '').toLowerCase();
      const promptLower = userPrompt.toLowerCase();
      return promptLower.split(/\s+/).some(word => 
        word.length > 3 && nameLower.includes(word)
      );
    });
    
    if (relevantInstances.length > 0) {
      relevantInstances.slice(0, 10).forEach(inst => {
        prompt += `- ${inst.Name || 'Unknown'} (${inst.ClassName || 'Unknown'}) at ${inst.Path || 'Unknown'}\n`;
      });
    } else {
      // Show some random instances
      validInstances.slice(0, 5).forEach(inst => {
        prompt += `- ${inst.Name || 'Unknown'} (${inst.ClassName || 'Unknown'}) at ${inst.Path || 'Unknown'}\n`;
      });
    }
    prompt += '\n';
  }
  
  // SPECIAL CASE: Simple greetings/questions
  const lowerPrompt = userPrompt.toLowerCase();
  const isGreeting = ['hello', 'hi', 'hey', 'greetings'].some(word => lowerPrompt.includes(word));
  const isHelp = ['help', 'what can you do', 'how do i', 'can you'].some(phrase => lowerPrompt.includes(phrase));
  
  prompt += 'INSTRUCTIONS:\n';
  
  if (isGreeting || isHelp) {
    prompt += '1. This is a simple greeting or help request\n';
    prompt += '2. Respond with a friendly message\n';
    prompt += '3. Return empty thinkingSteps and plan arrays\n';
    prompt += '4. Keep it helpful and encouraging\n';
  } else {
    prompt += '1. ALWAYS include "thinkingSteps" array with planning, reading, working, testing, complete\n';
    prompt += '2. Use format: "state: description" for thinking steps\n';
    prompt += '3. FIRST check SESSION CONTEXT for instance names\n';
    prompt += '4. Use EXACT names and paths from session\n';
    prompt += '5. If modifying, use sourceModifications for scripts\n';
    prompt += '6. Message = one sentence summary\n';
    prompt += '7. Respond in JSON format only\n';
  }
  
  return prompt;
}

async function processAIRequest(prompt, context, sessionId) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
      systemInstruction: SYSTEM_PROMPT
    });

    const fullPrompt = buildPrompt(prompt, context || {}, sessionId);
    console.log('[AI] Prompt length:', fullPrompt.length);
    
    const startTime = Date.now();
    const result = await model.generateContent(fullPrompt);
    const thinkingTime = Date.now() - startTime;
    
    const text = result.response.text();
    let aiResponse;
    
    try {
      const cleanedText = text.replace(/```json\n?|\n?```/g, '').trim();
      aiResponse = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('[AI] Parse error:', parseError.message);
      console.error('[AI] Raw text:', text.substring(0, 500));
      aiResponse = {
        message: 'Working on it',
        thinkingSteps: [],
        plan: [],
        needsApproval: false,
        reasoning: 'Failed to parse response'
      };
    }

    // Validate response
    if (!aiResponse.message) aiResponse.message = 'Done';
    if (!aiResponse.thinkingSteps) aiResponse.thinkingSteps = [];
    if (!aiResponse.plan) aiResponse.plan = [];
    if (!aiResponse.reasoning) aiResponse.reasoning = 'Based on session context';
    
    // Auto-approve settings
    const hasDestructiveAction = aiResponse.plan.some(step => step && step.type === 'delete');
    const hasManySteps = aiResponse.plan.length >= 3;
    aiResponse.needsApproval = hasDestructiveAction || hasManySteps;

    // Update session memory
    updateSession(sessionId, aiResponse.plan, prompt);
    
    aiResponse.metadata = {
      thinkingTime,
      model: 'gemini-3-flash-preview',
      sessionId,
      timestamp: new Date().toISOString(),
      planSize: aiResponse.plan.length,
      thinkingStepsSize: aiResponse.thinkingSteps.length,
      sessionInstances: sessionMemory.get(sessionId)?.createdInstances?.length || 0
    };

    console.log(`[AI] ${aiResponse.thinkingSteps.length} thinking steps, ${aiResponse.plan.length} plan steps`);
    return aiResponse;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      message: 'Error processing request',
      thinkingSteps: [],
      plan: [],
      needsApproval: false,
      reasoning: 'Internal server error',
      error: true
    };
  }
}

app.get('/', (req, res) => {
  res.json({
    name: 'Acidnade AI',
    version: '2.5',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Session memory',
      'Thinking steps system',
      'State bubbles in UI',
      'Context-aware instance tracking',
      'Persistent chat history'
    ],
    sessions: sessionMemory.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/ping', (req, res) => {
  res.json({ 
    status: 'ok', 
    model: 'gemini-3-flash-preview',
    uptime: process.uptime(),
    sessions: sessionMemory.size
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
    createdInstances: session.createdInstances || [],
    modifiedInstances: session.modifiedInstances || [],
    chatHistory: session.chatHistory || [],
    timestamp: new Date(session.timestamp || Date.now()).toISOString()
  });
});

app.delete('/session/:sessionId', authenticateRequest, (req, res) => {
  const sessionId = req.params.sessionId;
  const deleted = sessionMemory.delete(sessionId);
  
  res.json({
    success: deleted,
    message: deleted ? 'Session cleared' : 'Session not found'
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
    
    // Initialize session if needed
    initSession(sessionId);
    
    const aiResponse = await processAIRequest(prompt, context || {}, sessionId);
    res.json(aiResponse);
    
  } catch (error) {
    console.error('[Server Error]:', error.message);
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

// Clean up old sessions periodically (optional)
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - (session.timestamp || now) > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

app.use((err, req, res, next) => {
  console.error('[Middleware Error]:', err.message);
  res.status(500).json({ 
    error: 'Internal error',
    thinkingSteps: [],
    plan: [],
    needsApproval: false
  });
});

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'Route does not exist'
  });
});

app.listen(PORT, () => {
  console.log('==========================================');
  console.log('ACIDNADE AI v2.5 - THINKING STEPS SYSTEM');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Features:');
  console.log('  • Thinking steps: planning, reading, working, testing, complete');
  console.log('  • State bubbles in UI with colored indicators');
  console.log('  • Enhanced session memory');
  console.log('  • Fixed nil errors in instance tracking');
  console.log('  • Improved modification system');
  console.log('==========================================');
  console.log('Server ready at http://localhost:' + PORT);
  console.log('==========================================');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, saving sessions...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, saving sessions...');
  process.exit(0);
});
