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

const sessions = new Map();

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
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

// NO KEYWORD DETECTION IN CODE - ALL IN PROMPT
function buildPrompt(userPrompt, context) {
  // Just send everything to AI and let it decide
  let prompt = `User message: "${userPrompt}"\n\n`;
  
  // Add context if available
  if (context?.selectedObjects?.length > 0) {
    prompt += `User has selected in Roblox Studio:\n`;
    context.selectedObjects.forEach(obj => {
      prompt += `- ${obj.Name} (${obj.ClassName})\n`;
    });
    prompt += '\n';
  }
  
  // NO KEYWORD DETECTION - ALL INSTRUCTIONS IN PROMPT
  prompt += `YOU MUST DECIDE: Is this a friendly chat or work request?

LOOK AT THE USER'S MESSAGE:
• If it's a greeting (hi, hello, hey, greetings) → CHAT
• If it's a simple question (how are you, what's up, help) → CHAT  
• If it's a thank you (thanks, thank you, ty) → CHAT
• If it's just talking (yes, no, maybe, okay) → CHAT
• If user wants to CREATE/MODIFY/FIX anything → EXECUTION
• If user mentions scripts, parts, GUI, code → EXECUTION
• If user has selected objects → EXECUTION

EXAMPLES:
"hi" → CHAT
"hello there" → CHAT  
"how are you?" → CHAT
"thanks for helping" → CHAT
"ok" → CHAT
"help" → CHAT
"create a red part" → EXECUTION
"make a script" → EXECUTION
"fix the health bar" → EXECUTION
"add button to GUI" → EXECUTION
"player should take damage" → EXECUTION

RESPONSE FORMATS:

For CHAT (friendly conversation):
{
  "type": "chat",
  "message": "Your friendly response here. Be helpful and enthusiastic!"
}

For EXECUTION (creating/modifying):
{
  "type": "execution",
  "message": "Brief description of what will be created",
  "actions": [
    {
      "action": "create",
      "name": "InstanceName",
      "classtype": "Script/Part/TextLabel/etc",
      "parent": "game.Workspace",
      "properties": {
        "Position": "0,5,0",
        "Size": "5,5,5"
      },
      "content": "-- Lua code here"
    }
  ]
}

IMPORTANT RULES:
1. NEVER return "Working on your request" or "Processing" - be specific
2. For CHAT: Be friendly, helpful, enthusiastic about Roblox
3. For EXECUTION: Include all necessary actions
4. ALWAYS return valid JSON`;

  return prompt;
}

async function processAIRequest(userPrompt, context, sessionId) {
  try {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        history: [],
        timestamp: Date.now()
      });
    }
    
    const session = sessions.get(sessionId);
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI, a friendly Roblox Studio assistant.

You must decide: Is the user chatting or requesting work?

CHAT EXAMPLES:
• "hi", "hello", "hey" → Friendly greeting
• "how are you" → Friendly response  
• "what can you do" → Helpful explanation
• "thanks" → Appreciative response
• "help" → Offer assistance

EXECUTION EXAMPLES:
• "create [something]" → Build it
• "make [something]" → Build it
• "fix [something]" → Fix it
• "add [something]" → Add it
• Any technical/scripting request → Execute it

ALWAYS:
1. Return valid JSON
2. Be specific in messages
3. Never say "Working on it" or "Processing"
4. For chat: Be enthusiastic and helpful
5. For execution: Provide complete actions`
    });

    const prompt = buildPrompt(userPrompt, context);
    
    console.log(`[AI] Processing: "${userPrompt}"`);
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      console.error('[AI] Parse error:', error.message);
      // Default to chat if we can't parse
      response = {
        type: 'chat',
        message: "Hello! I'm Acidnade AI, your Roblox Studio assistant! How can I help you today?"
      };
    }
    
    // CRITICAL FIX: Never allow "Working on your request"
    if (response.message && 
        (response.message.toLowerCase().includes('working on') || 
         response.message.toLowerCase().includes('processing') ||
         response.message.toLowerCase().includes('please wait'))) {
      
      if (response.type === 'chat') {
        response.message = "Hello! I'm Acidnade AI. I can help you build amazing things in Roblox Studio!";
      } else {
        response.message = "I'll create that for you right now!";
      }
    }
    
    // Ensure required fields
    if (!response.type) response.type = 'execution';
    if (!response.message) {
      response.message = response.type === 'chat' 
        ? "Hi there! Ready to build something awesome?"
        : "Creating your request now!";
    }
    if (response.type === 'execution' && !response.actions) {
      response.actions = [];
    }
    
    // Track history
    session.history.push({
      input: userPrompt,
      response: response.message,
      type: response.type,
      timestamp: Date.now()
    });
    
    // Keep history small
    session.history = session.history.slice(-20);
    
    return response;
    
  } catch (error) {
    console.error('[AI] Error:', error.message);
    // Always return a friendly chat response on error
    return {
      type: 'chat',
      message: "Hi! I'm having a little trouble right now. Try asking me to create something in Roblox Studio!"
    };
  }
}

// Main endpoint
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    
    if (!prompt || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Hi! I need a prompt and session ID to help you."
      });
    }
    
    console.log(`[Request] Session ${sessionId}: "${prompt}"`);
    
    const response = await processAIRequest(prompt, context, sessionId);
    res.json(response);
    
  } catch (error) {
    console.error('[Server] Error:', error.message);
    // Friendly error response
    res.status(500).json({
      type: 'chat',
      message: "Oops! Something went wrong. Say 'hi' and let's try again!"
    });
  }
});

// Chat-only endpoint (force chat mode)
app.post('/ai/chat', authenticateRequest, async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        type: 'chat',
        message: "Hello! What would you like to chat about?"
      });
    }
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: {
        temperature: 0.9, // More creative for chat
        maxOutputTokens: 512,
        responseMimeType: 'application/json',
      },
      systemInstruction: `You are Acidnade AI - a friendly, enthusiastic Roblox Studio assistant.
The user just wants to chat.
Be helpful, excited about Roblox, and offer assistance.
Never say "Working on it" or "Processing".
Always return: {"type": "chat", "message": "Your friendly response here"}`
    });
    
    const prompt = `User wants to chat: "${message}"
    
Respond friendly and helpfully. Be excited about Roblox!
Example responses:
• "Hi! I'm Acidnade AI, ready to help you build in Roblox Studio!"
• "Hello! What would you like to create today?"
• "Hey there! I can help you with scripts, GUIs, animations, and more!"`;
    
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    let response;
    try {
      const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
      response = JSON.parse(cleaned);
    } catch (error) {
      response = {
        type: 'chat',
        message: `Hello! I'm Acidnade AI. You said: "${message}". How can I help you with Roblox Studio today?`
      };
    }
    
    res.json(response);
    
  } catch (error) {
    res.status(500).json({
      type: 'chat',
      message: "Hello! Let's chat about Roblox development!"
    });
  }
});

// Simple health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Acidnade AI is running! Say "hi" to start chatting.',
    sessions: sessions.size
  });
});

// Cleanup old sessions
setInterval(() => {
  const hourAgo = Date.now() - 3600000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.history.length > 0) {
      const lastTime = session.history[session.history.length - 1].timestamp;
      if (lastTime < hourAgo) {
        sessions.delete(sessionId);
      }
    }
  }
}, 300000);

app.listen(PORT, () => {
  console.log('👋 ACIDNADE AI - FRIENDLY CHAT FIXED');
  console.log(`Port: ${PORT}`);
  console.log('Fixed:');
  console.log('  • No more "Working on your request"');
  console.log('  • AI decides chat vs execution in prompt');
  console.log('  • Friendly responses for greetings');
  console.log('  • No keyword detection in code');
  console.log('Ready to chat and build!');
});
