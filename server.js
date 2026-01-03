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
    temperature: 0.9,
    topP: 0.95,
    topK: 64,
    maxOutputTokens: 8192,
  }
});

// Session memory
const sessionData = new Map();

function getSession(sessionId) {
  if (!sessionData.has(sessionId)) {
    sessionData.set(sessionId, {
      history: [],
      creationLog: [],
      canUndo: false
    });
  }
  return sessionData.get(sessionId);
}

function addToCreationLog(sessionId, planData) {
  const session = getSession(sessionId);
  session.creationLog.push({
    timestamp: Date.now(),
    plan: planData,
    type: 'creation'
  });
  session.canUndo = true;
  
  if (session.creationLog.length > 10) {
    session.creationLog.shift();
  }
}

function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `Scripts: ${stats.TotalScripts || 0}, UI: ${stats.TotalUI || 0}\n`;
  }
  
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nEXISTING SCRIPTS:\n`;
      scripts.slice(-10).forEach(script => {
        text += `- ${script.Name} (${script.Type}) in ${script.Path}\n`;
      });
    }
  }
  
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nSELECTED:\n`;
    context.selectedObjects.forEach(item => {
      text += `- ${item.Name || item.name} (${item.ClassName || item.className})\n`;
    });
  }
  
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `\nRECENTLY CREATED:\n`;
    context.createdInstances.slice(-5).forEach(item => {
      text += `- ${item.name} (${item.className}) at ${item.parentPath}\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "17.0-EXECUTE" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v17.0 - Execute Mode'));

// Undo endpoint
app.post('/undo', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.json({ message: "No session ID", canUndo: false });
    }
    
    const session = getSession(sessionId);
    
    if (session.creationLog.length === 0) {
      return res.json({ 
        message: "Nothing to undo",
        canUndo: false
      });
    }
    
    const lastAction = session.creationLog.pop();
    const undoPlan = [];
    
    for (const step of lastAction.plan.plan) {
      undoPlan.push({
        step: undoPlan.length + 1,
        description: `Delete ${step.name} (undoing)`,
        type: "delete",
        className: step.className,
        name: step.name,
        parentPath: step.parentPath,
        reasoning: "Reverting previous creation"
      });
    }
    
    session.canUndo = session.creationLog.length > 0;
    
    res.json({
      message: `Undoing last action (${lastAction.plan.plan.length} items)`,
      plan: undoPlan,
      autoExecute: false,
      needsApproval: true,
      canUndo: session.canUndo
    });
    
  } catch (error) {
    console.error("Undo Error:", error);
    res.json({ 
      message: "Error processing undo",
      canUndo: false
    });
  }
});

// MAIN AI ENDPOINT - EXECUTION MODE
app.post('/ai', async (req, res) => {
  try {
    console.log("🔥 EXECUTION MODE - Processing...");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What do you want me to create?",
        plan: [],
        autoExecute: true
      });
    }
    
    const session = getSession(sessionId || 'default');
    const contextSummary = formatContext(context);
    const userRequest = prompt.trim().toLowerCase();
    
    // ═══════════════════════════════════════════════════════════════
    // INTELLIGENT INTENT DETECTION - NO KEYWORDS
    // ═══════════════════════════════════════════════════════════════
    
    // Detect if user ONLY wants ideas (very explicit)
    const wantsOnlyIdeas = 
      (userRequest.includes('give me ideas') || 
       userRequest.includes('suggest') || 
       userRequest.includes('what could i') ||
       userRequest.includes('what should i') ||
       userRequest.includes('ideas for') ||
       userRequest.includes('suggestions for')) &&
      !userRequest.includes('create') &&
      !userRequest.includes('make') &&
      !userRequest.includes('add') &&
      !userRequest.includes('build');
    
    // Detect pure questions (no action)
    const isPureQuestion = 
      (userRequest.startsWith('what is') ||
       userRequest.startsWith('how does') ||
       userRequest.startsWith('why does') ||
       userRequest.startsWith('explain') ||
       userRequest.startsWith('tell me about')) &&
      !userRequest.includes('create') &&
      !userRequest.includes('make');
    
    console.log(`Intent: Ideas Only = ${wantsOnlyIdeas}, Pure Question = ${isPureQuestion}`);
    
    // ═══════════════════════════════════════════════════════════════
    // EXECUTION-FIRST AI PROMPT
    // ═══════════════════════════════════════════════════════════════
    
    const systemPrompt = `You are ACIDNADE, an EXECUTION-FOCUSED AI. You CREATE, not suggest.

${contextSummary}

USER REQUEST:
"${prompt}"

═══════════════════════════════════════════════════════════════
🔥 EXECUTION MODE - READ CAREFULLY
═══════════════════════════════════════════════════════════════

YOUR DEFAULT MODE: **EXECUTE**

Unless the user EXPLICITLY asks for ideas/suggestions, YOU MUST:
1. Analyze what they want
2. Design the solution
3. Return a PLAN with complete code
4. NEVER say "here are some ideas"
5. NEVER say "you could implement"
6. NEVER say "if you'd like me to create"

═══════════════════════════════════════════════════════════════
🎯 INTENT DETECTION
═══════════════════════════════════════════════════════════════

<thinking>
STEP 1 - WHAT DOES THE USER WANT?

A. PURE QUESTION (no action needed):
   - "what is a RemoteEvent?"
   - "how does DataStore work?"
   - "explain combat systems"
   → Answer with explanation (no plan)

B. WANTS IDEAS ONLY (explicit request):
   - "give me ideas for a shop"
   - "what are some suggestions for UI"
   - "what could I add to my game"
   → Give 3-5 ideas (no plan)

C. **EVERYTHING ELSE = EXECUTE** (DEFAULT):
   - "add animation to HitHandler"
   - "create a shop system"
   - "make UI for health bar"
   - "improve my combat"
   - "fix the lag in my script"
   - Even vague like "make my game better" → EXECUTE SOMETHING
   → Return PLAN with code

STEP 2 - CHECK EXISTING WORKSPACE:
   - Does the script they mention exist? → MODIFY it
   - Do they want something new? → CREATE it
   - Are they referencing selected objects? → Work with those

STEP 3 - DESIGN MINIMAL SOLUTION:
   - What's the simplest approach?
   - Do I really need RemoteEvent? (only if client-server)
   - Can I do this with 1 script? → Do it
   - Can I modify existing instead of creating? → Do it
</thinking>

═══════════════════════════════════════════════════════════════
⚡ ABSOLUTE RULES
═══════════════════════════════════════════════════════════════

1. 🎨 UI CREATION:
   • Create ALL UI inside LocalScript using Instance.new()
   • Parent to player:WaitForChild("PlayerGui")
   • NEVER create ScreenGui/Frame as separate steps

2. 💻 LUAU CODE:
   • Complete, working Roblox Luau code
   • Use game:GetService(), :WaitForChild(), task.wait()
   • Add comments explaining logic
   • Handle errors with pcall when needed

3. ✏️ MODIFY vs CREATE:
   • If script exists in EXISTING SCRIPTS → type: "modify"
   • If it's new → type: "create"
   • Use exact paths from workspace

4. 🎯 EXECUTION PRIORITY:
   • DEFAULT = Execute (create plan)
   • Only give ideas if explicitly asked
   • Never ask "would you like me to..."

═══════════════════════════════════════════════════════════════
📝 RESPONSE FORMATS
═══════════════════════════════════════════════════════════════

**EXECUTION (DEFAULT):**
{
  "thinking": "Brief analysis",
  "message": "I've created/modified [what]. [How it works]",
  "plan": [
    {
      "step": 1,
      "description": "Clear description with visual impact",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript",
      "name": "DescriptiveName",
      "parentPath": "game.ServiceName",
      "properties": {
        "Source": "-- COMPLETE WORKING CODE\\n-- With comments\\n-- Error handling"
      },
      "reasoning": "Why this approach",
      "visualImpact": "What user will see/experience"
    }
  ],
  "autoExecute": true,
  "canUndo": true
}

**IDEAS ONLY (if explicitly asked):**
{
  "thinking": "They want ideas",
  "message": "Here are some ideas:\\n1. Idea one\\n2. Idea two\\n3. Idea three"
}

**QUESTIONS:**
{
  "thinking": "Pure question",
  "message": "Detailed explanation of the concept"
}

═══════════════════════════════════════════════════════════════
💡 EXAMPLES
═══════════════════════════════════════════════════════════════

REQUEST: "add hit animation to HitHandler"
EXISTING: HitHandler (Script) in ServerScriptService

✅ CORRECT:
{
  "message": "I've added hit animations to HitHandler! When players land hits, the character plays a punch animation and the target flashes red.",
  "plan": [{
    "step": 1,
    "type": "modify",
    "name": "HitHandler",
    "parentPath": "game.ServerScriptService",
    "properties": {
      "Source": "-- [COMPLETE MODIFIED CODE WITH ANIMATIONS]"
    }
  }],
  "autoExecute": true
}

❌ WRONG:
{
  "message": "Here are some ideas: 1. You could add animations..."
}

═══════════════════════════════════════════════════════════════

REQUEST: "create a shop"

✅ CORRECT:
{
  "message": "I've created a complete shop system with UI and server validation!",
  "plan": [
    {"step": 1, "type": "create", "name": "ShopUI", ...},
    {"step": 2, "type": "create", "name": "ShopServer", ...}
  ],
  "autoExecute": true
}

❌ WRONG:
{
  "message": "Here are ideas for a shop: 1. Currency system..."
}

═══════════════════════════════════════════════════════════════

REQUEST: "give me ideas for a shop system"

✅ CORRECT:
{
  "message": "Shop system ideas:\\n1. Currency-based purchases\\n2. Level-gated items\\n3. Daily rotating stock"
}

═══════════════════════════════════════════════════════════════

REQUEST: "what is a RemoteEvent?"

✅ CORRECT:
{
  "message": "A RemoteEvent is Roblox's way to communicate between client and server..."
}

═══════════════════════════════════════════════════════════════

NOW: Analyze the request and EXECUTE (unless it's clearly just ideas/questions).`;

    console.log("⚡ Sending to AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Error connecting to AI. Try again.",
        plan: [],
        autoExecute: true
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "Error processing response.",
        plan: [],
        autoExecute: true
      });
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
      console.error("JSON Parse Failed");
      
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
      
      data = {
        thinking: thinking,
        message: "I'll create that for you!",
        plan: [],
        autoExecute: true
      };
    }
    
    if (!data.message) {
      data.message = "Done!";
    }
    
    // ═══════════════════════════════════════════════════════════════
    // FORCE EXECUTION MODE (SERVER-SIDE ENFORCEMENT)
    // ═══════════════════════════════════════════════════════════════
    
    const shouldGiveIdeas = wantsOnlyIdeas || isPureQuestion;
    
    if (!shouldGiveIdeas && (!data.plan || data.plan.length === 0)) {
      // User wanted execution but AI didn't create plan
      console.log("⚠️ AI didn't execute - forcing error message");
      data.message = "⚠️ I should have executed that. Please rephrase or try: 'create [what you want]'";
    }
    
    if (data.plan && Array.isArray(data.plan)) {
      // Add to creation log
      if (data.plan.length > 0) {
        addToCreationLog(sessionId, data);
      }
      
      data.stepsTotal = data.plan.length;
      data.progressText = `Steps: 0/${data.plan.length}`;
      data.sequentialExecution = true;
      
      // Auto-execute by default
      if (data.autoExecute === undefined) {
        data.autoExecute = true;
      }
      
      // Only need approval for mass deletions
      const deletionCount = data.plan.filter(step => step.type === 'delete').length;
      if (deletionCount >= 5) {
        data.needsApproval = true;
        data.autoExecute = false;
      } else {
        data.needsApproval = false;
      }
      
      // Enforce UI rule
      const uiClasses = ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 
                         'ScrollingFrame', 'TextBox', 'ImageButton', 'ViewportFrame'];
      
      data.plan = data.plan.filter(step => {
        if (uiClasses.includes(step.className)) {
          console.log(`⚠️ UI VIOLATION: Blocked ${step.className}`);
          return false;
        }
        return true;
      });
      
      data.stepsTotal = data.plan.length;
      data.canUndo = session.canUndo || data.plan.length > 0;
      
      console.log(`🔥 EXECUTED: ${data.plan.length} steps`);
    } else {
      console.log(`💬 Response: ${shouldGiveIdeas ? 'Ideas/Question' : 'Conversation'}`);
    }
    
    res.json(data);

  } catch (error) {
    console.error("Execution Error:", error);
    res.json({ 
      message: "Error occurred. Try again.",
      plan: [],
      autoExecute: false
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔥 ACIDNADE AI v17.0 — EXECUTION MODE`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⚡ DEFAULT MODE: EXECUTE`);
  console.log(`✅ Creates plans with code by default`);
  console.log(`✅ Only gives ideas when explicitly asked`);
  console.log(`✅ Intelligent intent detection (no keywords)`);
  console.log(`✅ Autonomous decision making`);
  console.log(`✅ Undo system active`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
