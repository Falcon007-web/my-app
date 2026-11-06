ws.on('message', (message, isBinary) => {
        // Buffer yoki binar ma'lumot kelganini aniq tekshiramiz (provayderlar va kutubxona uchun eng xavfsiz usul)
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
