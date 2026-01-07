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
  "message": "Descriptive summary of what will be accomplished (not just 'Done')",
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
## CRITICAL: AVOID REPLACEALL - USE TARGETED MODIFICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ⚠️ CRITICAL WARNING: NEVER USE "replaceAll" UNLESS ABSOLUTELY NECESSARY
- "replaceAll" DELETES ENTIRE SCRIPTS and REPLACES ALL CODE
- Users HATE this - they want PARTIAL changes, not complete rewrites
- ALWAYS prefer targeted modifications over complete replacements

### ✅ CORRECT APPROACH: Targeted Changes
1. FIRST try: "replace" for specific lines
2. SECOND try: "insertAfter" or "insertBefore" for adding code
3. THIRD try: "append" or "prepend" for end/beginning additions
4. LAST RESORT: "replaceAll" ONLY if script is completely broken/wrong

### ❌ FORBIDDEN:
- Never use "replaceAll" for small changes
- Never use "replaceAll" for bug fixes
- Never use "replaceAll" for feature additions
- Only use "replaceAll" if script has fundamental architectural issues

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## THINKING STEPS FORMAT (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST include "thinkingSteps" array with these state formats:

1. PLANNING: Analysis and planning phase
   Format: "planning: [description]"
   Examples: 
   - "planning: Analyzing the full user request"
   - "planning: Planning multi-step implementation"
   - "planning: Mapping all requirements from user prompt"

2. READING: Reading files, docs, or existing code
   Format: "reading: [description]"
   Examples:
   - "reading: Reading CurrencyManager at game.ServerScriptService"
   - "reading: Reading source code provided by user"

3. WORKING: Creating, modifying, or editing
   Format: "working: [action] [location]"
   Examples:
   - "working: Creating gold collection system"
   - "working: Modifying CurrencyManager for resource limits"

4. TESTING: Running tests or validations
   Format: "testing: [description]"
   Examples:
   - "testing: Validating resource collection system"

5. COMPLETE: Final state, success or completion
   Format: "complete: [description]"
   Examples:
   - "complete: All requirements implemented successfully"
   - "complete: Multi-step task completed as requested"

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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## MULTI-STEP REQUESTS HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### EXAMPLE: User says:
"make so there is a limit of how much gold and diamonds there can be at the plots, and also make them anchored, and in like them a PART, a square, with skull texture or sand also make so when you collect them, it adds to your lead-retart by leaderstats handler"

### YOU MUST:
1. Break down ALL requirements:
   - Resource limits for gold and diamonds
   - Make parts anchored
   - Create square parts with skull/sand texture
   - Collection system
   - Leaderstats integration

2. Create ONE comprehensive plan that addresses ALL points
3. Do NOT ask for clarification unless absolutely necessary
4. Do NOT break into multiple conversations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## RESPONSE QUALITY REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### FORBIDDEN RESPONSES:
- ❌ "Done" (alone)
- ❌ "Fixed"
- ❌ "Working on it"
- ❌ "Ok"
- ❌ "replaceAll" for minor changes

### REQUIRED RESPONSES:
- ✅ "Creating resource collection system with limits and leaderstats"
- ✅ "Implementing gold/diamond limits with anchored collection parts"
- ✅ "Building comprehensive resource management system"
- ✅ Always descriptive and specific

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CRITICAL: CODE MODIFICATION RULES - FIXED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 🎯 TARGETED MODIFICATIONS ONLY - NO REPLACEALL
You MUST use targeted, specific modifications instead of full replacements:

### 1. USE THESE IN ORDER OF PREFERENCE:
1. **"replace"** - Replace specific line(s) (BEST CHOICE)
   - Example: Fix a bug on line 15
   - Use for: Changing specific logic, fixing errors

2. **"insertAfter"** - Insert code after specific line
   - Example: Add new function after existing function
   - Use for: Adding features without breaking existing code

3. **"insertBefore"** - Insert code before specific line
   - Example: Add initialization code before main loop

4. **"append"** - Add code at the end of script
   - Example: Add new utility functions at bottom

5. **"prepend"** - Add code at the beginning
   - Example: Add new requires or constants

6. **"remove"** - Remove specific lines
   - Example: Remove deprecated code

7. **🚨 "replaceAll"** - ONLY as LAST RESORT
   - Use ONLY if: Script is completely wrong architecture
   - Use ONLY if: User explicitly asks for complete rewrite
   - Use ONLY if: No existing code is worth keeping

### 2. MULTI-LINE TARGETING EXAMPLES:
✅ GOOD - Replace specific function:
\`\`\`json
{
  "type": "modify",
  "sourceModifications": {
    "action": "replace",
    "target": "function collectResource(player, resourceType)\\n    local amount = 1\\n    addToLeaderstats(player, amount)\\nend",
    "newCode": "function collectResource(player, resourceType)\\n    local amount = 1\\n    -- Check resource limits before adding\\n    if canCollectMore(resourceType) then\\n        addToLeaderstats(player, amount)\\n    end\\nend"
  }
}
\`\`\`

✅ GOOD - Insert after specific line:
\`\`\`json
{
  "type": "modify",
  "sourceModifications": {
    "action": "insertAfter",
    "target": "function addToLeaderstats(player, amount)",
    "newCode": "\\n-- Check resource limits\\nlocal function canCollectMore(resourceType)\\n    local current = getResourceCount(resourceType)\\n    return current < MAX_RESOURCES[resourceType]\\nend"
  }
}
\`\`\`

### 3. ALWAYS SPECIFY EXACT TARGETS:
- Use exact line patterns
- Include line breaks exactly as in source code
- Copy-paste from provided source code when possible

### 4. REPLACEALL REQUIREMENTS:
To use "replaceAll" you MUST:
1. Have "reading: [script]" in thinking steps
2. Have analyzed the existing code
3. Determine it's fundamentally broken
4. Explain in reasoning why replaceAll is necessary
5. ALWAYS set "needsApproval": true for replaceAll

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## ABSOLUTE RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. READ ENTIRE PROMPTS
- Read EVERY WORD of the user's message
- Identify ALL requirements mentioned
- Do not focus on just keywords like "Fix", "Broken"
- Implement COMPLETE solutions

### 2. NO "DONE" RESPONSES
- Never respond with just "Done"
- Always provide descriptive summary in "message"
- Explain what was accomplished

### 3. NO REPLACEALL FOR MINOR CHANGES
- Use targeted modifications (replace, insertAfter, etc.)
- replaceAll ONLY for complete architectural rewrites
- Users want partial changes, not full rewrites

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

### 2. MODIFY (Change existing instances) - TARGETED ONLY:
{
  "type": "modify",
  "description": "What changes - be specific",
  "name": "EXACT_NAME_FROM_MATCHES",
  "parentPath": "EXACT_PATH_FROM_MATCHES",
  "properties": {
    "Color": "0, 255, 0"
  },
  "sourceModifications": {
    "action": "replace|insertAfter|insertBefore|append|prepend|remove",  // AVOID replaceAll
    "target": "-- exact line or block to find",  // REQUIRED for replace, insertAfter, insertBefore
    "newCode": "-- new code to insert"  // REQUIRED except for remove
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
## EXAMPLE: TARGETED MODIFICATION (GOOD)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### User Request:
"Fix the CurrencyManager so it limits gold to 100 per plot"

### ✅ CORRECT RESPONSE (Targeted):
{
  "message": "Adding resource limit of 100 gold per plot to CurrencyManager",
  "thinkingSteps": [
    "planning: Analyzing CurrencyManager for gold limit implementation",
    "reading: Reading CurrencyManager at game.ServerScriptService",
    "working: Modifying CurrencyManager to add gold limits",
    "testing: Testing gold limit functionality",
    "complete: Gold limit of 100 per plot implemented successfully"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Add gold limit constant to CurrencyManager",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "insertAfter",
        "target": "local MAX_GOLD = 1000  -- Old global limit",
        "newCode": "local MAX_GOLD_PER_PLOT = 100  -- New per-plot limit"
      }
    },
    {
      "type": "modify",
      "description": "Modify gold collection to check per-plot limit",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "replace",
        "target": "function addGold(player, plotId, amount)\\n    local current = getPlayerGold(player)\\n    if current + amount <= MAX_GOLD then\\n        setPlayerGold(player, current + amount)\\n        return true\\n    end\\n    return false\\nend",
        "newCode": "function addGold(player, plotId, amount)\\n    local current = getPlayerGold(player)\\n    local plotGold = getPlotGold(plotId)\\n    \\n    -- Check both player and plot limits\\n    if current + amount <= MAX_GOLD and plotGold + amount <= MAX_GOLD_PER_PLOT then\\n        setPlayerGold(player, current + amount)\\n        setPlotGold(plotId, plotGold + amount)\\n        return true\\n    end\\n    return false\\nend"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Used targeted modifications (insertAfter and replace) to add per-plot gold limit without rewriting entire script"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXAMPLE: REPLACEALL (BAD - AVOID)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ❌ BAD RESPONSE (Full replacement):
{
  "message": "Rewriting CurrencyManager with gold limits",
  "thinkingSteps": [...],
  "plan": [
    {
      "type": "modify",
      "description": "Rewrite CurrencyManager",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "replaceAll",  // ⚠️ BAD - DELETES ALL EXISTING CODE
        "newCode": "-- Entire new script here, old code GONE..."
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Fixed gold limits"
}

### WHY THIS IS BAD:
1. Deletes ALL existing CurrencyManager code
2. User loses any custom features they added
3. Breaks if script has other working features
4. User wanted LIMIT ADDED, not full rewrite

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## PERFORMANCE GUIDELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### COMPLETE IMPLEMENTATIONS:
- Handle multi-step requests in ONE response
- Create 5-10 plan steps if needed for complex requests
- Batch related modifications together
- No step limits - user wants complete solutions

### TARGETED MODIFICATION STRATEGY:
1. READ the existing source code first
2. IDENTIFY specific lines to change
3. USE exact line patterns from source
4. CHANGE only what's needed
5. KEEP existing working code

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NO REPLACEALL. TARGETED MODIFICATIONS ONLY. READ EXISTING CODE. PARTIAL CHANGES.
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
      
      // Add source code for exact matches if available WITH WARNING
      exactMatches.forEach((match, i) => {
        if (match.hasSourceCode && sourceCodes[match.path]) {
          prompt += `📜 SOURCE CODE FOR ${match.name} at ${match.path}:\n`;
          prompt += '```lua\n';
          prompt += sourceCodes[match.path].substring(0, 2000); // Limit code length
          if (sourceCodes[match.path].length > 2000) {
            prompt += '\n... (truncated)';
          }
          prompt += '\n```\n';
          prompt += '⚠️ ⚠️ ⚠️ CRITICAL: DO NOT USE "replaceAll" FOR THIS SCRIPT! ⚠️ ⚠️ ⚠️\n';
          prompt += 'Use targeted modifications like "replace", "insertAfter", or "insertBefore"\n';
          prompt += 'Example: Find the exact line(s) to change in the code above\n\n';
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
    prompt += '3. Use TARGETED modifications, NOT replaceAll\n';
    prompt += '4. Include "reading: Reading [instance] at [path]" in thinking steps\n';
    prompt += '5. Provide fix based on the source code you read\n';
    prompt += '6. 🚨 NEVER use "replaceAll" unless script is completely broken\n\n';
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
  
  // Check for problematic keywords
  const hasProblematicKeywords = ['done', 'fix', 'broken', 'ok', 'working on it', 'fixed'].some(word => 
    lowerPrompt.toLowerCase().includes(word)
  );
  
  if (isGreeting || isHelp) {
    prompt += '1. This is a simple greeting or help request\n';
    prompt += '2. Respond with a friendly, descriptive message\n';
    prompt += '3. Return empty thinkingSteps and plan arrays\n';
    prompt += '4. Keep it helpful and encouraging\n';
  } else {
    prompt += '1. READ THE ENTIRE USER PROMPT - process every requirement mentioned\n';
    prompt += '2. NEVER respond with just "Done", "Fixed", or "Ok" - use descriptive summaries\n';
    prompt += '3. Handle multi-part requests in ONE comprehensive response\n';
    prompt += '4. ALWAYS include "thinkingSteps" array with planning, reading, working, testing, complete\n';
    prompt += '5. Use format: "state: description" for thinking steps\n';
    prompt += '6. READ the source code automatically when available\n';
    prompt += '7. NEVER ask for code if instance is found\n';
    prompt += '8. 🚨 CRITICAL: DO NOT USE "replaceAll" UNLESS ABSOLUTELY NECESSARY\n';
    prompt += '9. Use "replace", "insertAfter", "insertBefore" for targeted changes\n';
    prompt += '10. Use EXACT names and paths from matches\n';
    prompt += '11. Use MULTI-LINE targeting when changing related lines\n';
    prompt += '12. Respond in JSON format only\n';
    prompt += '13. EVERY plan step MUST have a description field\n';
    prompt += '14. No artificial step limits - handle complex requests completely\n';
    
    if (hasProblematicKeywords) {
      prompt += '\n⚠️ WARNING: User mentioned problematic keywords. DO NOT just respond to keywords.\n';
      prompt += 'READ THE ENTIRE PROMPT and implement ALL requirements mentioned.\n';
    }
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
        message: 'Processing your request',
        thinkingSteps: [],
        plan: [],
        needsApproval: false,
        reasoning: 'Failed to parse response'
      };
    }

    // Validate response
    if (!aiResponse.message) aiResponse.message = 'Processing request';
    if (!aiResponse.thinkingSteps) aiResponse.thinkingSteps = [];
    if (!aiResponse.plan) aiResponse.plan = [];
    if (!aiResponse.reasoning) aiResponse.reasoning = 'Based on session context';
    
    // FIX: Prevent "Done" responses
    const badResponses = ['done', 'fixed', 'ok', 'working on it'];
    if (badResponses.includes(aiResponse.message.toLowerCase())) {
      console.warn('[AI] WARNING: AI returned a bad response:', aiResponse.message);
      aiResponse.message = 'Implementing your request';
    }
    
    // CRITICAL FIX: Validate and convert replaceAll to targeted modifications
    if (aiResponse.plan && Array.isArray(aiResponse.plan)) {
      aiResponse.plan.forEach((step, index) => {
        if (step && typeof step === 'object') {
          // Ensure required fields with better defaults
          if (!step.type) step.type = 'create';
          if (!step.description) {
            step.description = `${step.type} ${step.name || 'instance'} at ${step.parentPath || 'game.Workspace'}`;
          }
          if (!step.name) {
            step.name = `${step.type || 'Instance'}_${index + 1}`;
          }
          if (!step.parentPath) step.parentPath = 'game.Workspace';
          if (!step.className && step.type === 'create') {
            step.className = 'Part';
          }
          
          // Ensure description is never empty
          if (typeof step.description !== 'string' || step.description.trim() === '') {
            step.description = `${step.type || 'action'} ${step.name || 'instance'}`;
          }
          
          // 🚨 CRITICAL FIX: Check for replaceAll and warn/convert
          if (step.sourceModifications && step.sourceModifications.action === 'replaceAll') {
            console.warn(`[AI] ⚠️ CRITICAL WARNING: Step ${index} uses replaceAll!`);
            
            // If we have source code, try to suggest targeted changes
            if (sourceCodes[step.parentPath]) {
              console.warn('[AI] Source code available, replaceAll should be avoided!');
              
              // Add warning to reasoning
              aiResponse.reasoning = (aiResponse.reasoning || '') + 
                ' WARNING: Used replaceAll which replaces entire script. Consider using targeted modifications instead.';
              
              // Force approval for replaceAll
              step.needsSpecialApproval = true;
              step.replaceAllWarning = 'This will DELETE ALL existing code in the script and replace it entirely.';
            }
          }
          
          // Validate source modifications have required fields
          if (step.sourceModifications) {
            const action = step.sourceModifications.action;
            const needsTarget = ['replace', 'insertAfter', 'insertBefore'].includes(action);
            const needsNewCode = ['replace', 'insertAfter', 'insertBefore', 'append', 'prepend'].includes(action);
            
            if (needsTarget && !step.sourceModifications.target) {
              console.warn(`[AI] Step ${index} action "${action}" missing target field`);
              // Set a default or remove the step
            }
            
            if (needsNewCode && !step.sourceModifications.newCode) {
              console.warn(`[AI] Step ${index} action "${action}" missing newCode field`);
            }
          }
        } else {
          // Replace invalid step with a valid one
          aiResponse.plan[index] = {
            type: 'create',
            description: `Step ${index + 1}: Creating instance as requested`,
            name: `Instance_${index + 1}`,
            parentPath: 'game.Workspace',
            className: 'Part'
          };
        }
      });
    }
    
    // Check for destructive "replaceAll" actions and warn - ALWAYS require approval
    const hasReplaceAll = aiResponse.plan.some(step => 
      step && step.sourceModifications && step.sourceModifications.action === 'replaceAll'
    );
    
    if (hasReplaceAll) {
      console.warn('[AI] ⚠️ CRITICAL: Response contains replaceAll - requiring approval');
      // Add explicit warning to the response
      aiResponse.replaceAllWarning = 'This plan uses replaceAll which will DELETE ALL existing code and replace entire scripts. This is destructive.';
    }
    
    // Auto-approve settings - NO STEP LIMITS AS REQUESTED
    const hasDestructiveAction = aiResponse.plan.some(step => step && step.type === 'delete');
    const hasManySteps = false; // Always false now - no step limits
    
    // 🚨 ALWAYS require approval for replaceAll
    aiResponse.needsApproval = hasDestructiveAction || hasReplaceAll || hasManySteps;
    
    // Add progress text for approval dialog
    if (aiResponse.plan.length > 0) {
      aiResponse.progressText = `Steps: 0/${aiResponse.plan.length}`;
    }

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
      hasDestructiveActions: hasDestructiveAction,
      note: 'No step limits - handles complete requests. ReplaceAll requires approval.'
    };

    console.log(`[AI] Response: ${aiResponse.thinkingSteps.length} thinking steps, ${aiResponse.plan.length} plan steps`);
    console.log(`[AI] Message: "${aiResponse.message}"`);
    console.log(`[AI] Has replaceAll: ${hasReplaceAll}`);
    return aiResponse;

  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      message: 'Processing your request',
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
    version: '2.7',
    status: 'online',
    model: 'gemini-3-flash-preview',
    features: [
      'Full prompt processing',
      'No "Done" responses',
      'Complete multi-step implementations',
      'No artificial step limits',
      'Automatic code reading',
      'Enhanced instance matching',
      'Exact name detection',
      'Multi-line targeting',
      'Location-aware search',
      'Session memory',
      'Thinking steps system',
      '🚨 REPLACEALL FIX: Targeted modifications only',
      'Partial code changes instead of full rewrites'
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
  console.log('ACIDNADE AI v2.7 - TARGETED MODIFICATIONS');
  console.log('==========================================');
  console.log('Port:', PORT);
  console.log('Environment:', NODE_ENV);
  console.log('FIXES:');
  console.log('  • 🚨 NO replaceAll for minor changes');
  console.log('  • ✅ Targeted modifications only');
  console.log('  • Partial code changes instead of full rewrites');
  console.log('  • Use replace, insertAfter, insertBefore');
  console.log('  • Always require approval for replaceAll');
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
