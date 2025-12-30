// server.js — Acidnade AI v8.2 (STRUCTURED RESPONSE + LEMONADE COMPATIBLE)
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
  if ((req.method === 'GET' && req.path === '/') || 
      (req.method === 'GET' && req.path === '/health') ||
      (req.method === 'GET' && req.path === '/ping')) {
    return next();
  }
  
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
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// 🔥 NEW SYSTEM PROMPT (Concise, structured, no fluff)
const SYSTEM_PROMPT = `
You are Acidnade, a professional Roblox Studio AI. 
CONTEXT: You have access to Workspace, ServerScriptService, ReplicatedStorage, StarterGui, and StarterPlayer.
TONE: 
- Be normal and concise. No "Greetings, Developer" or robotic formality.
- No "homeless" or slang talk. Just a helpful peer.
- Keep answers short. If a long explanation isn't asked for, don't give one.

RULES:
1. RICHTEXT: Always use <b>bold</b> or <font color="#00aaff">color</font> for key terms.
2. NO GREETING: Do not send the first message. Only reply to user prompts.
3. SCRIPTING: If asked to build/script, you MUST return a JSON 'plan' array. 
4. SERVICES: Look beyond Workspace. Suggest putting UIs in StarterGui and logic in ServerScriptService.

FORMAT:
If building: {"plan": [{"description": "Step 1", "type": "create", "className": "Part", "name": "Obstacle", "parentPath": "Workspace", "properties": {...}}, ...], "message": "Short summary."}
If chatting: {"message": "Your concise answer here."}
`;

// Format workspace (keep full for /execute-step compatibility)
function formatWorkspaceContext(workspace) {
  if (!workspace || !workspace.scripts) return "No workspace data.";
  
  let context = `WORKSPACE SNAPSHOT:\n`;
  context += `Scripts: ${workspace.scriptCount || 0} | Folders: ${workspace.folderCount || 0} | Remotes: ${workspace.remoteCount || 0}\n\n`;
  
  if (workspace.scripts.length > 0) {
    context += `EXISTING SCRIPTS:\n`;
    for (const script of workspace.scripts.slice(0, 15)) {
      context += `\n${script.name} (${script.type}) - ${script.lines} lines\n`;
      context += `Path: ${script.path}\n`;
      if (script.source) {
        const preview = script.source.split('\n').slice(0, 50).join('\n');
        context += `Source:\n${preview}\n`;
        if (script.lines > 50) context += `... (${script.lines - 50} more lines)\n`;
      }
    }
  }
  
  return context;
}

function formatChatHistory(history) {
  if (!history || history.length === 0) return "No history.";
  return history.slice(-8).map(m => `${m.role === "user" ? "User" : "AI"}: ${m.content}`).join('\n');
}

// Public endpoints
app.get('/health', (req, res) => {
  res.json({ status: "OK", version: "8.2", message: "Structured Response Mode" });
});

app.get('/ping', (req, res) => res.send('PONG'));
app.get('/', (req, res) => res.send('Acidnade AI v8.2 - Structured Response'));

// 🔁 Main AI endpoint — UPDATED FORMAT
app.post('/ai', async (req, res) => {
  try {
    console.log("🧠 AI Request (v8.2)");
    const { prompt, context } = req.body; // ✅ Note: now uses "context" like your new spec

    // 🔍 Build context summary from full snapshot (for AI awareness)
    let workspaceSummary = "Current project state:\n";
    if (context?.hierarchy) {
      for (const svc of context.hierarchy) {
        if (svc) {
          workspaceSummary += `- ${svc.name}: ${svc.children?.length || 0} children\n`;
        }
      }
    }
    if (context?.selection?.length) {
      workspaceSummary += `- ${context.selection.length} instance(s) selected\n`;
    }

    const userMessage = `CONTEXT:\n${workspaceSummary}\n\nUSER REQUEST:\n${prompt}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3,
        maxOutputTokens: 800
      },
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
    });

    let rawResponse = result.response.text().trim();
    // Clean common markdown
    rawResponse = rawResponse
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    let data;
    try {
      data = JSON.parse(rawResponse);
    } catch (e) {
      console.warn("JSON parse failed, falling back to message-only:", rawResponse);
      data = { message: rawResponse };
    }

    // Ensure minimal valid response
    if (!data.message && !data.plan) {
      data.message = "Done.";
    }

    console.log(`✅ Response: ${data.plan ? 'PLAN' : 'MESSAGE'}`);
    res.json(data);

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: error.message || "AI generation failed" });
  }
});

// ⚙️ Keep /execute-step for backward compatibility (used in step-by-step mode)
app.post('/execute-step', async (req, res) => {
  try {
    console.log("⚙️ Executing Step (Legacy)");
    const { stepNumber, totalSteps, stepDescription, instanceType, workspace } = req.body;
    
    const workspaceContext = formatWorkspaceContext(workspace);
    
    const stepPrompt = `You are Acidnade — creating PROFESSIONAL, POLISHED Roblox UI code.

TASK: ${stepDescription}
TYPE: ${instanceType}

EXISTING CODE (DO NOT DUPLICATE):
${workspaceContext}

🔥 OUTPUT ONLY VALID JSON IN THIS FORMAT:
{
  "message": "Created professional UI element",
  "plan": [
    {
      "description": "${stepDescription}",
      "type": "create",
      "className": "${instanceType}",
      "name": "${instanceType.replace(/Script$/, '')}UI",
      "parentPath": "${instanceType === 'LocalScript' ? 'StarterGui' : instanceType === 'ModuleScript' ? 'ReplicatedStorage' : 'ServerScriptService'}",
      "properties": {
        "Source": "-- FULL CODE HERE (modern, animated, no duplicates)"
      }
    }
  ]
}`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: stepPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 1200
      }
    });

    let raw = result.response.text().trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      data = { message: "Step generated", plan: [] };
    }

    console.log(`✅ Step ${stepNumber}/${totalSteps} complete`);
    res.json(data);

  } catch (error) {
    console.error("Step Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Acidnade AI v8.2 - STRUCTURED RESPONSE MODE`);
  console.log(`🌍 Port: ${PORT}`);
  console.log(`\n✅ Features:`);
  console.log(`   • Modern structured output: { plan, message }`);
  console.log(`   • RichText support (<b>, <font>)`);
  console.log(`   • Multi-service context awareness`);
  console.log(`   • No robotic greetings`);
  console.log(`   • Full Lemonade UI compatibility`);
  console.log(`\n📡 Ready!\n`);
});
