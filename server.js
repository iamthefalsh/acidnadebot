require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(cors({ origin: '*' }));
app.use(bodyParser.json({ limit: '50mb' }));

// Fixed: Use the exact API key from the plugin configuration
const PLUGIN_API_KEY = "acidnadesecretkey"; // This MUST match the plugin's CONFIG.API_KEY

// API Key Authentication - FIXED
app.use((req, res, next) => {
  const clientKey = req.headers['x-acidnade-key'];
  
  console.log(`🔑 Received API Key: ${clientKey ? '***' + clientKey.slice(-4) : 'NOT PROVIDED'}`);
  console.log(`🔑 Expected API Key: ***${PLUGIN_API_KEY.slice(-4)}`);
  
  // Allow health checks without API key
  if (req.path === '/health' || req.path === '/ping' || req.path === '/') {
    return next();
  }
  
  if (!clientKey) {
    console.error('❌ No API key provided in X-Acidnade-Key header');
    return res.status(401).json({ 
      error: true,
      message: "API key required. Set X-Acidnade-Key header to 'acidnadesecretkey'"
    });
  }
  
  if (clientKey !== PLUGIN_API_KEY) {
    console.error(`❌ Invalid API key: Expected ${PLUGIN_API_KEY}, got ${clientKey}`);
    return res.status(403).json({ 
      error: true,
      message: "Invalid API key. Make sure you're using 'acidnadesecretkey' in your plugin"
    });
  }
  
  console.log('✅ API key validated successfully');
  next();
});

// Initialize Gemini AI
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ ERROR: Missing GEMINI_API_KEY environment variable");
  console.error("💡 Get one from: https://makersuite.google.com/app/apikey");
  console.error("💡 Then set it with: export GEMINI_API_KEY=your_key_here");
  console.error("💡 Or create a .env file with GEMINI_API_KEY=your_key_here");
  
  // Create a default AI that returns placeholder responses if no key
  console.warn("⚠️  WARNING: Running in demo mode without real AI");
  const mockAI = {
    generateContent: async () => ({
      response: {
        text: () => JSON.stringify({
          thinking: "Running in demo mode - no Gemini API key configured",
          message: "I'd help you create that, but I'm in demo mode. Please set GEMINI_API_KEY.",
          plan: [{
            step: 1,
            type: "create",
            className: "Script",
            name: "ExampleScript",
            parentPath: "game.ServerScriptService",
            properties: {
              Source: `-- Demo mode: No AI key configured\n-- Set GEMINI_API_KEY environment variable\n-- Get key from: https://makersuite.google.com/app/apikey\n\nprint("Hello from Acidnade AI Demo Mode!")`
            },
            description: "Example script (demo mode)",
            reasoning: "Running without Gemini API key"
          }],
          autoExecute: false,
          needsApproval: false
        })
      }
    })
  };
  
  var model = mockAI;
} else {
  console.log("✅ Gemini API key loaded successfully");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  var model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-pro",
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 64,
      maxOutputTokens: 8192,
    }
  });
}

// Session management
const sessionData = new Map();

function getSession(sessionId) {
  if (!sessionData.has(sessionId)) {
    sessionData.set(sessionId, {
      history: [],
      createdInstances: [],
      modifiedInstances: [],
      currentPlan: null,
      stepIndex: 0,
      thinkingSteps: []
    });
  }
  return sessionData.get(sessionId);
}

// UI Classes that must be created via LocalScript
const UI_CLASSES = [
  'ScreenGui', 'Frame', 'TextLabel', 'TextButton', 'ImageLabel',
  'ScrollingFrame', 'TextBox', 'ImageButton', 'ViewportFrame',
  'BillboardGui', 'SurfaceGui', 'CanvasGroup', 'UIPadding',
  'UICorner', 'UIStroke', 'UIGradient', 'UIListLayout'
];

// Format context for AI
function formatContext(context) {
  if (!context) return "No context available.";
  
  let text = "=== PROJECT CONTEXT ===\n\n";
  
  // Project Statistics
  if (context.project?.Statistics) {
    const stats = context.project.Statistics;
    text += `📊 Project Statistics:\n`;
    text += `- Total Scripts: ${stats.TotalScripts || 0}\n`;
    text += `- Total UI Elements: ${stats.TotalUI || 0}\n`;
    text += `- Total Instances: ${stats.TotalInstances || 0}\n\n`;
  }
  
  // Selected Objects
  if (context.selectedObjects && context.selectedObjects.length > 0) {
    text += `🎯 Currently Selected Objects:\n`;
    context.selectedObjects.forEach((obj, idx) => {
      text += `${idx + 1}. [${obj.ClassName || obj.className}] "${obj.Name || obj.name}"\n`;
      text += `   Path: ${obj.Path || obj.path || 'Unknown'}\n`;
      
      // Include source code for scripts
      if (obj.Source && obj.Source.length > 0) {
        text += `   Current Source Code (first 10 lines):\n`;
        text += "   ```lua\n";
        const lines = obj.Source.split('\n').slice(0, 10);
        text += lines.join('\n');
        if (obj.Source.split('\n').length > 10) text += "\n   ...";
        text += "\n   ```\n";
      }
      text += "\n";
    });
  }
  
  // All Scripts
  if (context.project?.ScriptDetails && context.project.ScriptDetails.length > 0) {
    text += `📁 All Scripts in Project (showing 10):\n`;
    context.project.ScriptDetails.slice(0, 10).forEach((script, idx) => {
      text += `${idx + 1}. [${script.Type}] "${script.Name}"\n`;
      text += `   Path: ${script.Path}\n`;
      if (script.Preview && script.Preview.trim().length > 0) {
        text += `   Preview: ${script.Preview.substring(0, 100)}${script.Preview.length > 100 ? '...' : ''}\n`;
      }
      text += "\n";
    });
  }
  
  // Recently Created
  if (context.createdInstances && context.createdInstances.length > 0) {
    text += `🆕 Recently Created Instances:\n`;
    context.createdInstances.slice(-5).forEach(inst => {
      text += `- ${inst.name} (${inst.className}) at ${inst.parentPath}\n`;
    });
    text += "\n";
  }
  
  // Previous Steps
  if (context.previousSteps && context.previousSteps.length > 0) {
    text += `📝 Previous Steps in Session:\n`;
    context.previousSteps.slice(-5).forEach((step, idx) => {
      text += `${idx + 1}. ${step.type || 'action'}: ${step.description || 'No description'}\n`;
    });
    text += "\n";
  }
  
  return text;
}

// Generate UI creation code for LocalScript
function generateUICreationCode(step) {
  const { className, name, properties = {} } = step;
  const parentPath = step.parentPath || "game.StarterGui";
  
  let code = `-- UI Creation Script generated by Acidnade AI\n`;
  code += `-- Creates a ${className} named "${name}"\n\n`;
  
  // Create the UI instance
  const varName = name.replace(/[^a-zA-Z0-9]/g, '_');
  code += `local ${varName} = Instance.new("${className}")\n`;
  code += `${varName}.Name = "${name}"\n\n`;
  
  // Apply properties
  code += `-- Set properties\n`;
  for (const [key, value] of Object.entries(properties)) {
    if (key === 'Source' || key === 'Parent' || key === 'Disabled') continue;
    
    if (typeof value === 'string') {
      // Handle Color3 strings
      if (value.startsWith('Color3.fromRGB')) {
        code += `${varName}.${key} = ${value}\n`;
      } else if (value.startsWith('UDim2.new')) {
        code += `${varName}.${key} = ${value}\n`;
      } else {
        code += `${varName}.${key} = "${value.replace(/"/g, '\\"')}"\n`;
      }
    } else if (typeof value === 'number') {
      code += `${varName}.${key} = ${value}\n`;
    } else if (typeof value === 'boolean') {
      code += `${varName}.${key} = ${value}\n`;
    }
  }
  
  // Set parent based on parentPath
  code += `\n-- Parent the UI element\n`;
  if (parentPath.includes("StarterGui")) {
    code += `${varName}.Parent = game.StarterGui\n`;
  } else if (parentPath.includes("PlayerGui")) {
    code += `local Players = game:GetService("Players")\n`;
    code += `${varName}.Parent = Players.LocalPlayer:WaitForChild("PlayerGui")\n`;
  } else {
    code += `-- Note: Custom parent path "${parentPath}" detected\n`;
    code += `-- ${varName}.Parent should be set by your game logic\n`;
  }
  
  code += `\nprint("✅ UI created: ${name}")\n`;
  return code;
}

// Step 1: Analyze the request
async function analyzeRequest(prompt, context) {
  const systemPrompt = `You are ACIDNADE, an AI assistant for Roblox Studio.

${formatContext(context)}

USER REQUEST: "${prompt}"

=== ANALYSIS PHASE ===
Analyze this request and determine:
1. Is this a creation, modification, deletion, or explanation request?
2. What type of objects are involved? (Scripts, UI, Models, etc.)
3. Are there any dependencies or prerequisites?
4. Should this be broken into multiple steps?

Return your analysis in this JSON format:
{
  "analysis": "Brief analysis of what the user wants",
  "type": "create|modify|delete|explain",
  "requiresUI": true|false,
  "stepsNeeded": number,
  "complexity": "simple|moderate|complex"
}

Be concise and focused.`;
  
  try {
    const result = await model.generateContent(systemPrompt);
    const response = result.response.text().trim();
    
    // Extract JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Analysis error:", error.message);
  }
  
  // Default fallback
  return {
    analysis: "Create new script",
    type: "create",
    requiresUI: false,
    stepsNeeded: 1,
    complexity: "simple"
  };
}

// Step 2: Generate plan steps
async function generatePlanSteps(prompt, context, analysis, sessionId) {
  const session = getSession(sessionId);
  const steps = [];
  
  // Get appropriate parent path based on type
  function getParentPath(stepType, className) {
    if (UI_CLASSES.includes(className)) {
      return "game.StarterPlayer.StarterPlayerScripts";
    } else if (className === "Script") {
      return "game.ServerScriptService";
    } else if (className === "LocalScript") {
      return "game.StarterPlayer.StarterPlayerScripts";
    } else if (className === "ModuleScript") {
      return "game.ReplicatedStorage";
    }
    return "game.ServerScriptService";
  }
  
  // Create step planning prompt
  const planPrompt = `You are ACIDNADE, a Roblox Studio execution assistant.

${formatContext(context)}

USER REQUEST: "${prompt}"
ANALYSIS: ${JSON.stringify(analysis)}

=== PLANNING PHASE ===
Create a step-by-step plan to fulfill this request.

CRITICAL RULES:
1. UI ELEMENTS (ScreenGui, Frame, TextLabel, etc.) MUST be created by a LocalScript, not directly.
2. Scripts go in ServerScriptService
3. LocalScripts go in StarterPlayerScripts or StarterGui
4. Modules go in ReplicatedStorage
5. Always check for existing objects before creating new ones

Generate exactly ${analysis.stepsNeeded || 1} steps in this JSON format:
{
  "steps": [
    {
      "step": 1,
      "type": "create|modify|delete",
      "className": "Script|LocalScript|ModuleScript|etc.",
      "name": "DescriptiveName",
      "parentPath": "appropriate.path.here",
      "properties": {
        "Source": "Lua code here if applicable"
      },
      "description": "What this step does",
      "reasoning": "Why this step is needed"
    }
  ]
}

If UI elements are needed, create a LocalScript that generates them.`;

  try {
    const result = await model.generateContent(planPrompt);
    const response = result.response.text().trim();
    
    // Extract JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      
      // Process each step
      data.steps.forEach((step, index) => {
        // Ensure UI elements are created via LocalScript
        if (UI_CLASSES.includes(step.className)) {
          console.log(`Converting UI element ${step.className} to LocalScript creation`);
          
          steps.push({
            step: index + 1,
            type: "create",
            className: "LocalScript",
            name: `Create${step.name.replace(/[^a-zA-Z0-9]/g, '')}UI`,
            parentPath: getParentPath("create", "LocalScript"),
            properties: {
              Source: generateUICreationCode(step),
              Disabled: false
            },
            description: `Create LocalScript that generates ${step.name} UI element`,
            reasoning: step.reasoning || "UI elements must be created by LocalScripts"
          });
        } else {
          // Standard step
          steps.push({
            ...step,
            step: index + 1,
            parentPath: step.parentPath || getParentPath(step.type, step.className)
          });
        }
      });
      
      // Store in session
      session.currentPlan = steps;
      session.thinkingSteps.push({
        phase: "planning",
        steps: steps.length,
        timestamp: Date.now()
      });
      
      return steps;
    }
  } catch (error) {
    console.error("Plan generation error:", error.message);
  }
  
  // Fallback simple step
  return [{
    step: 1,
    type: "create",
    className: "Script",
    name: `NewScript_${Date.now()}`,
    parentPath: "game.ServerScriptService",
    properties: {
      Source: `-- Created by Acidnade AI\n-- Request: ${prompt}\n\nprint("Hello from Acidnade AI!")`
    },
    description: "Create a new script for the request",
    reasoning: "Fallback creation"
  }];
}

// Step 3: Validate plan
async function validatePlan(prompt, context, steps, sessionId) {
  const session = getSession(sessionId);
  
  const validationPrompt = `You are ACIDNADE, validating a Roblox Studio plan.

${formatContext(context)}

USER REQUEST: "${prompt}"
PLAN STEPS: ${JSON.stringify(steps, null, 2)}

=== VALIDATION PHASE ===
Validate this plan for:
1. Technical feasibility in Roblox Studio
2. Proper parenting and locations
3. Lua code syntax correctness
4. Potential errors or issues

Return validation in JSON format:
{
  "valid": true|false,
  "issues": ["List any issues found"],
  "improvements": ["Suggestions for improvement"],
  "needsApproval": true|false,
  "riskLevel": "low|medium|high"
}`;

  try {
    const result = await model.generateContent(validationPrompt);
    const response = result.response.text().trim();
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const validation = JSON.parse(jsonMatch[0]);
      
      session.thinkingSteps.push({
        phase: "validation",
        valid: validation.valid,
        issues: validation.issues,
        timestamp: Date.now()
      });
      
      return validation;
    }
  } catch (error) {
    console.error("Validation error:", error.message);
  }
  
  return {
    valid: true,
    issues: [],
    improvements: [],
    needsApproval: steps.length > 1,
    riskLevel: "low"
  };
}

// Main AI endpoint with multi-step thinking
app.post('/ai', async (req, res) => {
  try {
    console.log("🚀 Starting multi-step AI processing...");
    
    const { prompt, context, sessionId } = req.body;
    const session = getSession(sessionId || 'default');
    
    if (!prompt || prompt.trim() === '') {
      return res.json({
        message: "Please tell me what you want to create or modify.",
        plan: [],
        autoExecute: false,
        thinking: "Waiting for input"
      });
    }
    
    console.log(`[${sessionId}] Step 1: Analyzing request...`);
    
    // Step 1: Analyze
    const analysis = await analyzeRequest(prompt, context);
    console.log(`Analysis: ${JSON.stringify(analysis)}`);
    
    // Step 2: Generate plan
    console.log(`[${sessionId}] Step 2: Generating ${analysis.stepsNeeded} step plan...`);
    const planSteps = await generatePlanSteps(prompt, context, analysis, sessionId);
    
    // Step 3: Validate plan
    console.log(`[${sessionId}] Step 3: Validating plan...`);
    const validation = await validatePlan(prompt, context, planSteps, sessionId);
    
    // Construct response
    const response = {
      thinking: `Analyzed request as ${analysis.type} with ${analysis.complexity} complexity. ${validation.valid ? 'Plan validated successfully.' : 'Plan has issues.'}`,
      message: `I've created a ${planSteps.length}-step plan to ${analysis.type} ${analysis.requiresUI ? 'UI elements via LocalScripts' : 'your request'}.`,
      plan: planSteps,
      autoExecute: planSteps.length === 1 && validation.valid && validation.riskLevel === "low",
      needsApproval: planSteps.length > 1 || validation.needsApproval || validation.riskLevel !== "low",
      progressText: `Plan: ${planSteps.length} steps`,
      validation: {
        valid: validation.valid,
        issues: validation.issues,
        riskLevel: validation.riskLevel
      }
    };
    
    console.log(`[${sessionId}] ✅ Processed in 3 thinking steps. Returning plan with ${planSteps.length} steps.`);
    
    // Update session
    session.history.push({
      prompt: prompt,
      analysis: analysis,
      plan: planSteps,
      timestamp: Date.now()
    });
    
    res.json(response);
    
  } catch (error) {
    console.error("AI endpoint error:", error);
    res.status(500).json({
      error: true,
      message: "Internal server error during AI processing",
      plan: [],
      autoExecute: false
    });
  }
});

// Health endpoints
app.get('/health', (req, res) => {
  res.json({
    status: "OK",
    version: "2.0-multistep",
    sessions: sessionData.size,
    apiKey: PLUGIN_API_KEY ? "Configured" : "Missing",
    geminiKey: process.env.GEMINI_API_KEY ? "Configured" : "Missing (Demo Mode)"
  });
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>Acidnade AI Server</title></head>
      <body style="font-family: Arial, sans-serif; padding: 20px; background: #f0f0f0;">
        <div style="max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h1>🤖 Acidnade AI Server v2.0</h1>
          <p><strong>Status:</strong> ✅ Running</p>
          <p><strong>Plugin API Key:</strong> ${PLUGIN_API_KEY}</p>
          <p><strong>AI Provider:</strong> ${process.env.GEMINI_API_KEY ? "Gemini AI" : "Demo Mode"}</p>
          <hr>
          <h3>Endpoints:</h3>
          <ul>
            <li><code>POST /ai</code> - Main AI endpoint (requires X-Acidnade-Key header)</li>
            <li><code>GET /health</code> - Health check</li>
            <li><code>GET /ping</code> - Simple ping</li>
          </ul>
          <hr>
          <h3>Plugin Setup:</h3>
          <p>Make sure your Acidnade plugin has <code>API_KEY = "acidnadesecretkey"</code></p>
          <h3>Environment Variables:</h3>
          <ul>
            <li><code>GEMINI_API_KEY</code> - Your Google Gemini API key (optional for demo)</li>
            <li><code>PORT</code> - Server port (default: 3000)</li>
          </ul>
        </div>
      </body>
    </html>
  `);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║      ACIDNADE AI SERVER v2.0 - FIXED API KEY     ║
╠═══════════════════════════════════════════════════╣
║ ✅ Plugin API Key: "${PLUGIN_API_KEY}"            ║
║ ✅ Port: ${PORT}                                  ║
║ ✅ Multi-step thinking enabled                    ║
║ ✅ UI Creation via LocalScripts enforced         ║
╚═══════════════════════════════════════════════════╝
  
  IMPORTANT: Make sure your Acidnade plugin has:
  CONFIG.API_KEY = "acidnadesecretkey"
  
  The plugin must send this header with every request:
  X-Acidnade-Key: acidnadesecretkey
  
  Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Configured' : '❌ Not configured (Demo Mode)'}
  `);
});
