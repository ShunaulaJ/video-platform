'use client';

import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

export default function Room() {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const socketRef = useRef(null);
    const deviceRef = useRef(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        socketRef.current = io();

        socketRef.current.on('connect', () => {
            console.log('Connected to signaling server');
            setIsConnected(true);
        });

        return () => {
            socketRef.current.disconnect();
        };
    }, []);

    const startVideo = async () => {
        try {
            // 1. Get local media
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideoRef.current.srcObject = stream;

            // 2. Get Router RTP Capabilities
            socketRef.current.emit('getRouterRtpCapabilities', async (rtpCapabilities) => {
                // 3. Create Device
                const device = new mediasoupClient.Device();
                await device.load({ routerRtpCapabilities: rtpCapabilities });
                deviceRef.current = device;

                // 4. Create Transport on server
                socketRef.current.emit('createWebRtcTransport', {}, async ({ params, error }) => {
                    if (error) {
                        console.error(error);
                        return;
                    }

                    // 5. Create Send Transport on client
                    const sendTransport = device.createSendTransport(params);

                    sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                        socketRef.current.emit('connectWebRtcTransport', { dtlsParameters }, (error) => {
                            if (error) {
                                console.error('Transport connect error:', error);
                                errback(error);
                                return;
                            }
                            callback();
                        });
                    });

                    sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
                        socketRef.current.emit('produce', { kind, rtpParameters }, ({ id, error }) => {
                            if (error) {
                                console.error('Produce error:', error);
                                errback(error);
                                return;
                            }
                            callback({ id });
                        });
                    });

                    // 6. Produce!
                    const track = stream.getVideoTracks()[0];
                    await sendTransport.produce({ track });

                    console.log('Producing video track!');
                });

                // Handle new producers
                socketRef.current.on('newProducer', ({ producerId }) => {
                    console.log('New producer:', producerId);
                    consume(producerId);
                });
            });
        } catch (err) {
            console.error('Error starting video:', err);
        }
    };

    const consume = async (producerId) => {
        try {
            const device = deviceRef.current;
            const rtpCapabilities = device.rtpCapabilities;

            // 1. Create Recv Transport if not exists
            if (!deviceRef.current.recvTransport) {
                await new Promise((resolve, reject) => {
                    socketRef.current.emit('createWebRtcTransport', {}, async ({ params, error }) => {
                        if (error) return reject(error);

                        const recvTransport = device.createRecvTransport(params);
                        deviceRef.current.recvTransport = recvTransport;

                        recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                            socketRef.current.emit('connectWebRtcTransport', { dtlsParameters }, (error) => {
                                if (error) errback(error);
                                else callback();
                            });
                        });
                        resolve();
                    });
                });
            }

            // 2. Consume
            const { params } = await new Promise((resolve, reject) => {
                socketRef.current.emit('consume', { producerId, rtpCapabilities }, (response) => {
                    if (response.error) reject(response.error);
                    else resolve(response);
                });
            });

            const consumer = await deviceRef.current.recvTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            const { track } = consumer;
            remoteVideoRef.current.srcObject = new MediaStream([track]);

            // Resume the consumer
            socketRef.current.emit('resume');

        } catch (err) {
            console.error('Error consuming:', err);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
                <div style={{ textAlign: 'center' }}>
                    <h3>Local Video</h3>
                    <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', background: '#000', borderRadius: '8px' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h3>Remote Video</h3>
                    <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '300px', background: '#000', borderRadius: '8px' }} />
                </div>
            </div>
            <button
                onClick={startVideo}
                disabled={!isConnected}
                style={{
                    padding: '0.8rem 1.5rem',
                    background: isConnected ? 'var(--primary)' : '#444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: isConnected ? 'pointer' : 'not-allowed'
                }}
            >
                Join Meeting & Start Video
            </button>
        </div>
    );
}
