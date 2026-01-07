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
      mentionedInstances: [],
      chatHistory: [],
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
  "message": "Descriptive summary of what will be accomplished",
  "thinkingSteps": [
    "planning: Planning completed successfully",
    "reading: Reading existing code at game.ServerScriptService",
    "working: Modifying specific parts of the code",
    "testing: Testing modifications",
    "complete: Modifications completed successfully"
  ],
  "plan": [STEPS],
  "needsApproval": false,
  "reasoning": "Why this approach was chosen"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CRITICAL FIX: USE TARGETED MODIFICATIONS, NOT REPLACEALL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ABSOLUTE RULE: NEVER USE replaceAll UNLESS ABSOLUTELY NECESSARY
1. ALWAYS use targeted modifications: append, prepend, insertAfter, insertBefore, replace, remove
2. ONLY use replaceAll if the user explicitly says "rewrite entire script" or similar
3. When modifying existing code, ONLY change the specific parts that need fixing
4. Preserve the rest of the code as-is

### PREFERRED MODIFICATION TYPES (in order of preference):
1. "append": Add new code to the end (for new features)
2. "prepend": Add new code to the beginning (for initialization)
3. "insertAfter": Insert code after specific lines (for adding functionality)
4. "insertBefore": Insert code before specific lines (for setup)
5. "replace": Replace specific lines or blocks (for fixing bugs)
6. "remove": Remove specific lines (for cleanup)
7. "replaceAll": ONLY as last resort for complete rewrites

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## HOW TO READ AND MODIFY CODE PROPERLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### WHEN YOU HAVE SOURCE CODE:
1. READ the entire source code carefully
2. IDENTIFY the specific lines that need changing
3. USE EXACT line matching for "target" field
4. ONLY modify what's necessary
5. PRESERVE existing structure and comments

### EXAMPLE OF GOOD MODIFICATION:
User says: "Add a function to check if player has enough gold"
Existing code has: function addGold(amount) ... end

GOOD RESPONSE:
{
  "type": "modify",
  "description": "Add function to check gold balance",
  "name": "CurrencyManager",
  "parentPath": "game.ServerScriptService",
  "sourceModifications": {
    "action": "insertAfter",
    "target": "function addGold(amount)",
    "newCode": "\\nfunction hasEnoughGold(player, amount)\\n    return playerGold[player] >= amount\\nend"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## THINKING STEPS FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST include "thinkingSteps" array:
1. planning: Analyzing the request and existing code
2. reading: Reading the source code to understand current implementation
3. working: Applying targeted modifications to specific parts
4. testing: Validating changes don't break existing functionality
5. complete: Targeted modifications completed successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## CODE MODIFICATION EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### EXAMPLE 1: Adding a new function (USE append or insertAfter)
Existing code ends with: "end" (last line)

{
  "sourceModifications": {
    "action": "append",
    "newCode": "\\nfunction newFunction()\\n    print('Hello')\\nend"
  }
}

### EXAMPLE 2: Fixing a specific line (USE replace)
Existing line: "gold = gold + 1"

{
  "sourceModifications": {
    "action": "replace",
    "target": "gold = gold + 1",
    "newCode": "gold = gold + amount"
  }
}

### EXAMPLE 3: Adding initialization (USE prepend)
Existing code starts with: "local gold = 0"

{
  "sourceModifications": {
    "action": "prepend", 
    "newCode": "-- Currency Manager Initialized\\n"
  }
}

### EXAMPLE 4: Inserting after a specific block (USE insertAfter)
Existing code has: "if player then" ... "end"

{
  "sourceModifications": {
    "action": "insertAfter",
    "target": "if player then",
    "newCode": "    -- Check if player exists\\n    if not player:IsDescendantOf(game.Players) then\\n        return\\n    end"
  }
}

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

### 2. MODIFY (Change existing instances - USE TARGETED MODIFICATIONS):
{
  "type": "modify",
  "description": "What specific part changes",
  "name": "EXACT_NAME_FROM_MATCHES",
  "parentPath": "EXACT_PATH_FROM_MATCHES",
  "properties": { ... },  // For non-script properties
  "sourceModifications": {
    "action": "append|prepend|insertAfter|insertBefore|remove|replace",  // AVOID replaceAll
    "target": "-- exact line or block to find",
    "newCode": "-- new code to insert/replace"
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
## ABSOLUTE RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### 1. TARGETED MODIFICATIONS ONLY
- NEVER use replaceAll for routine modifications
- ONLY modify the specific parts mentioned in the request
- PRESERVE existing code structure
- Use exact line matching for targets

### 2. WHEN TO USE EACH ACTION:
- append: Adding new functions/features at the end
- prepend: Adding initialization/imports at the beginning  
- insertAfter: Adding code after specific functions/lines
- insertBefore: Adding setup code before specific functions
- replace: Fixing bugs in specific lines
- remove: Removing unused/dead code
- replaceAll: ONLY if user says "rewrite from scratch"

### 3. CODE PRESERVATION:
- Keep all existing comments
- Maintain existing formatting style
- Don't change unrelated code
- Add comments for your changes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## EXAMPLE: MODIFYING CURRENCYMANAGER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### User Request:
"Add a function to check if player has enough gold in CurrencyManager"

### Existing Code (provided in context):
local CurrencyManager = {}
local playerGold = {}

function CurrencyManager.addGold(player, amount)
    playerGold[player] = (playerGold[player] or 0) + amount
end

function CurrencyManager.getGold(player)
    return playerGold[player] or 0
end

return CurrencyManager

### Correct Response:
{
  "message": "Adding hasEnoughGold function to CurrencyManager",
  "thinkingSteps": [
    "planning: Analyzing request to add gold checking function",
    "reading: Reading CurrencyManager source code structure",
    "working: Adding hasEnoughGold function after getGold",
    "testing: Validating new function doesn't break existing code",
    "complete: Function added successfully"
  ],
  "plan": [
    {
      "type": "modify",
      "description": "Add hasEnoughGold function to CurrencyManager",
      "name": "CurrencyManager",
      "parentPath": "game.ServerScriptService",
      "sourceModifications": {
        "action": "insertAfter",
        "target": "function CurrencyManager.getGold(player)",
        "newCode": "\\nfunction CurrencyManager.hasEnoughGold(player, amount)\\n    return (playerGold[player] or 0) >= amount\\nend"
      }
    }
  ],
  "needsApproval": false,
  "reasoning": "Using insertAfter to add new function while preserving existing code structure"
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## BAD EXAMPLE (WHAT TO AVOID)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ❌ BAD: Using replaceAll unnecessarily
{
  "sourceModifications": {
    "action": "replaceAll",  // WRONG! Never do this for small changes
    "newCode": "-- Entire script rewritten..."
  }
}

### ❌ BAD: Modifying too much
{
  "sourceModifications": {
    "action": "replace",
    "target": "local CurrencyManager = {}",  // WRONG! Don't replace core structure
    "newCode": "local CurrencyManager = {new = true}"
  }
}

### ✅ GOOD: Targeted, minimal change
{
  "sourceModifications": {
    "action": "insertAfter",  // RIGHT! Minimal, targeted change
    "target": "function CurrencyManager.getGold(player)",
    "newCode": "\\n-- New function added\\nfunction CurrencyManager.newFunction()\\n    -- implementation\\nend"
  }
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## VALIDATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### BEFORE USING replaceAll, CHECK:
1. Did user explicitly ask for complete rewrite?
2. Is the existing code completely broken beyond repair?
3. Are you adding a completely new feature that requires new structure?
4. If NO to all above, use targeted modifications

### ALWAYS PREFER:
1. Adding new functions with append/insertAfter
2. Fixing bugs with replace (specific lines only)
3. Adding setup code with prepend/insertBefore
4. Removing dead code with remove

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## FINAL CHECK BEFORE RESPONDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### ASK YOURSELF:
1. Am I using replaceAll? If yes, is it absolutely necessary?
2. Am I preserving existing code structure?
3. Am I only modifying what's needed?
4. Am I using the most targeted action possible?

### REMEMBER:
- Users want their existing code enhanced, not replaced
- Small, targeted changes are better than complete rewrites
- Preserve all existing functionality
- Add, don't replace

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARGETED MODIFICATIONS ONLY. PRESERVE EXISTING CODE. NEVER USE replaceAll UNLESS ABSOLUTELY REQUIRED.
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

function findInstanceInContext(userPrompt, session, existingInstances, sourceCodes = {}) {
  if (!userPrompt) return [];
  
  const promptLower = userPrompt.toLowerCase();
  const matches = [];
  
  const potentialInstanceNames = userPrompt.match(/\b[A-Z][a-zA-Z]+\b/g) || [];
  const keywords = promptLower.match(/\b(\w+)\b/g) || [];
  
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
  
  const allSessionInstances = [];
  if (session) {
    if (session.createdInstances) allSessionInstances.push(...session.createdInstances);
    if (session.modifiedInstances) allSessionInstances.push(...session.modifiedInstances);
  }
  
  // First: Try exact name matching
  potentialInstanceNames.forEach(instanceName => {
    const nameLower = instanceName.toLowerCase();
    
    allSessionInstances.forEach(inst => {
      if (inst && inst.name && inst.name.toLowerCase() === nameLower) {
        matches.push({
          source: 'session_exact',
          name: inst.name,
          className: inst.className || 'Unknown',
          path: inst.path || 'Unknown',
          score: 20,
          exactMatch: true,
          matchType: 'exact_name',
          hasSourceCode: sourceCodes[inst.path] ? true : false
        });
      }
    });
    
    (existingInstances || []).forEach(inst => {
      if (!inst || typeof inst !== 'object') return;
      
      const instName = inst.Name || '';
      if (instName.toLowerCase() === nameLower) {
        matches.push({
          source: 'project_exact',
          name: inst.Name || 'Unknown',
          className: inst.ClassName || 'Unknown',
          path: inst.Path || 'Unknown',
          score: 19,
          exactMatch: true,
          matchType: 'exact_name',
          hasSourceCode: sourceCodes[inst.Path] ? true : false
        });
      }
    });
  });
  
  // Second: Search by keywords
  keywords.forEach(keyword => {
    if (keyword.length < 3 || 
        ['the', 'and', 'for', 'with', 'this', 'that', 'have', 'from', 'its', 'in', 'on', 'at'].includes(keyword)) {
      return;
    }
    
    allSessionInstances.forEach(inst => {
      if (!inst || !inst.name) return;
      
      const nameLower = inst.name.toLowerCase();
      const classNameLower = (inst.className || '').toLowerCase();
      const pathLower = (inst.path || '').toLowerCase();
      
      let score = 0;
      let matchType = 'keyword';
      
      if (nameLower === keyword) {
        score += 15;
        matchType = 'exact_name';
      }
      else if (nameLower.includes(keyword)) {
        score += 7;
      }
      
      if (classNameLower.includes(keyword)) {
        score += 5;
      }
      
      if (pathLower.includes(keyword)) {
        score += 4;
      }
      
      if (mentionedLocation && pathLower.includes(mentionedLocation.toLowerCase())) {
        score += 10;
        matchType = 'location_match';
      }
      
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
    
    (existingInstances || []).forEach(inst => {
      if (!inst || typeof inst !== 'object') return;
      
      const nameLower = (inst.Name || '').toLowerCase();
      const classNameLower = (inst.ClassName || '').toLowerCase();
      const pathLower = (inst.Path || '').toLowerCase();
      
      let score = 0;
      let matchType = 'keyword';
      
      if (nameLower === keyword) {
        score += 15;
        matchType = 'exact_name';
      }
      else if (nameLower.includes(keyword)) {
        score += 7;
      }
      
      if (classNameLower.includes(keyword)) {
        score += 5;
      }
      
      if (pathLower.includes(keyword)) {
        score += 4;
      }
      
      if (mentionedLocation && pathLower.includes(mentionedLocation.toLowerCase())) {
        score += 10;
        matchType = 'location_match';
      }
      
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
  
  const sourceCodes = context?.sourceCodes || {};
  const instanceMatches = findInstanceInContext(
    userPrompt, 
    session, 
    (context && context.existingInstances) ? context.existingInstances : [],
    sourceCodes
  );
  
  let prompt = 'USER REQUEST: ' + userPrompt + '\n\n';
  
  if (sessionContext) {
    prompt += 'SESSION CONTEXT:\n';
    prompt += sessionContext + '\n';
  }
  
  if (instanceMatches.length > 0) {
    prompt += '🔍 INSTANCE MATCHES FOUND:\n';
    
    const exactMatches = instanceMatches.filter(m => m.exactMatch);
    const keywordMatches = instanceMatches.filter(m => !m.exactMatch);
    
    if (exactMatches.length > 0) {
      prompt += '\n🎯 EXACT MATCHES (USE THESE):\n';
      exactMatches.forEach((match, i) => {
        const emoji = match.matchType === 'exact_name' ? '🎯' : '📍';
        const codeEmoji = match.hasSourceCode ? '📜' : '';
        prompt += `${i + 1}. ${emoji} ${codeEmoji} ${match.name} (${match.className}) at ${match.path}\n`;
      });
      prompt += '\n';
      
      exactMatches.forEach((match, i) => {
        if (match.hasSourceCode && sourceCodes[match.path]) {
          prompt += `📜 SOURCE CODE FOR ${match.name} at ${match.path}:\n`;
          prompt += '```lua\n';
          prompt += sourceCodes[match.path].substring(0, 2000);
          if (sourceCodes[match.path].length > 2000) {
            prompt += '\n... (truncated)';
          }
          prompt += '\n```\n\n';
        }
      });
    }
    
    if (keywordMatches.length > 0) {
      prompt += '\n🔎 KEYWORD MATCHES:\n';
      keywordMatches.forEach((match, i) => {
        const emoji = match.matchType === 'location_match' ? '📍' : '🔎';
        const codeEmoji = match.hasSourceCode ? '📜' : '';
        prompt += `${i + 1}. ${emoji} ${codeEmoji} ${match.name} (${match.className}) at ${match.path}\n`;
      });
      prompt += '\n';
    }
    
    // CRITICAL: Add instructions about targeted modifications
    prompt += '📋 IMPORTANT MODIFICATION RULES:\n';
    prompt += '1. NEVER use "replaceAll" unless user explicitly asks for complete rewrite\n';
    prompt += '2. ALWAYS use targeted modifications: append, prepend, insertAfter, insertBefore, replace, remove\n';
    prompt += '3. When modifying, find the EXACT line(s) in the source code above and use them as "target"\n';
    prompt += '4. Preserve existing code structure - only change what\'s necessary\n';
    prompt += '5. Add comments for your changes\n\n';
  } else {
    prompt += '⚠️ NO INSTANCE MATCHES FOUND\n\n';
  }
  
  const lowerPrompt = userPrompt.toLowerCase();
  if (lowerPrompt.includes('serverscriptservice')) {
    prompt += '⚠️ USER SPECIFIED LOCATION: ServerScriptService\n';
  }
  if (lowerPrompt.includes('workspace')) {
    prompt += '⚠️ USER SPECIFIED LOCATION: Workspace\n';
  }
  
  if (context && context.selectedObjects && Array.isArray(context.selectedObjects) && context.selectedObjects.length > 0) {
    prompt += 'SELECTED OBJECTS:\n';
    const validObjects = context.selectedObjects.filter(obj => obj && typeof obj === 'object');
    validObjects.forEach(obj => {
      prompt += `- ${obj.Name || 'Unknown'} (${obj.ClassName || 'Unknown'}) at ${obj.Path || 'Unknown'}\n`;
    });
    prompt += '\n';
  }
  
  if (context && context.existingInstances && Array.isArray(context.existingInstances) && context.existingInstances.length > 0) {
    prompt += 'PROJECT INSTANCES:\n';
    const validInstances = context.existingInstances.filter(inst => inst && typeof inst === 'object');
    
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
      validInstances.slice(0, 5).forEach(inst => {
        prompt += `- ${inst.Name || 'Unknown'} (${inst.ClassName || 'Unknown'}) at ${inst.Path || 'Unknown'}\n`;
      });
    }
    prompt += '\n';
  }
  
  const isGreeting = ['hello', 'hi', 'hey', 'greetings'].some(word => lowerPrompt.includes(word));
  const isHelp = ['help', 'what can you do', 'how do i', 'can you'].some(phrase => lowerPrompt.includes(phrase));
  
  prompt += 'FINAL INSTRUCTIONS:\n';
  
  if (isGreeting || isHelp) {
    prompt += '1. This is a simple greeting or help request\n';
    prompt += '2. Respond with a friendly, descriptive message\n';
    prompt += '3. Return empty thinkingSteps and plan arrays\n';
    prompt += '4. Keep it helpful and encouraging\n';
  } else {
    prompt += '1. READ THE ENTIRE USER PROMPT\n';
    prompt += '2. NEVER respond with just "Done" - use descriptive summaries\n';
    prompt += '3. Handle multi-part requests in ONE comprehensive response\n';
    prompt += '4. ALWAYS include "thinkingSteps" array\n';
    prompt += '5. Use targeted modifications, NOT replaceAll\n';
    prompt += '6. When modifying code, use the exact lines from provided source as "target"\n';
    prompt += '7. Preserve existing code structure\n';
    prompt += '8. Use append/prepend/insertAfter/insertBefore/replace/remove NOT replaceAll\n';
    prompt += '9. Respond in JSON format only\n';
    prompt += '10. EVERY plan step MUST have a description field\n';
    prompt += '11. No artificial step limits\n';
    
    const hasProblematicKeywords = ['done', 'fix', 'broken', 'ok', 'working on it', 'fixed'].some(word => 
      lowerPrompt.toLowerCase().includes(word)
    );
    
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
    
    // Validate each plan step
    if (aiResponse.plan && Array.isArray(aiResponse.plan)) {
      aiResponse.plan.forEach((step, index) => {
        if (step && typeof step === 'object') {
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
          
          if (typeof step.description !== 'string' || step.description.trim() === '') {
            step.description = `${step.type || 'action'} ${step.name || 'instance'}`;
          }
          
          // CRITICAL: Check for replaceAll and warn
          if (step.sourceModifications && step.sourceModifications.action === 'replaceAll') {
            console.warn(`[AI] ⚠️ WARNING: Step ${index} uses replaceAll - converting to targeted modification`);
            
            // Try to convert replaceAll to append if it's adding new functionality
            if (step.description.includes('add') || step.description.includes('create')) {
              step.sourceModifications.action = 'append';
              console.warn(`[AI] Converted replaceAll to append for step ${index}`);
            }
          }
        } else {
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
    
    // Check for destructive "replaceAll" actions and warn
    let hasReplaceAll = false;
    if (aiResponse.plan && Array.isArray(aiResponse.plan)) {
      aiResponse.plan.forEach((step, index) => {
        if (step && step.sourceModifications && step.sourceModifications.action === 'replaceAll') {
          console.warn(`[AI] ⚠️ WARNING: Step ${index} uses replaceAll - this removes existing code!`);
          hasReplaceAll = true;
        }
      });
    }
    
    const hasDestructiveAction = aiResponse.plan.some(step => step && step.type === 'delete');
    const hasManySteps = false;
    
    // Auto-approve settings - but warn about replaceAll
    aiResponse.needsApproval = hasDestructiveAction || hasReplaceAll || hasManySteps;
    
    if (hasReplaceAll) {
      aiResponse.reasoning = (aiResponse.reasoning || '') + ' WARNING: Used replaceAll which replaces entire script. Please review carefully.';
    }
    
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
      note: 'Targeted modifications preferred over replaceAll'
    };

    console.log(`[AI] Response: ${aiResponse.thinkingSteps.length} thinking steps, ${aiResponse.plan.length} plan steps`);
    console.log(`[AI] Message: "${aiResponse.message}"`);
    if (hasReplaceAll) {
      console.warn('[AI] ⚠️ WARNING: Response contains replaceAll - consider using targeted modifications instead');
    }
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
      'Targeted code modifications',
      'No automatic replaceAll',
      'Preserves existing code',
      'Exact line matching',
      'append/prepend/insertAfter/insertBefore/replace/remove',
      'Complete multi-step implementations',
      'Automatic code reading',
      'Enhanced instance matching'
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

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId, session] of sessionMemory.entries()) {
    if (now - (session.timestamp || now) > oneHour) {
      sessionMemory.delete(sessionId);
      console.log(`[Cleanup] Removed old session: ${sessionId}`);
    }
  }
}, 30 * 60 * 1000);

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
  console.log('  • NO automatic replaceAll - uses targeted modifications');
  console.log('  • Preserves existing code structure');
  console.log('  • Uses append/prepend/insertAfter/insertBefore/replace/remove');
  console.log('  • Exact line matching for modifications');
  console.log('  • Code preservation emphasized');
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
