const os = require('os');

module.exports = {
    // Mediasoup Worker settings
    worker: {
        rtcMinPort: 10000,
        rtcMaxPort: 20000,
        logLevel: 'warn',
        logTags: [
            'info',
            'ice',
            'dtls',
            'rtp',
            'srtp',
            'rtcp',
        ],
    },
    // Mediasoup Router settings
    router: {
        mediaCodecs: [
            {
                kind: 'audio',
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            },
            {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
                parameters: {
                    'x-google-start-bitrate': 1000,
                },
            },
        ],
    },
    // Mediasoup WebRtcTransport settings
    webRtcTransport: {
        listenIps: [
            {
                ip: '0.0.0.0',
                announcedIp: '104.198.154.216', // YOUR GCP EXTERNAL IP
            },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
    },
};
