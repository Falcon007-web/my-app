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
const sessions = new Map(); // token -> { agentWs, viewers: Set }

wss.on('connection', (ws, req) => {
    let currentToken = null;
    let currentRole = null;

    ws.on('message', (message) => {
        try {
            // WebRTC signaling uchun barcha xabarlar JSON formatida keladi
            const data = JSON.parse(message.toString());

            if (data.type === 'join-agent') {
                currentToken = data.token.trim();
                currentRole = 'agent';
                if (!sessions.has(currentToken)) {
                    sessions.set(currentToken, { agentWs: ws, viewers: new Set() });
                } else {
                    sessions.get(currentToken).agentWs = ws;
                }
                console.log('Rust Agent connected for WebRTC signaling, token:', currentToken);
            } 
            else if (data.type === 'join-viewer') {
                currentToken = data.token.trim();
                currentRole = 'viewer';
                if (!sessions.has(currentToken)) {
                    sessions.set(currentToken, { agentWs: null, viewers: new Set() });
                }
                const session = sessions.get(currentToken);
                session.viewers.add(ws);
                console.log('Browser Viewer connected for WebRTC signaling, token:', currentToken);

                if (session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'joined-success', agentName: 'Desktop-Agent' }));
                }
            }
            // --- WEBRTC SIGNALING (Offer, Answer, ICE Candidates) ---
            else if (data.type === 'offer' || data.type === 'answer' || data.type === 'candidate') {
                const session = sessions.get(currentToken);
                
                if (currentRole === 'viewer') {
                    // Brauzerdan kelgan offer/candidate ni Rust Agentga yo'naltiramiz
                    if (session && session.agentWs && session.agentWs.readyState === WebSocket.OPEN) {
                        session.agentWs.send(message.toString());
                    }
                } else if (currentRole === 'agent') {
                    // Rust Agentdan kelgan answer/candidate ni brauzerdagi viewer(lar)ga yo'naltiramiz
                    if (session && session.viewers) {
                        for (let viewerWs of session.viewers) {
                            if (viewerWs.readyState === WebSocket.OPEN) {
                                viewerWs.send(message.toString());
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error handling signaling message:', e);
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

// Portni faqat 127.0.0.1 ga bog'laymiz (Nginx orqali ishlaydi)
const PORT = 3030;
server.listen(PORT, '127.0.0.1', () => {
    console.log(`WebRTC Signaling Server running on port ${PORT} for domain admin.falconsupportsession.com`);
});
