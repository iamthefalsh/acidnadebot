const GEMINI_API_KEY = 'AIzaSyApWjzIzhjzpg0jMXs43b9Q5LsSOIX5tSg';
const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Variável global para estado (resetada entre cold starts)
global.currentGameState = global.currentGameState || null;

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { pathname } = new URL(req.url, `https://${req.headers.host}`);

    try {
        // ============ ROTA: STATUS ============
        if (pathname === '/status' && req.method === 'GET') {
            console.log('✓ Status check');
            return res.status(200).json({ 
                status: 'online',
                connected: true,
                timestamp: Date.now(),
                model: GEMINI_MODEL
            });
        }

        // ============ ROTA: GAME STATE ============
        if (pathname === '/game-state' && req.method === 'POST') {
            global.currentGameState = req.body;
            console.log('✓ Estado do jogo recebido');
            return res.status(200).json({ ok: true });
        }

        // ============ ROTA: GERAR CÓDIGO ============
        if (pathname === '/generate' && req.method === 'POST') {
            const { pseudoCode, gameState } = req.body;
            
            if (!pseudoCode) {
                return res.status(400).json({ 
                    error: 'pseudoCode é obrigatório',
                    code: '-- Erro: pseudoCode não fornecido'
                });
            }

            console.log('🤖 Gerando código para:', pseudoCode.substring(0, 50) + '...');
            
            const context = gameState || global.currentGameState || {};
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
7. RETORNE APENAS O CÓDIGO LUA, SEM MARKDOWN (```lua), SEM EXPLICAÇÕES

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
            
            // Remove markdown code blocks
            generatedText = generatedText
                .replace(/```lua\n?/gi, '')
                .replace(/```\n?/g, '')
                .trim();

            console.log('✓ Código gerado com sucesso!');

            // Cria ação para executar no Plugin
            const timestamp = Date.now();
            const action = {
                action: 'create',
                target: `ServerScriptService.AIScript_${timestamp}`,
                instanceType: 'Script',
                code: generatedText,
                description: 'Script gerado pela IA'
            };

            return res.status(200).json({ 
                code: generatedText,
                action: action,
                timestamp: timestamp
            });
        }

        // ============ ROTA: MODO AUTÔNOMO ============
        if (pathname === '/generate-autonomous' && req.method === 'POST') {
            const { task, gameState } = req.body;
            
            if (!task) {
                return res.status(400).json({ 
                    error: 'task é obrigatório',
                    plan: 'Erro',
                    steps: []
                });
            }

            console.log('⚡ Modo autônomo:', task.substring(0, 50) + '...');
            
            const context = gameState || global.currentGameState || {};
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
- target: caminho completo (ex: workspace.Folder.Object)
- code: Lua funcional e completo
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
            
            // Remove markdown
            result = result.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
            
            const plan = JSON.parse(result);
            
            console.log('✓ Plano criado com', plan.steps?.length || 0, 'steps');
            
            return res.status(200).json(plan);
        }

        // Rota não encontrada
        return res.status(404).json({ 
            error: 'Rota não encontrada',
            available: ['/status', '/game-state', '/generate', '/generate-autonomous']
        });

    } catch (error) {
        console.error('❌ Erro no handler:', error.message);
        return res.status(500).json({ 
            error: error.message,
            code: `-- Erro ao processar requisição\n-- ${error.message}`,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
