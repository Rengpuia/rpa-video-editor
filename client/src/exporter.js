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
        const bitrate = options.bitrate || 20000000;
        const format = options.format || 'webm';

        const engine = options.engine || 'software';
        const profile = options.profile || 'high';
        const keyframeInterval = options.keyframeInterval || 1.0;
        const skipBrowserDownload = Boolean(options.skipBrowserDownload);

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

        // Dedicated Offscreen Rendering Canvas for chosen resolution with studio high-DPI quality
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = targetWidth;
        exportCanvas.height = targetHeight;
        const exportCtx = exportCanvas.getContext('2d', { alpha: true });
        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';
        exportCtx.textRendering = 'geometricPrecision';

        // Buffer Compositor for atomic frame composition (prevents black flashing)
        const bufferCanvas = document.createElement('canvas');
        bufferCanvas.width = targetWidth;
        bufferCanvas.height = targetHeight;
        const bufferCtx = bufferCanvas.getContext('2d', { alpha: true });
        bufferCtx.imageSmoothingEnabled = true;
        bufferCtx.imageSmoothingQuality = 'high';
        bufferCtx.textRendering = 'geometricPrecision';

        const exportCompositor = new window.RpaCompositor(bufferCanvas);
        exportCompositor.ctx.imageSmoothingEnabled = true;
        exportCompositor.ctx.imageSmoothingQuality = 'high';
        exportCompositor.ctx.textRendering = 'geometricPrecision';
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

        // 2. Determine supported MIME type with audio codecs and profiles
        let mimeType = 'video/webm; codecs=vp9,opus';
        if (format === 'mp4') {
            const h264Profiles = {
                baseline: ['video/mp4; codecs="avc1.42001e, mp4a.40.2"', 'video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs=avc1'],
                main: ['video/mp4; codecs="avc1.4d001f, mp4a.40.2"', 'video/mp4; codecs="avc1.4D401F"', 'video/mp4; codecs=avc1'],
                high: ['video/mp4; codecs="avc1.640028, mp4a.40.2"', 'video/mp4; codecs="avc1.64001f"', 'video/mp4; codecs=avc1']
            };
            const candidates = h264Profiles[profile] || h264Profiles.high;
            for (const cand of candidates) {
                if (MediaRecorder.isTypeSupported(cand)) {
                    mimeType = cand;
                    break;
                }
            }
            if (!mimeType.includes('mp4') && MediaRecorder.isTypeSupported('video/mp4')) {
                mimeType = 'video/mp4';
            }
        }
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            if (engine === 'software') {
                if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
                    mimeType = 'video/webm; codecs=vp8,opus';
                } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
                    mimeType = 'video/webm; codecs=vp9,opus';
                } else {
                    mimeType = 'video/webm';
                }
            } else {
                if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9,opus')) {
                    mimeType = 'video/webm; codecs=vp9,opus';
                } else if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8,opus')) {
                    mimeType = 'video/webm; codecs=vp8,opus';
                } else {
                    mimeType = 'video/webm';
                }
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

            recorder.onstop = async () => {
                const extension = format === 'mp4' && mimeType.includes('mp4') ? 'mp4' : 'webm';
                let blob = new Blob(chunks, { type: mimeType });

                // If WebM, inject Duration and Seek Cues index to eliminate external player seek glitches
                if (extension === 'webm') {
                    try {
                        blob = await RpaExporter.injectWebmSeekCues(blob, totalExportDuration);
                    } catch (cueErr) {
                        console.warn('[RPA Exporter] WebM seek cues injection notice:', cueErr);
                    }
                }

                const url = URL.createObjectURL(blob);

                // Auto-trigger browser / desktop download only if not handled natively
                if (!skipBrowserDownload && !window.rpaNative?.saveExportedFile) {
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `RPA_Video_${targetWidth}x${targetHeight}_${Date.now()}.${extension}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }

                if (audioCtx) {
                    try { audioCtx.close(); } catch (_) {}
                }

                resolve({ blob, url, width: targetWidth, height: targetHeight, duration: totalExportDuration });
            };

            // Start recorder with cadence matching requested keyframe interval
            const timeslice = Math.max(250, Math.round(keyframeInterval * 1000));
            recorder.start(timeslice);
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

            const videoTrack = videoStream.getVideoTracks()[0];

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
                    if (videoTrack && typeof videoTrack.requestFrame === 'function') {
                        videoTrack.requestFrame();
                    }

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

    /**
     * Injects EBML Duration, Front-Loaded SeekHead, and Cues Seek Index table into exported WebM Blobs
     * Eliminates video glitching, gray frames, macroblocking and lag when seeking forward in external media players
     */
    static async injectWebmSeekCues(blob, durationSec) {
        try {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            if (bytes.length < 16) return blob;
            // Check EBML Header: 0x1A 0x45 0xDF 0xA3
            if (bytes[0] !== 0x1A || bytes[1] !== 0x45 || bytes[2] !== 0xDF || bytes[3] !== 0xA3) {
                return blob;
            }

            const readVint = (pos) => {
                if (pos >= bytes.length) return null;
                const b = bytes[pos];
                let len = 1;
                let mask = 0x80;
                while (len <= 8 && !(b & mask)) {
                    len++;
                    mask >>= 1;
                }
                if (len > 8 || pos + len > bytes.length) return null;
                let val = b & (~mask);
                for (let i = 1; i < len; i++) {
                    val = (val * 256) + bytes[pos + i];
                }
                return { value: val, length: len };
            };

            const writeUint = (val) => {
                const b = [];
                let temp = Math.max(0, Math.floor(val));
                do {
                    b.unshift(temp & 0xff);
                    temp = Math.floor(temp / 256);
                } while (temp > 0);
                return b;
            };

            const writeVint = (val) => {
                if (val < 0x7F) return [0x80 | val];
                if (val < 0x3FFF) return [0x40 | (val >> 8), val & 0xFF];
                if (val < 0x1FFFFF) return [0x20 | (val >> 16), (val >> 8) & 0xFF, val & 0xFF];
                if (val < 0x0FFFFFFF) return [0x10 | (val >> 24), (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF];
                const b0 = 0x08 | Math.floor(val / 0x100000000);
                const b1 = Math.floor(val / 0x1000000) & 0xFF;
                const b2 = Math.floor(val / 0x10000) & 0xFF;
                const b3 = Math.floor(val / 0x100) & 0xFF;
                const b4 = val & 0xFF;
                return [b0, b1, b2, b3, b4];
            };

            const makeElement = (idBytes, dataBytes) => {
                const lenBytes = writeVint(dataBytes.length);
                return [...idBytes, ...lenBytes, ...dataBytes];
            };

            const makeSeekEntry = (idBytes, posVal) => {
                const seekId = makeElement([0x53, 0xAB], idBytes);
                const seekPos = makeElement([0x53, 0xAC], writeUint(posVal));
                return makeElement([0x4D, 0xBB], [...seekId, ...seekPos]);
            };

            // Find Segment (0x18 0x53 0x80 0x67)
            let segPos = -1;
            for (let i = 0; i < Math.min(256, bytes.length - 4); i++) {
                if (bytes[i] === 0x18 && bytes[i + 1] === 0x53 && bytes[i + 2] === 0x80 && bytes[i + 3] === 0x67) {
                    segPos = i;
                    break;
                }
            }
            if (segPos === -1) return blob;

            const segVint = readVint(segPos + 4);
            if (!segVint) return blob;
            const segPayloadStart = segPos + 4 + segVint.length;

            // Scan Info, Tracks, and Clusters
            let infoPos = -1;
            let infoV = null;
            let tracksPos = -1;
            const clusters = [];
            let pos = segPayloadStart;

            while (pos < bytes.length - 4) {
                // Info ID: 0x15 0x49 0xA9 0x66
                if (bytes[pos] === 0x15 && bytes[pos + 1] === 0x49 && bytes[pos + 2] === 0xA9 && bytes[pos + 3] === 0x66) {
                    infoPos = pos;
                    infoV = readVint(pos + 4);
                    if (infoV) {
                        pos = pos + 4 + infoV.length + infoV.value;
                        continue;
                    }
                }
                // Tracks ID: 0x16 0x54 0xAE 0x6B
                if (bytes[pos] === 0x16 && bytes[pos + 1] === 0x54 && bytes[pos + 2] === 0xAE && bytes[pos + 3] === 0x6B) {
                    tracksPos = pos;
                    const tv = readVint(pos + 4);
                    if (tv) {
                        pos = pos + 4 + tv.length + tv.value;
                        continue;
                    }
                }
                // Cluster ID: 0x1F 0x43 0xB6 0x75
                if (bytes[pos] === 0x1F && bytes[pos + 1] === 0x43 && bytes[pos + 2] === 0xB6 && bytes[pos + 3] === 0x75) {
                    const clusterStart = pos;
                    const cVint = readVint(pos + 4);
                    if (!cVint) break;
                    const cPayloadStart = pos + 4 + cVint.length;
                    const clusterOffsetFromSeg = clusterStart - segPayloadStart;

                    // Search for Timecode inside cluster (0xE7)
                    let clusterTime = 0;
                    let tcPos = cPayloadStart;
                    while (tcPos < Math.min(cPayloadStart + 40, bytes.length)) {
                        if (bytes[tcPos] === 0xE7) {
                            const tVint = readVint(tcPos + 1);
                            if (tVint) {
                                let tVal = 0;
                                for (let k = 0; k < tVint.value; k++) {
                                    tVal = (tVal * 256) + bytes[tcPos + 1 + tVint.length + k];
                                }
                                clusterTime = tVal;
                            }
                            break;
                        }
                        tcPos++;
                    }

                    clusters.push({ time: clusterTime, offset: clusterOffsetFromSeg });
                    pos = cVint.value === 0x01ffffffffffffff ? bytes.length : (cPayloadStart + cVint.value);
                } else {
                    pos++;
                }
            }

            if (clusters.length === 0) return blob;

            // 1. Construct 64-bit IEEE float Duration element (0x44 0x89) in milliseconds
            const dv = new DataView(new ArrayBuffer(8));
            dv.setFloat64(0, Math.max(0.1, durationSec) * 1000.0, false);
            const durationElement = [0x44, 0x89, 0x88, ...new Uint8Array(dv.buffer)];

            let newInfoElement = null;
            let durShift = 0;
            let origInfoTotalLength = 0;

            if (infoPos !== -1 && infoV) {
                origInfoTotalLength = 4 + infoV.length + infoV.value;
                const origInfoPayload = Array.from(bytes.subarray(infoPos + 4 + infoV.length, infoPos + origInfoTotalLength));
                newInfoElement = makeElement([0x15, 0x49, 0xA9, 0x66], [...origInfoPayload, ...durationElement]);
                durShift = newInfoElement.length - origInfoTotalLength;
            }

            // 2. Converge SeekHead pointing to Info, Tracks, and Cues
            let seekHeadLen = 50;
            let seekHeadElement = [];
            for (let pass = 0; pass < 3; pass++) {
                const infoTarget = seekHeadLen;
                const tracksTarget = (tracksPos !== -1 ? tracksPos - segPayloadStart : 0) + seekHeadLen + durShift;
                const cuesTarget = (bytes.length - segPayloadStart) + seekHeadLen + durShift;
                const s1 = makeSeekEntry([0x15, 0x49, 0xA9, 0x66], infoTarget);
                const s2 = makeSeekEntry([0x16, 0x54, 0xAE, 0x6B], tracksTarget);
                const s3 = makeSeekEntry([0x1C, 0x53, 0xBB, 0x6B], cuesTarget);
                seekHeadElement = makeElement([0x11, 0x4D, 0x9B, 0x74], [...s1, ...s2, ...s3]);
                seekHeadLen = seekHeadElement.length;
            }

            // 3. Build Cues Element (0x1C 0x53 0xBB 0x6B) with adjusted cluster offsets
            let videoTrackNumber = 1;
            if (tracksPos !== -1) {
                const trLen = readVint(tracksPos + 4);
                if (trLen) {
                    const trEnd = tracksPos + 4 + trLen.length + trLen.value;
                    let p = tracksPos + 4 + trLen.length;
                    while (p < Math.min(trEnd, bytes.length - 6)) {
                        if (bytes[p] === 0xAE) { // TrackEntry
                            const teLen = readVint(p + 1);
                            if (teLen) {
                                const entryEnd = p + 1 + teLen.length + teLen.value;
                                let ep = p + 1 + teLen.length;
                                let foundType = 0;
                                let foundNum = 1;
                                while (ep < entryEnd) {
                                    if (bytes[ep] === 0xD7) { // TrackNumber
                                        const nLen = readVint(ep + 1);
                                        if (nLen) {
                                            foundNum = bytes[ep + 1 + nLen.length];
                                            ep += 1 + nLen.length + nLen.value;
                                            continue;
                                        }
                                    }
                                    if (bytes[ep] === 0x83) { // TrackType
                                        const tLen = readVint(ep + 1);
                                        if (tLen) {
                                            foundType = bytes[ep + 1 + tLen.length];
                                            ep += 1 + tLen.length + tLen.value;
                                            continue;
                                        }
                                    }
                                    ep++;
                                }
                                if (foundType === 1) { // 1 = Video Track
                                    videoTrackNumber = foundNum;
                                    break;
                                }
                                p = entryEnd;
                                continue;
                            }
                        }
                        p++;
                    }
                }
            }

            const cuePoints = [];
            for (const c of clusters) {
                const cOffset = c.offset + seekHeadLen + durShift;
                const timeEl = makeElement([0xB3], writeUint(c.time));
                const trackEl = makeElement([0xF7], [videoTrackNumber]);
                const posEl = makeElement([0xF1], writeUint(cOffset));
                const trackPosEl = makeElement([0xB7], [...trackEl, ...posEl]);
                const pointEl = makeElement([0xBB], [...timeEl, ...trackPosEl]);
                cuePoints.push(...pointEl);
            }
            const cuesElement = makeElement([0x1C, 0x53, 0xBB, 0x6B], cuePoints);

            // 4. Assemble Final WebM binary with SeekHead at front and Cues at end
            const totalNewLength = segPayloadStart + seekHeadElement.length + (newInfoElement ? newInfoElement.length : 0) + (bytes.length - (infoPos !== -1 ? (infoPos + origInfoTotalLength) : segPayloadStart)) + cuesElement.length;
            const newBytes = new Uint8Array(totalNewLength);

            let outPos = 0;
            // A. EBML Header + Segment ID & Length vint
            newBytes.set(bytes.subarray(0, segPayloadStart), outPos);
            outPos += segPayloadStart;

            // B. Front-Loaded SeekHead element
            newBytes.set(seekHeadElement, outPos);
            outPos += seekHeadElement.length;

            // C. Updated Info element with Duration
            if (newInfoElement) {
                newBytes.set(newInfoElement, outPos);
                outPos += newInfoElement.length;
            }

            // D. Remaining payload from original file (Tracks, Clusters)
            const copyStart = (infoPos !== -1 && origInfoTotalLength > 0) ? (infoPos + origInfoTotalLength) : segPayloadStart;
            const remainder = bytes.subarray(copyStart);
            newBytes.set(remainder, outPos);
            outPos += remainder.length;

            // E. Cues Seek Index table at end of file
            newBytes.set(cuesElement, outPos);
            outPos += cuesElement.length;

            return new Blob([newBytes], { type: blob.type || 'video/webm' });
        } catch (e) {
            console.warn('[RPA Exporter] injectWebmSeekCues fallback:', e);
            return blob;
        }
    }
}

window.RpaExporter = RpaExporter;
