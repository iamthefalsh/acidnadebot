import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

/* ===============================
   BASIC SETUP
================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/* 🔥 REQUIRED FOR RATE-LIMIT BEHIND PROXY */
app.set('trust proxy', 1);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ===============================
   LOAD CONFIG FILES
================================ */
let REQUIREMENTS = {};
let PROMPTS = {};

try {
  REQUIREMENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'requirements.json'), 'utf8'));
  PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8'));
  console.log('✅ Loaded config files');
} catch (err) {
  console.error('❌ Failed to load config:', err.message);
  process.exit(1);
}

/* ===============================
   MIDDLEWARE
================================ */
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/ai', limiter);

/* ===============================
   AUTH + LOGGING
================================ */
const authenticateRequest = (req, res, next) => {
  const apiKey = req.headers['x-acidnade-key'];
  if (!apiKey || apiKey !== process.env.ACIDNADE_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ===============================
   SESSION MEMORY
================================ */
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      conversationHistory: [],
      currentPlan: [],
      currentStep: 0,
      executionState: 'idle',
      timestamp: Date.now(),
    });
  }
  return sessionMemory.get(sessionId);
}

/* ===============================
   JSON HARDENING
================================ */
function extractValidJSON(text) {
  if (!text) throw new Error('Empty AI response');

  const cleaned = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');

  return JSON.parse(match[0]);
}

/* ===============================
   GEMINI CALL (FIXED)
================================ */
async function callAI(systemPrompt, userPrompt, maxTokens = 1000, jsonMode = false) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: {
          temperature: attempt === 1 ? 0.8 : 0.4,
          topP: 0.95,
          topK: 40,
          maxOutputTokens: maxTokens,
          responseMimeType: jsonMode ? 'application/json' : 'text/plain',
        },
      });

      // ✅ CORRECT PROMPT FORMAT (NO role / parts)
      const prompt = [
        'SYSTEM:',
        systemPrompt,
        '',
        'USER:',
        userPrompt,
      ].join('\n');

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return jsonMode ? extractValidJSON(text) : text;

    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Gemini retry ${attempt} failed:`, err.message);
    }
  }

  throw lastError;
}

/* ===============================
   AUTONOMOUS DECISION
================================ */
async function autonomousDecision(userPrompt, conversationHistory) {
  const systemPrompt = `
You are Acidnade AI, an autonomous Roblox development assistant.

Conversation history:
${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

Respond ONLY with JSON:
{
  "intent": "conversation|question|build|analyze|modify",
  "confidence": 0.0-1.0,
  "reasoning": "why",
  "shouldCreatePlan": true|false,
  "suggestedResponse": "text",
  "needsMoreInfo": []
}
`;

  return await callAI(systemPrompt, userPrompt, 500, true);
}

/* ===============================
   CONVERSATION RESPONSE
================================ */
async function conversationalResponse(userPrompt, decision, history) {
  const systemPrompt = `
You are a friendly Roblox assistant.

History:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

Reasoning:
${decision.reasoning}

Return JSON:
{
  "message": "text",
  "thinkingSteps": [],
  "plan": [],
  "reasoning": "why",
  "suggestions": []
}
`;
  return await callAI(systemPrompt, userPrompt, 600, true);
}

/* ===============================
   BUILD SYSTEM
================================ */
async function buildSystem(userPrompt, decision, history, session) {
  const systemPrompt = `
You are creating a Roblox implementation plan.

Context:
${history.map(m => `${m.role}: ${m.content}`).join('\n')}

Knowledge:
${JSON.stringify(PROMPTS.knowledge, null, 2)}

Return JSON with plan steps and COMPLETE CODE.
`;
  const plan = await callAI(systemPrompt, userPrompt, 2000, true);

  session.currentPlan = plan.plan || [];
  session.currentStep = 0;
  session.executionState = 'ready';

  return plan;
}

/* ===============================
   MAIN PROCESSOR
================================ */
async function processAIRequest(prompt, context, sessionId) {
  const session = initSession(sessionId);

  session.conversationHistory.push({ role: 'user', content: prompt });
  session.conversationHistory = session.conversationHistory.slice(-10);

  const decision = await autonomousDecision(prompt, session.conversationHistory);

  let response;

  switch (decision.intent) {
    case 'conversation':
    case 'question':
      response = await conversationalResponse(prompt, decision, session.conversationHistory);
      break;
    case 'build':
      response = decision.shouldCreatePlan
        ? await buildSystem(prompt, decision, session.conversationHistory, session)
        : await conversationalResponse(prompt, decision, session.conversationHistory);
      break;
    default:
      response = await conversationalResponse(prompt, decision, session.conversationHistory);
  }

  session.conversationHistory.push({ role: 'assistant', content: response.message });

  return response;
}

/* ===============================
   ROUTES
================================ */
app.post('/ai', authenticateRequest, async (req, res) => {
  try {
    const { prompt, context, sessionId } = req.body;
    if (!prompt || !sessionId) {
      return res.status(400).json({ error: 'Missing prompt or sessionId' });
    }

    const result = await processAIRequest(prompt, context || {}, sessionId);
    res.json(result);

  } catch (err) {
    console.error('❌ AI Error:', err.message);
    res.status(500).json({ error: true, message: err.message });
  }
});

/* ===============================
   STREAMING ENDPOINT
================================ */
app.post('/ai/stream', authenticateRequest, async (req, res) => {
  const { prompt } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-flash-preview',
      generationConfig: { temperature: 0.8, maxOutputTokens: 1500 },
    });

    const stream = await model.generateContentStream(prompt);

    for await (const chunk of stream.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🍋 Acidnade AI ONLINE');
  console.log('Port:', PORT);
  console.log('Env:', NODE_ENV);
  console.log('Model: gemini-3-flash-preview');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
