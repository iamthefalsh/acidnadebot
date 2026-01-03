require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
// Increased limit to handle sending full source code
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
// Using 2.0 Flash or 1.5 Pro is recommended for large context (code reading)
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash", // Changed to stable model with large context
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

// ---------------------------------------------------------
// 🔥 FIX: Include Source Code in Context
// ---------------------------------------------------------
function formatContext(context) {
  if (!context) return "Empty workspace.";
  
  let text = `WORKSPACE CONTEXT:\n`;
  
  if (context.project && context.project.Statistics) {
    const stats = context.project.Statistics;
    text += `Stats: ${stats.TotalScripts || 0} Scripts, ${stats.TotalUI || 0} UI Elements\n`;
  }
  
  // 1. Prioritize Selected Objects (User likely wants to modify these)
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `\nCurrently Selected Objects:\n`;
    context.selectedObjects.forEach(item => {
      text += `> [${item.ClassName}] ${item.Name || item.name}\n`;
      // If the client sends 'Source', include it so AI can read it
      if (item.Source) {
        text += `  CURRENT CODE:\n\`\`\`lua\n${item.Source}\n\`\`\`\n`;
      }
    });
  }
  
  // 2. Existing Scripts (For reference or modification)
  if (context.project && context.project.ScriptDetails) {
    const scripts = context.project.ScriptDetails;
    if (scripts.length > 0) {
      text += `\nAll Project Scripts:\n`;
      // We limit to 5-10 to prevent token overflow, but include source if available
      scripts.slice(-10).forEach(script => {
        text += `- [${script.Type}] "${script.Name}" at ${script.Path}\n`;
        if (script.Source) {
           // Truncate extremely long scripts just in case, or send full if model allows
           const sourcePreview = script.Source.length > 15000 
             ? script.Source.substring(0, 15000) + "...(truncated)" 
             : script.Source;
           text += `  CONTENT:\n\`\`\`lua\n${sourcePreview}\n\`\`\`\n`;
        }
      });
    }
  }
  
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `\nRecently Created:\n`;
    context.createdInstances.slice(-5).forEach(item => {
      text += `- ${item.name} (${item.className}) at ${item.parentPath}\n`;
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "17.1-FIXED" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v17.1 - Execute Mode'));

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
        type: "delete", // Simple undo strategy
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

// MAIN AI ENDPOINT
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
    
    // Intent Detection
    const wantsOnlyIdeas = 
      (userRequest.includes('give me ideas') || 
       userRequest.includes('suggest') || 
       userRequest.includes('what could i') ||
       userRequest.includes('ideas for')) &&
      !userRequest.includes('create') &&
      !userRequest.includes('make') &&
      !userRequest.includes('fix') &&
      !userRequest.includes('modify');
    
    const isPureQuestion = 
      (userRequest.startsWith('what is') ||
       userRequest.startsWith('how does') ||
       userRequest.startsWith('explain')) &&
      !userRequest.includes('create') &&
      !userRequest.includes('make');
    
    // ═══════════════════════════════════════════════════════════════
    // EXECUTION-FIRST AI PROMPT
    // ═══════════════════════════════════════════════════════════════
    
    const systemPrompt = `You are ACIDNADE, an EXECUTION-FOCUSED Roblox AI.

${contextSummary}

USER REQUEST:
"${prompt}"

═══════════════════════════════════════════════════════════════
🔥 EXECUTION RULES
═══════════════════════════════════════════════════════════════

YOUR GOAL: Return a JSON plan to execute the user's request.

1. **MODIFYING CODE (CRITICAL):**
   - Look at the "CURRENT CODE" or "CONTENT" sections in the Workspace Context above.
   - If the user asks to "fix", "change", or "add to" a script that exists, you MUST use type: "modify".
   - **IMPORTANT:** When modifying, you must provide the **FULL NEW SOURCE CODE**.
   - Read the old code, apply the changes, and return the complete updated script in the "Source" property.
   - Do not remove existing logic unless asked.

2. **CREATING NEW:**
   - If the script doesn't exist, use type: "create".

3. **UI RULES:**
   - Create UI in LocalScripts using Instance.new().
   - Parent to player.PlayerGui.

═══════════════════════════════════════════════════════════════
📝 RESPONSE FORMAT (JSON ONLY)
═══════════════════════════════════════════════════════════════

{
  "thinking": "Brief analysis of what to change",
  "message": "I have modified [Script Name] to include [Feature].",
  "plan": [
    {
      "step": 1,
      "type": "modify", 
      "className": "Script", 
      "name": "ExactScriptName",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- [[ FULL UPDATED CODE HERE ]] --\n-- Include old code + new changes"
      },
      "reasoning": "Adding requested feature to existing logic"
    }
  ],
  "autoExecute": true
}

Analyze the request and the PROVIDED CODE above. EXECUTE.`;

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
      console.error("JSON Parse Failed", response);
      data = {
        thinking: "Failed to parse",
        message: "I tried to create code but the format failed. Try again.",
        plan: [],
        autoExecute: false
      };
    }
    
    // Logic for ideas vs execution
    const shouldGiveIdeas = wantsOnlyIdeas || isPureQuestion;
    if (!shouldGiveIdeas && (!data.plan || data.plan.length === 0)) {
      data.message = "⚠️ I couldn't generate a plan. If you want to modify a script, make sure it is Selected in Studio.";
    }
    
    // Process Plan
    if (data.plan && Array.isArray(data.plan)) {
      if (data.plan.length > 0) addToCreationLog(sessionId, data);
      
      data.stepsTotal = data.plan.length;
      data.autoExecute = data.autoExecute ?? true;
      
      // Safety check for mass delete
      const deletionCount = data.plan.filter(step => step.type === 'delete').length;
      if (deletionCount >= 5) {
        data.needsApproval = true;
        data.autoExecute = false;
      }
      
      // Block UI classes (Enforce LocalScript creation rule)
      const uiClasses = ['ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'ScrollingFrame'];
      data.plan = data.plan.filter(step => !uiClasses.includes(step.className));
      
      data.canUndo = session.canUndo || data.plan.length > 0;
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
  console.log(`\n🔥 ACIDNADE AI v17.1 — FIXED MODIFICATION MODE`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Source Code Reading: ENABLED`);
  console.log(`✅ Modification Logic: FIXED`);
  console.log(`✅ Context Limit: 50MB`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
