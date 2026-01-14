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
    const io = new Server(httpServer);

    // Socket.io connection handler
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

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
