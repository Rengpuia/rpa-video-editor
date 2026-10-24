/**
 * CLEANROOM IMPLEMENTATION DECLARATION
 * Component: RPA Video Editor - Multi-Resolution Render & Export Engine
 * Specification: SPEC-EDT-003 (Multi-Resolution, Framerates, Format Encoders)
 * Authors: Cleanroom Development Team
 * License: Private Cleanroom Software Suite
 */

class RpaExporter {
    /**
     * Export Timeline with Custom Resolutions, Bitrates & Framerates
     */
    static async exportTimeline(timeline, compositor, options = {}, onProgress) {
        const targetWidth = options.width || compositor.projectSettings.width || 1920;
        const targetHeight = options.height || compositor.projectSettings.height || 1080;
        const fps = options.fps || compositor.projectSettings.fps || 30;
        const bitrate = options.bitrate || 6000000;
        const format = options.format || 'webm';
        const totalDuration = timeline.totalDuration;
        const frameInterval = 1000 / fps;

        // Dedicated Offscreen Rendering Canvas for chosen resolution
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetWidth;
        exportCanvas.height = targetHeight;
        const exportCompositor = new window.RpaCompositor(exportCanvas);
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
            if (e.data.size > 0) chunks.push(e.data);
        };

        return new Promise((resolve, reject) => {
            recorder.onerror = (err) => reject(err);

            recorder.onstop = () => {
                const extension = format === 'mp4' && mimeType.includes('mp4') ? 'mp4' : 'webm';
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);

                // Auto-trigger browser download
                const a = document.createElement('a');
                a.href = url;
                a.download = `RPA_Video_${targetWidth}x${targetHeight}_${Date.now()}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                resolve({ blob, url, width: targetWidth, height: targetHeight, duration: totalDuration });
            };

            recorder.start();

            let currentTime = 0;
            const timer = setInterval(() => {
                currentTime += 1 / fps;
                exportCompositor.renderFrame(timeline, currentTime);

                if (onProgress) {
                    onProgress(Math.min(100, (currentTime / totalDuration) * 100));
                }

                if (currentTime >= totalDuration) {
                    clearInterval(timer);
                    recorder.stop();
                }
            }, frameInterval);
        });
    }
}

window.RpaExporter = RpaExporter;
