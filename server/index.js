require('dotenv').config();
const express = require('express');
const next = require('next');
const http = require('http');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./mediasoup-config');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

const port = process.env.PORT || 3000;

let worker;
let router;

async function startMediasoup() {
    worker = await mediasoup.createWorker(config.worker);
    worker.on('died', () => {
        console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
        setTimeout(() => process.exit(1), 2000);
    });

    router = await worker.createRouter(config.router);
    console.log('> Mediasoup worker and router created');
}

app.prepare().then(async () => {
    await startMediasoup();

    const server = express();
    const httpServer = http.createServer(server);
    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // Socket.io connection handler
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        // Get Router RTP Capabilities
        socket.on('getRouterRtpCapabilities', (callback) => {
            callback(router.rtpCapabilities);
        });

        // Create WebRtcTransport
        socket.on('createWebRtcTransport', async (data, callback) => {
            try {
                const transport = await router.createWebRtcTransport(config.webRtcTransport);

                transport.on('dtlsstatechange', (dtlsState) => {
                    if (dtlsState === 'closed') transport.close();
                });

                callback({
                    params: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters,
                    }
                });

                // Store transport in socket for later use (simplified for POC)
                socket.transport = transport;
            } catch (error) {
                console.error('Failed to create transport:', error);
                callback({ error: error.message });
            }
        });

        // Connect WebRtcTransport
        socket.on('connectWebRtcTransport', async ({ dtlsParameters }, callback) => {
            try {
                await socket.transport.connect({ dtlsParameters });
                callback();
            } catch (error) {
                console.error('Failed to connect transport:', error);
                callback({ error: error.message });
            }
        });

        // Produce media
        socket.on('produce', async ({ kind, rtpParameters }, callback) => {
            try {
                const producer = await socket.transport.produce({ kind, rtpParameters });

                producer.on('transportclose', () => {
                    console.log('Producer transport closed');
                    producer.close();
                });

                // Broadcast new producer to other peers
                socket.broadcast.emit('newProducer', { producerId: producer.id });

                callback({ id: producer.id });
            } catch (error) {
                console.error('Failed to produce:', error);
                callback({ error: error.message });
            }
        });

        // Consume media
        socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
            try {
                if (router.canConsume({ producerId, rtpCapabilities })) {
                    const consumer = await socket.transport.consume({
                        producerId,
                        rtpCapabilities,
                        paused: true,
                    });

                    consumer.on('transportclose', () => {
                        console.log('Consumer transport closed');
                        consumer.close();
                    });

                    consumer.on('producerclose', () => {
                        console.log('Producer closed');
                        consumer.close();
                    });

                    callback({
                        params: {
                            id: consumer.id,
                            producerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                        }
                    });

                    // Resume consumer
                    await consumer.resume();
                }
            } catch (error) {
                console.error('Failed to consume:', error);
                callback({ error: error.message });
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    // Default catch-all handler to allow Next.js to handle all other routes
    server.use((req, res) => {
        return handle(req, res);
    });

    httpServer.listen(port, (err) => {
        if (err) throw err;
        console.log(`> Ready on http://localhost:${port}`);
    });
});
