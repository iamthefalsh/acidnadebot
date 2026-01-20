// servidor-ai.js
// Servidor Node.js para comunicação entre Plugin e Gemini AI

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Configurações
const GEMINI_API_KEY = 'AIzaSyApWjzIzhjzpg0jMXs43b9Q5LsSOIX5tSg';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Estado global
let currentGameState = null;
let pendingActions = [];

// Rota de status
app.get('/status', (req, res) => {
    res.json({ 
        status: 'online',
        connected: true,
        timestamp: Date.now()
    });
});

// Recebe estado do jogo do Plugin
app.post('/game-state', (req, res) => {
    currentGameState = req.body;
    console.log('✓ Estado do jogo atualizado');
    res.json({ ok: true });
});

// Gera código com Gemini AI
app.post('/generate', async (req, res) => {
    try {
        const { pseudoCode, gameState } = req.body;
        
        console.log('🤖 Gerando código para:', pseudoCode.substring(0, 50) + '...');
        
        // Monta o contexto
        const context = gameState ? JSON.stringify(gameState, null, 2) : 'Nenhum estado disponível';
        
        const systemPrompt = `Você é um especialista em Roblox Lua. Converta pseudocódigo em código Lua funcional.

CONTEXTO DO JOGO:
${context}

REGRAS IMPORTANTES:
1. Gere código Lua COMPLETO e FUNCIONAL
2. Use TweenService para animações suaves
3. Implemente debounce automaticamente quando necessário
4. Valide se os Instances referenciados existem
5. Use WaitForChild para segurança
6. Adicione comentários explicativos
7. RETORNE APENAS O CÓDIGO LUA, SEM MARKDOWN, SEM EXPLICAÇÕES

IMPORTANTE: O código deve ser executável diretamente no Roblox Studio.`;

        const userPrompt = `PSEUDOCÓDIGO:
${pseudoCode}

Converta isso em código Lua funcional seguindo as regras acima.`;

        // Chama Gemini API
        const response = await fetch(GEMINI_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{ 
                        text: `${systemPrompt}\n\n${userPrompt}` 
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 8000,
                }
            })
        });

        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0]) {
            throw new Error('Resposta inválida da Gemini API');
        }

        let generatedText = data.candidates[0].content.parts[0].text;
        
        // Remove markdown code blocks se existirem
        generatedText = generatedText
            .replace(/```lua\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        console.log('✓ Código gerado com sucesso');

        // Cria ação para executar no Plugin
        const action = {
            action: 'create',
            target: 'ServerScriptService.AIGeneratedScript_' + Date.now(),
            instanceType: 'Script',
            code: generatedText,
            description: 'Script gerado pela IA'
        };

        res.json({ 
            code: generatedText,
            action: action
        });

    } catch (error) {
        console.error('❌ Erro ao gerar código:', error.message);
        res.status(500).json({ 
            error: error.message,
            code: '-- Erro ao gerar código\n-- ' + error.message
        });
    }
});

// Modo autônomo - gera plano de ação completo
app.post('/generate-autonomous', async (req, res) => {
    try {
        const { task, gameState } = req.body;
        
        console.log('⚡ Modo autônomo:', task.substring(0, 50) + '...');
        
        const context = gameState ? JSON.stringify(gameState, null, 2) : 'Nenhum estado disponível';
        
        const systemPrompt = `Você é uma IA autônoma especializada em Roblox Studio. 

CONTEXTO DO JOGO:
${context}

TAREFA: Criar um PLANO DE AÇÃO COMPLETO para executar a tarefa do usuário.

FORMATO DE RESPOSTA (JSON VÁLIDO, SEM MARKDOWN):
{
  "plan": "Descrição geral do que será feito",
  "steps": [
    {
      "action": "create",
      "target": "workspace.NovaPart",
      "description": "Cria uma Part no workspace",
      "code": "-- código lua aqui",
      "instanceType": "Part"
    },
    {
      "action": "edit",
      "target": "ServerScriptService.MainScript",
      "description": "Modifica o script principal",
      "code": "-- código modificado",
      "instanceType": "Script"
    }
  ]
}

IMPORTANTE:
- action pode ser: create, edit, delete
- target é o caminho completo (ex: workspace.Folder.Part)
- code deve ser Lua funcional completo
- Crie quantos steps forem necessários`;

        const userPrompt = `TAREFA DO USUÁRIO:
${task}

Crie um plano de ação completo e detalhado em JSON.`;

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
        
        // Remove markdown
        result = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const plan = JSON.parse(result);
        
        console.log('✓ Plano autônomo criado com', plan.steps.length, 'steps');
        
        res.json(plan);

    } catch (error) {
        console.error('❌ Erro no modo autônomo:', error.message);
        res.status(500).json({ 
            error: error.message,
            plan: 'Erro ao criar plano',
            steps: []
        });
    }
});

// Ações pendentes (para polling)
app.get('/pending-actions', (req, res) => {
    const actions = [...pendingActions];
    pendingActions = [];
    res.json({ actions });
});

// Adiciona ação pendente
app.post('/add-action', (req, res) => {
    pendingActions.push(req.body);
    res.json({ ok: true });
});

// Inicia servidor
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🚀 Servidor AI Roblox rodando!');
    console.log('📍 URL: http://localhost:' + PORT);
    console.log('🤖 Modelo: ' + GEMINI_MODEL);
    console.log('═══════════════════════════════════════════════');
});

// Tratamento de erros
process.on('uncaughtException', (error) => {
    console.error('❌ Erro não tratado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Promise rejeitada:', error);
});
