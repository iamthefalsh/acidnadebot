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
app.get('/health', (req, res) => res.json({ status: "OK", version: "19.0-UPGRADED-FLOW" }));
app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v19.0 - Upgraded Idea → Plan → Build Flow'));

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
      // MODE 1: Generate ideas (3-5 depending on complexity)
      const ideasPrompt = `You are ACIDNADE, a creative Roblox game AI that generates innovative ideas.

${contextSummary}

USER REQUEST: "${prompt}"

=== TASK ===
Generate 3-5 distinct implementation ideas for this request.
- For simple requests: Generate 3 ideas
- For complex/open-ended requests: Generate 4-5 ideas

=== REQUIREMENTS ===
1. Each idea MUST be completely different in approach
2. Focus on practical Roblox implementation
3. Consider existing scripts in the project
4. Each idea should have:
   - A catchy, descriptive title (3-6 words max)
   - A detailed description (2-3 sentences explaining WHAT it does)
   - 3-5 key features (bullet points)
   - Estimated complexity: Simple/Medium/Complex
   - A specific prompt for implementation (used when user selects this idea)

=== RESPONSE FORMAT (JSON ONLY) ===
{
  "type": "ideas",
  "thinking": "Brief analysis of the request",
  "message": "Here are [X] ideas for your request:",
  "ideas": [
    {
      "id": 1,
      "title": "Idea Title",
      "description": "Clear description of what this idea accomplishes",
      "features": ["Feature 1", "Feature 2", "Feature 3"],
      "complexity": "Simple",
      "prompt": "Detailed prompt to implement this exact idea"
    }
  ]
}

⚠️ IMPORTANT: Return ONLY valid JSON, no markdown, no extra text.`;
      
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
        
        // Store ideas in session
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
              description: "A simple, straightforward implementation of your request with core functionality.",
              features: ["Easy to understand", "Lightweight code", "Quick to implement"],
              complexity: "Simple",
              prompt: `Create a basic implementation of: ${prompt}`
            },
            {
              id: 2,
              title: "Enhanced Version",
              description: "An improved version with additional features, better UI, and error handling.",
              features: ["More features", "Polished UI", "Error handling", "Better UX"],
              complexity: "Medium",
              prompt: `Create an enhanced version of: ${prompt} with polished features and good user experience`
            },
            {
              id: 3,
              title: "Advanced System",
              description: "A complete, scalable system with multiple components, data persistence, and advanced features.",
              features: ["Modular design", "Multiple scripts", "Data persistence", "Advanced UI", "Scalable"],
              complexity: "Complex",
              prompt: `Create a complete, professional system for: ${prompt} with modular architecture and scalability`
            }
          ]
        };
      }
      
      res.json(data);
      
    } else if (mode === 'plan') {
      // MODE 2: Generate detailed plan with INDIVIDUAL PROMPTS PER STEP
      const ideaPrompt = selectedIdea || prompt;
      
      const planPrompt = `You are ACIDNADE, an execution-focused Roblox AI that creates detailed implementation plans.

${contextSummary}

=== SELECTED IDEA ===
${ideaPrompt}

=== CRITICAL TASK ===
Create a detailed, step-by-step implementation plan where EACH STEP HAS ITS OWN INDIVIDUAL PROMPT.

=== MANDATORY RULES ===
1. ⚠️ EACH STEP MUST HAVE ITS OWN UNIQUE, SELF-CONTAINED PROMPT
2. ⚠️ DO NOT create one prompt for the entire plan
3. ⚠️ Each prompt describes ONLY what to build for THAT SPECIFIC STEP
4. Steps must be in logical dependency order
5. Each step should create/modify ONE thing at a time
6. For modify steps: The prompt must request the FULL modified code
7. Use descriptive, meaningful names for all instances

=== STEP REQUIREMENTS ===
For EACH step, you MUST provide:
1. step: Sequential number
2. description: Brief summary (what this step does)
3. prompt: INDIVIDUAL, DETAILED instruction for THIS STEP ONLY
   - Example: "Create a Script in ServerScriptService called 'GameManager' that handles player join/leave events and tracks active players in a table"
   - NOT: "Create main game logic" (too vague)
4. type: "create", "modify", or "delete"
5. className: Roblox class (Script, LocalScript, ModuleScript, Part, etc.)
6. name: Descriptive instance name
7. parentPath: Full path (e.g., "game.ServerScriptService")
8. properties: Object with properties to set
   - For scripts: MUST include "Source" with full Lua code
9. reasoning: Why this step is needed

=== RESPONSE FORMAT (JSON ONLY) ===
{
  "type": "plan",
  "thinking": "Brief analysis of implementation approach",
  "message": "I'll implement this in X steps:",
  "plan": [
    {
      "step": 1,
      "description": "Create main game manager",
      "prompt": "Create a Script in ServerScriptService called 'GameManager' that handles player join/leave events and tracks active players",
      "type": "create",
      "className": "Script",
      "name": "GameManager",
      "parentPath": "game.ServerScriptService",
      "properties": {
        "Source": "-- Full Lua code here\nlocal Players = game:GetService(\"Players\")\n..."
      },
      "reasoning": "Central server-side game state management"
    },
    {
      "step": 2,
      "description": "Create UI handler",
      "prompt": "Create a LocalScript in StarterPlayer.StarterPlayerScripts called 'UIHandler' that creates and manages the player's UI elements",
      "type": "create",
      "className": "LocalScript",
      "name": "UIHandler",
      "parentPath": "game.StarterPlayer.StarterPlayerScripts",
      "properties": {
        "Source": "-- Full Lua code here\nlocal Players = game:GetService(\"Players\")\n..."
      },
      "reasoning": "Client-side UI management"
    }
  ],
  "totalSteps": 2,
  "estimatedTime": "Medium"
}

⚠️ CRITICAL: Each step's prompt must be independently executable and describe ONLY what that step should accomplish.
⚠️ Return ONLY valid JSON, no markdown, no extra text.`;
      
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
        
        // Validate and ensure each step has individual prompt
        if (data.plan && Array.isArray(data.plan)) {
          data.plan = data.plan.map((step, index) => {
            // Ensure prompt exists and is detailed
            let stepPrompt = step.prompt || step.description || `Execute step ${index + 1}`;
            
            // If prompt is too generic, make it more specific
            if (stepPrompt.length < 20) {
              stepPrompt = `${step.description || 'Execute step'}: Create a ${step.className} called '${step.name}' in ${step.parentPath}`;
            }
            
            return {
              step: index + 1,
              description: step.description || `Step ${index + 1}`,
              prompt: stepPrompt,
              type: step.type || "create",
              className: step.className || "Script",
              name: step.name || `Step${index + 1}_${Date.now()}`,
              parentPath: step.parentPath || "game.ServerScriptService",
              properties: step.properties || {},
              reasoning: step.reasoning || "Needed for implementation"
            };
          });
        }
        
        // Store plan in session
        session.lastPlan = {
          originalIdea: ideaPrompt,
          plan: data.plan,
          timestamp: Date.now()
        };
        
      } catch (parseError) {
        console.error("JSON Parse Failed:", parseError.message);
        // Fallback plan with individual prompts
        data = {
          type: 'plan',
          thinking: "Creating a structured implementation plan",
          message: "I'll implement your idea in 3 steps:",
          plan: [
            {
              step: 1,
              description: "Create main server script",
              prompt: `Create a Script in ServerScriptService called 'MainScript' that serves as the core server-side logic for: ${ideaPrompt}`,
              type: "create",
              className: "Script",
              name: "MainScript",
              parentPath: "game.ServerScriptService",
              properties: {
                Source: `-- Main server-side script for: ${ideaPrompt}\n\nlocal Players = game:GetService("Players")\nlocal ReplicatedStorage = game:GetService("ReplicatedStorage")\n\nprint("MainScript initialized")\n\n-- Core logic here`
              },
              reasoning: "Central server-side game logic and state management"
            },
            {
              step: 2,
              description: "Create client-side handler",
              prompt: `Create a LocalScript in StarterPlayer.StarterPlayerScripts called 'ClientHandler' that manages client-side interactions for: ${ideaPrompt}`,
              type: "create",
              className: "LocalScript",
              name: "ClientHandler",
              parentPath: "game.StarterPlayer.StarterPlayerScripts",
              properties: {
                Source: `-- Client-side handler for: ${ideaPrompt}\n\nlocal Players = game:GetService("Players")\nlocal ReplicatedStorage = game:GetService("ReplicatedStorage")\nlocal player = Players.LocalPlayer\n\nprint("ClientHandler initialized for", player.Name)\n\n-- Client logic here`
              },
              reasoning: "Handle player-side interactions and UI"
            },
            {
              step: 3,
              description: "Create configuration module",
              prompt: `Create a ModuleScript in ReplicatedStorage called 'Config' that stores shared configuration settings for: ${ideaPrompt}`,
              type: "create",
              className: "ModuleScript",
              name: "Config",
              parentPath: "game.ReplicatedStorage",
              properties: {
                Source: `-- Configuration module for: ${ideaPrompt}\n\nlocal Config = {}\n\n-- Settings\nConfig.Settings = {\n\t-- Add configuration here\n}\n\nreturn Config`
              },
              reasoning: "Centralized configuration shared between client and server"
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
        prompt: `Delete the ${step.className} named '${step.name}' from ${step.parentPath} to undo previous action`,
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
  console.log(`\n🔥 ACIDNADE AI v19.0 – UPGRADED FLOW`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ Ideas → Plan → Build Flow: ENABLED`);
  console.log(`✅ Individual Step Prompts: ENFORCED`);
  console.log(`✅ UI-Based Idea Selection: ENABLED`);
  console.log(`✅ Port: ${PORT}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
});
