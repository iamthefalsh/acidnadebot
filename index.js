// server.js - Sistema Lemonade AI para Roblox (FIXED - Rate Limit Solution)
import express from 'express';
import cors from 'cors';

const app = express();

const GEMINI_API_KEY = "AIzaSyAwXC00BXlfyjKJkMQsjtAvf8uUqYiNFOk";
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ============ RATE LIMITER SIMPLIFICADO ============

class RateLimiter {
    constructor() {
        this.lastCall = 0;
        this.MIN_DELAY = 5000; // 5 segundos entre chamadas (aumentado para evitar 429)
        this.queues = new Map(); // Por sessão
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
            // Delay global obrigatório
            const now = Date.now();
            const delay = Math.max(0, this.lastCall + this.MIN_DELAY - now);
            
            if (delay > 0) {
                console.log(`⏳ [${sessionId}] Delay global: ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
            }

            // Executa a tarefa
            console.log(`🚀 [${sessionId}] Chamando Gemini...`);
            const result = await task();
            
            // Atualiza timestamp da última chamada
            this.lastCall = Date.now();
            
            // Remove da fila e resolve
            queue.shift();
            resolve(result);
            
        } catch (error) {
            // Tratamento específico para 429
            if (error.message.includes('429')) {
                console.log(`⚠️ [${sessionId}] Rate limit detectado. Aguardando 10s...`);
                
                // Aguarda 10 segundos e tenta de novo (mantém na fila)
                setTimeout(() => {
                    this.processing.set(sessionId, false);
                    this.processQueue(sessionId);
                }, 10000);
                return;
            }
            
            // Outro erro: remove e rejeita
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

// Inicializa rate limiter
const rateLimiter = new RateLimiter();

// Estado das conversas
let conversations = new Map(); // sessionId -> {messages: [], hasSystemPrompt: boolean}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============ SYSTEM PROMPT COMPLETO ============

const SYSTEM_PROMPT = `Você é um AGENTE DE DESENVOLVIMENTO AUTÔNOMO para Roblox Studio.

# IDENTIDADE
Você é um desenvolvedor Roblox experiente especializado em:
- Criar, editar e deletar scripts/objetos
- Análise de código e arquitetura
- Modificações múltiplas simultâneas
- Pensamento profundo antes de agir

# FORMATO DE RESPOSTA OBRIGATÓRIO
Você SEMPRE responde em JSON com este formato:
{
  "thinking": "Análise detalhada aqui...",
  "response": "Resposta amigável ao usuário...",
  "actions": [
    {
      "type": "edit/create/rewrite/modify/delete/batch",
      "target": "caminho.do.objeto",
      "description": "descrição da ação",
      // ... outros campos específicos do tipo
    }
  ],
  "needsMoreInfo": false,
  "followUpQuestion": null
}

# TIPOS DE AÇÃO SUPORTADOS
1. create - Criar novo script/objeto
2. edit - Editar linhas específicas
3. rewrite - Reescrever script completo
4. modify - Modificar propriedades
5. delete - Deletar objeto
6. batch - Múltiplas ações

# PROCESSO DE PENSAMENTO
1. ANALISE: O que o usuário quer? Estado atual do jogo?
2. PLANO: Qual melhor abordagem? Riscos?
3. AÇÃO: Execute as modificações necessárias.

# CONTEXTO DO JOGO
O estado atual será fornecido. Use para:
- Evitar conflitos de nomes
- Identificar dependências
- Tomar decisões informadas

# SEGURANÇA
- Confirme mudanças grandes/destrutivas
- Sugira testes após mudanças críticas
- Mantenha boas práticas de código

--- AGORA VOCÊ ESTÁ PRONTO PARA AJUDAR ---`;

// ============ FUNÇÕES AUXILIARES ============

// Obtém ou cria conversa
function getConversation(sessionId) {
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, {
            messages: [], // Histórico completo
            hasSystemPrompt: false, // Flag para verificar se já enviou o system prompt
            messageCount: 0
        });
    }
    return conversations.get(sessionId);
}

// Adiciona mensagem ao histórico
function addMessage(sessionId, role, content) {
    const conv = getConversation(sessionId);
    conv.messages.push({ role, content });
    if (role === 'user') {
        conv.messageCount++;
    }
}

// Chama a API Gemini
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
                maxOutputTokens: 4000, // Reduzido para evitar custos
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

// Processa uma mensagem (APENAS 1 CHAMADA GEMINI)
async function processMessage(sessionId, message, gameState = {}) {
    const conv = getConversation(sessionId);
    
    console.log(`💬 [${sessionId}] Processando mensagem ${conv.messageCount + 1}`);

    // Prepara mensagens para enviar
    const messagesToSend = [];

    // 1. Se for primeira mensagem, adiciona SYSTEM_PROMPT completo
    if (!conv.hasSystemPrompt) {
        console.log(`📋 [${sessionId}] Enviando SYSTEM_PROMPT completo...`);
        messagesToSend.push({ role: 'user', content: SYSTEM_PROMPT });
        conv.hasSystemPrompt = true; // Marca que já enviou
    }

    // 2. Adiciona histórico da conversa (últimas 4 mensagens para contexto)
    const recentMessages = conv.messages.slice(-4); // Mantém contexto curto
    messagesToSend.push(...recentMessages);

    // 3. Adiciona mensagem atual com gameState
    const userMessage = `ESTADO ATUAL DO JOGO:
${JSON.stringify(gameState, null, 2).substring(0, 3000)}... (truncado se muito grande)

MENSAGEM DO USUÁRIO:
${message}`;

    messagesToSend.push({ role: 'user', content: userMessage });

    // 4. Chama Gemini (APENAS UMA VEZ)
    console.log(`🤔 [${sessionId}] Pensando e gerando ações...`);
    const response = await callGemini(messagesToSend);
    const cleanResponse = cleanJSON(response);

    // 5. Parseia a resposta
    let parsed;
    try {
        parsed = JSON.parse(cleanResponse);
    } catch (e) {
        console.log(`⚠️ [${sessionId}] JSON inválido, usando fallback`);
        parsed = {
            thinking: "Processando sua solicitação...",
            response: cleanResponse,
            actions: [],
            needsMoreInfo: false
        };
    }

    // 6. Salva no histórico (AMBAS as mensagens)
    addMessage(sessionId, 'user', message);
    addMessage(sessionId, 'assistant', JSON.stringify(parsed));

    console.log(`✅ [${sessionId}] Processado com ${parsed.actions?.length || 0} ações`);
    
    return parsed;
}

// ============ ROTAS ============

// Status do servidor
app.get('/status', (req, res) => {
    res.json({ 
        status: 'online',
        model: GEMINI_MODEL,
        activeSessions: conversations.size,
        rateLimitDelay: rateLimiter.MIN_DELAY + 'ms'
    });
});

// Atualiza estado do jogo
app.post('/game-state', (req, res) => {
    console.log('✓ Estado do jogo recebido');
    res.json({ ok: true });
});

// Rota principal de chat
app.post('/chat', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { message, sessionId = 'default', gameState = {} } = req.body;
        
        if (!message || message.trim() === '') {
            return res.status(400).json({ 
                error: 'Mensagem é obrigatória',
                response: 'Por favor, digite uma mensagem.'
            });
        }

        console.log(`📥 [${sessionId}] Nova mensagem: "${message.substring(0, 50)}..."`);

        // Enfileira no rate limiter
        const result = await rateLimiter.enqueue(sessionId, () => 
            processMessage(sessionId, message, gameState)
        );

        const processingTime = Date.now() - startTime;
        console.log(`📤 [${sessionId}] Respondido em ${processingTime}ms`);

        res.json({
            ...result,
            sessionId,
            processingTime: processingTime + 'ms'
        });

    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ Erro após ${processingTime}ms:`, error.message);
        
        let statusCode = 500;
        let errorMessage = 'Desculpe, ocorreu um erro ao processar sua mensagem.';
        
        if (error.message.includes('429')) {
            statusCode = 429;
            errorMessage = 'Rate limit da API atingido. Por favor, aguarde 10 segundos antes de tentar novamente.';
        }
        
        res.status(statusCode).json({ 
            error: error.message,
            response: errorMessage,
            retryAfter: '10s'
        });
    }
});

// Limpa conversa
app.post('/reset-conversation', (req, res) => {
    const { sessionId = 'default' } = req.body;
    
    conversations.delete(sessionId);
    console.log(`🗑️ Conversa ${sessionId} resetada`);
    
    res.json({ 
        ok: true,
        message: `Conversa ${sessionId} resetada com sucesso`
    });
});

// Lista conversas ativas
app.get('/conversations', (req, res) => {
    const list = [];
    conversations.forEach((conv, id) => {
        list.push({
            sessionId: id,
            messageCount: conv.messageCount,
            hasSystemPrompt: conv.hasSystemPrompt,
            historyLength: conv.messages.length
        });
    });
    
    res.json({ 
        conversations: list,
        total: list.length
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.json({
        name: 'Lemonade AI - Roblox Studio Agent',
        version: '3.0',
        model: GEMINI_MODEL,
        features: [
            'Conversational AI',
            'Multi-edit system',
            'Context preservation',
            'System prompt memory',
            'Rate limiting (5s delay)',
            'Single Gemini call per request'
        ],
        endpoints: [
            'GET  /status',
            'POST /game-state',
            'POST /chat',
            'POST /reset-conversation',
            'GET  /conversations'
        ]
    });
});

// Inicia servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🍋 Lemonade AI v3.0 - Sistema Corrigido');
    console.log('📍 URL: http://localhost:' + PORT);
    console.log('🤖 Modelo: ' + GEMINI_MODEL);
    console.log('⚡ Rate Limit: 1 chamada a cada 5 segundos');
    console.log('🧠 Sistema: Prompt enviado apenas na 1ª mensagem');
    console.log('📝 Memória: Contexto mantido (últimas 4 mensagens)');
    console.log('═══════════════════════════════════════════════');
});

export default app;
