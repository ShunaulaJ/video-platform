'use client';

import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

export default function Room() {
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const socketRef = useRef(null);
    const deviceRef = useRef(null);

    const [isSocketConnected, setIsSocketConnected] = useState(false);
    const [isJoined, setIsJoined] = useState(false);
    const [localStream, setLocalStream] = useState(null);

    // 1. Initialize Socket and Local Preview on Mount
    useEffect(() => {
        // Setup Socket
        socketRef.current = io();

        socketRef.current.on('connect', () => {
            console.log('Connected to signaling server');
            setIsSocketConnected(true);
        });

        socketRef.current.on('roomFull', () => {
            alert('Room is full (max 2 users).');
            setIsJoined(false);
        });

        socketRef.current.on('newProducer', ({ producerId }) => {
            console.log('New producer:', producerId);
            consume(producerId);
        });

        // Setup Local Preview
        const getMedia = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                setLocalStream(stream);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error('Failed to get local media:', err);
            }
        };
        getMedia();

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, []);

    // Ensure video element gets stream if it re-renders
    useEffect(() => {
        if (localVideoRef.current && localStream) {
            localVideoRef.current.srcObject = localStream;
        }
    }, [localStream]);

    const joinMeeting = async () => {
        if (!localStream || !isSocketConnected) return;

        try {
            setIsJoined(true);

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
                        setIsJoined(false);
                        return;
                    }

                    // 5. Create Send Transport on client
                    const sendTransport = device.createSendTransport(params);

                    sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
                        socketRef.current.emit('connectWebRtcTransport', { dtlsParameters }, (error) => {
                            if (error) errback(error);
                            else callback();
                        });
                    });

                    sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
                        socketRef.current.emit('produce', { kind, rtpParameters }, ({ id, error }) => {
                            if (error) errback(error);
                            else callback({ id });
                        });
                    });

                    // 6. Produce Video
                    const videoTrack = localStream.getVideoTracks()[0];
                    if (videoTrack) {
                        await sendTransport.produce({ track: videoTrack });
                    }

                    // 7. Produce Audio
                    const audioTrack = localStream.getAudioTracks()[0];
                    if (audioTrack) {
                        await sendTransport.produce({ track: audioTrack });
                    }

                    console.log('Joined and producing!');

                    // 8. Get existing producers (to see others who are already there)
                    socketRef.current.emit('getProducers', (producerIds) => {
                        producerIds.forEach((id) => consume(id));
                    });
                });
            });
        } catch (err) {
            console.error('Error joining meeting:', err);
            setIsJoined(false);
        }
    };

    const leaveRoom = () => {
        // Refresh the page to cleanly reset everything (simplest for MVP)
        window.location.reload();
    };

    const consume = async (producerId) => {
        try {
            const device = deviceRef.current;
            if (!device) return;

            const rtpCapabilities = device.rtpCapabilities;

            // 1. Create Recv Transport if not exists
            if (!device.recvTransport) {
                await new Promise((resolve, reject) => {
                    socketRef.current.emit('createWebRtcTransport', {}, async ({ params, error }) => {
                        if (error) return reject(error);

                        const recvTransport = device.createRecvTransport(params);
                        device.recvTransport = recvTransport; // Attach to device instance for easy access

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

            const consumer = await device.recvTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters,
            });

            const { track } = consumer;

            // Handle Audio vs Video
            if (params.kind === 'video') {
                remoteVideoRef.current.srcObject = new MediaStream([track]);
            } else if (params.kind === 'audio') {
                if (remoteVideoRef.current.srcObject) {
                    remoteVideoRef.current.srcObject.addTrack(track);
                } else {
                    remoteVideoRef.current.srcObject = new MediaStream([track]);
                }
            }

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
                    <h3>Local Video {localStream ? '(Ready)' : '(Loading...)'}</h3>
                    <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '300px', background: '#000', borderRadius: '8px', border: isJoined ? '2px solid #4caf50' : '2px solid #666' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                    <h3>Remote Video</h3>
                    <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '300px', background: '#000', borderRadius: '8px' }} />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
                {!isJoined ? (
                    <button
                        onClick={joinMeeting}
                        disabled={!localStream || !isSocketConnected}
                        style={{
                            padding: '0.8rem 1.5rem',
                            background: (localStream && isSocketConnected) ? 'var(--primary)' : '#444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: (localStream && isSocketConnected) ? 'pointer' : 'not-allowed',
                            fontSize: '1.1rem',
                            fontWeight: 'bold'
                        }}
                    >
                        {isSocketConnected ? 'Join Meeting' : 'Connecting...'}
                    </button>
                ) : (
                    <button
                        onClick={leaveRoom}
                        style={{
                            padding: '0.8rem 1.5rem',
                            background: '#ff4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            fontWeight: 'bold'
                        }}
                    >
                        End Call
                    </button>
                )}
            </div>
        </div>
    );
}
