// server.js - Versão Otimizada
import express from 'express';
import cors from 'cors';

const app = express();

// Configurações da API Gemini
const GEMINI_API_KEY = "AIzaSyD_wG2YI7Q6hphOl8eLkoPKD-hxsehSpkI";
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// ============ SISTEMA SIMPLIFICADO DE RATE LIMITING ============

class SimpleRateLimiter {
    constructor() {
        this.queues = new Map();
        this.processing = new Map();
        this.lastCall = new Map();
        this.GLOBAL_DELAY = 1500; // 1.5 segundos entre chamadas GLOBAIS
        this.lastGlobalCall = 0;
    }

    async enqueue(sessionId, task) {
        // Cria fila se não existir
        if (!this.queues.has(sessionId)) {
            this.queues.set(sessionId, []);
            this.processing.set(sessionId, false);
            this.lastCall.set(sessionId, 0);
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
            // Delay baseado no último call global
            const now = Date.now();
            const globalDelay = Math.max(0, this.lastGlobalCall + this.GLOBAL_DELAY - now);
            await new Promise(r => setTimeout(r, globalDelay));

            // Executa a tarefa
            const result = await task();
            
            // Atualiza timestamps
            this.lastCall.set(sessionId, now);
            this.lastGlobalCall = now;
            
            // Remove da fila e resolve
            queue.shift();
            resolve(result);
        } catch (error) {
            // Se for erro 429, espera 10 segundos e tenta de novo
            if (error.message.includes('429') && queue[0]) {
                console.log(`⚠️ [${sessionId}] Rate limit atingido. Aguardando 10s...`);
                setTimeout(() => {
                    this.processing.set(sessionId, false);
                    this.processQueue(sessionId);
                }, 10000);
                return;
            }
            
            // Outro erro: rejeita e remove
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
const rateLimiter = new SimpleRateLimiter();
let conversations = new Map();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// PROMPT SIMPLIFICADO
const SYSTEM_PROMPT = `Você é um assistente de desenvolvimento Roblox. 
Responda em JSON: { "thinking": "análise", "response": "resposta", "actions": [] }`;

// Funções básicas
function getConversation(sessionId) {
    if (!conversations.has(sessionId)) {
        conversations.set(sessionId, { messages: [] });
    }
    return conversations.get(sessionId);
}

// Chama Gemini com retry simplificado
async function callGemini(messages, retryCount = 0) {
    try {
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
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (error) {
        throw error;
    }
}

// Processa mensagem
async function processMessage(sessionId, message, gameState = {}) {
    const conv = getConversation(sessionId);
    
    // Prepara mensagens
    const messages = [];
    
    // Adiciona prompt do sistema se for primeira mensagem
    if (conv.messages.length === 0) {
        messages.push({ role: 'user', content: SYSTEM_PROMPT });
    }
    
    // Adiciona histórico (últimas 3 mensagens)
    messages.push(...conv.messages.slice(-3));
    
    // Adiciona mensagem atual
    const userMessage = `Estado do jogo: ${JSON.stringify(gameState).substring(0, 2000)}...\n\nMensagem: ${message}`;
    messages.push({ role: 'user', content: userMessage });
    
    // Chama Gemini
    const response = await callGemini(messages);
    
    // Limpa e parseia
    const clean = response.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    let parsed;
    try {
        parsed = JSON.parse(clean);
    } catch {
        parsed = { thinking: "", response: clean, actions: [] };
    }
    
    // Salva no histórico
    conv.messages.push({ role: 'user', content: message });
    conv.messages.push({ role: 'assistant', content: JSON.stringify(parsed) });
    
    return parsed;
}

// ============ ROTAS ============

app.get('/status', (req, res) => {
    res.json({ status: 'online', model: GEMINI_MODEL, sessions: conversations.size });
});

app.post('/chat', async (req, res) => {
    try {
        const { message, sessionId = 'default', gameState = {} } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        // Enfileira a requisição
        const result = await rateLimiter.enqueue(sessionId, () => 
            processMessage(sessionId, message, gameState)
        );
        
        res.json(result);
    } catch (error) {
        console.error('Chat error:', error.message);
        
        if (error.message.includes('429')) {
            res.status(429).json({ 
                error: 'Rate limit exceeded. Please wait 10 seconds.',
                response: "Desculpe, estou recebendo muitas requisições. Tente novamente em 10 segundos."
            });
        } else {
            res.status(500).json({ 
                error: error.message,
                response: "Erro ao processar sua mensagem."
            });
        }
    }
});

app.post('/reset', (req, res) => {
    const { sessionId = 'default' } = req.body;
    conversations.delete(sessionId);
    res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🍋 Lemonade AI rodando na porta ${PORT}`);
});
