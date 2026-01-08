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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/* ===============================
   LOAD CONFIG FILES
================================ */
const REQUIREMENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'requirements.json'), 'utf8'));
const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'prompts.json'), 'utf8'));

/* ===============================
   MIDDLEWARE
================================ */
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
}));

/* ===============================
   SESSION MEMORY
================================ */
const sessionMemory = new Map();

function initSession(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, {
      conversationHistory: [],
      timestamp: Date.now()
    });
  }
  return sessionMemory.get(sessionId);
}

/* ===============================
   JSON HARDENING UTIL
================================ */
function extractValidJSON(text) {
  if (!text) throw new Error('Empty AI response');

  // Remove markdown fences
  const cleaned = text.replace(/```json|```/g, '').trim();

  // Try full parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Try extracting first JSON object
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found');

  return JSON.parse(match[0]);
}

/* ===============================
   AI CALL (RETRY + STREAM)
================================ */
async function callAI({
  systemPrompt,
  userPrompt,
  maxTokens = 1000,
  jsonMode = false,
  stream = false,
  retries = 3
}) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const model = genAI.getGenerativeModel({
        model: 'gemini-3-flash-preview',
        generationConfig: {
          temperature: attempt === 1 ? 0.8 : 0.4,
          maxOutputTokens: maxTokens,
          responseMimeType: jsonMode ? 'application/json' : 'text/plain'
        }
      });

      const prompt = [
        'SYSTEM:',
        systemPrompt,
        '',
        'USER:',
        userPrompt
      ].join('\n');

      if (stream) {
        return await model.generateContentStream(prompt);
      }

      const result = await model.generateContent(prompt);
      const text = result.response.text();

      return jsonMode ? extractValidJSON(text) : text;

    } catch (err) {
      lastError = err;
      console.warn(`⚠️ AI attempt ${attempt} failed:`, err.message);
    }
  }

  throw lastError;
}

/* ===============================
   STREAMING ENDPOINT
================================ */
app.post('/ai/stream', async (req, res) => {
  const { prompt, sessionId } = req.body;
  if (!prompt || !sessionId) {
    return res.status(400).json({ error: 'Missing prompt or sessionId' });
  }

  const session = initSession(sessionId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = await callAI({
      systemPrompt: 'You are Acidnade AI.',
      userPrompt: prompt,
      stream: true
    });

    for await (const chunk of stream.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();

  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/* ===============================
   NORMAL AI ENDPOINT
================================ */
app.post('/ai', async (req, res) => {
  try {
    const { prompt, sessionId } = req.body;
    if (!prompt || !sessionId) {
      return res.status(400).json({ error: 'Missing prompt or sessionId' });
    }

    const session = initSession(sessionId);
    session.conversationHistory.push({ role: 'user', content: prompt });

    const response = await callAI({
      systemPrompt: 'You are Acidnade AI.',
      userPrompt: prompt,
      jsonMode: true
    });

    session.conversationHistory.push({ role: 'assistant', content: response });

    res.json(response);

  } catch (error) {
    console.error('❌ AI ERROR:', error.message);
    res.status(500).json({
      error: true,
      message: error.message
    });
  }
});

/* ===============================
   START SERVER
================================ */
app.listen(PORT, () => {
  console.log('🍋 Acidnade AI running on port', PORT);
});
