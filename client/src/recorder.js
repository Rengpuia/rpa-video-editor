/**
 * RPA Video Editor - Cleanroom Screen & Telemetry Recorder
 *
 * Implements high-performance display media capture, webcam overlays with
 * geometric masks (circle, square, polygon, diamond, oval), audio mixing,
 * and cursor telemetry logging.
 */

class RpaScreenRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.telemetryEvents = [];
        this.stream = null;
        this.isRecording = false;
        this.startTime = 0;
        this.compositeCanvas = null;
        this.compositeCtx = null;
        this.screenVideo = null;
        this.webcamVideo = null;
        this.animFrameId = null;
    }

    async start(options = {}) {
        this.recordedChunks = [];
        this.telemetryEvents = [];

        // 1. Resolve Resolution & Framerate Constraints
        let videoConstraints = {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 60 }
        };

        if (options.resolution === '3840x2160') {
            videoConstraints = { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } };
        } else if (options.resolution === '1920x1080_30') {
            videoConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
        } else if (options.resolution === '1280x720') {
            videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
        } else if (options.resolution === '1080x1920') {
            videoConstraints = { width: { ideal: 1080 }, height: { ideal: 1920 }, frameRate: { ideal: 60 } };
        } else if (options.resolution === 'native') {
            videoConstraints = { frameRate: { ideal: 60 } };
        }

        const includeSystemAudio = options.includeSystemAudio !== false;

        // 2. Capture Screen Display
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: videoConstraints,
            audio: includeSystemAudio
        });

        this.displayStream = displayStream;
        let finalVideoStream = displayStream;

        // 3. Optional Picture-in-Picture Webcam with Shapes & Effects
        if (options.includeCamera) {
            try {
                const camConstraints = {
                    video: options.cameraDeviceId && options.cameraDeviceId !== 'default'
                        ? { deviceId: { exact: options.cameraDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
                        : { width: { ideal: 1280 }, height: { ideal: 720 } },
                    audio: false
                };
                const camStream = await navigator.mediaDevices.getUserMedia(camConstraints);
                this.camStream = camStream;

                // Setup Offscreen Compositing Canvas
                const screenTrack = displayStream.getVideoTracks()[0];
                const screenSettings = screenTrack.getSettings();
                const cw = screenSettings.width || 1920;
                const ch = screenSettings.height || 1080;

                const canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
                this.compositeCanvas = canvas;
                this.compositeCtx = ctx;

                // Screen Video Element
                const screenVideo = document.createElement('video');
                screenVideo.autoplay = true;
                screenVideo.muted = true;
                screenVideo.playsInline = true;
                screenVideo.srcObject = displayStream;
                await screenVideo.play();
                this.screenVideo = screenVideo;

                // Webcam Video Element
                const webcamVideo = document.createElement('video');
                webcamVideo.autoplay = true;
                webcamVideo.muted = true;
                webcamVideo.playsInline = true;
                webcamVideo.srcObject = camStream;
                await webcamVideo.play();
                this.webcamVideo = webcamVideo;

                // Webcam Styling Parameters
                const shape = options.webcamShape || 'circle';
                const pos = options.webcamPosition || 'bottom-right';
                const sizeRatio = Math.max(0.08, Math.min(0.75, options.webcamSize || 0.22));
                const borderWidth = options.webcamBorderWidth !== undefined ? options.webcamBorderWidth : 3;
                const borderColor = options.webcamBorderColor || '#38bdf8';
                const hasShadow = options.webcamShadow !== false;
                const isMirror = options.webcamMirror !== false;

                const renderComposite = () => {
                    if (!this.isRecording) return;

                    // 1. Draw Primary Screen Display
                    ctx.drawImage(screenVideo, 0, 0, cw, ch);

                    // 2. Calculate Webcam Overlay Coordinates
                    const overlayW = Math.round(cw * sizeRatio);
                    const overlayH = (shape === 'rect' || shape === 'oval') ? Math.round(overlayW * (9 / 16)) : overlayW;
                    const margin = Math.round(Math.min(cw, ch) * 0.035);

                    let ox = cw - overlayW - margin;
                    let oy = ch - overlayH - margin;

                    if (pos === 'bottom-left') {
                        ox = margin;
                        oy = ch - overlayH - margin;
                    } else if (pos === 'top-right') {
                        ox = cw - overlayW - margin;
                        oy = margin;
                    } else if (pos === 'top-left') {
                        ox = margin;
                        oy = margin;
                    } else if (pos === 'custom' && options.webcamCustomPos) {
                        ox = Math.max(0, Math.min(cw - overlayW, Math.round(options.webcamCustomPos.x * cw)));
                        oy = Math.max(0, Math.min(ch - overlayH, Math.round(options.webcamCustomPos.y * ch)));
                    }

                    const cx = ox + overlayW / 2;
                    const cy = oy + overlayH / 2;
                    const radius = overlayW / 2;

                    // Helper to create shape path
                    const buildShapePath = () => {
                        ctx.beginPath();
                        if (shape === 'circle') {
                            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
                        } else if (shape === 'square' || shape === 'squircle') {
                            const r = Math.round(overlayW * 0.18);
                            if (ctx.roundRect) {
                                ctx.roundRect(ox, oy, overlayW, overlayH, r);
                            } else {
                                ctx.rect(ox, oy, overlayW, overlayH);
                            }
                        } else if (shape === 'polygon' || shape === 'hexagon') {
                            const sides = 6;
                            for (let i = 0; i < sides; i++) {
                                const angle = (i * 2 * Math.PI / sides) - (Math.PI / 2);
                                const px = cx + radius * Math.cos(angle);
                                const py = cy + radius * Math.sin(angle);
                                if (i === 0) ctx.moveTo(px, py);
                                else ctx.lineTo(px, py);
                            }
                            ctx.closePath();
                        } else if (shape === 'diamond') {
                            ctx.moveTo(cx, oy);
                            ctx.lineTo(ox + overlayW, cy);
                            ctx.lineTo(cx, oy + overlayH);
                            ctx.lineTo(ox, cy);
                            ctx.closePath();
                        } else if (shape === 'oval') {
                            ctx.ellipse(cx, cy, radius, radius * 0.72, 0, 0, Math.PI * 2);
                        } else {
                            ctx.rect(ox, oy, overlayW, overlayH);
                        }
                    };

                    // Draw Shadow / Glow
                    if (hasShadow) {
                        ctx.save();
                        buildShapePath();
                        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
                        ctx.shadowBlur = Math.round(20 * (cw / 1920));
                        ctx.shadowOffsetX = 0;
                        ctx.shadowOffsetY = Math.round(6 * (ch / 1080));
                        ctx.fillStyle = '#000000';
                        ctx.fill();
                        ctx.restore();
                    }

                    // Clip and Draw Webcam Video
                    ctx.save();
                    buildShapePath();
                    ctx.clip();

                    if (isMirror) {
                        ctx.translate(cx, cy);
                        ctx.scale(-1, 1);
                        ctx.translate(-cx, -cy);
                    }

                    // Draw webcam with object-fit cover
                    const vw = webcamVideo.videoWidth || 1280;
                    const vh = webcamVideo.videoHeight || 720;
                    const vAspect = vw / vh;
                    let sw = vw;
                    let sh = vh;
                    let sx = 0;
                    let sy = 0;
                    if (vAspect > 1) {
                        sw = vh;
                        sx = (vw - sw) / 2;
                    } else {
                        sh = vw;
                        sy = (vh - sh) / 2;
                    }

                    ctx.drawImage(webcamVideo, sx, sy, sw, sh, ox, oy, overlayW, overlayH);
                    ctx.restore();

                    // Draw Border
                    if (borderWidth > 0) {
                        ctx.save();
                        buildShapePath();
                        ctx.strokeStyle = borderColor;
                        ctx.lineWidth = borderWidth;
                        ctx.stroke();
                        ctx.restore();
                    }

                    this.animFrameId = requestAnimationFrame(renderComposite);
                };

                const targetFps = (options.resolution && options.resolution.includes('_30')) ? 30 : 60;
                finalVideoStream = canvas.captureStream(targetFps);
                this.isRecording = true;
                this.animFrameId = requestAnimationFrame(renderComposite);

            } catch (camErr) {
                console.warn('Webcam stream capture could not be initialized:', camErr);
                finalVideoStream = displayStream;
            }
        }

        let combinedStream = finalVideoStream;

        // 4. Audio Mixing: Microphone & System Audio
        if (options.includeMic || displayStream.getAudioTracks().length > 0) {
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                this.audioCtx = audioCtx;
                const destination = audioCtx.createMediaStreamDestination();

                if (displayStream.getAudioTracks().length > 0 && includeSystemAudio) {
                    const sysSource = audioCtx.createMediaStreamSource(displayStream);
                    sysSource.connect(destination);
                }

                if (options.includeMic) {
                    const micConstraints = options.audioDeviceId && options.audioDeviceId !== 'default'
                        ? { deviceId: { exact: options.audioDeviceId }, echoCancellation: true, noiseSuppression: true }
                        : { echoCancellation: true, noiseSuppression: true };

                    const micStream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints });
                    this.micStream = micStream;
                    const micSource = audioCtx.createMediaStreamSource(micStream);
                    micSource.connect(destination);
                }

                combinedStream = new MediaStream([
                    ...finalVideoStream.getVideoTracks(),
                    ...destination.stream.getAudioTracks()
                ]);
            } catch (err) {
                console.warn('Audio mixer setup warning:', err);
            }
        }

        this.stream = combinedStream;
        this.startTime = performance.now();

        // 5. Setup MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
            ? 'video/webm; codecs=vp9'
            : 'video/webm';

        this.mediaRecorder = new MediaRecorder(combinedStream, { mimeType });

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                this.recordedChunks.push(e.data);
            }
        };

        // 6. Cursor tracking listener
        if (options.trackCursor) {
            this.mouseListener = (e) => {
                if (!this.isRecording) return;
                const relTime = (performance.now() - this.startTime) / 1000.0;
                this.telemetryEvents.push({
                    time: relTime,
                    x: e.clientX / window.innerWidth,
                    y: e.clientY / window.innerHeight,
                    type: e.type
                });
            };
            window.addEventListener('mousemove', this.mouseListener);
            window.addEventListener('mousedown', this.mouseListener);
        }

        this.mediaRecorder.start(100);
        this.isRecording = true;

        // Automatically handle user pressing native "Stop Sharing" button
        displayStream.getVideoTracks()[0].onended = () => {
            if (this.isRecording && window.rpaStudio) {
                window.rpaStudio.stopRecording();
            }
        };
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.mediaRecorder || !this.isRecording) {
                return resolve(null);
            }

            this.mediaRecorder.onstop = () => {
                this.isRecording = false;

                if (this.animFrameId) {
                    cancelAnimationFrame(this.animFrameId);
                    this.animFrameId = null;
                }

                // Stop all tracks to release hardware resources and camera indicators
                if (this.stream) {
                    this.stream.getTracks().forEach(t => t.stop());
                }
                if (this.displayStream) {
                    this.displayStream.getTracks().forEach(t => t.stop());
                }
                if (this.camStream) {
                    this.camStream.getTracks().forEach(t => t.stop());
                }
                if (this.micStream) {
                    this.micStream.getTracks().forEach(t => t.stop());
                }

                if (this.screenVideo) {
                    this.screenVideo.srcObject = null;
                    this.screenVideo = null;
                }
                if (this.webcamVideo) {
                    this.webcamVideo.srcObject = null;
                    this.webcamVideo = null;
                }
                if (this.audioCtx) {
                    try { this.audioCtx.close(); } catch (e) {}
                    this.audioCtx = null;
                }

                if (this.mouseListener) {
                    window.removeEventListener('mousemove', this.mouseListener);
                    window.removeEventListener('mousedown', this.mouseListener);
                }

                const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
                const videoUrl = URL.createObjectURL(blob);
                const duration = (performance.now() - this.startTime) / 1000.0;

                resolve({
                    blob,
                    videoUrl,
                    duration,
                    telemetry: this.telemetryEvents
                });
            };

            this.mediaRecorder.stop();
        });
    }
}

window.RpaScreenRecorder = RpaScreenRecorder;
