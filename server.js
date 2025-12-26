require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000; // Required for cloud platforms

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Security middleware (optional but recommended)
app.use((req, res, next) => {
    // Skip auth for health check
    if (req.method === 'GET' && req.path === '/') return next();
    
    const clientKey = req.headers['x-acidnade-key'];
    const serverKey = process.env.ACIDNADE_API_KEY;
    
    if (serverKey && clientKey !== serverKey) {
        return res.status(403).json({ error: "Invalid API key" });
    }
    next();
});

// Initialize Gemini
if (!process.env.API_KEY) {
    console.error("ERROR: Missing API_KEY in environment variables");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// Helper functions
function formatChatHistory(history) {
    if (!history || history.length === 0) return "No previous conversation.";
    const recentHistory = history.slice(-10);
    return recentHistory.map(msg => {
        const role = msg.role === "user" ? "User" : "Assistant";
        const metadata = msg.metadata ? ` [${msg.metadata.action || ''}]` : '';
        return `${role}: ${msg.content}${metadata}`;
    }).join('\n');
}

function formatCreatedScripts(scripts) {
    if (!scripts || scripts.length === 0) return "No scripts created yet.";
    return scripts.map(script => {
        return `- ${script.name} (${script.type}): ${script.description}\n  Path: ${script.path}`;
    }).join('\n');
}

// --- HEALTH CHECK ---
app.get('/', (req, res) => {
    res.send('Acidnade AI Server v6.0 - Public Ready');
});

// --- MAIN INTELLIGENCE ENDPOINT ---
app.post('/chat', async (req, res) => {
    try {
        console.log("💬 Request Received");
        const { prompt, chatHistory, createdScripts } = req.body;
        
        const historyContext = formatChatHistory(chatHistory);
        const scriptsContext = formatCreatedScripts(createdScripts);
        
        const systemInstruction = `
You are Lemonade — a senior Roblox Luau engineer with elite standards.

CORE PRINCIPLES:
- You write production-ready, secure, and efficient Luau
- You NEVER use deprecated patterns (e.g., game.Workspace)
- You ALWAYS use game:GetService("ServiceName")
- You document key logic with clear comments (-- explain why, not what)
- You name scripts professionally (e.g., "PetSpawnHandler", not "Script2")

PROJECT CONTEXT:
${scriptsContext}

CONVERSATION HISTORY:
${historyContext}

YOUR BEHAVIOR:
1. For SIMPLE requests (bug fixes, small tweaks, questions):
   - Respond directly in natural language
   - If code is needed, output ONLY raw Luau with documentation comments
   
2. For COMPLEX requests (multi-part systems requiring coordination):
   - First, decide if a plan is truly needed (only if ≥2 scripts are required)
   - If YES, return JSON with { "shouldPlan": true, "plan": [...] }
   - If NO, output code/text directly

PLAN RULES (only when essential):
- Only for requests needing multiple coordinated scripts
- Never for trivial tasks ("fix typo", "hello", "add print", simple bug fixes)
- Each step must be a self-contained script with clear responsibility

RESPONSE FORMAT:
- Simple requests: Direct response (text or code)
- Complex requests: { "shouldPlan": true, "plan": [...] }

USER REQUEST:
${prompt}

Respond appropriately.
`;

        const result = await model.generateContent(systemInstruction);
        let response = result.response.text().trim();

        // Try to parse as JSON (for plan requests)
        try {
            const cleanJson = response.replace(/```json|```/g, '').trim();
            const data = JSON.parse(cleanJson);
            if (data.shouldPlan && Array.isArray(data.plan)) {
                console.log(`✅ Complex request - Plan generated with ${data.plan.length} steps`);
                return res.json({ shouldPlan: true, plan: data.plan });
            }
        } catch (e) {
            // Not JSON → treat as direct response
        }

        // Direct response (code or text)
        const cleanResponse = response
            .replace(/```lua/g, '')
            .replace(/```/g, '')
            .trim();

        console.log("✅ Direct response generated");
        res.json({ response: cleanResponse });

    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- PLAN GENERATION ---
app.post('/plan', async (req, res) => {
    try {
        console.log("🧠 Generating Plan...");
        const { prompt, chatHistory, createdScripts } = req.body;

        const historyContext = formatChatHistory(chatHistory);
        const scriptsContext = formatCreatedScripts(createdScripts);

        const systemInstruction = `
You are Lemonade — a senior Roblox Luau engineer.

CONVERSATION HISTORY:
${historyContext}

PREVIOUSLY CREATED SCRIPTS:
${scriptsContext}

TASK: Break down the user's request into clear steps ONLY if it genuinely requires multiple coordinated scripts.

RULES:
1. Return JSON with "plan" array
2. Each step needs:
   - "description": Clear task description (becomes script name)
   - "type": "server" or "client"
3. Use professional naming (e.g., "RNGRewardSystem", not "script1")
4. Order logically: server → client → UI
5. Create as many steps as needed (no artificial limits)
6. NEVER plan for trivial requests (bug fixes, small changes)

USER REQUEST:
${prompt}

Respond ONLY with valid JSON, no markdown.
`;

        const result = await model.generateContent(systemInstruction);
        let response = result.response.text().trim();
        response = response.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(response);
        
        if (!data.plan || !Array.isArray(data.plan)) {
            throw new Error("Invalid plan format");
        }

        console.log(`✅ Plan generated with ${data.plan.length} steps`);
        res.json({ success: true, plan: data.plan });

    } catch (error) {
        console.error("Plan Error:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            plan: [] 
        });
    }
});

// --- STEP EXECUTION ---
app.post('/step', async (req, res) => {
    try {
        console.log("⚙️ Executing Step...");
        const { prompt, context } = req.body;
        const { originalPrompt, stepDescription, stepIndex, chatHistory, createdScripts } = context || {};

        const historyContext = formatChatHistory(chatHistory);
        const scriptsContext = formatCreatedScripts(createdScripts);

        const systemInstruction = `
You are Lemonade — a senior Roblox Luau engineer.

...
[ALL EXISTING RULES FROM PREVIOUS /step PROMPT] ...
...
ADDITIONAL RULE:
- ADD PROFESSIONAL DOCUMENTATION COMMENTS:
  • Header comment explaining script purpose
  • Inline comments for non-obvious logic
  • Document parameters and return values

...
[KEEP ALL EXISTING NAMING/QUALITY RULES] ...
`;

        // Reconstruct full prompt with documentation requirement
        const fullPrompt = `
You are Lemonade — a senior Roblox Luau engineer with elite standards.

You fully understand:
- The existing architecture
- Previously created scripts and systems
- Naming conventions and shared patterns

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 ABSOLUTE NAMING RULE (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Every script MUST have a descriptive, meaningful name (8-35 chars). Forbidden: single letters, "Script", "Main", "Handler".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 PROJECT CONTEXT (PERSISTENT)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION HISTORY:
${historyContext}

PREVIOUSLY CREATED SCRIPTS:
${scriptsContext}

You MUST:
- Assume existing scripts are present
- Reference their behavior when relevant
- Ensure backward compatibility
- Never duplicate responsibility

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 CURRENT TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK TO EXECUTE:
${stepDescription || prompt}

ORIGINAL REQUEST CONTEXT:
${originalPrompt || "N/A"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 DOCUMENTATION REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALL CODE MUST INCLUDE:
1. Header comment explaining script purpose
2. Inline comments for non-obvious logic (-- explain WHY)
3. Document function parameters/returns
4. Use --[[ for multi-line explanations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧪 QUALITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use game:GetService()
- Avoid magic numbers
- Defensive programming
- No dead code or TODOs
- Clean, production-ready Luau

⛔ OUTPUT: ONLY raw Luau code with -- ScriptName: header. NO markdown.
`;

        const result = await model.generateContent(fullPrompt);
        let code = result.response.text().trim();
        code = code.replace(/```lua/g, '').replace(/```/g, '').trim();

        const scriptNameMatch = code.match(/--[^\n]*ScriptName:[^\n]*([A-Za-z0-9_]+)/);
        let scriptName = scriptNameMatch ? scriptNameMatch[1] : null;

        if (!scriptName || scriptName.length <= 2 || /^[a-zA-Z]$/.test(scriptName)) {
            scriptName = null;
        }

        console.log(`✅ Step ${stepIndex || '?'} executed: ${scriptName || 'Generated'}`);
        res.json({ success: true, code, scriptName, response: code });

    } catch (error) {
        console.error("Step Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- SELF-IMPROVEMENT ---
app.post('/improve', async (req, res) => {
    try {
        console.log("⚡ Self-Improvement Request");
        const { currentSource, instruction, scriptName, chatHistory, createdScripts } = req.body;

        if (!currentSource || !instruction) {
            return res.status(400).json({ success: false, error: "Missing source or instruction" });
        }

        const historyContext = formatChatHistory(chatHistory);
        const scriptsContext = formatCreatedScripts(createdScripts);

        const systemInstruction = `
You are Lemonade — a senior Roblox engineer performing self-improvement.

CONVERSATION HISTORY:
${historyContext}

PREVIOUSLY CREATED SCRIPTS:
${scriptsContext}

TASK: Modify the provided Lua code based on the user's instruction.

RULES:
1. Return ONLY raw Lua code with documentation comments
2. Preserve core functionality
3. Apply changes precisely
4. Ensure backward compatibility
5. Add comments explaining key changes

CURRENT CODE:
${currentSource}

USER INSTRUCTION:
${instruction}

Return the complete modified Lua code.
`;

        const result = await model.generateContent(systemInstruction);
        let cleanCode = result.response.text().trim();
        cleanCode = cleanCode.replace(/```lua/g, '').replace(/```/g, '').trim();

        console.log(`✅ Code improved for: ${scriptName || 'Script'}`);
        res.json({ success: true, code: cleanCode, changes: `Applied: ${instruction}` });

    } catch (error) {
        console.error("Improvement Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Start server on all interfaces (critical for cloud hosting)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Acidnade AI Server v6.0 ready`);
    console.log(`🌍 Listening on http://0.0.0.0:${PORT}`);
    console.log(`\n✅ Endpoints:`);
    console.log(`   POST /chat      - Main intelligence`);
    console.log(`   POST /plan      - Generate plans (complex requests)`);
    console.log(`   POST /step      - Execute plan steps`);
    console.log(`   POST /improve   - Self-improve mode`);
    console.log(`\n🔑 Security: ${process.env.ACIDNADE_API_KEY ? 'Enabled' : 'Disabled (set ACIDNADE_API_KEY to enable)'}`);
    console.log(`\n📡 Public deployment ready!\n`);
});
