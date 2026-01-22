const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require("express");
const app = express();
app.use(express.json());

// CORS support for multiple origins
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
        res.sendStatus(200);
    } else {
        next();
    }
});

// API Keys from environment or fallback (use env vars in production)
const apiKeys = (process.env.GEMINI_API_KEYS || "AIzaSyD_wG2YI7Q6hphOl8eLkoPKD-hxsehSpkI,AIzaSyAODHxEXWRWVKsP163DqVmZ5uPzOBxm0Q8,AIzaSyALu99r6lLDQtjJGtQlZOyI9cLrhf3KZXE").split(",");
let currentKeyIndex = 0;
const SYSTEM_PROMPT = `
Você é um Agente Autónomo do Roblox Studio.
CAPACIDADES ESPECIAIS:
- Atributos: Você pode ler e sugerir mudanças em Attributes usando obj:SetAttribute() e obj:GetAttribute().
- Leitura por Referência: Se o usuário mencionar um objeto que não está no contexto, use a ação "READ" com o caminho completo (ex: game.ReplicatedStorage.Skins).
- Resolução de Erros: Se o usuário colar um erro do Output, analise a stack trace e sugira o "EDIT" exato.

ESTRUTURA DE DADOS:
Ao receber instâncias, observe a propriedade 'Attributes'. Use-os para lógica de precificação ou configuração de skins.

RESPONDA APENAS JSON: Não inclua explicações fora do JSON. Estrutura de saída esperada:
{
  "thinking": "string",
  "tasks": [
    { "action": "READ|EDIT|CREATE|DELETE|SELECT", "targetPath": "game.ReplicatedStorage.Skins", "targetName":"string", "className":"string", "newSource":"string", "parentName":"string" }
  ]
}
`;

const KNOWLEDGE_INJECTIONS = `
DEFINIÇÕES ADICIONAIS (Knowledge Injections):
- SkinType: string enum (Default, Animated, Accessory)
- Price: number (in-game currency integer)
- Rarity: string (Common, Rare, Epic, Legendary)
- EquipSlot: string (Head, Torso, Legs, Accessory)

Quando sugerir mudanças em atributos, especifique comandos Luau exatos (ex: obj:SetAttribute("Price", 100)).
`;

function extractKeywords(text) {
    if (!text) return [];
    const matches = text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    return Array.from(new Set(matches)).slice(0, 40);
}

function summarizeSelection(selectionContext, instruction) {
    if (!Array.isArray(selectionContext)) return '[]';
    const keywords = extractKeywords(instruction);
    const summary = selectionContext.map(item => {
        const name = (item.Name || '').toLowerCase();
        let hit = false;
        if (keywords.some(k => name.includes(k))) hit = true;
        if (item.Source && keywords.some(k => (item.Source || '').toLowerCase().includes(k))) hit = true;
        if (item.Attributes) {
            for (const [k, v] of Object.entries(item.Attributes)) {
                const pair = (k + ' ' + String(v)).toLowerCase();
                if (keywords.some(kw => pair.includes(kw))) { hit = true; break; }
            }
        }
        if (hit) {
            return Object.assign({}, item, { Source: item.Source ? String(item.Source).slice(0, 4000) : undefined, _included_full: true });
        }
        return { Name: item.Name, ClassName: item.ClassName, Path: item.Path, Attributes: item.Attributes, ChildrenNames: item.ChildrenNames };
    });
    return JSON.stringify(summary, null, 2);
}

async function askGemini(prompt) {
    const genAI = new GoogleGenerativeAI(apiKeys[currentKeyIndex]);
    const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        if (currentKeyIndex < apiKeys.length - 1) {
            currentKeyIndex++;
            return askGemini(prompt);
        }
        throw error;
    }
}

app.post("/process", async (req, res) => {
    try {
        const { instruction, selectionContext, history, readResults } = req.body;

        if (!instruction) {
            return res.status(400).json({ error: "Instrução é obrigatória" });
        }

        const selectionSummary = summarizeSelection(selectionContext, instruction);
        const fullPrompt = `
        ${SYSTEM_PROMPT}
        ${KNOWLEDGE_INJECTIONS}

        HISTÓRICO DA CONVERSA:
        ${JSON.stringify(history)}

        CONTEXTO DE SELEÇÃO (RESUMIDO PARA REDUÇÃO DE TOKENS):
        ${selectionSummary}

        INSTRUÇÃO ATUAL:
        ${instruction}

        SE FORNECIDO, AQUI HÁ READ_RESULTS ENVIADOS PELO PLUGIN (conteúdos de pastas solicitadas):
        ${JSON.stringify(readResults)}

        Observação: se precisar de conteúdo adicional, retorne tarefas com "action":"READ" e um "targetPath".

        RESPONDA NO FORMATO JSON (SEM MARKDOWN):
        {
            "thinking": "Explicação curta do raciocínio",
            "tasks": [
                { "action": "READ|EDIT|CREATE|DELETE|SELECT", "targetPath": "string", "targetName": "string", "className": "string", "newSource": "string", "parentName": "string" }
            ]
        }
        `;

        const responseText = await askGemini(fullPrompt);
        const cleanJson = responseText.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleanJson);
        res.json(parsed);
    } catch (err) {
        console.error("Erro no /process:", err);
        res.status(500).json({ error: err.message });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Root endpoint
app.get("/", (req, res) => {
    res.json({ 
        name: "Gemini AI Editor Server",
        version: "1.0.0",
        endpoint: "/process",
        deployedAt: "https://acidnadebot.vercel.app"
    });
});

// Local server listener (only for development)
const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) {
    app.listen(PORT, () => console.log(`🚀 Servidor Inteligente rodando em http://localhost:${PORT}`));
}

// Export for Vercel
module.exports = app;
