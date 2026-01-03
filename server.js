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
  model: "gemini-1.5-pro", // Better for code generation
  generationConfig: {
    temperature: 0.7,
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

// FIXED: Proper context formatting
function formatContext(context) {
  if (!context) return "No context provided.";
  
  let text = "=== WORKSPACE CONTEXT ===\n\n";
  
  // Project Statistics
  if (context.project?.Statistics) {
    const stats = context.project.Statistics;
    text += `📊 Statistics:\n`;
    text += `- Scripts: ${stats.TotalScripts || 0}\n`;
    text += `- UI Elements: ${stats.TotalUI || 0}\n`;
    text += `- Total Instances: ${stats.TotalInstances || 0}\n\n`;
  }
  
  // Selected Objects (CRITICAL for modification)
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `🎯 SELECTED OBJECTS:\n`;
    context.selectedObjects.forEach((item, index) => {
      text += `${index + 1}. [${item.ClassName}] "${item.Name || item.name}"\n`;
      text += `   Path: ${item.Path || item.path || 'Unknown'}\n`;
      
      // FIXED: Include source code for scripts
      if (item.Source && item.Source.length > 0) {
        text += `   Current Source Code:\n`;
        text += "   ```lua\n";
        const lines = item.Source.split('\n');
        const preview = lines.slice(0, 20).join('\n');
        text += preview;
        if (lines.length > 20) text += "\n   ... (truncated)";
        text += "\n   ```\n";
      } else if (item.preview && item.preview.length > 0) {
        text += `   Preview:\n`;
        text += "   ```lua\n";
        text += item.preview;
        text += "\n   ```\n";
      }
      text += "\n";
    });
  }
  
  // All Scripts in Project
  if (context.project?.ScriptDetails && context.project.ScriptDetails.length > 0) {
    text += `📁 ALL PROJECT SCRIPTS:\n`;
    context.project.ScriptDetails.slice(-15).forEach((script, index) => {
      text += `${index + 1}. [${script.Type}] "${script.Name}"\n`;
      text += `   Path: ${script.Path}\n`;
      if (script.Preview && script.Preview.trim().length > 0) {
        text += `   Preview:\n`;
        text += "   ```lua\n";
        text += script.Preview;
        text += "\n   ```\n";
      }
      text += "\n";
    });
  }
  
  // Recently Created
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `🆕 RECENTLY CREATED:\n`;
    context.createdInstances.slice(-5).forEach(item => {
      text += `- ${item.name} (${item.className}) at ${item.parentPath}\n`;
    });
    text += "\n";
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "17.2-FIXED" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v17.2 - Fixed Modification Mode'));

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

// FIXED MAIN AI ENDPOINT
app.post('/ai', async (req, res) => {
  try {
    console.log("🔥 Processing AI request...");
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
    
    // Enhanced prompt for execution
    const systemPrompt = `You are ACIDNADE, an execution-focused Roblox Studio AI assistant.

${contextSummary}

USER REQUEST: "${prompt}"

=== EXECUTION RULES ===
1. ANALYZE the "SELECTED OBJECTS" section above. If the user wants to modify something, it should be in that list.
2. For MODIFICATION:
   - Read the CURRENT SOURCE CODE from the "Selected Objects" section
   - Apply the requested changes to the existing code
   - Return the COMPLETE NEW SOURCE CODE in the "Source" property
   - Type must be "modify"
3. For CREATION:
   - Create new scripts with proper Lua syntax
   - Type must be "create"
4. Use appropriate parent paths:
   - Server scripts: game.ServerScriptService
   - Client scripts: game.ReplicatedStorage or game.StarterPlayer.StarterPlayerScripts
   - Module scripts: game.ReplicatedStorage
5. NEVER create UI elements directly. Only create scripts that create UI.

=== RESPONSE FORMAT (JSON ONLY) ===
{
  "thinking": "Brief analysis",
  "message": "I will modify/create X to do Y",
  "plan": [
    {
      "step": 1,
      "type": "modify", // or "create" or "delete"
      "className": "Script", // or "LocalScript", "ModuleScript"
      "name": "ExactName",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- Full Lua code here\n-- For modification, include existing code + changes"
      },
      "description": "What this step does",
      "reasoning": "Why this change is needed"
    }
  ],
  "autoExecute": true,
  "needsApproval": false
}

Now analyze the request and provide a JSON plan.`;

    console.log("⚡ Sending to AI...");
    
    let result;
    try {
      result = await model.generateContent(systemPrompt);
    } catch (apiError) {
      console.error("API Error:", apiError.message);
      return res.json({ 
        message: "Error connecting to AI. Try again.",
        plan: [],
        autoExecute: false
      });
    }
    
    let response;
    try {
      response = result.response.text().trim();
    } catch (textError) {
      console.error("Error extracting text:", textError);
      return res.json({ 
        message: "Error processing AI response.",
        plan: [],
        autoExecute: false
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
      console.error("JSON Parse Failed:", parseError.message);
      console.log("Raw response:", response.substring(0, 500));
      
      // Fallback: Create a simple plan based on the prompt
      const isModification = userRequest.includes('fix') || 
                            userRequest.includes('modify') || 
                            userRequest.includes('edit') ||
                            userRequest.includes('change') ||
                            (context.selectedObjects && context.selectedObjects.length > 0);
      
      data = {
        thinking: "Creating fallback plan",
        message: "I'll create a script for your request.",
        plan: [{
          step: 1,
          type: isModification ? "modify" : "create",
          className: "Script",
          name: "NewScript",
          parentPath: "game.ServerScriptService",
          properties: {
            Source: `-- Script created by Acidnade AI\n-- Request: ${prompt}\n\nprint("Hello from Acidnade AI!")`
          },
          description: `Create script for: ${prompt}`,
          reasoning: "Fallback creation"
        }],
        autoExecute: true,
        needsApproval: false
      };
    }
    
    // Validate plan structure
    if (!data.plan || !Array.isArray(data.plan)) {
      data.plan = [];
    }
    
    // Ensure each step has required fields
    data.plan = data.plan.map((step, index) => ({
      step: index + 1,
      type: step.type || "create",
      className: step.className || "Script",
      name: step.name || `NewScript_${Date.now()}`,
      parentPath: step.parentPath || "game.ServerScriptService",
      properties: step.properties || {},
      description: step.description || `Step ${index + 1}`,
      reasoning: step.reasoning || "No reasoning provided"
    }));
    
    // Log creation if we have steps
    if (data.plan.length > 0) {
      addToCreationLog(sessionId, data);
    }
    
    data.stepsTotal = data.plan.length;
    data.autoExecute = data.autoExecute ?? true;
    data.canUndo = session.canUndo || data.plan.length > 0;
    
    // Safety: Require approval for large deletions
    const deletionCount = data.plan.filter(step => step.type === 'delete').length;
    if (deletionCount >= 3) {
      data.needsApproval = true;
      data.autoExecute = false;
    }
    
    res.json(data);

  } catch (error) {
    console.error("Execution Error:", error);
    res.json({ 
      message: "Server error occurred. Please try again.",
      plan: [],
      autoExecute: false,
      error: true
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔥 ACIDNADE AI v17.2 — FIXED`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Modification: FIXED`);
  console.log(`✅ Instance Creation: ENABLED`);
  console.log(`✅ Port: ${PORT}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
