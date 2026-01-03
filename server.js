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

// Format context
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
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "15.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v15.0 - Always Execute'));

// Main endpoint - ALWAYS EXECUTE MODE
app.post('/ai', async (req, res) => {
  try {
    console.log("🤖 ALWAYS EXECUTE MODE - Processing...");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What do you need me to create or modify?",
        plan: [],
        autoExecute: true
      });
    }
    
    const contextSummary = formatContext(context);
    const userRequest = prompt.trim();
    
    // === ALWAYS EXECUTE - NO IDEAS MODE ===
    const systemPrompt = `You are ACIDNADE, an EXECUTION-FOCUSED AI. You DO, not suggest.

WORKSPACE:
${contextSummary}

USER REQUEST:
"${userRequest}"

═══════════════════════════════════════════════════════════════
⚠️ CRITICAL: ALWAYS EXECUTE - NEVER GIVE IDEAS
═══════════════════════════════════════════════════════════════

MANDATORY BEHAVIOR:
• If user wants something CREATED → Create it (return plan)
• If user wants something MODIFIED → Modify it (return plan)
• If user wants something DELETED → Delete it (return plan)
• ONLY give ideas/suggestions if user explicitly asks: "give me ideas", "what could I do", "suggest something"

🔀 MIXED REQUESTS (Action + Question):
• If user asks for BOTH action AND question → Do BOTH
• Return plan array with the action
• Include answer to question in message field
• Example: "give me code AND explain how it works" → Execute code + explain in message

YOU ARE NOT ALLOWED TO:
❌ Say "Here are some ideas"
❌ Say "You could implement"
❌ Say "If you'd like me to create"
❌ Say "Let me know if you want"
❌ Give suggestions unless explicitly asked
❌ Return empty plan array when user wants something done

YOU MUST:
✅ ALWAYS return a plan with steps when user wants creation/modification
✅ EXECUTE the request immediately
✅ Be confident and direct
✅ Just do it without asking permission

═══════════════════════════════════════════════════════════════
🧠 DECISION LOGIC
═══════════════════════════════════════════════════════════════

<thinking>
1. IS THIS A PURE QUESTION?
   • ONLY question words: "what is", "how does", "explain", "why" → Answer (no plan)
   • ONLY ideas request: "what are some ideas" → Give ideas (no plan)
   
2. IS THIS AN ACTION REQUEST?
   • "add", "create", "make", "modify", "update", "change", "fix" → EXECUTE (return plan)

3. IS THIS A MIXED REQUEST? (Action + Question)
   • Contains BOTH action words AND question words
   • Example: "update my code and explain how it works"
   • Solution: Return plan for action + explanation in message
   • BOTH parts must be addressed
   
3. DOES THE TARGET EXIST?
   • Look at EXISTING SCRIPTS above
   • If script exists → Use type: "modify" with exact path
   • If doesn't exist → Use type: "create"
   
4. WHAT'S THE MINIMAL SOLUTION?
   • Don't create unnecessary components
   • If editing existing, just modify it
   • Don't create RemoteEvent unless truly needed
   • Keep it simple
</thinking>

═══════════════════════════════════════════════════════════════
⚡ REQUIREMENTS
═══════════════════════════════════════════════════════════════

1. 🎨 UI CREATION:
   • Create UI inside LocalScript using Instance.new()
   • Parent to player.PlayerGui or player:WaitForChild("PlayerGui")
   • Never create ScreenGui/Frame/etc as separate steps

2. 💻 LUAU CODE:
   • Valid Roblox Studio Luau only
   • Use game:GetService(), :WaitForChild(), task.wait()
   • Complete, working code (no placeholders)

3. ✏️ MODIFYING EXISTING:
   • If script exists in EXISTING SCRIPTS list → type: "modify"
   • Use exact parentPath from the list
   • Add/update the code as requested

4. 🎯 SIMPLICITY:
   • Minimum components needed
   • Don't overcomplicate

═══════════════════════════════════════════════════════════════
📝 RESPONSE FORMAT
═══════════════════════════════════════════════════════════════

For ACTION requests (create/modify/delete):
{
  "thinking": "Brief analysis",
  "message": "I've [created/modified/deleted] [what]",
  "plan": [
    {
      "step": 1,
      "description": "Clear description of what this does",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript",
      "name": "ScriptName",
      "parentPath": "game.ServiceName.Path",
      "properties": {
        "Source": "-- Complete Luau code"
      },
      "reasoning": "Why this approach"
    }
  ],
  "autoExecute": true
}

For QUESTIONS only:
{
  "thinking": "Analysis",
  "message": "Your answer to their question"
}

═══════════════════════════════════════════════════════════════
📋 EXAMPLES
═══════════════════════════════════════════════════════════════

REQUEST: "add a hit animation to my HitHandler"
EXISTING: HitHandler (Script) in ServerScriptService

CORRECT RESPONSE:
{
  "message": "I've added hit animation logic to your HitHandler",
  "plan": [{
    "step": 1,
    "type": "modify",
    "className": "Script",
    "name": "HitHandler",
    "parentPath": "game.ServerScriptService",
    "properties": {
      "Source": "-- [Complete modified code with animation added]"
    }
  }],
  "autoExecute": true
}

WRONG RESPONSE:
{
  "message": "Here are some ideas...",
  "plan": []
}

═══════════════════════════════════════════════════════════════

REQUEST: "what are some ideas for a shop?"
CORRECT RESPONSE:
{
  "message": "Here are shop system ideas: 1. Currency-based shop 2. Item rarity system..."
}

═══════════════════════════════════════════════════════════════

REQUEST: "give me an update code, and how does Handler work?"
MIXED REQUEST - Do BOTH parts:

CORRECT RESPONSE:
{
  "message": "I've updated your Handler code. Handler works by: 1. Listening for hit events from the client 2. Validating the hit on the server 3. Applying damage and triggering effects 4. Sending feedback to the client. It's a bridge between client input and server authority.",
  "plan": [{
    "step": 1,
    "type": "modify",
    "className": "Script",
    "name": "HitHandler",
    "parentPath": "game.ServerScriptService",
    "properties": {
      "Source": "-- Updated Handler code"
    }
  }],
  "autoExecute": true
}

WRONG RESPONSE:
{
  "message": "Handler works by...",
  "plan": []  // ❌ Forgot to execute the update!
}

═══════════════════════════════════════════════════════════════

NOW: Analyze the request and EXECUTE IT. Don't suggest. Don't ask. Just DO.`;

    console.log("⚡ ALWAYS EXECUTE processing...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Error processing request. Please try again.",
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
        message: "Error extracting response.",
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
      console.log("Raw response:", response.substring(0, 300));
      
      // Extract thinking
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
      
      // Check if response contains "ideas" or suggestions (indicating AI didn't execute)
      const isIdeas = response.toLowerCase().includes('here are some ideas') ||
                      response.toLowerCase().includes('you could implement') ||
                      response.toLowerCase().includes('if you\'d like');
      
      if (isIdeas) {
        console.log("⚠️ AI gave ideas instead of executing. Forcing execution mode.");
        data = {
          thinking: thinking || "Forcing execution",
          message: "⚠️ I should execute, not suggest. Please rephrase your request or I'll need clearer instructions.",
          plan: [],
          autoExecute: false,
          needsApproval: true
        };
      } else {
        data = {
          thinking: thinking,
          message: "I'll create that for you!",
          plan: [],
          autoExecute: true
        };
      }
    }
    
    // Detect "ideas mode" in parsed response
    if (data.message && (
        data.message.toLowerCase().includes('here are some ideas') ||
        data.message.toLowerCase().includes('you could implement') ||
        data.message.toLowerCase().includes('if you\'d like me to')
    )) {
      console.log("⚠️ DETECTED IDEAS MODE - AI not executing!");
      
      // Check if user explicitly asked for ideas
      const userWantsIdeas = userRequest.toLowerCase().includes('ideas') ||
                            userRequest.toLowerCase().includes('suggest') ||
                            userRequest.toLowerCase().includes('what could') ||
                            userRequest.toLowerCase().includes('what should');
      
      if (!userWantsIdeas && (!data.plan || data.plan.length === 0)) {
        data.message = "⚠️ I detected you want me to DO something, not just suggest. Let me execute that for you.";
        data.needsApproval = true;
        data.autoExecute = false;
      }
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "Done!";
    }
    
    // Validate plans
    if (data.plan && Array.isArray(data.plan)) {
      data.stepsTotal = data.plan.length;
      data.progressText = `Executing ${data.plan.length} step${data.plan.length > 1 ? 's' : ''}`;
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
        data.message = `⚠️ This will delete ${deletionCount} items. Review and approve.`;
      } else {
        data.needsApproval = false;
      }
      
      // Enforce UI rule
      let hasUIViolation = false;
      data.plan = data.plan.filter(step => {
        const isUIInstance = ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 
                              'ImageLabel', 'ImageButton', 'ScrollingFrame',
                              'TextBox', 'ViewportFrame'].includes(step.className);
        
        if (isUIInstance) {
          console.log(`⚠️ UI VIOLATION: Removed ${step.className} - must be in LocalScript`);
          hasUIViolation = true;
          return false;
        }
        return true;
      });
      
      if (hasUIViolation) {
        data.message = "⚠️ UI must be created inside LocalScript. Correcting...";
        data.needsApproval = true;
        data.autoExecute = false;
      }
      
      data.stepsTotal = data.plan.length;
      
      console.log(`🤖 Execution plan: ${data.plan.length} step${data.plan.length > 1 ? 's' : ''}`);
      if (data.plan[0]) {
        console.log(`📋 Action: ${data.plan[0].type.toUpperCase()} "${data.plan[0].name}" (${data.plan[0].className}) in ${data.plan[0].parentPath}`);
      }
    } else if (!data.plan || data.plan.length === 0) {
      // Check if this was supposed to be an action request
      const actionWords = ['add', 'create', 'make', 'modify', 'update', 'change', 'fix', 'remove', 'delete', 'give me'];
      const questionWords = ['what', 'how', 'why', 'explain', 'tell me'];
      
      const hasActionWord = actionWords.some(word => userRequest.toLowerCase().includes(word));
      const hasQuestionWord = questionWords.some(word => userRequest.toLowerCase().includes(word));
      const isQuestion = userRequest.toLowerCase().startsWith('what') || 
                        userRequest.toLowerCase().startsWith('how') ||
                        userRequest.toLowerCase().startsWith('why') ||
                        userRequest.toLowerCase().startsWith('explain');
      
      // Detect mixed request
      if (hasActionWord && hasQuestionWord) {
        console.log(`📊 MIXED REQUEST detected: Action + Question`);
        console.log(`   Action part should be in plan, question part in message`);
        if (!data.plan || data.plan.length === 0) {
          console.log(`   ⚠️ WARNING: Action part not executed!`);
        }
      } else if (hasActionWord && !isQuestion) {
        console.log(`⚠️ WARNING: User requested action but no plan returned!`);
        console.log(`User request: "${userRequest}"`);
        console.log(`Response: "${data.message?.substring(0, 100)}"`);
      }
    }
    
    console.log(`📤 Response: ${data.plan?.length || 0} step${data.plan?.length !== 1 ? 's' : ''}`);
    res.json(data);

  } catch (error) {
    console.error("Execution Error:", error);
    res.json({ 
      message: "Error occurred. Please try again.",
      plan: [],
      autoExecute: false
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 ACIDNADE AI v15.0 — ALWAYS EXECUTE MODE`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⚡ NO IDEAS - ONLY EXECUTION`);
  console.log(`✅ Always return plan for actions`);
  console.log(`✅ Only suggest when explicitly asked`);
  console.log(`✅ Modify existing scripts automatically`);
  console.log(`✅ Handle mixed requests (action + question)`);
  console.log(`✅ UI in LocalScript enforced`);
  console.log(`✅ Luau code required`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
