/**
 * CLEANROOM IMPLEMENTATION DECLARATION
 * Component: RPA Video Editor - Multi-Resolution Render & Export Engine
 * Specification: SPEC-EDT-003 (Multi-Resolution, Framerates, Format Encoders & Audio Synchronization)
 * Authors: Cleanroom Development Team
 * License: Private Cleanroom Software Suite
 */

class RpaExporter {
    /**
     * Decode and pre-mix timeline audio into a pristine multi-channel AudioBuffer using OfflineAudioContext.
     * Accurately supports trimming, volume, playback speed, crossfades, and mute states.
     */
    static async mixTimelineAudio(timeline, exportStart, exportEnd, sampleRate = 48000) {
        const totalDuration = Math.max(0.1, exportEnd - exportStart);
        const totalSamples = Math.ceil(totalDuration * sampleRate);

        // Find all active audio sources (audio clips + video clips with audio) on unmuted tracks
        const audioClips = (timeline.clips || []).filter(c => {
            const track = timeline.getTrack ? timeline.getTrack(c.trackId) : null;
            if (track && track.muted) return false;
            if (c.muted) return false;
            const hasAudio = (c.type === 'audio') || (c.type === 'video' && c.hasAudio !== false);
            return hasAudio && Boolean(c.sourceUrl);
        });

        // 1. Fetch & decode all unique audio source files into memory
        const bufferCache = new Map();
        if (audioClips.length > 0) {
            let decodeCtx = null;
            try {
                decodeCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
                for (const clip of audioClips) {
                    if (!bufferCache.has(clip.sourceUrl)) {
                        try {
                            const resp = await fetch(clip.sourceUrl);
                            const ab = await resp.arrayBuffer();
                            const decoded = await decodeCtx.decodeAudioData(ab.slice(0));
                            bufferCache.set(clip.sourceUrl, decoded);
                        } catch (decodeErr) {
                            console.warn('[RPA Exporter] Could not decode audio data for:', clip.sourceUrl, decodeErr);
                        }
                    }
                }
            } catch (ctxErr) {
                console.warn('[RPA Exporter] AudioContext initialization notice:', ctxErr);
            } finally {
                if (decodeCtx) {
                    try { await decodeCtx.close(); } catch (_) {}
                }
            }
        }

        // 2. Mix into OfflineAudioContext
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, totalSamples, sampleRate);

        let activeMixSources = 0;
        for (const clip of audioClips) {
            const audioBuf = bufferCache.get(clip.sourceUrl);
            if (!audioBuf) continue;

            const clipStart = clip.startTime || 0;
            const clipEnd = clipStart + (clip.duration || 0);
            const overlapStart = Math.max(clipStart, exportStart);
            const overlapEnd = Math.min(clipEnd, exportEnd);

            if (overlapEnd > overlapStart) {
                const when = Math.max(0, overlapStart - exportStart);
                const clipSpeed = Math.max(0.1, Math.min(10.0, clip.speed || 1.0));
                const offset = Math.max(0, (clip.trimStart || 0) + (overlapStart - clipStart) * clipSpeed);
                const dur = overlapEnd - overlapStart;

                try {
                    const srcNode = offlineCtx.createBufferSource();
                    srcNode.buffer = audioBuf;
                    srcNode.playbackRate.value = clipSpeed;

                    const gainNode = offlineCtx.createGain();
                    const baseVol = Math.max(0, Math.min(1, clip.volume !== undefined ? clip.volume : 1.0));
                    gainNode.gain.setValueAtTime(baseVol, when);

                    // Fade in volume ramp
                    if (clip.audioEffects?.fadeIn && clip.audioEffects.fadeIn > 0) {
                        const fi = clip.audioEffects.fadeIn;
                        gainNode.gain.setValueAtTime(0, when);
                        gainNode.gain.linearRampToValueAtTime(baseVol, Math.min(when + dur, when + fi));
                    }

                    // Fade out volume ramp
                    if (clip.audioEffects?.fadeOut && clip.audioEffects.fadeOut > 0) {
                        const fo = clip.audioEffects.fadeOut;
                        const foStart = Math.max(when, when + dur - fo);
                        gainNode.gain.setValueAtTime(baseVol, foStart);
                        gainNode.gain.linearRampToValueAtTime(0, when + dur);
                    }

                    srcNode.connect(gainNode);
                    gainNode.connect(offlineCtx.destination);
                    srcNode.start(when, offset, dur);
                    activeMixSources++;
                } catch (mixErr) {
                    console.warn('[RPA Exporter] Error scheduling audio clip:', clip.id, mixErr);
                }
            }
        }

        try {
            const renderedBuffer = await offlineCtx.startRendering();
            return { renderedBuffer, hasAudibleAudio: activeMixSources > 0 };
        } catch (renderErr) {
            console.warn('[RPA Exporter] Offline audio rendering failed, fallback to silent buffer:', renderErr);
            return null;
        }
    }

    /**
     * Export Timeline with Custom Resolutions, Bitrates & Framerates (Anti-Flicker & Synchronized with Pristine Audio)
     */
    static async exportTimeline(timeline, compositor, options = {}, onProgress) {
        const targetWidth = options.width || compositor.projectSettings.width || 1920;
        const targetHeight = options.height || compositor.projectSettings.height || 1080;
        const fps = options.fps || compositor.projectSettings.fps || 30;
        const bitrate = options.bitrate || 6000000;
        const format = options.format || 'webm';

        // Auto-detect exact timeline content boundaries (eliminates trailing black void)
        let exportStart = 0.0;
        let exportEnd = 0.0;

        if (options.startTime !== undefined && options.endTime !== undefined && options.endTime > options.startTime) {
            exportStart = Math.max(0, options.startTime);
            exportEnd = options.endTime;
        } else if (typeof timeline.getExportRange === 'function') {
            const range = timeline.getExportRange();
            exportStart = range.start;
            exportEnd = range.end;
        } else {
            const contentEnd = timeline.getContentEnd ? timeline.getContentEnd() : 0;
            exportStart = 0.0;
            exportEnd = contentEnd > 0 ? contentEnd : timeline.totalDuration;
        }

        const totalExportDuration = Math.max(0.1, exportEnd - exportStart);
        const frameInterval = 1000 / fps;

        // Dedicated Offscreen Rendering Canvas for chosen resolution
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetWidth;
        exportCanvas.height = targetHeight;
        const exportCtx = exportCanvas.getContext('2d', { alpha: true });

        // Buffer Compositor for atomic frame composition (prevents black flashing)
        const bufferCanvas = document.createElement('canvas');
        bufferCanvas.width = targetWidth;
        bufferCanvas.height = targetHeight;
        const exportCompositor = new window.RpaCompositor(bufferCanvas);
        exportCompositor.setProjectSettings(targetWidth, targetHeight, fps, compositor.projectSettings?.backgroundColor || '#0f1115');
        exportCompositor.visualFx = { ...compositor.visualFx };
        exportCompositor.cursorOptions = { ...compositor.cursorOptions };
        exportCompositor.zoom = { ...compositor.zoom };

        // 1. Pre-mix timeline audio with Web Audio API (Offline Rendering)
        let audioCtx = null;
        let audioDest = null;
        let audioSourceNode = null;
        const sampleRate = 48000;

        try {
            const mixResult = await this.mixTimelineAudio(timeline, exportStart, exportEnd, sampleRate);
            if (mixResult && mixResult.renderedBuffer) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
                if (audioCtx.state === 'suspended') {
                    await audioCtx.resume();
                }
                audioDest = audioCtx.createMediaStreamDestination();
                audioSourceNode = audioCtx.createBufferSource();
                audioSourceNode.buffer = mixResult.renderedBuffer;
                audioSourceNode.connect(audioDest);
            }
        } catch (audioPrepErr) {
            console.warn('[RPA Exporter] Audio pre-mix notice:', audioPrepErr);
        }

        // 2. Determine supported MIME type with audio codecs
        let mimeType = 'video/webm; codecs=vp9,opus';
        if (format === 'mp4') {
            if (MediaRecorder.isTypeSupported('video/mp4; codecs=avc1,mp4a.40.2')) {
                mimeType = 'video/mp4; codecs=avc1,mp4a.40.2';
            } else if (MediaRecorder.isTypeSupported('video/mp4')) {
                mimeType = 'video/mp4';
            }
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
                mimeType = 'video/webm; codecs=vp9,opus';
            } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
                mimeType = 'video/webm; codecs=vp8,opus';
            } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) {
                mimeType = 'video/webm; codecs=vp9';
            } else {
                mimeType = 'video/webm';
            }
        }

        // 3. Assemble media streams (video + audio)
        const videoStream = exportCanvas.captureStream(fps);
        let finalStream = videoStream;

        if (audioDest && audioDest.stream && audioDest.stream.getAudioTracks().length > 0) {
            finalStream = new MediaStream([
                ...videoStream.getVideoTracks(),
                ...audioDest.stream.getAudioTracks()
            ]);
        }

        const recorder = new MediaRecorder(finalStream, {
            mimeType,
            videoBitsPerSecond: bitrate
        });

        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
        };

        return new Promise((resolve, reject) => {
            recorder.onerror = (err) => reject(err);

            recorder.onstop = () => {
                const extension = format === 'mp4' && mimeType.includes('mp4') ? 'mp4' : 'webm';
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Auto-trigger browser / desktop download
                const a = document.createElement('a');
                a.href = url;
                a.download = `RPA_Video_${targetWidth}x${targetHeight}_${Date.now()}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                if (audioCtx) {
                    try { audioCtx.close(); } catch (_) {}
                }

                resolve({ blob, url, width: targetWidth, height: targetHeight, duration: totalExportDuration });
            };

            // Start recorder and synchronized audio stream simultaneously
            recorder.start(100);
            if (audioSourceNode) {
                try {
                    audioSourceNode.start(0);
                } catch (nodeErr) {
                    console.warn('[RPA Exporter] Audio start error:', nodeErr);
                }
            }

            // Synchronous Frame Seeking to Eliminate Black/Flashing Frames
            const seekAllActiveVideos = async (time) => {
                const seekPromises = [];
                for (const clip of timeline.clips) {
                    if (clip.type === 'video' && clip.sourceUrl && time >= clip.startTime && time <= (clip.startTime + clip.duration)) {
                        const v = exportCompositor.getVideoElement(clip.sourceUrl);
                        if (v) {
                            const relTime = time - clip.startTime;
                            const targetTime = (clip.trimStart || 0) + relTime * (clip.speed || 1.0);
                            if (Math.abs(v.currentTime - targetTime) > 0.03 || v.seeking || v.readyState < 2) {
                                seekPromises.push(new Promise((res) => {
                                    let done = false;
                                    const finish = () => {
                                        if (!done) {
                                            done = true;
                                            v.removeEventListener('seeked', finish);
                                            v.removeEventListener('canplay', finish);
                                            res();
                                        }
                                    };
                                    v.addEventListener('seeked', finish, { once: true });
                                    v.addEventListener('canplay', finish, { once: true });
                                    try { v.currentTime = targetTime; } catch (_) { finish(); }
                                    setTimeout(finish, 100); // Safety watchdog timeout
                                }));
                            }
                        }
                    }
                }
                if (seekPromises.length > 0) {
                    await Promise.all(seekPromises);
                }
            };

            const runRenderLoop = async () => {
                const renderStartTime = performance.now();
                const totalFrames = Math.ceil(totalExportDuration * fps);

                for (let f = 0; f <= totalFrames; f++) {
                    const currentTime = exportStart + (f / fps);
                    if (currentTime > exportEnd + 0.0001) break;

                    // 1. Wait for video decoders to stabilize at current timestamp
                    await seekAllActiveVideos(currentTime);

                    // 2. Render frame into buffer canvas
                    exportCompositor.renderFrame(timeline, currentTime);

                    // 3. Atomically blit composite buffer to export canvas (zero flicker/flash)
                    exportCtx.drawImage(bufferCanvas, 0, 0);

                    if (onProgress) {
                        const elapsed = Math.max(0, currentTime - exportStart);
                        onProgress(Math.min(100, (elapsed / totalExportDuration) * 100));
                    }

                    // Strict wall-clock pacing to synchronize canvas stream with real-time Web Audio
                    const targetWallTime = renderStartTime + ((f + 1) * frameInterval);
                    const delay = Math.max(4, Math.floor(targetWallTime - performance.now()));
                    await new Promise(r => setTimeout(r, delay));
                }

                // Final safety flush before stop
                await new Promise(r => setTimeout(r, 250));
                recorder.stop();
            };

            runRenderLoop().catch(err => {
                console.error('[RPA Exporter] Render error:', err);
                if (audioCtx) {
                    try { audioCtx.close(); } catch (_) {}
                }
                reject(err);
            });
        });
    }
}

window.RpaExporter = RpaExporter;
