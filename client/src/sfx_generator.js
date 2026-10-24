/**
 * RPA Video Editor - Studio Pro SFX Engine
 * Studio Sound Effects Suite
 * 
 * Cleanroom procedural Web Audio synthesizer providing pristine 44.1kHz PCM WAV
 * audio clips with zero external audio assets or network dependencies.
 */

class RpaSfxGenerator {
    constructor() {
        this.audioCtx = null;
        this.cache = new Map(); // id -> wavBlob
    }

    getAudioContext() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        return this.audioCtx;
    }

    getSfxLibrary() {
        return [
            {
                id: 'whoosh-fast',
                name: 'Whoosh (Fast Whip)',
                category: 'transitions',
                duration: 0.45,
                icon: '💨',
                desc: 'Crisp high-speed camera whip / transition pan'
            },
            {
                id: 'whoosh-deep',
                name: 'Cinematic Swoosh',
                category: 'transitions',
                duration: 0.75,
                icon: '🌪️',
                desc: 'Heavy low-end cinematic impact whoosh'
            },
            {
                id: 'pop',
                name: 'Pop & Bubble',
                category: 'ui',
                duration: 0.15,
                icon: '🫧',
                desc: 'Clean punchy UI notification / bubble pop'
            },
            {
                id: 'shutter',
                name: 'Camera Shutter',
                category: 'foley',
                duration: 0.32,
                icon: '📸',
                desc: 'Mechanical DSLR shutter click & mirror slap'
            },
            {
                id: 'ding',
                name: 'Success Chime',
                category: 'ui',
                duration: 1.20,
                icon: '🔔',
                desc: 'Crystal bright bell chime for achievements / alerts'
            },
            {
                id: 'impact-boom',
                name: 'Sub-Bass Boom',
                category: 'cinematic',
                duration: 1.85,
                icon: '💥',
                desc: 'Deep 40Hz cinematic rumble hit & sub drop'
            },
            {
                id: 'glitch',
                name: 'Cyber Glitch Zap',
                category: 'cinematic',
                duration: 0.35,
                icon: '⚡',
                desc: 'Digital noise burst with modulated square sweep'
            },
            {
                id: 'click',
                name: 'Mechanical Key Click',
                category: 'foley',
                duration: 0.08,
                icon: '⌨️',
                desc: 'Crisp mechanical keyboard switch click'
            },
            {
                id: 'beep',
                name: 'Countdown Pip',
                category: 'ui',
                duration: 0.12,
                icon: '🎯',
                desc: 'Pristine 1000Hz timer pip / start tone'
            },
            {
                id: 'laser',
                name: 'Sci-Fi Laser Blast',
                category: 'cinematic',
                duration: 0.25,
                icon: '🔫',
                desc: 'Retro arcade downward pitch laser sweep'
            },
            {
                id: 'vinyl',
                name: 'Vinyl Scratch Pause',
                category: 'foley',
                duration: 0.55,
                icon: '📀',
                desc: 'DJ turntable needle scratch tape deceleration'
            },
            {
                id: 'sparkle',
                name: 'Magic Sparkle Chime',
                category: 'ui',
                duration: 0.95,
                icon: '✨',
                desc: 'High shimmer ascending pentatonic sparkle arpeggio'
            }
        ];
    }

    /**
     * Synthesize audio into an AudioBuffer using OfflineAudioContext
     */
    async synthesize(id) {
        const item = this.getSfxLibrary().find(s => s.id === id) || this.getSfxLibrary()[0];
        const sampleRate = 44100;
        const dur = item.duration;
        const totalSamples = Math.ceil(sampleRate * dur);
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, totalSamples, sampleRate);

        const now = 0;
        const out = offlineCtx.destination;

        switch (id) {
            case 'whoosh-fast': {
                // Filtered white noise with rapid bandpass frequency sweep
                const bufferSize = totalSamples;
                const noiseBuf = offlineCtx.createBuffer(1, bufferSize, sampleRate);
                const data = noiseBuf.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

                const noise = offlineCtx.createBufferSource();
                noise.buffer = noiseBuf;

                const filter = offlineCtx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.Q.value = 2.5;
                filter.frequency.setValueAtTime(350, now);
                filter.frequency.exponentialRampToValueAtTime(3200, now + dur * 0.45);
                filter.frequency.exponentialRampToValueAtTime(250, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.9, now + dur * 0.4);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                noise.connect(filter);
                filter.connect(gain);
                gain.connect(out);
                noise.start(now);
                break;
            }

            case 'whoosh-deep': {
                // Low rumble + lowpass noise sweep
                const noiseBuf = offlineCtx.createBuffer(1, totalSamples, sampleRate);
                const d = noiseBuf.getChannelData(0);
                for (let i = 0; i < totalSamples; i++) d[i] = (Math.random() * 2 - 1);

                const noise = offlineCtx.createBufferSource();
                noise.buffer = noiseBuf;

                const filter = offlineCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(1400, now);
                filter.frequency.exponentialRampToValueAtTime(90, now + dur);

                const sub = offlineCtx.createOscillator();
                sub.type = 'sine';
                sub.frequency.setValueAtTime(120, now);
                sub.frequency.exponentialRampToValueAtTime(35, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.95, now + 0.2);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                noise.connect(filter);
                filter.connect(gain);
                sub.connect(gain);
                gain.connect(out);
                noise.start(now);
                sub.start(now);
                break;
            }

            case 'pop': {
                // Resonant sine downward pitch drop
                const osc = offlineCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(850, now);
                osc.frequency.exponentialRampToValueAtTime(160, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.85, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'shutter': {
                // Mechanical double click
                const makeClick = (startTime, freq) => {
                    const osc = offlineCtx.createOscillator();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(freq, startTime);
                    osc.frequency.exponentialRampToValueAtTime(120, startTime + 0.04);

                    const g = offlineCtx.createGain();
                    g.gain.setValueAtTime(0.65, startTime);
                    g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.045);

                    osc.connect(g);
                    g.connect(out);
                    osc.start(startTime);
                };
                makeClick(now, 1800);
                makeClick(now + 0.08, 950);
                makeClick(now + 0.16, 2200);
                break;
            }

            case 'ding': {
                // Dual bell harmonic
                const makeBell = (freq, vol, decay) => {
                    const osc = offlineCtx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now);

                    const g = offlineCtx.createGain();
                    g.gain.setValueAtTime(vol, now);
                    g.gain.exponentialRampToValueAtTime(0.001, now + decay);

                    osc.connect(g);
                    g.connect(out);
                    osc.start(now);
                };
                makeBell(1760, 0.6, dur);      // A6
                makeBell(2637.02, 0.35, dur * 0.85); // E7
                makeBell(3520, 0.15, dur * 0.6); // A7
                break;
            }

            case 'impact-boom': {
                // Heavy sub boom (60Hz down to 24Hz with distortion)
                const osc = offlineCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(95, now);
                osc.frequency.exponentialRampToValueAtTime(26, now + dur);

                // Transient click at head
                const clickOsc = offlineCtx.createOscillator();
                clickOsc.type = 'triangle';
                clickOsc.frequency.setValueAtTime(320, now);
                clickOsc.frequency.exponentialRampToValueAtTime(40, now + 0.08);

                const clickGain = offlineCtx.createGain();
                clickGain.gain.setValueAtTime(0.8, now);
                clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.95, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                clickOsc.connect(clickGain);
                clickGain.connect(out);
                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                clickOsc.start(now);
                break;
            }

            case 'glitch': {
                // Rapid frequency hopping square wave + noise burst
                const osc = offlineCtx.createOscillator();
                osc.type = 'sawtooth';
                const hops = [120, 850, 240, 1600, 320, 90, 1100, 480];
                const step = dur / hops.length;
                hops.forEach((f, idx) => {
                    osc.frequency.setValueAtTime(f, now + idx * step);
                });

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.7, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'click': {
                // Tactile mouse / mechanical key click
                const osc = offlineCtx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(2800, now);
                osc.frequency.exponentialRampToValueAtTime(400, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.85, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'beep': {
                // Pristine 1000Hz pip
                const osc = offlineCtx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1000, now);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.001, now);
                gain.gain.linearRampToValueAtTime(0.75, now + 0.015);
                gain.gain.setValueAtTime(0.75, now + dur - 0.02);
                gain.gain.linearRampToValueAtTime(0.001, now + dur);

                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'laser': {
                // Downward exponential pitch laser
                const osc = offlineCtx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(2400, now);
                osc.frequency.exponentialRampToValueAtTime(120, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.75, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                osc.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'vinyl': {
                // Turntable scratch / tape deceleration
                const osc = offlineCtx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(650, now);
                osc.frequency.exponentialRampToValueAtTime(30, now + dur);

                const filter = offlineCtx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1200, now);
                filter.frequency.exponentialRampToValueAtTime(200, now + dur);

                const gain = offlineCtx.createGain();
                gain.gain.setValueAtTime(0.85, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(out);
                osc.start(now);
                break;
            }

            case 'sparkle': {
                // Pentatonic arpeggio cascade
                const notes = [1046.50, 1318.51, 1567.98, 1975.53, 2349.32, 2793.83];
                const noteDur = 0.12;
                notes.forEach((freq, idx) => {
                    const t = now + idx * 0.09;
                    const osc = offlineCtx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, t);

                    const g = offlineCtx.createGain();
                    g.gain.setValueAtTime(0.35, t);
                    g.gain.exponentialRampToValueAtTime(0.001, t + noteDur * 3);

                    osc.connect(g);
                    g.connect(out);
                    osc.start(t);
                });
                break;
            }
        }

        return await offlineCtx.startRendering();
    }

    /**
     * Convert an AudioBuffer into an official PCM RIFF/WAV Blob
     */
    audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const numSamples = buffer.length;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numSamples * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;

        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };

        // RIFF chunk descriptor
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');

        // "fmt " sub-chunk
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true); // 16 for PCM
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);

        // "data" sub-chunk
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        // Write interleaved 16-bit PCM samples
        const channels = [];
        for (let c = 0; c < numChannels; c++) {
            channels.push(buffer.getChannelData(c));
        }

        let offset = 44;
        for (let i = 0; i < numSamples; i++) {
            for (let c = 0; c < numChannels; c++) {
                const sample = Math.max(-1, Math.min(1, channels[c][i]));
                // Convert float to 16-bit signed integer (-32768 to 32767)
                const intSample = sample < 0 ? sample * 32768 : sample * 32767;
                view.setInt16(offset, intSample, true);
                offset += 2;
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    /**
     * Get or generate a cached WAV Blob for an SFX
     */
    async getWavBlob(id) {
        if (this.cache.has(id)) {
            return this.cache.get(id);
        }
        const audioBuf = await this.synthesize(id);
        const wavBlob = this.audioBufferToWav(audioBuf);
        this.cache.set(id, wavBlob);
        return wavBlob;
    }

    /**
     * Instant audio preview in browser
     */
    async preview(id) {
        const audioBuf = await this.synthesize(id);
        const ctx = this.getAudioContext();
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        src.connect(ctx.destination);
        src.start();
    }

    /**
     * Add the synthesized SFX directly onto the project timeline
     */
    async addToTimeline(timeline, sfxId, startTime = 0, trackId = 2) {
        const item = this.getSfxLibrary().find(s => s.id === sfxId) || this.getSfxLibrary()[0];
        const blob = await this.getWavBlob(sfxId);
        const blobUrl = URL.createObjectURL(blob);

        // Ensure target audio track exists
        let track = timeline.getTrack(trackId);
        if (!track) {
            track = timeline.addTrack();
        }

        const newClip = {
            title: `SFX: ${item.name}`,
            type: 'audio',
            trackId: track.id,
            startTime: startTime,
            duration: item.duration,
            volume: 1.0,
            sourceUrl: blobUrl,
            sfxId: sfxId
        };

        timeline.addClip(newClip);
        timeline.saveSnapshot();
        return newClip;
    }
}

window.RpaSfxGenerator = RpaSfxGenerator;
