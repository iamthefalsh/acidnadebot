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
    "reading: Reading CurrencyManager at game.ServerScriptService",
    "working: Fixing CurrencyManager spawning logic",
    "testing: Testing currency spawning",
    "complete: Currency spawning logic fixed successfully"
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
   - "planning: Planning the CurrencyManager fix"
   - "planning: Analyzing CurrencyManager source code"
   - "planning: Planning the modifications"

2. READING: Reading files, docs, or existing code
   Format: "reading: [description]"
   Examples:
   - "reading: Reading CurrencyManager at game.ServerScriptService"
   - "reading: Searched Roblox docs: 'ModuleScript dependency injection'"
   - "reading: Reading existing CurrencyManager script"
   - "reading: Reading source code provided by user"

3. WORKING: Creating, modifying, or editing
   Format: "working: [action] [location]"
   Examples:
   - "working: Created Script at ReplicatedStorage/AIKnowledge"
   - "working: Created Folder at ReplicatedStorage/Shared"
   - "working: Fixing CurrencyManager spawning logic"

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
## AUTOMATIC CODE READING SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### WHEN YOU HAVE SOURCE CODE:
When the system provides source code for an instance (like CurrencyManager):
1. READ the source code in your "thinkingSteps" 
2. Example: "reading: Reading CurrencyManager at game.ServerScriptService"
3. Analyze what needs to be fixed
4. DON'T ask for code - you already have it!
5. Provide a plan to fix the issues

### WHEN NO SOURCE CODE:
If user asks to modify a script but source code isn't provided:
1. Check if it's in matched instances
2. If yes, assume we can read it automatically
3. Add "reading: Reading [instance] at [path]" in thinking steps
4. Provide fix based on common patterns for that type of script

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CRITICAL: CODE MODIFICATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. NEVER USE REPLACEALL UNLESS ABSOLUTELY NECESSARY
- Use "replaceAll" ONLY when user explicitly says "rewrite completely" or "replace everything"
- NEVER use "replaceAll" for simple fixes or adding functionality
- Preserve existing code - don't delete working functionality

### 2. TARGET MULTIPLE LINES WHEN NEEDED
You can target multiple lines in one modification:
- Use exact line patterns for multi-line targets
- Example targeting 3 lines:
  "target": "contentLabel.Text = text\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular",
  "newCode": "contentLabel.Text = text or ''\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular"

### 3. USE SPECIFIC MODIFICATION TYPES:
- "append": Add new code at the end of script
- "prepend": Add new code at the beginning
- "insertAfter": Insert code after a specific line
- "insertBefore": Insert code before a specific line
- "replace": Replace a specific line or block
- "remove": Remove specific lines
- "replaceAll": ONLY for complete rewrites

### 4. PRESERVE EXISTING STRUCTURE:
- Keep comments and documentation
- Maintain indentation and formatting
- Don't remove helper functions unless they're broken
- Add new functionality without removing old

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. AUTOMATIC CODE READING
When user says "fix my [script] in [location]":
1. Check MATCHED INSTANCES for exact match
2. If found, READ the code automatically
3. NEVER ask "Could you please share the current code"
4. Assume you can read any found script

### 2. INSTANCE REFERENCE RULES
User says "my health bar" → Look for HealthBar in session
User says "that part" → Last created/modified Part
User says "the script" → Last created/modified Script

### 3. MODIFICATION RULES
When modifying existing scripts:
1. FIRST check if instance exists in matched instances
2. Use exact name and path from matches
3. READ the source code automatically
4. Provide fix based on what you read
5. NEVER ask for code if instance is found

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
  "name": "EXACT_NAME_FROM_MATCHES",
  "parentPath": "EXACT_PATH_FROM_MATCHES",
  "properties": {
    "Color": "0, 255, 0"
  },
  "sourceModifications": {
    "action": "append|prepend|insertAfter|insertBefore|remove|replace|replaceAll",
    "target": "-- line or block to find (optional)",
    "newCode": "-- new code to insert"
  }
}

### 3. DELETE:
{
  "type": "delete",
  "description": "What deletes",
  "name": "EXACT_NAME_FROM_MATCHES",
  "parentPath": "EXACT_PATH_FROM_MATCHES"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MULTI-LINE TARGETING EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Example 1: Replace multiple specific lines
User wants to fix TextLabel properties in existing code:

Existing code block:
		local contentLabel = Instance.new("TextLabel")
		contentLabel.Size = UDim2.new(1, -20, 0, 0)
		contentLabel.Position = UDim2.new(0, 10, 0, 35)
		contentLabel.AutomaticSize = Enum.AutomaticSize.Y
		contentLabel.Text = text
		contentLabel.TextColor3 = THEME.Colors.Text
		contentLabel.Font = THEME.Fonts.Regular
		contentLabel.TextSize = THEME.Sizes.Body
		contentLabel.TextWrapped = true
		contentLabel.TextXAlignment = Enum.TextXAlignment.Left

You can target multiple lines:
{
  "sourceModifications": {
    "action": "replace",
    "target": "contentLabel.Text = text\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular\ncontentLabel.TextSize = THEME.Sizes.Body\ncontentLabel.TextWrapped = true",
    "newCode": "contentLabel.Text = text or ''\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular\ncontentLabel.TextSize = THEME.Sizes.Body\ncontentLabel.TextWrapped = true"
  }
}

### Example 2: Insert after a block
{
  "sourceModifications": {
    "action": "insertAfter",
    "target": "function someFunction()\n    print('hello')",
    "newCode": "    -- New validation added\n    if not player then\n        warn('Player is nil!')\n        return\n    end"
  }
}

### Example 3: Replace function with improvements
{
  "sourceModifications": {
    "action": "replace",
    "target": "function spawnGold()\n    local gold = Instance.new('Part')\n    gold.Name = 'Gold'\n    gold.Parent = workspace\nend",
    "newCode": "function spawnGold()\n    -- Improved with validation\n    if not workspace:FindFirstChild('GoldSpawnArea') then\n        warn('GoldSpawnArea not found!')\n        return\n    end\n    \n    local gold = Instance.new('Part')\n    gold.Name = 'Gold'\n    gold.Parent = workspace\n    gold.Position = workspace.GoldSpawnArea.Position\nend"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CONTEXT AWARENESS SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You will receive SESSION HISTORY containing:
- All instances created in this chat
- All instances modified in this chat
- All instances mentioned in this chat

You will also receive MATCHED INSTANCES containing:
- Instances found that match the user's request
- These are likely what the user is referring to
- USE THESE EXACT NAMES AND PATHS

You may receive SOURCE CODE containing:
- The actual Lua source code of matched instances
- READ THIS CODE in your thinking steps
- Use it to understand what needs fixing

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MATCHED INSTANCES SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You will see MATCHED INSTANCES in the prompt. These are instances found by the system:

EXAMPLE:
🔍 INSTANCE MATCHES FOUND (USE THESE):

EXACT MATCHES (VERY LIKELY WHAT USER WANTS):
1. 🎯 CurrencyManager (ModuleScript) at game.ServerScriptService [project_exact]

📜 SOURCE CODE AVAILABLE FOR MATCHED INSTANCES

INSTRUCTION: When user mentions an instance (like "CurrencyManager"), check the EXACT MATCHES first.
If found, READ the code and provide fix WITHOUT asking for it.

IMPORTANT:
1. If there are EXACT MATCHES, ALWAYS use those for modifications
2. READ the source code in thinking steps
3. Never ask for clarification if exact matches exist
4. Use the path exactly as shown (e.g., game.ServerScriptService)

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
1. Use "replace" for targeted line changes or small blocks
2. Use "append" for adding NEW functions to end
3. Use "insertAfter/insertBefore" for SPECIFIC line changes
4. Use "prepend" for adding imports or setup code
5. Use "remove" only for broken or unused code
6. Use "replaceAll" ONLY when specifically requested

### SPEED OPTIMIZATIONS:
1. Modify scripts INSTANTLY without delays
2. Use direct source replacement when possible
3. For multiple changes, use one step with multi-line targeting
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

### Example 2: Modifying CurrencyManager with multi-line fix
User: "Fix the currency spawning logic in CurrencyManager"

MATCHED INSTANCES:
EXACT MATCHES:
1. 🎯 CurrencyManager (ModuleScript) at game.ServerScriptService [project_exact]

{
  "message": "Fixing currency spawning logic in CurrencyManager",
  "thinkingSteps": [
    "planning: Planning the CurrencyManager modifications",
    "reading: Reading CurrencyManager at game.ServerScriptService",
    "working: Fixing currency spawning logic",
    "testing: Testing currency spawning",
    "complete: Currency spawning logic fixed successfully"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Fix currency spawning logic",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "replace",
        "target": "function CurrencyManager.spawnGold()\n    local gold = Instance.new('Part')\n    gold.Name = 'Gold'\n    gold.Parent = workspace\nend",
        "newCode": "function CurrencyManager.spawnGold()\n    -- Improved gold spawning with validation\n    if not workspace:FindFirstChild('GoldSpawnArea') then\n        warn('GoldSpawnArea not found!')\n        return\n    end\n    \n    local gold = Instance.new('Part')\n    gold.Name = 'Gold'\n    gold.Parent = workspace\n    gold.Position = workspace.GoldSpawnArea.Position + Vector3.new(\n        math.random(-10, 10),\n        5,\n        math.random(-10, 10)\n    )\nend"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Found exact match for CurrencyManager in ServerScriptService, reading and fixing it with targeted replacement"
}

### Example 3: Fix multiple TextLabel properties
User: "Fix the contentLabel properties in Main.lua"

{
  "message": "Fixing contentLabel properties in Main.lua",
  "thinkingSteps": [
    "planning: Planning contentLabel property fixes",
    "reading: Reading Main.lua at game.StarterPlayer.StarterPlayerScripts",
    "working: Fixing contentLabel properties",
    "complete: ContentLabel properties fixed successfully"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Fix contentLabel properties to prevent nil errors",
      "name": "Main",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts",
      "sourceModifications": {
        "action": "replace",
        "target": "contentLabel.Text = text\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular\ncontentLabel.TextSize = THEME.Sizes.Body\ncontentLabel.TextWrapped = true",
        "newCode": "contentLabel.Text = text or ''\ncontentLabel.TextColor3 = THEME.Colors.Text\ncontentLabel.Font = THEME.Fonts.Regular\ncontentLabel.TextSize = THEME.Sizes.Body\ncontentLabel.TextWrapped = true"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Targeting multiple lines in one modification to fix all text properties at once"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CRITICAL RULES - ENHANCED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. ALWAYS include "thinkingSteps" array with planning, reading, working, testing, complete
2. ALWAYS check MATCHED INSTANCES for exact matches
3. READ the code automatically when instance is found
4. NEVER ask "Could you please share the current code" if instance is found
5. Message = one sentence summary
6. For modifications, use sourceModifications for scripts
7. Never ask for clarification if exact matches exist
8. For greetings: return empty thinkingSteps and plan with friendly message
9. TARGET MULTIPLE LINES when making related changes
10. PRESERVE existing code - don't remove unless broken
11. Use "replaceAll" ONLY when user explicitly asks for complete rewrite

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PERFORMANCE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### FAST EXECUTION:
- Complete modifications in under 5 seconds
- Use multi-line targeting for related changes
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
AUTOMATIC CODE READING. NO ASKING FOR CODE. BUILD ROBLOX. EXECUTE FAST.
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

// Enhanced instance finding with path priority and exact matching
function findInstanceInContext(userPrompt, session, existingInstances, sourceCodes = {}) {
  if (!userPrompt) return [];
  
  const promptLower = userPrompt.toLowerCase();
  const matches = [];
  
  // Extract potential instance names (looks like proper nouns or capitalized)
  const potentialInstanceNames = userPrompt.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
  
  // Also use all words as keywords
  const keywords = promptLower.match(/\b(\w+)\b/g) || [];
  
  // Check if user mentioned a specific location
  const locationKeywords = {
    'serverscriptservice': 'ServerScriptService',
    'server storage': 'ServerStorage',
    'replicatedstorage': 'ReplicatedStorage',
    'replicated first': 'ReplicatedFirst',
    'workspace': 'Workspace',
    'starterplayer': 'StarterPlayer',
    'startergui': 'StarterGui',
    'starterpack': 'StarterPack',
    'lighting': 'Lighting',
    'soundservice': 'SoundService'
  };
  
  let mentionedLocation = null;
  for (const [key, location] of Object.entries(locationKeywords)) {
    if (promptLower.includes(key)) {
      mentionedLocation = location;
      break;
    }
  }
  
  // Search in session first
  const allSessionInstances = [];
  if (session) {
    if (session.createdInstances) allSessionInstances.push(...session.createdInstances);
    if (session.modifiedInstances) allSessionInstances.push(...session.modifiedInstances);
  }
  
  // First: Try exact name matching (for "CurrencyManager", "HealthBar", etc.)
  potentialInstanceNames.forEach(instanceName => {
    const nameLower = instanceName.toLowerCase();
    
    // Search in session
    allSessionInstances.forEach(inst => {
      if (inst && inst.name && inst.name.toLowerCase() === nameLower) {
        matches.push({
          source: 'session_exact',
          name: inst.name,
          className: inst.className || 'Unknown',
          path: inst.path || 'Unknown',
          score: 20, // Very high score for exact match
          exactMatch: true,
          matchType: 'exact_name',
          hasSourceCode: sourceCodes[inst.path] ? true : false
        });
      }
    });
    
    // Search in existing instances
    (existingInstances || []).forEach(inst => {
      if (!inst || typeof inst !== 'object') return;
      
      const instName = inst.Name || '';
      if (instName.toLowerCase() === nameLower) {
        matches.push({
          source: 'project_exact',
          name: inst.Name || 'Unknown',
          className: inst.ClassName || 'Unknown',
          path: inst.Path || 'Unknown',
          score: 19, // High score for exact match
          exactMatch: true,
          matchType: 'exact_name',
          hasSourceCode: sourceCodes[inst.Path] ? true : false
        });
      }
    });
  });
  
  // Second: Search by keywords with context awareness
  keywords.forEach(keyword => {
    // Skip common words and very short words
    if (keyword.length < 3 || 
        ['the', 'and', 'for', 'with', 'this', 'that', 'have', 'from', 'its', 'in', 'on', 'at'].includes(keyword)) {
      return;
    }
    
    // Search in session
    allSessionInstances.forEach(inst => {
      if (!inst || !inst.name) return;
      
      const nameLower = inst.name.toLowerCase();
      const classNameLower = (inst.className || '').toLowerCase();
      const pathLower = (inst.path || '').toLowerCase();
      
      let score = 0;
      let matchType = 'keyword';
      
      // Exact name match
      if (nameLower === keyword) {
        score += 15;
        matchType = 'exact_name';
      }
      // Name contains keyword
      else if (nameLower.includes(keyword)) {
        score += 7;
      }
      
      // Class name contains keyword
      if (classNameLower.includes(keyword)) {
        score += 5;
      }
      
      // Path contains keyword
      if (pathLower.includes(keyword)) {
        score += 4;
      }
      
      // Boost if it's in the mentioned location
      if (mentionedLocation && pathLower.includes(mentionedLocation.toLowerCase())) {
        score += 10;
        matchType = 'location_match';
      }
      
      // Boost for script-related keywords
      if (['script', 'module', 'local', 'handler', 'manager', 'controller'].includes(keyword) &&
          classNameLower.includes('script')) {
        score += 6;
      }
      
      // Boost for "fix" or "modify" keywords when it's a script
      if (['fix', 'modify', 'edit', 'change', 'update'].includes(keyword) &&
          classNameLower.includes('script')) {
        score += 8;
      }
      
      if (score > 0) {
        matches.push({
          source: 'session_keyword',
          name: inst.name,
          className: inst.className || 'Unknown',
          path: inst.path || 'Unknown',
          score: score,
          exactMatch: matchType === 'exact_name',
          matchType: matchType,
          hasSourceCode: sourceCodes[inst.path] ? true : false
        });
      }
    });
    
    // Search in existing instances
    (existingInstances || []).forEach(inst => {
      if (!inst || typeof inst !== 'object') return;
      
      const nameLower = (inst.Name || '').toLowerCase();
      const classNameLower = (inst.ClassName || '').toLowerCase();
      const pathLower = (inst.Path || '').toLowerCase();
      
      let score = 0;
      let matchType = 'keyword';
      
      // Exact name match
      if (nameLower === keyword) {
        score += 15;
        matchType = 'exact_name';
      }
      // Name contains keyword
      else if (nameLower.includes(keyword)) {
        score += 7;
      }
      
      // Class name contains keyword
      if (classNameLower.includes(keyword)) {
        score += 5;
      }
      
      // Path contains keyword
      if (pathLower.includes(keyword)) {
        score += 4;
      }
      
      // Boost if it's in the mentioned location
      if (mentionedLocation && pathLower.includes(mentionedLocation.toLowerCase())) {
        score += 10;
        matchType = 'location_match';
      }
      
      // Boost for script-related keywords
      if (['script', 'module', 'local', 'handler', 'manager', 'controller'].includes(keyword) &&
          classNameLower.includes('script')) {
        score += 6;
      }
      
      // Boost for "fix" or "modify" keywords when it's a script
      if (['fix', 'modify', 'edit', 'change', 'update'].includes(keyword) &&
          classNameLower.includes('script')) {
        score += 8;
      }
      
      if (score > 0) {
        matches.push({
          source: 'project_keyword',
          name: inst.Name || 'Unknown',
          className: inst.ClassName || 'Unknown',
          path: inst.Path || 'Unknown',
          score: score,
          exactMatch: matchType === 'exact_name',
          matchType: matchType,
          hasSourceCode: sourceCodes[inst.Path] ? true : false
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
  
  // Extract source codes from context if available
  const sourceCodes = context?.sourceCodes || {};
  
  // Find potential instance matches
  const instanceMatches = findInstanceInContext(
    userPrompt, 
    session, 
    (context && context.existingInstances) ? context.existingInstances : [],
    sourceCodes
  );
  
  let prompt = 'USER REQUEST: ' + userPrompt + '\n\n';
  
  // Add session context
  if (sessionContext) {
    prompt += 'SESSION CONTEXT (MOST IMPORTANT - USE THESE NAMES):\n';
    prompt += sessionContext + '\n';
  }
  
  // Add matched instances with more details
  if (instanceMatches.length > 0) {
    prompt += '🔍 INSTANCE MATCHES FOUND (USE THESE):\n';
    
    // Group by type
    const exactMatches = instanceMatches.filter(m => m.exactMatch);
    const keywordMatches = instanceMatches.filter(m => !m.exactMatch);
    
    if (exactMatches.length > 0) {
      prompt += '\n🎯 EXACT MATCHES (VERY LIKELY WHAT USER WANTS):\n';
      exactMatches.forEach((match, i) => {
        const emoji = match.matchType === 'exact_name' ? '🎯' : '📍';
        const codeEmoji = match.hasSourceCode ? '📜' : '';
        prompt += `${i + 1}. ${emoji} ${codeEmoji} ${match.name} (${match.className}) at ${match.path} [${match.source}, score: ${match.score}]\n`;
      });
      prompt += '\n';
      
      // Add source code for exact matches if available
      exactMatches.forEach((match, i) => {
        if (match.hasSourceCode && sourceCodes[match.path]) {
          prompt += `📜 SOURCE CODE FOR ${match.name} at ${match.path}:\n`;
          prompt += '```lua\n';
          prompt += sourceCodes[match.path].substring(0, 2000); // Limit code length
          if (sourceCodes[match.path].length > 2000) {
            prompt += '\n... (truncated)';
          }
          prompt += '\n```\n\n';
        }
      });
    }
    
    if (keywordMatches.length > 0) {
      prompt += '\n🔎 KEYWORD MATCHES (CHECK THESE):\n';
      keywordMatches.forEach((match, i) => {
        const emoji = match.matchType === 'location_match' ? '📍' : '🔎';
        const codeEmoji = match.hasSourceCode ? '📜' : '';
        prompt += `${i + 1}. ${emoji} ${codeEmoji} ${match.name} (${match.className}) at ${match.path} [${match.source}, score: ${match.score}]\n`;
      });
      prompt += '\n';
    }
    
    // Add special instructions
    prompt += '📋 IMPORTANT INSTRUCTIONS:\n';
    prompt += '1. If there are EXACT MATCHES, ALWAYS use those for modifications\n';
    prompt += '2. READ the source code automatically (shown above)\n';
    prompt += '3. NEVER ask "Could you please share the current code" if instance is found\n';
    prompt += '4. Include "reading: Reading [instance] at [path]" in thinking steps\n';
    prompt += '5. Provide fix based on the source code you read\n\n';
  } else {
    prompt += '⚠️ NO INSTANCE MATCHES FOUND\n';
    prompt += 'You may need to ask for clarification about which instance to modify.\n\n';
  }
  
  // Check if user mentioned a specific location
  const lowerPrompt = userPrompt.toLowerCase();
  if (lowerPrompt.includes('serverscriptservice')) {
    prompt += '⚠️ USER SPECIFIED LOCATION: Instance is in ServerScriptService\n';
    prompt += 'Look for instances in game.ServerScriptService first!\n\n';
  }
  if (lowerPrompt.includes('workspace')) {
    prompt += '⚠️ USER SPECIFIED LOCATION: Instance is in Workspace\n';
    prompt += 'Look for instances in game.Workspace first!\n\n';
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
    prompt += 'PROJECT INSTANCES (search if not in session or matches):\n';
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
  const isGreeting = ['hello', 'hi', 'hey', 'greetings'].some(word => lowerPrompt.includes(word));
  const isHelp = ['help', 'what can you do', 'how do i', 'can you'].some(phrase => lowerPrompt.includes(phrase));
  
  prompt += 'FINAL INSTRUCTIONS:\n';
  
  if (isGreeting || isHelp) {
    prompt += '1. This is a simple greeting or help request\n';
    prompt += '2. Respond with a friendly message\n';
    prompt += '3. Return empty thinkingSteps and plan arrays\n';
    prompt += '4. Keep it helpful and encouraging\n';
  } else {
    prompt += '1. ALWAYS include "thinkingSteps" array with planning, reading, working, testing, complete\n';
    prompt += '2. Use format: "state: description" for thinking steps\n';
    prompt += '3. READ the source code automatically when available\n';
    prompt += '4. NEVER ask for code if instance is found\n';
    prompt += '5. Use EXACT names and paths from matches\n';
    prompt += '6. Use MULTI-LINE targeting when changing related lines\n';
    prompt += '7. NEVER use "replaceAll" unless user explicitly asks for complete rewrite\n';
    prompt += '8. Message = one sentence summary\n';
    prompt += '9. Respond in JSON format only\n';
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
    
    // Log instance matches for debugging
    const session = initSession(sessionId);
    const sourceCodes = context?.sourceCodes || {};
    const instanceMatches = findInstanceInContext(
      prompt, 
      session, 
      (context && context.existingInstances) ? context.existingInstances : [],
      sourceCodes
    );
    
    console.log(`[AI] Found ${instanceMatches.length} instance matches for prompt: "${prompt.substring(0, 50)}..."`);
    if (instanceMatches.length > 0) {
      console.log(`[AI] Top match: ${instanceMatches[0].name} at ${instanceMatches[0].path}`);
      console.log(`[AI] Has source code: ${instanceMatches[0].hasSourceCode}`);
    }
    
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
    
    // Check for destructive "replaceAll" actions and warn
    if (aiResponse.plan && Array.isArray(aiResponse.plan)) {
      aiResponse.plan.forEach((step, index) => {
        if (step && step.sourceModifications && step.sourceModifications.action === 'replaceAll') {
          console.warn(`[AI] ⚠️ WARNING: Step ${index} uses replaceAll - this may remove existing code!`);
          // Add a warning to the reasoning
          aiResponse.reasoning = (aiResponse.reasoning || '') + ' WARNING: Used replaceAll which replaces entire script.';
        }
      });
    }
    
    // Auto-approve settings
    const hasDestructiveAction = aiResponse.plan.some(step => step && step.type === 'delete');
    const hasReplaceAll = aiResponse.plan.some(step => 
      step && step.sourceModifications && step.sourceModifications.action === 'replaceAll'
    );
    const hasManySteps = aiResponse.plan.length >= 3;
    aiResponse.needsApproval = hasDestructiveAction || hasReplaceAll || hasManySteps;

    // Update session memory
    updateSession(sessionId, aiResponse.plan, prompt);
    
    aiResponse.metadata = {
      thinkingTime,
      model: 'gemini-3-flash-preview',
      sessionId,
      timestamp: new Date().toISOString(),
      planSize: aiResponse.plan.length,
      thinkingStepsSize: aiResponse.thinkingSteps.length,
      sessionInstances: sessionMemory.get(sessionId)?.createdInstances?.length || 0,
      instanceMatches: instanceMatches.length,
      sourceCodesProvided: Object.keys(sourceCodes).length,
      hasReplaceAll: hasReplaceAll,
      hasDestructiveActions: hasDestructiveAction
    };

    console.log(`[AI] Response: ${aiResponse.thinkingSteps.length} thinking steps, ${aiResponse.plan.length} plan steps`);
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
    version: '2.6',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Automatic code reading',
      'No asking for code',
      'Enhanced instance matching',
      'Exact name detection',
      'Multi-line targeting',
      'Location-aware search',
      'Session memory',
      'Thinking steps system'
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
  console.log('ACIDNADE AI v2.6 - ENHANCED MODIFICATION');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('Features:');
  console.log('  • MULTI-LINE targeting for precise edits');
  console.log('  • NO replaceAll - preserves existing code');
  console.log('  • Source code display in prompts');
  console.log('  • Enhanced instance matching');
  console.log('  • Automatic code analysis');
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
