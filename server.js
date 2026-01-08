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

// Simple session store
const sessions = new Map();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// SIMPLE PROMPT BUILDER - NO DETECTION IN CODE
function buildPrompt(userPrompt, context) {
  // Just send everything to AI and let it decide
  let prompt = `User: ${userPrompt}\n\n`;
  
  // Add context if available
  if (context?.selectedObjects?.length > 0) {
    prompt += `User has selected in Roblox Studio:\n`;
    context.selectedObjects.forEach(obj => {
      prompt += `- ${obj.Name} (${obj.ClassName})\n`;
    });
    prompt += '\n';
  }
  
  if (context?.sourceCodes && Object.keys(context.sourceCodes).length > 0) {
    prompt += `Source code available for these scripts:\n`;
    Object.keys(context.sourceCodes).forEach(path => {
      const name = path.split('.').pop();
      prompt += `- ${name}\n`;
    });
    prompt += '\n';
  }
  
  // THE DETECTION IS IN THIS PROMPT - AI DECIDES
  prompt += `INSTRUCTIONS:
1. If this is just chatting (hi, hello, thanks, simple questions), respond with type "chat"
2. If this is about creating, modifying, or fixing something in Roblox, respond with type "execution"
3. For "execution", include ALL necessary actions in the "actions" array
4. Each action should be complete with all properties
5. Respond in JSON format only

Response format for chatting:
{
  "type": "chat",
  "message": "Your friendly response here"
}

Response format for execution:
{
  "type": "execution",
  "message": "Brief description",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script/Part/etc",
      "properties": { "Position": "0,5,0" },
      "parent": "game.Workspace",
      "content": "-- Lua code here"
    }
  ]
}`;

  return prompt;
}

// Process request - let AI do all detection
async function processAIRequest(userPrompt, context, sessionId) {
  try {
    // Store session
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        created: [],
        history: []
      });
    }
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI for Roblox Studio. 
Always respond in valid JSON format.
Decide if the user is chatting or requesting work.
If requesting work, include ALL actions needed.`
    });

    const prompt = buildPrompt(userPrompt, context);
    
    console.log(`[AI] Prompt length: ${prompt.length}`);
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    // Parse response
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      // Fallback if AI doesn't return JSON
      response = {
        type: 'execution',
        message: "Processing your request...",
        actions: []
      };
    }
    
    // Ensure required fields
    if (!response.type) response.type = 'execution';
    if (!response.message) response.message = 'Done';
    if (response.type === 'execution' && !response.actions) {
      response.actions = [];
    }
    
    // Track in session
    const session = sessions.get(sessionId);
    session.history.push({
      input: userPrompt,
      response: response.message,
      type: response.type,
      time: Date.now()
    });
    
    if (response.type === 'execution' && response.actions) {
      response.actions.forEach(action => {
        if (action.action === 'create') {
          session.created.push({
            name: action.name,
            type: action.classtype,
            time: Date.now()
          });
        }
      });
    }
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    return {
      type: 'chat',
      message: "Sorry, an error occurred. Please try again."
    };
  }
}

// Routes
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Missing prompt or session"
      });
    }
    
    const response = await processAIRequest(prompt, context, sessionId);
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    res.status(500).json({
      type: 'chat',
      message: "Server error"
    });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: sessions.size,
    uptime: process.uptime()
  });
});

// Cleanup old sessions
setInterval(() => {
  const hourAgo = Date.now() - (60 * 60 * 1000);
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.history.length > 0) {
      const lastTime = session.history[session.history.length - 1].time;
      if (lastTime < hourAgo) {
        sessions.delete(sessionId);
      }
    }
  }
}, 300000); // Every 5 minutes

app.listen(PORT, () => {
  console.log(`Acidnade AI running on port ${PORT}`);
});
