// server.js - Sistema Lemonade AI para Roblox (FIXED - Ações Estruturadas)
import express from 'express';
import cors from 'cors';

const app = express();

const GEMINI_API_KEY = "AIzaSyAwXC00BXlfyjKJkMQsjtAvf8uUqYiNFOk";
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ============ RATE LIMITER ============

class RateLimiter {
    constructor() {
        this.lastCall = 0;
        this.MIN_DELAY = 5000; // 5 segundos entre chamadas
        this.queues = new Map();
        this.processing = new Map();
    }

    async enqueue(sessionId, task) {
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, []);
            this.processing.set(sessionId, false);
        }

        return new Promise((resolve, reject) => {
            const taskWrapper = { task, resolve, reject };
            this.queues.get(sessionId).push(taskWrapper);
            this.processQueue(sessionId);
        });
    }

    async processQueue(sessionId) {
        const queue = this.queues.get(sessionId);
        if (!queue || queue.length === 0 || this.processing.get(sessionId)) return;

        this.processing.set(sessionId, true);
        const { task, resolve, reject } = queue[0];

        try {
            const now = Date.now();
            const delay = Math.max(0, this.lastCall + this.MIN_DELAY - now);
            
            if (delay > 0) {
                console.log(`⏳ [${sessionId}] Delay: ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }

            console.log(`🚀 [${sessionId}] Chamando Gemini...`);
            const result = await task();
            
            this.lastCall = Date.now();
            queue.shift();
            resolve(result);
            
        } catch (error) {
            if (error.message.includes('429')) {
                console.log(`⚠️ [${sessionId}] Rate limit. Aguardando 10s...`);
                setTimeout(() => {
                    this.processing.set(sessionId, false);
                    this.processQueue(sessionId);
                }, 10000);
                return;
            }
            
            queue.shift();
            reject(error);
            
        } finally {
            this.processing.set(sessionId, false);
            if (queue?.length > 0) {
                setTimeout(() => this.processQueue(sessionId), 100);
            }
        }
    }
}

const rateLimiter = new RateLimiter();
let conversations = new Map();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ SYSTEM PROMPT FOCADO EM AÇÕES ============

const SYSTEM_PROMPT = `# VOCÊ É UM ASSISTENTE DE DESENVOLVIMENTO ROBOX
# SUA TAREFA: ANALISAR E MODIFICAR CÓDIGO USANDO AÇÕES ESTRUTURADAS

## REGRA PRIMÁRIA: NUNCA RETORNE CÓDIGO COMPLETO COMO TEXTO
## SEMPRE RETORNE AÇÕES JSON PARA EDITAR/CRIAR ARQUIVOS

# FORMATO DE RESPOSTA OBRIGATÓRIO:
{
  "thinking": "Análise breve do que precisa ser feito...",
  "response": "Mensagem para o usuário explicando o que será modificado...",
  "actions": [
    {
      "type": "edit",
      "target": "ServerScriptService.MainScript",
      "description": "Adiciona função de limpeza",
      "changes": [
        {
          "line": 45,
          "old": "local function cleanup()",
          "new": "local function cleanup() -- Limpa estado do jogo"
        },
        {
          "line": 46,
          "old": "    print('Cleaning')",
          "new": "    print('✔️ Cleaning up round data.')"
        }
      ]
    },
    {
      "type": "create",
      "target": "ReplicatedStorage.Modules.GameManager",
      "instanceType": "ModuleScript",
      "description": "Cria módulo de gerenciamento",
      "code": "local GameManager = {}\\nfunction GameManager.init()\\n    -- código aqui\\nend\\nreturn GameManager"
    }
  ]
}

# TIPOS DE AÇÃO DISPONÍVEIS:

## 1. EDIT (EDITA LINHAS ESPECÍFICAS)
- Use para modificar partes de scripts existentes
- Especifique linha exata, conteúdo antigo e novo
- Exemplo: Corrigir bug em uma função específica

## 2. CREATE (CRIA NOVO SCRIPT/OBJETO)
- Use para criar novos arquivos
- Forneça código completo para o novo script
- Exemplo: Criar um novo módulo ou sistema

## 3. REWRITE (REESCREVE SCRIPT COMPLETO)
- Use para substituir arquivo inteiro
- Forneça novo código completo
- CUIDADO: Backup mental do código original

## 4. MODIFY (MODIFICA PROPRIEDADES)
- Use para modificar propriedades de instâncias
- Exemplo: Mudar Position, Size, etc.

## 5. DELETE (REMOVE OBJETO)
- Use para deletar scripts/objetos
- SEMPRE confirme antes de deletar

## 6. BATCH (MÚLTIPLAS AÇÕES)
- Use para executar várias ações ao mesmo tempo
- Mantenha ações relacionadas juntas

# EXEMPLOS DE USO:

## USUÁRIO DIZ: "faz a porta abrir mais devagar"
RESPOSTA CORRETA:
\`\`\`json
{
  "thinking": "Usuário quer porta mais lenta. Analisando DoorScript...",
  "response": "Vou ajustar a animação da porta de 0.5s para 2s.",
  "actions": [
    {
      "type": "edit",
      "target": "workspace.Door.DoorScript",
      "description": "Aumenta tempo de animação",
      "changes": [
        {
          "line": 12,
          "old": "local tweenInfo = TweenInfo.new(0.5)",
          "new": "local tweenInfo = TweenInfo.new(2) -- Mais lento"
        }
      ]
    }
  ]
}
\`\`\`

## USUÁRIO DIZ: "corrige o bug no MainScript linha 30"
RESPOSTA CORRETA:
\`\`\`json
{
  "thinking": "Bug na linha 30 do MainScript...",
  "response": "Corrigindo bug de referência nula.",
  "actions": [
    {
      "type": "edit",
      "target": "ServerScriptService.MainScript",
      "description": "Fix null reference bug",
      "changes": [
        {
          "line": 30,
          "old": "local player = Players[playerId]",
          "new": "local player = Players:FindFirstChild(playerId)\\nif not player then return end"
        }
      ]
    }
  ]
}
\`\`\`

## USUÁRIO DIZ: "cria um sistema de inventário"
RESPOSTA CORRETA:
\`\`\`json
{
  "thinking": "Sistema de inventário requer ModuleScript e UI...",
  "response": "Criando sistema de inventário com 20 slots.",
  "actions": [
    {
      "type": "create",
      "target": "ReplicatedStorage.Modules.Inventory",
      "instanceType": "ModuleScript",
      "description": "Módulo principal do inventário",
      "code": "local Inventory = {}\\nInventory.Slots = {}\\nfunction Inventory.addItem(item, slot)\\n    -- implementação\\nend\\nreturn Inventory"
    },
    {
      "type": "create",
      "target": "StarterGui.InventoryUI",
      "instanceType": "ScreenGui",
      "description": "Interface do inventário",
      "properties": {
        "Name": "InventoryUI",
        "ResetOnSpawn": false
      }
    }
  ]
}
\`\`\`

# IMPORTANTE:
1. NUNCA retorne código completo em "response"
2. SEMPRE use "actions" para especificar mudanças
3. Seja específico com números de linha
4. Mantenha "thinking" breve e técnico
5. "response" deve ser amigável para o usuário

# CONTEXTO DO JOGO:
O estado atual será fornecido. Use para:
- Identificar scripts existentes
- Evitar criar duplicatas
- Entender estrutura do projeto

--- VOCÊ ESTÁ PRONTO. SEMPRE RETORNE JSON COM AÇÕES ---`;

// ============ FUNÇÕES ============

function getConversation(sessionId) {
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, {
            messages: [],
            hasSystemPrompt: false,
            messageCount: 0
        });
    }
    return conversations.get(sessionId);
}

function addMessage(sessionId, role, content) {
    const conv = getConversation(sessionId);
    conv.messages.push({ role, content });
    if (role === 'user') {
        conv.messageCount++;
    }
}

async function callGemini(messages) {
    const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: messages.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            })),
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 4000,
                topP: 0.95,
                topK: 40
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

function cleanJSON(text) {
    // Remove qualquer markdown e extrai JSON
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return jsonMatch[0];
    }
    return text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
}

function validateActions(actions) {
    if (!Array.isArray(actions)) return [];
    
    return actions.filter(action => {
        // Valida estrutura básica
        if (!action.type || !action.target || !action.description) return false;
        
        // Validações específicas por tipo
        switch (action.type) {
            case 'edit':
                return Array.isArray(action.changes) && action.changes.length > 0;
            case 'create':
                return action.instanceType && action.code;
            case 'rewrite':
                return action.code;
            case 'modify':
                return action.properties && typeof action.properties === 'object';
            case 'delete':
                return true; // Apenas precisa do target
            case 'batch':
                return Array.isArray(action.actions) && action.actions.length > 0;
            default:
                return false;
        }
    });
}

async function processMessage(sessionId, message, gameState = {}) {
    const conv = getConversation(sessionId);
    
    console.log(`💬 [${sessionId}] Mensagem ${conv.messageCount + 1}`);

    const messagesToSend = [];

    // 1. System Prompt (apenas na primeira vez)
    if (!conv.hasSystemPrompt) {
        messagesToSend.push({ role: 'user', content: SYSTEM_PROMPT });
        conv.hasSystemPrompt = true;
    }

    // 2. Histórico (últimas 3 mensagens)
    const recentMessages = conv.messages.slice(-3);
    messagesToSend.push(...recentMessages);

    // 3. Mensagem atual com contexto
    const gameStateSummary = Object.keys(gameState).length > 0 
        ? `Jogo tem: ${Object.keys(gameState).join(', ')}`
        : 'Estado do jogo vazio ou não fornecido';

    const userMessage = `CONTEXTO: ${gameStateSummary}

SOLICITAÇÃO DO USUÁRIO:
${message}

IMPORTANTE: NÃO RETORNE CÓDIGO COMPLETO COMO TEXTO.
RETORNE APENAS JSON COM AÇÕES ESTRUTURADAS (edit/create/rewrite).`;

    messagesToSend.push({ role: 'user', content: userMessage });

    // 4. Chama Gemini
    console.log(`🤔 [${sessionId}] Gerando ações estruturadas...`);
    let response;
    try {
        response = await callGemini(messagesToSend);
    } catch (error) {
        // Fallback se a API falhar
        console.log(`⚠️ [${sessionId}] API falhou, usando fallback`);
        return {
            thinking: "API temporariamente indisponível",
            response: "Estou com dificuldades técnicas. Tente novamente em alguns segundos.",
            actions: []
        };
    }

    const cleanResponse = cleanJSON(response);
    
    // 5. Parse e validação
    let parsed;
    try {
        parsed = JSON.parse(cleanResponse);
        
        // Garante que actions exista e seja válida
        if (!parsed.actions || !Array.isArray(parsed.actions)) {
            parsed.actions = [];
        }
        
        // Valida cada ação
        parsed.actions = validateActions(parsed.actions);
        
        // Se não tem ações mas tem thinking/response, mantém
        if (!parsed.thinking) parsed.thinking = "Analisando sua solicitação...";
        if (!parsed.response) parsed.response = "Processando suas modificações...";
        
    } catch (e) {
        console.log(`⚠️ [${sessionId}] JSON inválido: ${e.message}`);
        
        // Fallback: converte texto em uma ação de rewrite se parecer código
        if (cleanResponse.includes("local ") || cleanResponse.includes("function ")) {
            parsed = {
                thinking: "Detectei código, criando ação de edição...",
                response: "Encontrei código para modificar. Vou estruturá-lo como uma ação.",
                actions: [{
                    type: "rewrite",
                    target: "ServerScriptService.ScriptCorrecao",
                    description: "Código fornecido pelo usuário",
                    code: cleanResponse
                }]
            };
        } else {
            parsed = {
                thinking: "Resposta não estruturada detectada",
                response: cleanResponse,
                actions: []
            };
        }
    }

    // 6. Salva histórico
    addMessage(sessionId, 'user', message);
    addMessage(sessionId, 'assistant', JSON.stringify(parsed));

    console.log(`✅ [${sessionId}] ${parsed.actions.length} ações geradas`);
    
    return parsed;
}

// ============ ROTAS ============

app.get('/status', (req, res) => {
    res.json({ 
        status: 'online',
        model: GEMINI_MODEL,
        sessions: conversations.size,
        features: ['ações estruturadas', 'rate limiting']
    });
});

app.post('/chat', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { message, sessionId = 'default', gameState = {} } = req.body;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ 
                error: 'Mensagem vazia',
                response: 'Por favor, digite uma mensagem.'
            });
        }

        console.log(`📥 [${sessionId}] "${message.substring(0, 50)}..."`);

        const result = await rateLimiter.enqueue(sessionId, () => 
            processMessage(sessionId, message, gameState)
        );

        const processingTime = Date.now() - startTime;
        console.log(`📤 [${sessionId}] ${processingTime}ms, ${result.actions.length} ações`);
        
        res.json(result);

    } catch (error) {
        console.error(`❌ Erro:`, error.message);
        
        if (error.message.includes('429')) {
            res.status(429).json({ 
                error: 'Rate limit',
                response: 'Muitas requisições. Aguarde 10 segundos.',
                actions: []
            });
        } else {
            res.status(500).json({ 
                error: error.message,
                response: 'Erro ao processar. Tente novamente.',
                actions: []
            });
        }
    }
});

app.post('/reset', (req, res) => {
    const { sessionId = 'default' } = req.body;
    conversations.delete(sessionId);
    console.log(`🗑️ Reset ${sessionId}`);
    res.json({ ok: true });
});

app.get('/', (req, res) => {
    res.json({
        name: 'Lemonade AI - Editor Estruturado',
        version: '4.0',
        model: GEMINI_MODEL,
        description: 'Sistema que retorna ações JSON para editar/criar scripts',
        endpoints: {
            'POST /chat': 'Processa mensagem, retorna ações',
            'POST /reset': 'Reseta conversa',
            'GET /status': 'Status do servidor'
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🍋 Lemonade AI v4.0 - Editor Estruturado');
    console.log('📍 http://localhost:' + PORT);
    console.log('🤖 ' + GEMINI_MODEL);
    console.log('🎯 RETORNA APENAS AÇÕES JSON');
    console.log('⚡ Delay: 5s entre chamadas');
    console.log('═══════════════════════════════════════════════');
});
