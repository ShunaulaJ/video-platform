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

    // Track connected peers
    const connectedPeers = new Set();
    // Track producers with ownership (socketId -> producerIds)
    const producers = new Map();
    const producerToSocket = new Map(); // producerId -> socketId

    // Socket.io connection handler
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        if (connectedPeers.size >= 2) {
            console.log('Room full, rejecting client:', socket.id);
            socket.emit('roomFull');
            socket.disconnect(true);
            return;
        }

        connectedPeers.add(socket.id);

        // Get Router RTP Capabilities
        socket.on('getRouterRtpCapabilities', (callback) => {
            callback(router.rtpCapabilities);
        });

        // Create WebRtcTransport
        socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
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

                // Store transport in socket
                if (consumer) {
                    socket.consumerTransport = transport;
                } else {
                    socket.producerTransport = transport;
                }
            } catch (error) {
                console.error('Failed to create transport:', error);
                callback({ error: error.message });
            }
        });

        // Connect WebRtcTransport
        socket.on('connectWebRtcTransport', async ({ dtlsParameters, consumer }, callback) => {
            try {
                const transport = consumer ? socket.consumerTransport : socket.producerTransport;
                if (!transport) {
                    return callback({ error: 'Transport not found' });
                }
                await transport.connect({ dtlsParameters });
                callback();
            } catch (error) {
                console.error('Failed to connect transport:', error);
                callback({ error: error.message });
            }
        });

        // Produce media
        socket.on('produce', async ({ kind, rtpParameters }, callback) => {
            try {
                const producer = await socket.producerTransport.produce({ kind, rtpParameters });

                producers.set(producer.id, producer);
                producerToSocket.set(producer.id, socket.id);

                producer.on('transportclose', () => {
                    console.log('Producer transport closed');
                    producer.close();
                    producers.delete(producer.id);
                    producerToSocket.delete(producer.id);
                });

                producer.on('close', () => {
                    console.log('Producer closed');
                    producers.delete(producer.id);
                    producerToSocket.delete(producer.id);
                });

                // Broadcast new producer to other peers
                socket.broadcast.emit('newProducer', { producerId: producer.id });

                callback({ id: producer.id });
            } catch (error) {
                console.error('Failed to produce:', error);
                callback({ error: error.message });
            }
        });

        // Get existing producers (excluding own producers)
        socket.on('getProducers', (callback) => {
            const producerIds = [];
            producers.forEach((producer, id) => {
                // Only return producers that DON'T belong to this socket
                if (producerToSocket.get(id) !== socket.id) {
                    producerIds.push(id);
                }
            });
            console.log(`getProducers for ${socket.id}: found ${producerIds.length} producers`);
            callback(producerIds);
        });

        // Consume media
        socket.on('consume', async ({ producerId, rtpCapabilities }, callback) => {
            try {
                // Check if transport exists
                if (!socket.consumerTransport) {
                    console.error('Consumer transport not found');
                    return callback({ error: 'Consumer transport not found' });
                }

                // Check if we can consume
                if (!router.canConsume({ producerId, rtpCapabilities })) {
                    console.error('Cannot consume producer:', producerId);
                    return callback({ error: 'Cannot consume' });
                }

                const consumer = await socket.consumerTransport.consume({
                    producerId,
                    rtpCapabilities,
                    paused: true,
                });

                consumer.on('transportclose', () => {
                    console.log('Consumer transport closed');
                    consumer.close();
                });

                consumer.on('producerclose', () => {
                    console.log('Producer closed, closing consumer');
                    consumer.close();
                    socket.emit('producerClosed', { producerId });
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
                console.log(`Consumer created for producer ${producerId}`);
            } catch (error) {
                console.error('Failed to consume:', error);
                callback({ error: error.message });
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            connectedPeers.delete(socket.id);
            // Clean up producers for this socket
            producerToSocket.forEach((socketId, producerId) => {
                if (socketId === socket.id) {
                    producers.delete(producerId);
                    producerToSocket.delete(producerId);
                }
            });
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
