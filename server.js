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
  res.json({ status: "OK", version: "14.0" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v14.0 - True Autonomy'));

// Main endpoint - TRUE AUTONOMY (NO TEMPLATES)
app.post('/ai', async (req, res) => {
  try {
    console.log("🤖 TRUE AUTONOMOUS AI - Processing...");
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What do you need?",
        plan: [],
        autoExecute: true
      });
    }
    
    const contextSummary = formatContext(context);
    const userRequest = prompt.trim();
    
    // === TRUE AUTONOMOUS AI - NO TEMPLATES ===
    const systemPrompt = `You are ACIDNADE, a truly autonomous AI with deep Roblox/Luau expertise.

CURRENT WORKSPACE:
${contextSummary}

USER REQUEST:
"${userRequest}"

═══════════════════════════════════════════════════════════════
🧠 AUTONOMOUS THINKING PROCESS
═══════════════════════════════════════════════════════════════

<thinking>
STEP 1 - UNDERSTAND THE REQUEST:
• What EXACTLY is the user asking for?
• Are they asking to CREATE something new?
• Are they asking to EDIT/MODIFY something existing?
• Are they asking to DELETE something?
• Are they asking to FIX/DEBUG something?
• Are they just asking a QUESTION?

STEP 2 - ANALYZE THE CONTEXT:
• Look at the existing scripts listed above
• Is the thing they want to modify ALREADY THERE?
• If yes, which script is it? What's its current location?
• If no, what needs to be created?

STEP 3 - DECIDE THE APPROACH:
• If EDITING existing script → Use type: "modify" with the EXACT script path
• If CREATING new feature → Decide what components are actually needed
• If DELETING → Use type: "delete"
• If it's just a question → Just answer, no plan needed

STEP 4 - CHOOSE COMPONENTS INTELLIGENTLY:
• Do I REALLY need a RemoteEvent for this? (Only if client-server communication)
• Do I REALLY need a separate Script AND LocalScript? (Only if both client and server logic)
• Can this be done with just ONE script modification?
• What's the SIMPLEST solution?

STEP 5 - DETERMINE SCRIPT TYPES:
• Script (ServerScript) → For server-side game logic
• LocalScript → For client-side UI, input handling, effects
• ModuleScript → For shared utilities and code

STEP 6 - PLAN MINIMAL STEPS:
• What's the MINIMUM number of steps to accomplish this?
• Don't create unnecessary components
• Don't create new systems if modifying existing ones will work
</thinking>

═══════════════════════════════════════════════════════════════
⚡ ABSOLUTE REQUIREMENTS (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════

1. 🎨 UI CREATION RULE:
   IF you need to create UI elements (ScreenGui, Frame, TextButton, TextLabel, etc.):
   • You MUST create them inside a LocalScript
   • The LocalScript creates the UI dynamically using Instance.new()
   • UI must be parented to player.PlayerGui or player:WaitForChild("PlayerGui")
   • NEVER create UI instances as separate steps
   • ALL UI must be in ONE LocalScript that creates everything

2. 💻 LUAU CODE REQUIREMENT:
   • ALL code must be valid Roblox Studio Luau
   • Use proper Roblox services (game:GetService())
   • Use :WaitForChild() for safety
   • Use task.wait() instead of wait()
   • Follow Roblox API conventions

3. ✏️ MODIFICATION RULE:
   IF the user wants to edit/modify/update an existing script:
   • Use type: "modify"
   • Use the EXACT parentPath from the existing scripts list
   • Don't create new components unless absolutely necessary

4. 🎯 SIMPLICITY RULE:
   • Use the MINIMUM components needed
   • Don't create RemoteEvents unless you actually need client-server communication
   • Don't create separate scripts if one script can do the job
   • Think: "What's the simplest way to do this?"

═══════════════════════════════════════════════════════════════
📝 RESPONSE FORMAT
═══════════════════════════════════════════════════════════════

For implementation:
{
  "thinking": "Your thought process from the 6 steps above",
  "message": "Clear explanation of what you're doing",
  "plan": [
    {
      "step": 1,
      "description": "Detailed description",
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript",
      "name": "ScriptName",
      "parentPath": "game.ServiceName.Path",
      "properties": {
        "Source": "-- Complete Luau code\\n-- No templates, just what's needed\\n-- If creating UI, do it in this LocalScript"
      },
      "reasoning": "Why this specific approach"
    }
  ],
  "autoExecute": true
}

For questions/conversation:
{
  "thinking": "Your analysis",
  "message": "Your answer"
}

═══════════════════════════════════════════════════════════════
🎯 EXAMPLES OF AUTONOMOUS THINKING
═══════════════════════════════════════════════════════════════

Example 1: "add a hit animation to HitHandler"
CORRECT APPROACH:
• Existing script "HitHandler" found in ServerScriptService
• User wants to ADD to existing script
• Solution: MODIFY HitHandler, add animation code
• Steps: 1 (just modify the existing script)

WRONG APPROACH:
• Create new LocalScript
• Create new RemoteEvent
• Create new Script
• Steps: 3+ (overcomplicated!)

Example 2: "create a shop UI"
CORRECT APPROACH:
• Need UI, so create LocalScript
• LocalScript creates ALL UI elements (ScreenGui, Frame, buttons)
• Steps: 1 (one LocalScript that creates the entire UI)

WRONG APPROACH:
• Create ScreenGui as separate step
• Create Frame as separate step
• Create LocalScript
• Steps: 3+ (violates UI rule!)

Example 3: "make a combo system"
AUTONOMOUS DECISION:
• Does this need server validation? If yes → RemoteEvent + Script + LocalScript
• If just client-side feedback → Only LocalScript
• Don't blindly create 3 components, THINK about what's needed

═══════════════════════════════════════════════════════════════
🚀 NOW: ANALYZE AND RESPOND
═══════════════════════════════════════════════════════════════

Think through the 6 steps carefully. Be autonomous. Be intelligent. Choose the simplest solution.`;

    console.log("⚡ TRUE AUTONOMOUS processing...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "I'll help you with that!",
        plan: [],
        autoExecute: true
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      response = "";
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
      
      // Extract thinking if present
      const thinkingMatch = response.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const thinking = thinkingMatch ? thinkingMatch[1].trim() : null;
      
      data = {
        thinking: thinking,
        message: "I understand what you need. Let me create that for you!",
        plan: [],
        autoExecute: true
      };
    }
    
    // Ensure message exists
    if (!data.message) {
      data.message = "I'll handle that!";
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
      
      // ENFORCE UI RULE: Check if any step is trying to create UI instances separately
      let hasViolation = false;
      data.plan = data.plan.filter(step => {
        const isUIInstance = ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 
                              'ImageLabel', 'ImageButton', 'ScrollingFrame',
                              'TextBox', 'ViewportFrame'].includes(step.className);
        
        if (isUIInstance) {
          console.log(`⚠️ UI VIOLATION DETECTED: Attempting to create ${step.className} as separate step`);
          hasViolation = true;
          return false; // Remove this step
        }
        return true;
      });
      
      if (hasViolation) {
        data.message = "⚠️ UI creation violation detected. UI must be created inside LocalScript. Please rephrase your request or I'll create a LocalScript that generates the UI.";
        data.needsApproval = true;
        data.autoExecute = false;
      }
      
      // Recalculate after filtering
      data.stepsTotal = data.plan.length;
      
      console.log(`🤖 Autonomous decision: ${data.plan.length} step${data.plan.length > 1 ? 's' : ''}`);
      if (data.plan[0]) {
        console.log(`📋 Action: ${data.plan[0].type} "${data.plan[0].name}" (${data.plan[0].className})`);
      }
    }
    
    console.log(`📤 Response: ${data.plan?.length || 0} step${data.plan?.length !== 1 ? 's' : ''} | Thinking: ${data.thinking ? 'YES' : 'NO'}`);
    res.json(data);

  } catch (error) {
    console.error("Autonomous AI Error:", error);
    res.json({ 
      message: "I'm ready to help! What do you need?",
      plan: [],
      autoExecute: true
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 ACIDNADE AI v14.0 — TRUE AUTONOMY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`⚡ No templates - Pure intelligence`);
  console.log(`🎨 UI Rule: Must be in LocalScript`);
  console.log(`💻 Luau Requirement: Enforced`);
  console.log(`✏️ Edit existing: Automatic detection`);
  console.log(`🎯 Simplicity: Minimum components`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
