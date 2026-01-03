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
    temperature: 1,
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
      canUndo: false,
      lastIdeas: null,
      lastPlan: null
    });
  }
  return sessionData.get(sessionId);
}

// Fixed context formatting
function formatContext(context) {
  if (!context) return "No context provided.";
  
  let text = "=== WORKSPACE CONTEXT ===\n\n";
  
  if (context.project?.Statistics) {
    const stats = context.project.Statistics;
    text += `📊 Statistics:\n`;
    text += `- Scripts: ${stats.TotalScripts || 0}\n`;
    text += `- UI Elements: ${stats.TotalUI || 0}\n`;
    text += `- Total Instances: ${stats.TotalInstances || 0}\n\n`;
  }
  
  // Selected Objects
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `🎯 SELECTED OBJECTS:\n`;
    context.selectedObjects.forEach((item, index) => {
      text += `${index + 1}. [${item.ClassName}] "${item.Name || item.name}"\n`;
      text += `   Path: ${item.Path || item.path || 'Unknown'}\n`;
      
      if (item.Source && item.Source.length > 0) {
        text += `   Current Source Code:\n`;
        text += "   ```lua\n";
        const lines = item.Source.split('\n');
        const preview = lines.slice(0, 20).join('\n');
        text += preview;
        if (lines.length > 20) text += "\n   ... (truncated)";
        text += "\n   ```\n";
      }
      text += "\n";
    });
  }
  
  return text;
}

// Public endpoints
app.get('/health', (req, res) => res.json({ status: "OK", version: "18.0-IDEAS" }));
app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v18.0 - Ideas & Step-by-Step Mode'));

// MAIN AI ENDPOINT - TWO MODES
app.post('/ai', async (req, res) => {
  try {
    const { prompt, context, sessionId, mode = 'ideas', selectedIdea } = req.body;
    
    if (!prompt || prompt.trim() === '') {
      return res.json({ 
        message: "What do you want me to create?",
        type: 'error'
      });
    }
    
    const session = getSession(sessionId || 'default');
    const contextSummary = formatContext(context);
    
    console.log(`🔥 Mode: ${mode}, Request: "${prompt.substring(0, 100)}..."`);
    
    if (mode === 'ideas') {
      // MODE 1: Generate ideas only
      const ideasPrompt = `You are ACIDNADE, a creative Roblox game AI.

${contextSummary}

USER REQUEST: "${prompt}"

=== TASK ===
Generate 3 different implementation ideas for this request.

=== REQUIREMENTS ===
1. Each idea must be distinct and creative
2. Focus on practical Roblox implementation
3. Consider existing scripts in the project
4. Each idea should have:
   - A catchy title (max 5 words)
   - A detailed description (2-3 sentences)
   - Key features (bullet points)
   - Estimated complexity: Simple/Medium/Complex

=== RESPONSE FORMAT (JSON) ===
{
  "type": "ideas",
  "thinking": "Brief analysis",
  "message": "Here are 3 ideas for your request:",
  "ideas": [
    {
      "id": 1,
      "title": "Idea Title",
      "description": "Detailed description of what this idea does",
      "features": ["Feature 1", "Feature 2", "Feature 3"],
      "complexity": "Simple",
      "prompt": "Specific prompt to implement this idea (used when selected)"
    }
  ]
}

Generate exactly 3 ideas.`;
      
      const result = await model.generateContent(ideasPrompt);
      let response = result.response.text().trim();
      
      // Clean response
      response = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      let data;
      try {
        data = JSON.parse(response);
        data.type = 'ideas';
        
        // Store ideas in session for later reference
        session.lastIdeas = {
          originalPrompt: prompt,
          ideas: data.ideas,
          timestamp: Date.now()
        };
        
      } catch (parseError) {
        console.error("JSON Parse Failed:", parseError.message);
        // Fallback ideas
        data = {
          type: 'ideas',
          thinking: "Creating fallback ideas",
          message: "Here are 3 ideas for your request:",
          ideas: [
            {
              id: 1,
              title: "Basic Implementation",
              description: "A simple, straightforward implementation of your request.",
              features: ["Easy to understand", "Lightweight", "Good starting point"],
              complexity: "Simple",
              prompt: prompt
            },
            {
              id: 2,
              title: "Enhanced Version",
              description: "Adds extra features and polish to the basic idea.",
              features: ["More features", "Better UI", "Error handling"],
              complexity: "Medium",
              prompt: `${prompt} with enhanced features and better user experience`
            },
            {
              id: 3,
              title: "Advanced System",
              description: "A complete system with multiple components and interactions.",
              features: ["Multiple scripts", "Data persistence", "Advanced UI"],
              complexity: "Complex",
              prompt: `Create a complete system for: ${prompt} with modular design and scalability`
            }
          ]
        };
      }
      
      res.json(data);
      
    } else if (mode === 'plan') {
      // MODE 2: Generate detailed plan for selected idea
      const ideaPrompt = selectedIdea || prompt;
      
      const planPrompt = `You are ACIDNADE, an execution-focused Roblox AI.

${contextSummary}

=== SELECTED IDEA ===
${ideaPrompt}

=== TASK ===
Create a detailed, step-by-step implementation plan.

=== CRITICAL RULES ===
1. Each step MUST have its own INDIVIDUAL prompt
2. Steps must be in logical order
3. Each step should create/modify ONE thing
4. For modification steps: Include FULL source code
5. Each step should be independently executable

=== STEP REQUIREMENTS ===
For EACH step, provide:
1. step: Number
2. description: What this step does
3. prompt: Detailed instruction JUST for this step (what to code/create)
4. type: "create", "modify", or "delete"
5. className: Class to create (Script, LocalScript, ModuleScript, etc.)
6. name: Name of the instance
7. parentPath: Where to place it
8. properties: Any properties to set (for scripts, MUST include full Source code)
9. reasoning: Why this step is needed

=== RESPONSE FORMAT (JSON) ===
{
  "type": "plan",
  "thinking": "Brief analysis of the full plan",
  "message": "I'll create this in X steps:",
  "plan": [
    {
      "step": 1,
      "description": "Create main script",
      "prompt": "Create a Script in ServerScriptService that handles the main logic",
      "type": "create",
      "className": "Script",
      "name": "MainHandler",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- Full Lua code here"
      },
      "reasoning": "We need a central server-side script"
    }
  ],
  "totalSteps": 1,
  "estimatedTime": "Simple/Medium/Complex"
}

Create a practical, executable plan.`;
      
      const result = await model.generateContent(planPrompt);
      let response = result.response.text().trim();
      
      // Clean response
      response = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      let data;
      try {
        data = JSON.parse(response);
        data.type = 'plan';
        data.totalSteps = data.plan ? data.plan.length : 0;
        
        // Validate each step has individual prompt
        if (data.plan && Array.isArray(data.plan)) {
          data.plan = data.plan.map((step, index) => ({
            step: index + 1,
            description: step.description || `Step ${index + 1}`,
            prompt: step.prompt || step.description || `Execute step ${index + 1}`,
            type: step.type || "create",
            className: step.className || "Script",
            name: step.name || `Step${index + 1}_${Date.now()}`,
            parentPath: step.parentPath || "game.ServerScriptService",
            properties: step.properties || {},
            reasoning: step.reasoning || "Needed for implementation"
          }));
        }
        
        // Store plan in session
        session.lastPlan = {
          originalIdea: ideaPrompt,
          plan: data.plan,
          timestamp: Date.now()
        };
        
      } catch (parseError) {
        console.error("JSON Parse Failed:", parseError.message);
        // Fallback plan
        data = {
          type: 'plan',
          thinking: "Creating fallback plan",
          message: "I'll implement your idea in 3 steps:",
          plan: [
            {
              step: 1,
              description: "Create main script",
              prompt: "Create a Script in ServerScriptService",
              type: "create",
              className: "Script",
              name: "MainScript",
              parentPath: "game.ServerScriptService",
              properties: {
                Source: `-- Main script for: ${ideaPrompt}\n\nprint("Hello from Acidnade AI!")`
              },
              reasoning: "Central server-side logic"
            },
            {
              step: 2,
              description: "Create client-side handler",
              prompt: "Create a LocalScript for client-side",
              type: "create",
              className: "LocalScript",
              name: "ClientHandler",
              parentPath: "game.StarterPlayer.StarterPlayerScripts",
              properties: {
                Source: `-- Client-side handler\n\nlocal Players = game:GetService("Players")\n\n-- Client logic here`
              },
              reasoning: "Handle player interactions"
            },
            {
              step: 3,
              description: "Create configuration module",
              prompt: "Create a ModuleScript for settings",
              type: "create",
              className: "ModuleScript",
              name: "Config",
              parentPath: "game.ReplicatedStorage",
              properties: {
                Source: `-- Configuration module\n\nlocal Config = {}\n\nConfig.Settings = {\n  -- Add settings here\n}\n\nreturn Config`
              },
              reasoning: "Centralized configuration"
            }
          ],
          totalSteps: 3,
          estimatedTime: "Medium"
        };
      }
      
      res.json(data);
      
    } else {
      res.json({
        type: 'error',
        message: "Invalid mode. Use 'ideas' or 'plan'."
      });
    }
    
  } catch (error) {
    console.error("AI Error:", error);
    res.json({ 
      type: 'error',
      message: "Error processing request. Please try again."
    });
  }
});

// Get previous ideas/plan
app.post('/get-session', (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    
    res.json({
      lastIdeas: session.lastIdeas,
      lastPlan: session.lastPlan,
      canUndo: session.creationLog.length > 0
    });
  } catch (error) {
    console.error("Session Error:", error);
    res.json({ error: "Failed to get session" });
  }
});

// Undo endpoint
app.post('/undo', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = getSession(sessionId);
    
    if (session.creationLog.length === 0) {
      return res.json({ 
        message: "Nothing to undo",
        canUndo: false
      });
    }
    
    const lastAction = session.creationLog.pop();
    const undoPlan = [];
    
    for (const step of lastAction.plan) {
      undoPlan.push({
        step: undoPlan.length + 1,
        description: `Delete ${step.name} (undoing)`,
        prompt: `Delete ${step.name} to undo previous action`,
        type: "delete",
        className: step.className,
        name: step.name,
        parentPath: step.parentPath,
        reasoning: "Reverting previous creation"
      });
    }
    
    session.canUndo = session.creationLog.length > 0;
    
    res.json({
      message: `Undoing last action (${lastAction.plan.length} items)`,
      plan: undoPlan,
      type: 'plan',
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔥 ACIDNADE AI v18.0 — IDEAS & STEP-BY-STEP`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Ideas System: ENABLED`);
  console.log(`✅ Individual Step Prompts: ENABLED`);
  console.log(`✅ Port: ${PORT}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
