// server.js - Bridge between HTML interface and Roblox Plugin
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 8080;

// Enable CORS for localhost
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// State management
let pluginSessions = new Map();
let pendingResponses = new Map();

// ============ WEB INTERFACE ENDPOINTS ============

// Serve HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'lemonade-ai.html'));
});

// Receive AI response from web interface
app.post('/api/ai-response', (req, res) => {
    const { sessionId, response } = req.body;
    
    console.log('📨 AI Response received for session:', sessionId);
    
    // Store response for plugin to poll
    response.id = Date.now().toString();
    pendingResponses.set(sessionId, response);
    
    res.json({ ok: true, responseId: response.id });
});

// ============ PLUGIN ENDPOINTS ============

// Plugin connects
app.post('/plugin/connect', (req, res) => {
    const { sessionId, connected } = req.body;
    
    console.log('🔌 Plugin connected:', sessionId);
    
    pluginSessions.set(sessionId, {
        connected: true,
        lastSeen: Date.now(),
        gameState: {}
    });
    
    res.json({ ok: true });
});

// Plugin disconnects
app.post('/plugin/disconnect', (req, res) => {
    const { sessionId } = req.body;
    
    console.log('🔌 Plugin disconnected:', sessionId);
    
    pluginSessions.delete(sessionId);
    pendingResponses.delete(sessionId);
    
    res.json({ ok: true });
});

// Plugin sends game state
app.post('/plugin/state', (req, res) => {
    const { sessionId, gameState } = req.body;
    
    const session = pluginSessions.get(sessionId);
    if (session) {
        session.gameState = gameState;
        session.lastSeen = Date.now();
        console.log('📊 Game state updated:', sessionId);
    }
    
    res.json({ ok: true });
});

// Plugin polls for actions
app.get('/plugin/poll', (req, res) => {
    const sessionId = req.query.session;
    
    const session = pluginSessions.get(sessionId);
    if (session) {
        session.lastSeen = Date.now();
    }
    
    const response = pendingResponses.get(sessionId);
    
    if (response) {
        console.log('✅ Sending actions to plugin:', sessionId);
        res.json({ 
            ok: true, 
            response: response 
        });
        
        // Clear after sending
        pendingResponses.delete(sessionId);
    } else {
        res.json({ 
            ok: true, 
            response: null 
        });
    }
});

// ============ STATUS ENDPOINTS ============

app.get('/api/status', (req, res) => {
    const sessions = Array.from(pluginSessions.entries()).map(([id, session]) => ({
        id,
        connected: session.connected,
        lastSeen: session.lastSeen,
        hasGameState: Object.keys(session.gameState).length > 0
    }));
    
    res.json({
        server: 'online',
        activeSessions: sessions.length,
        sessions
    });
});

// Get game state for web interface
app.get('/api/game-state/:sessionId', (req, res) => {
    const session = pluginSessions.get(req.params.sessionId);
    
    if (session) {
        res.json({ 
            ok: true, 
            gameState: session.gameState 
        });
    } else {
        res.json({ 
            ok: false, 
            error: 'Session not found' 
        });
    }
});

// ============ CLEANUP ============

// Remove stale sessions
setInterval(() => {
    const now = Date.now();
    const TIMEOUT = 30000; // 30 seconds
    
    for (const [sessionId, session] of pluginSessions.entries()) {
        if (now - session.lastSeen > TIMEOUT) {
            console.log('🗑️ Removing stale session:', sessionId);
            pluginSessions.delete(sessionId);
            pendingResponses.delete(sessionId);
        }
    }
}, 10000);

// ============ START SERVER ============

app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════');
    console.log('🍋 Lemonade AI Bridge Server');
    console.log('📍 http://localhost:' + PORT);
    console.log('🔗 Open this URL in your browser');
    console.log('🔌 Make sure HttpService is enabled in Roblox');
    console.log('═══════════════════════════════════════════════');
});
