import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// No sessions, no memory, no complex logic - pure AI decisions
const sessions = new Map(); // Just for session tracking

app.use(cors());
app.use(express.json({ limit: '10mb' })); // For large code responses

// Authentication middleware
const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// PURE AI DECISION SYSTEM - NO KEYWORD DETECTION
async function getAIResponse(userPrompt, context, sessionId, isPlanRequest = false) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, a Roblox Studio assistant.

You must decide what the user wants:
1. Are they chatting? → Return chat response
2. Are they requesting work? → Return execution plan or code

NO KEYWORD DETECTION - USE YOUR OWN JUDGMENT.

RESPONSE FORMATS:

For CHAT (friendly conversation):
{
  "type": "chat",
  "message": "Your response here"
}

For EXECUTION PLAN (when user wants something created/changed):
{
  "type": "plan",
  "message": "What I'll create",
  "steps": [
    {
      "step": 1,
      "action": "create/modify/multiedit",
      "name": "InstanceName",
      "classtype": "Script/Part/TextLabel/etc",
      "parent": "game.Workspace OR UniqueID",
      "properties": {},
      "description": "What this step will do"
    }
  ]
}

For CODE EXECUTION (when asked to generate actual code):
{
  "type": "execution",
  "message": "Creating the instance",
  "name": "InstanceName",
  "classtype": "Script/Part/TextLabel/etc",
  "parent": "game.Workspace OR UniqueID",
  "properties": {
    "Color3": "255,0,0",
    "Position": "0,5,0"
  },
  "content": "-- Lua code here"
}

For MULTIPLE EDITS:
{
  "type": "multiedit",
  "message": "Modifying existing instances",
  "edits": [
    {
      "name": "EXACT_NAME_FROM_MATCHES",
      "parent": "EXACT_PATH_FROM_MATCHES",
      "properties": {
        "Color3": "0,255,0"
      },
      "sourceModifications": {
        "action": "replace/insert/delete",
        "fromLine": 5,
        "toLine": 9,
        "newCode": "-- new code"
      }
    }
  ]
}

RULES:
1. NEVER say "Working on your request" - be specific
2. If user asks to create something: Return "plan" type first
3. If user asks for code: Return "execution" type with content
4. ALWAYS return valid JSON
5. Make decisions purely based on understanding, not keywords`
    });

    const prompt = `User: ${userPrompt}

Context: ${context ? JSON.stringify(context) : 'No context'}

Session: ${sessionId}

What does the user want? Decide and respond with the appropriate JSON.

IMPORTANT: If the user is describing a complex system or multiple things, return a "plan" with steps.
If the user is asking for specific code or a single instance, return "execution".
If the user just wants to chat, return "chat".`;

    console.log(`[AI] Processing: "${userPrompt.substring(0, 100)}..."`);
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Clean and parse JSON
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const response = JSON.parse(cleaned);
    
    // Validate response has minimum required fields
    if (!response.type) {
      response.type = 'chat';
      response.message = "Hello! I'm Acidnade AI. What would you like to create?";
    }
    
    // Ensure required fields for each type
    switch(response.type) {
      case 'plan':
        if (!response.steps || !Array.isArray(response.steps)) {
          response.steps = [];
        }
        if (!response.message) {
          response.message = "I'll create that for you!";
        }
        break;
        
      case 'execution':
        if (!response.name) response.name = 'Instance';
        if (!response.classtype) response.classtype = 'Part';
        if (!response.parent) response.parent = 'game.Workspace';
        if (!response.properties) response.properties = {};
        if (!response.content && response.classtype.toLowerCase().includes('script')) {
          response.content = '-- Code will be generated here';
        }
        break;
        
      case 'multiedit':
        if (!response.edits || !Array.isArray(response.edits)) {
          response.edits = [];
        }
        break;
        
      case 'chat':
      default:
        if (!response.message) {
          response.message = "Hello! I'm Acidnade AI. How can I help you?";
        }
    }
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "Hello! I'm having trouble. Please ask me to create something in Roblox Studio!"
    };
  }
}

// Generate code for a specific step
async function generateCodeForStep(step, context, sessionId) {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, generating Roblox Lua code.

Generate the exact code for this specific step.
Include all necessary properties and logic.

Return ONLY this JSON format:
{
  "type": "code",
  "name": "InstanceName",
  "classtype": "Script/Part/etc",
  "parent": "game.Workspace",
  "properties": {
    "Color3": "255,0,0"
  },
  "content": "-- Lua code here"
}

If it's a script, include full working code.
If it's a part, include properties like Position, Size, Color.`
    });

    const prompt = `Generate code for this step:

Step Details:
${JSON.stringify(step, null, 2)}

Context: ${context ? JSON.stringify(context) : 'None'}

Generate complete, working Roblox Lua code.
Be specific and exact.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(cleaned);
    
  } catch (error) {
    console.error('[Code Gen] Error:', error.message);
    return {
      type: 'code',
      name: step.name || 'Instance',
      classtype: step.classtype || 'Part',
      parent: step.parent || 'game.Workspace',
      properties: step.properties || {},
      content: step.classtype?.toLowerCase().includes('script') ? 
        '-- Error generating code' : ''
    };
  }
}

// MAIN AI ENDPOINT - Pure AI decisions
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        type: 'chat',
        message: "Please send a message!"
      });
    }
    
    const response = await getAIResponse(prompt, context, sessionId || 'session-' + Date.now());
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Oops! Something went wrong. Try again!"
    });
  }
});

// PLAN EXECUTION ENDPOINT - Generate code for plan steps
app.post('/ai/execute', authenticateRequest, async (req, res) => {
  try {
    const { steps, context, sessionId, stepIndex } = req.body;
    
    if (!steps || !Array.isArray(steps)) {
      return res.status(400).json({
        type: 'chat',
        message: "Need steps to execute!"
      });
    }
    
    // If stepIndex is provided, generate code for that specific step
    if (stepIndex !== undefined) {
      const step = steps[stepIndex];
      if (!step) {
        return res.status(400).json({
          type: 'chat',
          message: "Invalid step index!"
        });
      }
      
      const code = await generateCodeForStep(step, context, sessionId);
      res.json({
        type: 'step_execution',
        step: stepIndex,
        ...code
      });
      
    } else {
      // Generate code for all steps
      const executions = [];
      
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const code = await generateCodeForStep(step, context, sessionId);
        executions.push({
          step: i + 1,
          ...code
        });
      }
      
      res.json({
        type: 'batch_execution',
        message: `Generated code for ${executions.length} steps`,
        executions: executions
      });
    }
    
  } catch (error) {
    console.error('[Execute] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Failed to generate code!"
    });
  }
});

// QUICK EXECUTION ENDPOINT - Direct code generation
app.post('/ai/quick', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        type: 'execution',
        name: 'Default',
        classtype: 'Part',
        parent: 'game.Workspace',
        properties: {},
        content: ''
      });
    }
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: `Generate Roblox Studio code directly.

User wants immediate code generation.
Return ONLY this format:

{
  "type": "execution",
  "message": "Brief description",
  "name": "InstanceName",
  "classtype": "Script/Part/TextLabel/etc",
  "parent": "game.Workspace/game.ServerStorage/etc",
  "properties": {},
  "content": "-- Lua code here"
}

If user doesn't specify, make reasonable assumptions.`
    });

    const result = await model.generateContent(`Generate Roblox code for: "${prompt}"`);
    const text = result.response.text();
    
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const response = JSON.parse(cleaned);
    
    // Ensure it's execution type
    response.type = 'execution';
    
    res.json(response);
    
  } catch (error) {
    console.error('[Quick] Error:', error.message);
    res.status(500).json({
      type: 'execution',
      name: 'Error',
      classtype: 'Part',
      parent: 'game.Workspace',
      properties: {},
      content: '-- Error generating code'
    });
  }
});

// HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Pure AI Autonomous System',
    mode: 'AI makes all decisions',
    endpoints: {
      '/ai': 'Main endpoint - AI decides chat/plan/execution',
      '/ai/execute': 'Execute plan steps with code generation',
      '/ai/quick': 'Direct code generation'
    }
  });
});

// CLEANUP OLD SESSIONS (once an hour)
setInterval(() => {
  const hourAgo = Date.now() - 3600000;
  for (const [sessionId, timestamp] of sessions.entries()) {
    if (timestamp < hourAgo) {
      sessions.delete(sessionId);
    }
  }
}, 3600000);

app.listen(PORT, () => {
  console.log('🚀 PURE AI AUTONOMOUS SYSTEM');
  console.log(`Port: ${PORT}`);
  console.log('✨ Features:');
  console.log('  • Pure AI decisions - no keyword detection');
  console.log('  • Plan steps without code initially');
  console.log('  • Separate code generation endpoint');
  console.log('  • Low token usage for plans');
  console.log('  • Direct execution endpoint');
  console.log('  • Supports all your JSON formats');
  console.log('\nReady! AI makes all decisions.');
});
