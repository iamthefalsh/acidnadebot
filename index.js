// server.js - Sistema Lemonade AI para Roblox com Rate Limiting
// Sistema conversacional com multi-edit e pensamento em batches

import express from 'express';
import cors from 'cors';

const app = express();

const GEMINI_API_KEY = "AIzaSyApWjzIzhjzpg0jMXs43b9Q5LsSOIX5tSg";
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ============ SISTEMA DE RATE LIMITING E FILA ============

class RateLimiter {
    constructor() {
        this.queues = new Map(); // sessionId -> queue
        this.processing = new Map(); // sessionId -> boolean
        this.limits = new Map(); // sessionId -> { lastCall: timestamp, retryCount: number }
        this.globalLastCall = 0;
        this.MIN_INTERVAL = 2000; // 2 segundos mínimo entre chamadas da mesma sessão
        this.GLOBAL_MIN_INTERVAL = 1000; // 1 segundo mínimo entre chamadas globais
        this.MAX_RETRIES = 5;
    }

    // Adiciona uma tarefa à fila da sessão
    async addTask(sessionId, taskFn) {
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, []);
            this.processing.set(sessionId, false);
            this.limits.set(sessionId, { lastCall: 0, retryCount: 0 });
        }

        return new Promise((resolve, reject) => {
            const task = {
                id: Date.now() + Math.random(),
                execute: taskFn,
                resolve,
                reject,
                retries: 0,
                maxRetries: this.MAX_RETRIES
            };

            this.queues.get(sessionId).push(task);
            this.processQueue(sessionId);
            
            // Timeout de segurança (30 segundos)
            setTimeout(() => {
                if (!task.resolved) {
                    task.reject(new Error('Timeout na fila de processamento'));
                }
            }, 30000);
        });
    }

    // Processa a próxima tarefa da fila da sessão
    async processQueue(sessionId) {
        const queue = this.queues.get(sessionId);
        const isProcessing = this.processing.get(sessionId);

        if (!queue || queue.length === 0 || isProcessing) {
            return;
        }

        this.processing.set(sessionId, true);
        const task = queue[0];

        try {
            // Calcula delay necessário baseado em rate limits
            const now = Date.now();
            const sessionLimit = this.limits.get(sessionId);
            const sessionDelay = Math.max(0, sessionLimit.lastCall + this.MIN_INTERVAL - now);
            const globalDelay = Math.max(0, this.globalLastCall + this.GLOBAL_MIN_INTERVAL - now);
            const delay = Math.max(sessionDelay, globalDelay);

            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }

            // Executa a tarefa
            const result = await task.execute();
            
            // Atualiza timestamps
            sessionLimit.lastCall = Date.now();
            sessionLimit.retryCount = 0; // Reset retries on success
            this.globalLastCall = Date.now();
            
            // Remove task da fila e resolve
            queue.shift();
            task.resolved = true;
            task.resolve(result);

        } catch (error) {
            // Tratamento de erro 429 com backoff exponencial
            if (error.message.includes('429') && task.retries < task.maxRetries) {
                task.retries++;
                sessionLimit.retryCount++;
                
                // Backoff exponencial: 2s → 4s → 8s → 16s → 32s
                const backoffTime = Math.min(32000, Math.pow(2, task.retries) * 1000);
                
                console.log(`⚠️ [${sessionId}] Erro 429. Tentativa ${task.retries}/${task.maxRetries}. Aguardando ${backoffTime}ms...`);
                
                // Move a task para o final da fila com delay
                queue.shift();
                setTimeout(() => {
                    queue.push(task);
                    this.processing.set(sessionId, false);
                    this.processQueue(sessionId);
                }, backoffTime);
                
                return;
            }
            
            // Se não for 429 ou excedeu retries, rejeita
            queue.shift();
            task.resolved = true;
            task.reject(error);
        } finally {
            // Continua processando a fila
            this.processing.set(sessionId, false);
            if (queue.length > 0) {
                setTimeout(() => this.processQueue(sessionId), 0);
            }
        }
    }

    // Retorna estatísticas das filas
    getStats() {
        const stats = {};
        let totalQueued = 0;
        let totalProcessing = 0;

        this.queues.forEach((queue, sessionId) => {
            stats[sessionId] = {
                queued: queue.length,
                processing: this.processing.get(sessionId),
                lastCall: this.limits.get(sessionId)?.lastCall || 0,
                retryCount: this.limits.get(sessionId)?.retryCount || 0
            };
            totalQueued += queue.length;
            if (this.processing.get(sessionId)) totalProcessing++;
        });

        return {
            sessions: stats,
            totals: {
                activeSessions: this.queues.size,
                totalQueued,
                totalProcessing,
                globalLastCall: this.globalLastCall
            }
        };
    }

    // Limpa fila de uma sessão específica
    clearSessionQueue(sessionId) {
        if (this.queues.has(sessionId)) {
            const queue = this.queues.get(sessionId);
            queue.forEach(task => {
                if (!task.resolved) {
                    task.reject(new Error('Fila limpa pelo usuário'));
                }
            });
            this.queues.set(sessionId, []);
            this.processing.set(sessionId, false);
        }
    }
}

// Inicializa rate limiter global
const rateLimiter = new RateLimiter();

// Estado global
let currentGameState = null;
let conversations = new Map(); // sessionId -> conversa

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// PROMPT SISTEMA PRINCIPAL - O cérebro do agente
const SYSTEM_PROMPT = `Você é um AGENTE DE DESENVOLVIMENTO AUTÔNOMO para Roblox Studio, similar ao Cursor/Windsurf.

# IDENTIDADE E PAPEL
Você é um desenvolvedor Roblox experiente que pode:
- Conversar naturalmente sobre desenvolvimento
- Analisar código e arquitetura existente
- Criar, editar e deletar qualquer coisa no jogo
- Fazer múltiplas modificações de uma vez
- Pensar profundamente antes de agir

# CAPACIDADES TÉCNICAS

## Multi-Edit System
Você pode editar QUALQUER COISA simultaneamente:
- Múltiplos scripts (editar linhas específicas ou reescrever completo)
- Múltiplas instâncias (criar, modificar propriedades, deletar)
- Múltiplos arquivos ao mesmo tempo
- Operações em batch otimizadas

## Tipos de Ação
1. **create** - Criar novo script/objeto
2. **edit** - Editar linhas específicas de um script
3. **rewrite** - Reescrever script completo
4. **modify** - Modificar propriedades de instância
5. **delete** - Deletar objeto
6. **batch** - Executar múltiplas ações

# PROCESSO DE PENSAMENTO (CRÍTICO!)

Quando receber uma solicitação, você DEVE seguir este processo em 2 ETAPAS:

## ETAPA 1: PENSAMENTO (thinking)
Analise profundamente:
- O que o usuário quer?
- Qual o estado atual do jogo?
- Quais arquivos/objetos precisam ser modificados?
- Qual a melhor abordagem?
- Há dependências ou ordem de execução?
- Quais são os riscos ou problemas potenciais?

## ETAPA 2: AÇÃO (actions)
Depois de pensar, execute as ações necessárias.

# FORMATO DE RESPOSTA

Você SEMPRE responde em JSON com esta estrutura
EXEMPLO:

\`\`\`json
{
  "thinking": "Análise detalhada do que precisa ser feito, considerações técnicas, plano de ação...",
  "response": "Mensagem amigável para o usuário explicando o que você vai fazer",
  "actions": [
    {
      "type": "edit",
      "target": "ServerScriptService.MainScript",
      "description": "Adiciona sistema de pontuação",
      "changes": [
        {
          "line": 15,
          "old": "local score = 0",
          "new": "local score = 100 -- Valor inicial aumentado"
        }
      ]
    },
    {
      "type": "create",
      "target": "ReplicatedStorage.Modules.ScoreManager",
      "instanceType": "ModuleScript",
      "description": "Cria módulo de gerenciamento de pontuação",
      "code": "local ScoreManager = {}\\n..."
    }
  ],
  "needsMoreInfo": false,
  "followUpQuestion": null
}
\`\`\`

# REGRAS IMPORTANTES

1. **SEMPRE pense antes de agir** - thinking é obrigatório
2. **Seja específico** - nomes exatos, linhas exatas
3. **Explique suas decisões** - o usuário precisa entender
4. **Use boas práticas** - código limpo, comentado, eficiente
5. **Considere o contexto** - analise o que já existe antes de criar
6. **Seja conversacional** - responda de forma amigável
7. **Peça confirmação** para mudanças grandes/destrutivas
8. **Multi-edit quando possível** - otimize operações em batch

# EXEMPLOS DE INTERAÇÃO

## Exemplo 1: Edição Simples
User: "faz a porta abrir mais devagar"

Response:
\`\`\`json
{
  "thinking": "Usuário quer que a porta abra mais devagar. Analisando o código da porta... Encontrei DoorScript com TweenService usando 0.5 segundos. Vou aumentar para 2 segundos para movimento mais suave.",
  "response": "Entendi! Vou ajustar a animação da porta para abrir em 2 segundos ao invés de 0.5. Isso vai deixar bem mais suave.",
  "actions": [
    {
      "type": "edit",
      "target": "workspace.Door.DoorScript",
      "changes": [
        {
          "line": 12,
          "old": "local tweenInfo = TweenInfo.new(0.5)",
          "new": "local tweenInfo = TweenInfo.new(2) -- Animação mais lenta"
        }
      ]
    }
  ]
}
\`\`\`

## Exemplo 2: Criação Complexa
User: "cria um sistema de inventário completo com UI"

Response:
\`\`\`json
{
  "thinking": "Sistema de inventário completo requer: 1) ModuleScript para lógica, 2) RemoteEvents para client-server, 3) UI no StarterGui, 4) Sistema de salvamento. Vou criar estrutura modular e escalável.",
  "response": "Vou criar um sistema de inventário completo! Isso inclui:\\n- Módulo de gerenciamento (20 slots)\\n- UI responsiva\\n- Sistema de drag & drop\\n- Salvamento automático\\n\\nSerão 5 arquivos criados. Quer que eu prossiga?",
  "actions": [...],
  "needsMoreInfo": false
}
\`\`\`

# CONTEXTO DO JOGO
O estado atual do jogo será fornecido em cada mensagem. Use-o para:
- Entender estrutura existente
- Evitar conflitos de nomes
- Identificar dependências
- Fazer decisões informadas

# SEGURANÇA
- Nunca delete sem confirmar
- Avise sobre mudanças que podem quebrar coisas
- Faça backup mental de código importante
- Sugira testes após mudanças críticas

Agora você está pronto para ajudar o desenvolvedor. Seja proativo, inteligente e útil!`;

// Cria ou recupera conversa
function getConversation(sessionId) {
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, {
            messages: [],
            messageCount: 0,
            lastSystemPrompt: 0
        });
    }
    return conversations.get(sessionId);
}

// Adiciona mensagem à conversa
function addMessage(sessionId, role, content) {
    const conv = getConversation(sessionId);
    conv.messages.push({ role, content });
    if (role === 'user') {
        conv.messageCount++;
    }
}

// Verifica se precisa re-injetar o prompt sistema
function needsSystemPromptRefresh(conv) {
    return conv.messageCount > 0 && conv.messageCount % 4 === 0 && 
           conv.messageCount !== conv.lastSystemPrompt;
}

// Chama Gemini API com tratamento de erro
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
                maxOutputTokens: 8000,
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    if (!data.candidates || !data.candidates[0]) {
        throw new Error('Invalid Gemini response');
    }

    return data.candidates[0].content.parts[0].text;
}

// Limpa resposta JSON
function cleanJSON(text) {
    return text
        .replace(/```json\n?/gi, '')
        .replace(/```\n?/g, '')
        .trim();
}

// Função principal de processamento de chat (mantém a lógica original)
async function processChatMessage(sessionId, message, gameState) {
    const conv = getConversation(sessionId);
    const state = gameState || currentGameState || {};

    console.log(`💬 [${sessionId}] Processando mensagem ${conv.messageCount + 1}`);

    // Monta mensagens para enviar
    let messagesToSend = [];

    // Verifica se precisa re-injetar prompt sistema
    if (conv.messages.length === 0 || needsSystemPromptRefresh(conv)) {
        messagesToSend.push({
            role: 'user',
            content: SYSTEM_PROMPT + '\n\n--- INÍCIO DA CONVERSA ---'
        });
        conv.lastSystemPrompt = conv.messageCount;
        console.log(`🔄 [${sessionId}] Sistema prompt injetado (msg ${conv.messageCount})`);
    }

    // Adiciona histórico da conversa (últimas 10 mensagens)
    const recentMessages = conv.messages.slice(-10);
    messagesToSend.push(...recentMessages);

    // Adiciona mensagem atual do usuário com contexto do jogo
    const userMessage = `ESTADO ATUAL DO JOGO:
\`\`\`json
${JSON.stringify(state, null, 2)}
\`\`\`

MENSAGEM DO USUÁRIO:
${message}`;

    messagesToSend.push({ role: 'user', content: userMessage });

    // PRIMEIRA RODADA: Pensamento
    console.log(`🤔 [${sessionId}] Fase 1: Pensamento...`);
    let response = await callGemini(messagesToSend);
    let cleanResponse = cleanJSON(response);

    // Tenta parsear
    let parsed;
    try {
        parsed = JSON.parse(cleanResponse);
    } catch (e) {
        // Se não é JSON, trata como resposta texto simples
        parsed = {
            thinking: "Processando resposta...",
            response: cleanResponse,
            actions: [],
            needsMoreInfo: false
        };
    }

    // Se tem ações, faz SEGUNDA RODADA de pensamento
    if (parsed.actions && parsed.actions.length > 0) {
        console.log(`🧠 [${sessionId}] Fase 2: Refinamento (${parsed.actions.length} ações)...`);
        
        messagesToSend.push({
            role: 'assistant',
            content: JSON.stringify(parsed)
        });

        messagesToSend.push({
            role: 'user',
            content: `Revise seu plano de ação. Está tudo certo? Há alguma otimização possível? Algum risco que não considerou?

Retorne o JSON final refinado (mesmo formato).`
        });

        const refinedResponse = await callGemini(messagesToSend);
        const refinedClean = cleanJSON(refinedResponse);
        
        try {
            parsed = JSON.parse(refinedClean);
            console.log(`✅ [${sessionId}] Plano refinado!`);
        } catch (e) {
            console.log(`⚠️ [${sessionId}] Usando plano original (refinamento falhou)`);
        }
    }

    // Salva na conversa
    addMessage(sessionId, 'user', message);
    addMessage(sessionId, 'assistant', JSON.stringify(parsed));

    console.log(`✅ [${sessionId}] Processamento completo com ${parsed.actions?.length || 0} ações`);
    
    return parsed;
}

// ============ ROTAS ============

app.get('/status', (req, res) => {
    const stats = rateLimiter.getStats();
    res.json({ 
        status: 'online',
        model: GEMINI_MODEL,
        activeConversations: conversations.size,
        rateLimiter: stats.totals,
        uptime: process.uptime()
    });
});

app.post('/game-state', (req, res) => {
    currentGameState = req.body;
    console.log('✓ Estado do jogo atualizado');
    res.json({ ok: true });
});

// Rota principal de chat com rate limiting
app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId, gameState } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'message é obrigatório' });
        }

        const session = sessionId || 'default';
        
        console.log(`📥 [${session}] Nova mensagem enfileirada: "${message.substring(0, 50)}..."`);

        // Enfileira a tarefa no rate limiter
        const result = await rateLimiter.addTask(session, () => 
            processChatMessage(session, message, gameState)
        );

        res.json(result);

    } catch (error) {
        console.error('❌ Erro no chat:', error.message);
        
        // Determina status code baseado no erro
        let statusCode = 500;
        let errorMessage = 'Desculpe, ocorreu um erro ao processar sua mensagem.';
        
        if (error.message.includes('429')) {
            statusCode = 429;
            errorMessage = 'Serviço ocupado. Por favor, aguarde alguns segundos e tente novamente.';
        } else if (error.message.includes('Timeout')) {
            statusCode = 504;
            errorMessage = 'Tempo limite excedido. O servidor está processando sua solicitação.';
        }
        
        res.status(statusCode).json({ 
            error: error.message,
            response: errorMessage,
            retryAfter: '5s'
        });
    }
});

// Limpa conversa
app.post('/reset-conversation', (req, res) => {
    const { sessionId } = req.body;
    const session = sessionId || 'default';
    
    conversations.delete(session);
    rateLimiter.clearSessionQueue(session);
    
    console.log(`🗑️ [${session}] Conversa e fila resetadas`);
    
    res.json({ 
        ok: true,
        message: `Conversa ${session} resetada com sucesso`
    });
});

// Lista conversas ativas
app.get('/conversations', (req, res) => {
    const list = [];
    conversations.forEach((conv, id) => {
        list.push({
            sessionId: id,
            messageCount: conv.messageCount,
            messages: conv.messages.length,
            lastSystemPrompt: conv.lastSystemPrompt
        });
    });
    
    const stats = rateLimiter.getStats();
    
    res.json({ 
        conversations: list,
        queueStats: stats
    });
});

// Rota para monitoramento da fila
app.get('/queue-status', (req, res) => {
    const stats = rateLimiter.getStats();
    
    res.json({
        timestamp: new Date().toISOString(),
        rateLimiter: stats,
        system: {
            memory: process.memoryUsage(),
            uptime: process.uptime(),
            activeSessions: conversations.size
        }
    });
});

// Rota para limpar fila específica
app.post('/clear-queue', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId é obrigatório' });
    }
    
    rateLimiter.clearSessionQueue(sessionId);
    
    res.json({ 
        ok: true,
        message: `Fila da sessão ${sessionId} limpa`
    });
});

// Rota raiz
app.get('/', (req, res) => {
    const stats = rateLimiter.getStats();
    
    res.json({
        name: 'Lemonade AI - Roblox Studio Agent',
        version: '2.1.0',
        model: GEMINI_MODEL,
        features: [
            'Conversational AI',
            'Multi-edit system',
            'Batch thinking',
            'Context preservation',
            'Auto system prompt refresh',
            'Rate limiting por sessão',
            'Fila inteligente',
            'Retry com backoff exponencial'
        ],
        currentStats: stats.totals,
        routes: [
            'GET  /status',
            'POST /game-state',
            'POST /chat',
            'POST /reset-conversation',
            'GET  /conversations',
            'GET  /queue-status',
            'POST /clear-queue'
        ],
        rateLimiting: {
            minIntervalPerSession: '2s',
            globalMinInterval: '1s',
            maxRetries: 5,
            backoffStrategy: 'exponencial (2s → 4s → 8s → 16s → 32s)'
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🍋 Lemonade AI - Roblox Studio Agent v2.1.0');
    console.log('📍 URL: http://localhost:' + PORT);
    console.log('🤖 Modelo: ' + GEMINI_MODEL);
    console.log('⚡ Rate Limiting: Habilitado');
    console.log('🔄 Retry com Backoff: Habilitado');
    console.log('🎯 Sessões Isoladas: Sim');
    console.log('═══════════════════════════════════════════════');
});

export default app;
