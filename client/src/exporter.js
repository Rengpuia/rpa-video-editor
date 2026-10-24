/**
 * CLEANROOM IMPLEMENTATION DECLARATION
 * Component: RPA Video Editor - Multi-Resolution Render & Export Engine
 * Specification: SPEC-EDT-003 (Multi-Resolution, Framerates, Format Encoders)
 * Authors: Cleanroom Development Team
 * License: Private Cleanroom Software Suite
 */

class RpaExporter {
    /**
     * Export Timeline with Custom Resolutions, Bitrates & Framerates (Anti-Flicker & Synchronized)
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

        // Determine supported MIME type
        let mimeType = 'video/webm; codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
                ? 'video/webm; codecs=vp9'
                : 'video/webm';
        }
        if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) {
            mimeType = 'video/mp4';
        }

        const videoStream = exportCanvas.captureStream(fps);
        let finalStream = videoStream;

        // Audio Mixing via Web Audio API
        let audioCtx = null;
        let audioDest = null;
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioDest = audioCtx.createMediaStreamDestination();

            // Connect any active audio elements from compositor
            for (const clip of timeline.clips) {
                if (clip.sourceUrl && (clip.type === 'audio' || (clip.type === 'video' && clip.hasAudio))) {
                    try {
                        const el = clip.type === 'video'
                            ? exportCompositor.getVideoElement(clip.sourceUrl)
                            : exportCompositor.getAudioElement(clip.sourceUrl);
                        if (el) {
                            const sourceNode = audioCtx.createMediaElementSource(el);
                            sourceNode.connect(audioDest);
                            sourceNode.connect(audioCtx.destination);
                        }
                    } catch (_) {}
                }
            }

            if (audioDest.stream.getAudioTracks().length > 0) {
                finalStream = new MediaStream([
                    ...videoStream.getVideoTracks(),
                    ...audioDest.stream.getAudioTracks()
                ]);
            }
        } catch (_) {}

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

            recorder.start(100);

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
                let currentTime = exportStart;
                const dt = 1 / fps;

                while (currentTime <= exportEnd + 0.0001) {
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

                    currentTime += dt;
                    // Yield slightly for MediaRecorder chunk dispatch
                    await new Promise(r => setTimeout(r, Math.max(8, Math.floor(frameInterval * 0.65))));
                }

                // Final safety flush before stop
                await new Promise(r => setTimeout(r, 250));
                recorder.stop();
            };

            runRenderLoop().catch(err => {
                console.error('[RPA Exporter] Render error:', err);
                reject(err);
            });
        });
    }
}

window.RpaExporter = RpaExporter;
