// index.js
// Backend AI Roblox com Express para Vercel

const express = require('express');
const cors = require('cors');

const app = express();

const GEMINI_API_KEY = 'AIzaSyApWjzIzhjzpg0jMXs43b9Q5LsSOIX5tSg';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

let currentGameState = null;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ ROTA: STATUS ============
app.get('/status', (req, res) => {
    console.log('✓ Status check');
    res.json({ 
        status: 'online',
        connected: true,
        timestamp: Date.now(),
        model: GEMINI_MODEL
    });
});

// ============ ROTA: GAME STATE ============
app.post('/game-state', (req, res) => {
    currentGameState = req.body;
    console.log('✓ Estado do jogo recebido');
    res.json({ ok: true });
});

// ============ ROTA: GERAR CÓDIGO ============
app.post('/generate', async (req, res) => {
    try {
        const { pseudoCode, gameState } = req.body;
        
        if (!pseudoCode) {
            return res.status(400).json({ 
                error: 'pseudoCode é obrigatório',
                code: '-- Erro: pseudoCode não fornecido'
            });
        }

        console.log('🤖 Gerando código:', pseudoCode.substring(0, 50) + '...');
        
        const context = gameState || currentGameState || {};
        const contextStr = JSON.stringify(context, null, 2);
        
        const systemPrompt = `Você é um especialista em Roblox Lua. Converta pseudocódigo em código Lua funcional.

CONTEXTO DO JOGO:
${contextStr}

REGRAS IMPORTANTES:
1. Gere código Lua COMPLETO e FUNCIONAL
2. Use TweenService para animações suaves
3. Implemente debounce automaticamente quando necessário
4. Valide se os Instances referenciados existem no contexto
5. Use WaitForChild para segurança
6. Adicione comentários explicativos em português
7. RETORNE APENAS O CÓDIGO LUA, SEM MARKDOWN (\`\`\`lua), SEM EXPLICAÇÕES

IMPORTANTE: O código deve ser executável diretamente no Roblox Studio.`;

        const userPrompt = `PSEUDOCÓDIGO:
${pseudoCode}

Converta isso em código Lua funcional seguindo as regras acima.`;

        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8000,
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro Gemini API:', errorText);
            throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0]) {
            console.error('❌ Resposta inválida:', JSON.stringify(data));
            throw new Error('Resposta inválida da Gemini API');
        }

        let generatedText = data.candidates[0].content.parts[0].text;
        
        generatedText = generatedText
            .replace(/```lua\n?/gi, '')
            .replace(/```\n?/g, '')
            .trim();

        console.log('✓ Código gerado!');

        const timestamp = Date.now();
        const action = {
            action: 'create',
            target: `ServerScriptService.AIScript_${timestamp}`,
            instanceType: 'Script',
            code: generatedText,
            description: 'Script gerado pela IA'
        };

        res.json({ 
            code: generatedText,
            action: action,
            timestamp: timestamp
        });

    } catch (error) {
        console.error('❌ Erro:', error.message);
        res.status(500).json({ 
            error: error.message,
            code: `-- Erro ao processar\n-- ${error.message}`
        });
    }
});

// ============ ROTA: MODO AUTÔNOMO ============
app.post('/generate-autonomous', async (req, res) => {
    try {
        const { task, gameState } = req.body;
        
        if (!task) {
            return res.status(400).json({ 
                error: 'task é obrigatório',
                plan: 'Erro',
                steps: []
            });
        }

        console.log('⚡ Modo autônomo:', task.substring(0, 50) + '...');
        
        const context = gameState || currentGameState || {};
        const contextStr = JSON.stringify(context, null, 2);
        
        const systemPrompt = `Você é uma IA autônoma especializada em Roblox Studio.

CONTEXTO DO JOGO:
${contextStr}

TAREFA: Criar um PLANO DE AÇÃO COMPLETO em JSON.

FORMATO (SEM MARKDOWN, APENAS JSON):
{
  "plan": "Descrição do que será feito",
  "steps": [
    {
      "action": "create",
      "target": "workspace.NovaPart",
      "description": "Descrição da ação",
      "code": "-- código lua completo",
      "instanceType": "Part"
    }
  ]
}

REGRAS:
- action: create, edit, delete
- target: caminho completo
- code: Lua funcional completo
- Crie quantos steps necessários`;

        const userPrompt = `TAREFA:
${task}

Crie um plano de ação completo em JSON (sem markdown).`;

        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8000,
                }
            })
        });

        const data = await response.json();
        let result = data.candidates[0].content.parts[0].text;
        
        result = result.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
        
        const plan = JSON.parse(result);
        
        console.log('✓ Plano criado com', plan.steps?.length || 0, 'steps');
        
        res.json(plan);

    } catch (error) {
        console.error('❌ Erro:', error.message);
        res.status(500).json({ 
            error: error.message,
            plan: 'Erro ao criar plano',
            steps: []
        });
    }
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        message: 'Roblox AI Backend',
        status: 'online',
        routes: [
            'GET  /status',
            'POST /game-state',
            'POST /generate',
            'POST /generate-autonomous'
        ]
    });
});

// Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`🤖 Modelo Gemini: ${GEMINI_MODEL}`);
});

// Exporta o app para Vercel
module.exports = app;
