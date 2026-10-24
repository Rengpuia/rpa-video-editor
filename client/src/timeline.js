/**
 * CLEANROOM IMPLEMENTATION DECLARATION
 * Component: RPA Video Editor - Multi-Layer Timeline Engine
 * Specification: SPEC-EDT-001 (Multi-Track, Clip Synchronizer, Undo/Redo Stack, Keyframes)
 * Authors: Cleanroom Development Team
 * License: Private Cleanroom Software Suite
 */

class RpaTimeline {
    constructor() {
        this.clips = [];
        this.markers = []; // { id, time, label }
        this.captions = []; // { id, startTime, duration, text }
        this.selectedClipId = null;
        this.pixelsPerSecond = 45;
        this.playheadTime = 0.0;
        this.totalDuration = 30.0;

        // In/Out Selection Range (Studio Range Feature)
        this.selectionStart = null;
        this.selectionEnd = null;
        this.snappingEnabled = true;

        // Dynamic Unlimited Multi-Layer Tracks
        this.tracks = [
            { id: 4, name: 'Track 4 (Overlays)', type: 'overlay', visible: true, locked: false, muted: false },
            { id: 3, name: 'Track 3 (Subtitles)', type: 'caption', visible: true, locked: false, muted: false },
            { id: 2, name: 'Track 2 (Video)', type: 'video', visible: true, locked: false, muted: false },
            { id: 1, name: 'Track 1 (Audio)', type: 'audio', visible: true, locked: false, muted: false }
        ];

        // Robust Undo / Redo History Stack
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 45;
        this.saveSnapshot(); // Initial snapshot
    }

    saveSnapshot() {
        const state = JSON.stringify({
            clips: this.clips,
            tracks: this.tracks,
            markers: this.markers,
            captions: this.captions,
            totalDuration: this.totalDuration,
            selectedClipId: this.selectedClipId
        });

        // Don't duplicate top of stack
        if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === state) {
            return;
        }

        this.undoStack.push(state);
        if (this.undoStack.length > this.maxHistory) {
            this.undoStack.shift();
        }
        this.redoStack = []; // New action clears redo stack
        if (window.rpaStudio) window.rpaStudio.updateUndoRedoUI();
    }

    undo() {
        if (this.undoStack.length <= 1) return false;
        const currentState = this.undoStack.pop();
        this.redoStack.push(currentState);

        const prevState = JSON.parse(this.undoStack[this.undoStack.length - 1]);
        this.clips = prevState.clips;
        this.tracks = prevState.tracks;
        this.markers = prevState.markers;
        this.captions = prevState.captions;
        this.totalDuration = prevState.totalDuration;
        this.selectedClipId = prevState.selectedClipId;

        if (window.rpaStudio) {
            window.rpaStudio.renderTimeline();
            window.rpaStudio.updateTimelineRuler();
            window.rpaStudio.updateUndoRedoUI();
            window.rpaStudio.compositor.renderFrame(this, this.playheadTime);
        }
        return true;
    }

    redo() {
        if (this.redoStack.length === 0) return false;
        const nextStateStr = this.redoStack.pop();
        this.undoStack.push(nextStateStr);

        const nextState = JSON.parse(nextStateStr);
        this.clips = nextState.clips;
        this.tracks = nextState.tracks;
        this.markers = nextState.markers;
        this.captions = nextState.captions;
        this.totalDuration = nextState.totalDuration;
        this.selectedClipId = nextState.selectedClipId;

        if (window.rpaStudio) {
            window.rpaStudio.renderTimeline();
            window.rpaStudio.updateTimelineRuler();
            window.rpaStudio.updateUndoRedoUI();
            window.rpaStudio.compositor.renderFrame(this, this.playheadTime);
        }
        return true;
    }

    canUndo() {
        return this.undoStack.length > 1;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    addTrack(name = null, type = 'any') {
        const nextId = this.tracks.length > 0 ? Math.max(...this.tracks.map(t => t.id)) + 1 : 1;
        const track = {
            id: nextId,
            name: name || `Track ${nextId} (${type.toUpperCase()})`,
            type,
            visible: true,
            locked: false,
            muted: false
        };
        this.tracks.unshift(track);
        this.saveSnapshot();
        return track;
    }

    removeTrack(trackId) {
        if (this.tracks.length <= 1) {
            alert('Cannot remove the last remaining track.');
            return false;
        }
        this.clips = this.clips.filter(c => c.trackId !== trackId);
        this.tracks = this.tracks.filter(t => t.id !== trackId);
        this.updateTotalDuration();
        this.saveSnapshot();
        return true;
    }

    getTrack(trackId) {
        return this.tracks.find(t => t.id === trackId);
    }

    toggleTrackLock(trackId) {
        const track = this.getTrack(trackId);
        if (track) track.locked = !track.locked;
        this.saveSnapshot();
        return track ? track.locked : false;
    }

    toggleTrackMute(trackId) {
        const track = this.getTrack(trackId);
        if (track) track.muted = !track.muted;
        this.saveSnapshot();
        return track ? track.muted : false;
    }

    toggleTrackVisibility(trackId) {
        const track = this.getTrack(trackId);
        if (track) track.visible = !track.visible;
        this.saveSnapshot();
        return track ? track.visible : true;
    }

    addClip(clipData) {
        const id = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        const clip = {
            id,
            title: clipData.title || 'Untitled Clip',
            type: clipData.type || 'video',
            trackId: clipData.trackId !== undefined ? clipData.trackId : 2,
            startTime: Math.max(0, clipData.startTime || 0.0),
            duration: Math.max(0.2, clipData.duration || 5.0),
            sourceUrl: clipData.sourceUrl || null,
            telemetry: clipData.telemetry || [],
            scale: clipData.scale || 1.0,
            opacity: clipData.opacity !== undefined ? clipData.opacity : 1.0,
            volume: clipData.volume !== undefined ? clipData.volume : 1.0,
            text: clipData.text || '',
            hasAudio: clipData.hasAudio !== undefined ? clipData.hasAudio : (clipData.type === 'video' || clipData.type === 'audio'),

            // Freeform / Changeable Aspect Ratio
            scaleX: clipData.scaleX !== undefined ? clipData.scaleX : (clipData.scale || 1.0),
            scaleY: clipData.scaleY !== undefined ? clipData.scaleY : (clipData.scale || 1.0),
            aspectRatioLocked: clipData.aspectRatioLocked !== undefined ? clipData.aspectRatioLocked : true,
            aspectRatioPreset: clipData.aspectRatioPreset || '16:9',

            // Transitions (Fade, Dissolve, Slide, Wipe, Circle, Zoom)
            transitionIn: clipData.transitionIn || 'none',
            transitionInDuration: clipData.transitionInDuration || 0.8,
            transitionOut: clipData.transitionOut || 'none',
            transitionOutDuration: clipData.transitionOutDuration || 0.8,

            // Behaviors (Physics Pop, Drift, Pulse, Jump, Fade-Scale)
            behavior: clipData.behavior || 'none',

            // Massive Effects Suite & Color Wheel Grading
            visualEffects: clipData.visualEffects || {
                // Interactive 3-Way Color Wheel & Auto Adjust
                colorGrade: {
                    lift: { r: 0, g: 0, b: 0 },
                    gamma: { r: 0, g: 0, b: 0 },
                    gain: { r: 0, g: 0, b: 0 },
                    temperature: 0,
                    tint: 0,
                    hue: 0,
                    autoAdjusted: false
                },
                // Chroma Key (Green Screen)
                chromaKey: false,
                chromaColor: '#00ff00',
                chromaTolerance: 0.28,
                // Massive Effects Collection
                vignette: 0,
                glow: 0,
                filmGrain: 0,
                scanlines: false,
                glitch: 0,
                pixelate: 0,
                invert: false,
                sepia: 0,
                borderRadius: 0,
                dropShadow: true,
                brightness: 100,
                contrast: 100,
                saturation: 100,
                deviceFrame: 'none'
            },

            // Audio Effects
            audioEffects: clipData.audioEffects || {
                noiseGate: false,
                volumeLeveling: false,
                fadeIn: 0,
                fadeOut: 0
            },

            // Interactive Canvas Crop
            crop: clipData.crop || { top: 0, right: 0, bottom: 0, left: 0 },

            // Position & Rotation
            xOffset: clipData.xOffset || 0,
            yOffset: clipData.yOffset || 0,
            rotation: clipData.rotation || 0,

            // Visual Keyframe Graphs
            keyframes: clipData.keyframes || []
        };

        this.clips.push(clip);
        this.updateTotalDuration();
        this.saveSnapshot();
        return clip;
    }

    getClip(id) {
        return this.clips.find(c => c.id === id);
    }

    removeClip(id) {
        this.clips = this.clips.filter(c => c.id !== id);
        if (this.selectedClipId === id) this.selectedClipId = null;
        this.updateTotalDuration();
        this.saveSnapshot();
    }

    separateAudioAndVideo(clipId) {
        const videoClip = this.getClip(clipId);
        if (!videoClip || videoClip.type !== 'video') {
            return null;
        }

        let audioTrack = this.tracks.find(t => t.type === 'audio');
        if (!audioTrack) {
            audioTrack = this.addTrack('Track (Separated Audio)', 'audio');
        }

        const audioClip = this.addClip({
            title: `${videoClip.title} (Audio)`,
            type: 'audio',
            trackId: audioTrack.id,
            startTime: videoClip.startTime,
            duration: videoClip.duration,
            sourceUrl: videoClip.sourceUrl,
            volume: videoClip.volume || 1.0,
            hasAudio: true
        });

        videoClip.hasAudio = false;
        videoClip.title = `${videoClip.title} (Video Only)`;

        this.updateTotalDuration();
        this.saveSnapshot();
        return { videoClip, audioClip };
    }

    addKeyframe(clipId, timeOffset, property = 'scale', value = 1.0, easing = 'easeInOut') {
        const clip = this.getClip(clipId);
        if (!clip) return null;
        if (!clip.keyframes) clip.keyframes = [];

        // Check if keyframe exists at this offset
        const existing = clip.keyframes.find(k => Math.abs(k.timeOffset - timeOffset) < 0.1 && k.property === property);
        if (existing) {
            existing.value = value;
            existing.easing = easing;
            this.saveSnapshot();
            return existing;
        }

        const kf = {
            id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            timeOffset: Math.max(0, Math.min(clip.duration, timeOffset)),
            property,
            value,
            easing
        };
        clip.keyframes.push(kf);
        clip.keyframes.sort((a, b) => a.timeOffset - b.timeOffset);
        this.saveSnapshot();
        return kf;
    }

    removeKeyframe(clipId, keyframeId) {
        const clip = this.getClip(clipId);
        if (!clip || !clip.keyframes) return;
        clip.keyframes = clip.keyframes.filter(k => k.id !== keyframeId);
        this.saveSnapshot();
    }

    addMarker(time, label = 'Marker') {
        const marker = {
            id: `marker_${Date.now()}`,
            time: Math.max(0, time),
            label
        };
        this.markers.push(marker);
        this.markers.sort((a, b) => a.time - b.time);
        this.saveSnapshot();
        return marker;
    }

    splitClip(clipId, splitTime) {
        const clip = this.getClip(clipId);
        if (!clip) return null;

        if (splitTime <= clip.startTime || splitTime >= (clip.startTime + clip.duration)) {
            return null;
        }

        const originalDuration = clip.duration;
        const firstDuration = splitTime - clip.startTime;
        const secondDuration = originalDuration - firstDuration;

        // Cut seam: Part 1 keeps its transitionIn, but drops its transitionOut (at the seam)
        const origTransitionOut = clip.transitionOut;
        const origTransitionOutDuration = clip.transitionOutDuration;

        clip.duration = firstDuration;
        clip.transitionOut = 'none';

        // Split keyframes cleanly between Part 1 and Part 2
        const part1Keyframes = [];
        const part2Keyframes = [];
        if (clip.keyframes) {
            for (const kf of clip.keyframes) {
                if (kf.timeOffset < firstDuration) {
                    part1Keyframes.push({ ...kf });
                } else {
                    part2Keyframes.push({
                        ...kf,
                        id: `kf_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        timeOffset: Math.max(0, parseFloat((kf.timeOffset - firstDuration).toFixed(2)))
                    });
                }
            }
        }
        clip.keyframes = part1Keyframes;

        // Split animation arrows cleanly
        const part1Anims = [];
        const part2Anims = [];
        if (clip.animations) {
            for (const anim of clip.animations) {
                if (anim.timeOffset < firstDuration) {
                    part1Anims.push({ ...anim });
                } else {
                    part2Anims.push({
                        ...anim,
                        id: `anim_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        timeOffset: Math.max(0, parseFloat((anim.timeOffset - firstDuration).toFixed(2)))
                    });
                }
            }
        }
        clip.animations = part1Anims;

        // Split intermediate timeline transitions cleanly
        const part1Transitions = [];
        const part2Transitions = [];
        if (clip.transitions) {
            for (const tr of clip.transitions) {
                if (tr.timeOffset < firstDuration) {
                    part1Transitions.push({ ...tr });
                } else {
                    part2Transitions.push({
                        ...tr,
                        id: `trans_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                        timeOffset: Math.max(0, parseFloat((tr.timeOffset - firstDuration).toFixed(2)))
                    });
                }
            }
        }
        clip.transitions = part1Transitions;

        // Create second clip with proper sourceStartTime offset and clean cut seam (transitionIn: 'none')
        const secondClip = this.addClip({
            ...clip,
            title: `${clip.title.replace(/\s*\(Part\s*\d+\)$/i, '')} (Part 2)`,
            startTime: splitTime,
            duration: secondDuration,
            sourceStartTime: (clip.sourceStartTime || 0) + firstDuration,
            transitionIn: 'none',
            transitionOut: origTransitionOut,
            transitionOutDuration: origTransitionOutDuration,
            keyframes: part2Keyframes,
            animations: part2Anims,
            transitions: part2Transitions
        });

        this.updateTotalDuration();
        this.saveSnapshot();
        return secondClip;
    }

    cutSelection(start, end) {
        if (start === null || end === null || start >= end) return;
        const cutDuration = end - start;
        const newClips = [];

        for (const clip of this.clips) {
            const clipEnd = clip.startTime + clip.duration;

            if (clipEnd <= start) {
                newClips.push(clip);
            } else if (clip.startTime >= end) {
                clip.startTime -= cutDuration;
                newClips.push(clip);
            } else {
                if (clip.startTime < start && clipEnd > end) {
                    const part1 = { ...clip, duration: start - clip.startTime };
                    const part2 = {
                        ...clip,
                        id: `clip_${Date.now()}_split`,
                        startTime: start,
                        duration: clipEnd - end
                    };
                    newClips.push(part1, part2);
                } else if (clip.startTime < start) {
                    clip.duration = start - clip.startTime;
                    newClips.push(clip);
                } else if (clipEnd > end) {
                    const trimmed = clipEnd - end;
                    clip.startTime = start;
                    clip.duration = trimmed;
                    newClips.push(clip);
                }
            }
        }

        this.clips = newClips;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.updateTotalDuration();
        this.saveSnapshot();
    }

    addCaption(startTime, duration, text) {
        const caption = {
            id: `cap_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            startTime: Math.max(0, startTime),
            duration: Math.max(1.0, duration),
            text: text || 'New subtitle line'
        };
        this.captions.push(caption);
        this.captions.sort((a, b) => a.startTime - b.startTime);
        this.saveSnapshot();
        return caption;
    }

    updateTotalDuration() {
        let maxTime = 15.0;
        for (const clip of this.clips) {
            const end = clip.startTime + clip.duration;
            if (end > maxTime) maxTime = end;
        }
        for (const m of this.markers) {
            if (m.time > maxTime) maxTime = m.time;
        }
        for (const c of this.captions) {
            const end = c.startTime + c.duration;
            if (end > maxTime) maxTime = end;
        }
        this.totalDuration = Math.ceil(maxTime + 5.0);
    }

    findSnapPoint(candidateTime, excludeClipId = null, ignoreNearTime = null) {
        if (!this.snappingEnabled) return { time: candidateTime, snapped: false };
        const thresholdSec = 10 / this.pixelsPerSecond;
        const snapTargets = [];

        if (ignoreNearTime === null || Math.abs(this.playheadTime - ignoreNearTime) > 0.05) {
            snapTargets.push(this.playheadTime);
        }
        if (this.selectionStart !== null && (ignoreNearTime === null || Math.abs(this.selectionStart - ignoreNearTime) > 0.05)) {
            snapTargets.push(this.selectionStart);
        }
        if (this.selectionEnd !== null && (ignoreNearTime === null || Math.abs(this.selectionEnd - ignoreNearTime) > 0.05)) {
            snapTargets.push(this.selectionEnd);
        }

        for (const m of this.markers) {
            if (ignoreNearTime === null || Math.abs(m.time - ignoreNearTime) > 0.05) {
                snapTargets.push(m.time);
            }
        }

        for (const c of this.clips) {
            if (c.id === excludeClipId) continue;
            snapTargets.push(c.startTime);
            snapTargets.push(c.startTime + c.duration);
        }

        let bestTarget = null;
        let minDiff = Infinity;

        for (const target of snapTargets) {
            const diff = Math.abs(candidateTime - target);
            if (diff < thresholdSec && diff < minDiff) {
                minDiff = diff;
                bestTarget = target;
            }
        }

        if (bestTarget !== null) {
            return { time: bestTarget, snapped: true };
        }
        return { time: candidateTime, snapped: false };
    }

    loadProjectData(projectData) {
        if (!projectData) return;
        this.clips = projectData.clips || [];
        if (projectData.tracks && projectData.tracks.length > 0) {
            this.tracks = projectData.tracks;
        }
        this.markers = projectData.markers || [];
        this.captions = projectData.captions || [];
        this.totalDuration = projectData.duration || 30.0;
        this.selectedClipId = null;
        this.selectionStart = null;
        this.selectionEnd = null;
        this.updateTotalDuration();
        this.saveSnapshot();
    }

    /**
     * Dynamic Multi-Layer Track & Clip DOM Renderer with Drag & Drop Dropzone
     */
    render(containerEl, onClipSelected) {
        if (!containerEl) return;
        containerEl.innerHTML = '';

        for (const track of this.tracks) {
            const trackEl = document.createElement('div');
            trackEl.className = 'timeline-track';
            trackEl.dataset.trackId = track.id;
            if (track.locked) trackEl.classList.add('track-locked');

            // 1. Interactive Track Header with Controls
            const headerEl = document.createElement('div');
            headerEl.className = 'track-header';
            headerEl.innerHTML = `
                <div class="track-title" title="Track ${track.id}">${track.name}</div>
                <div class="track-actions">
                    <span class="track-btn" data-action="toggle-vis" title="Toggle Visibility">${track.visible ? '👁️' : '🕶️'}</span>
                    <span class="track-btn" data-action="toggle-mute" title="Toggle Mute">${track.muted ? '🔇' : '🔊'}</span>
                    <span class="track-btn" data-action="toggle-lock" title="Toggle Lock">${track.locked ? '🔒' : '🔓'}</span>
                    <span class="track-btn track-btn-del" data-action="delete-track" title="Delete Track">✕</span>
                </div>
            `;

            headerEl.onclick = (e) => {
                const action = e.target.dataset.action;
                if (!action) return;
                e.stopPropagation();

                if (action === 'toggle-vis') {
                    this.toggleTrackVisibility(track.id);
                    this.render(containerEl, onClipSelected);
                    if (window.rpaStudio) window.rpaStudio.compositor.renderFrame(this, this.playheadTime);
                } else if (action === 'toggle-mute') {
                    this.toggleTrackMute(track.id);
                    this.render(containerEl, onClipSelected);
                } else if (action === 'toggle-lock') {
                    this.toggleTrackLock(track.id);
                    this.render(containerEl, onClipSelected);
                } else if (action === 'delete-track') {
                    if (confirm(`Delete ${track.name} and all clips on it?`)) {
                        this.removeTrack(track.id);
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) window.rpaStudio.updateTimelineRuler();
                    }
                }
            };

            // 2. Track Content Area (HTML5 Drag & Drop Target)
            const contentEl = document.createElement('div');
            contentEl.className = 'track-content';
            contentEl.id = `trackContent${track.id}`;
            contentEl.dataset.trackId = track.id;

            // Drag over & Drop target on track
            contentEl.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                contentEl.classList.add('track-drop-active');
            };
            contentEl.ondragleave = () => {
                contentEl.classList.remove('track-drop-active');
            };
            contentEl.ondrop = (e) => {
                e.preventDefault();
                contentEl.classList.remove('track-drop-active');
                if (window.rpaStudio) {
                    window.rpaStudio.handleToolDropOnTrack(e, track.id);
                }
            };

            // Empty Track Click to Deselect Clip & Seek
            contentEl.onpointerdown = (e) => {
                if (e.target === contentEl) {
                    this.selectedClipId = null;
                    if (onClipSelected) onClipSelected(null);
                    const rect = contentEl.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const time = Math.max(0, clickX / this.pixelsPerSecond);
                    if (window.rpaStudio) {
                        window.rpaStudio.seek(time);
                        window.rpaStudio.renderTimeline();
                    }
                }
            };

            // Populate clips for this track
            const trackClips = this.clips.filter(c => c.trackId === track.id);
            for (const clip of trackClips) {
                const clipEl = document.createElement('div');
                clipEl.className = `timeline-clip clip-${clip.type}`;
                clipEl.dataset.clipId = clip.id;
                if (clip.id === this.selectedClipId) {
                    clipEl.classList.add('selected');
                }

                const leftPx = clip.startTime * this.pixelsPerSecond;
                const widthPx = Math.max(30, clip.duration * this.pixelsPerSecond);

                clipEl.style.left = `${leftPx}px`;
                clipEl.style.width = `${widthPx}px`;

                // 1. Transition In Wedge (Entrance on Left)
                let transInHtml = '';
                if (clip.transitionIn && clip.transitionIn !== 'none') {
                    const durIn = clip.transitionInDuration !== undefined ? clip.transitionInDuration : 0.8;
                    const durInPx = Math.max(24, Math.min(widthPx * 0.48, durIn * this.pixelsPerSecond));
                    transInHtml = `
                        <div class="clip-transition-wedge wedge-in" style="width: ${durInPx}px;" data-action="inspect-transition" title="Transition In: ${clip.transitionIn} (${durIn.toFixed(1)}s) - Drag handle to resize, Click to edit">
                            <span class="wedge-del-btn" data-action="del-trans-in" title="Remove Transition In">✕</span>
                            <span class="wedge-label">⮌ ${clip.transitionIn} <span class="wedge-dur">${durIn.toFixed(1)}s</span></span>
                            <div class="wedge-resize-handle handle-in" data-action="resize-trans-in" title="Drag to adjust entrance duration"></div>
                        </div>
                    `;
                }

                // 2. Transition Out Wedge (Exit on Right)
                let transOutHtml = '';
                if (clip.transitionOut && clip.transitionOut !== 'none') {
                    const durOut = clip.transitionOutDuration !== undefined ? clip.transitionOutDuration : 0.8;
                    const durOutPx = Math.max(24, Math.min(widthPx * 0.48, durOut * this.pixelsPerSecond));
                    transOutHtml = `
                        <div class="clip-transition-wedge wedge-out" style="width: ${durOutPx}px;" data-action="inspect-transition" title="Transition Out: ${clip.transitionOut} (${durOut.toFixed(1)}s) - Drag handle to resize, Click to edit">
                            <div class="wedge-resize-handle handle-out" data-action="resize-trans-out" title="Drag to adjust exit duration"></div>
                            <span class="wedge-label">${clip.transitionOut} <span class="wedge-dur">${durOut.toFixed(1)}s</span> ⮍</span>
                            <span class="wedge-del-btn" data-action="del-trans-out" title="Remove Transition Out">✕</span>
                        </div>
                    `;
                }

                // 2.5 Multiple Intermediate Transitions on Timeline Content
                let transInterHtml = '';
                if (clip.transitions && clip.transitions.length > 0) {
                    clip.transitions.sort((a, b) => a.timeOffset - b.timeOffset);
                    for (const tr of clip.transitions) {
                        const trStartPx = Math.max(0, tr.timeOffset * this.pixelsPerSecond);
                        const trWidthPx = Math.max(26, (tr.duration || 0.8) * this.pixelsPerSecond);
                        transInterHtml += `
                            <div class="clip-transition-wedge wedge-intermediate" data-action="drag-intermediate-trans" data-trans-id="${tr.id}" style="left: ${trStartPx}px; width: ${trWidthPx}px;" title="Transition: ${tr.name} (${(tr.duration || 0.8).toFixed(1)}s) - Drag body to slide, Drag handle to resize">
                                <span class="wedge-del-btn" data-action="del-intermediate-trans" data-trans-id="${tr.id}" title="Remove Transition">✕</span>
                                <span class="wedge-label">⚡ ${tr.name} <span class="wedge-dur">${(tr.duration || 0.8).toFixed(1)}s</span></span>
                                <div class="wedge-resize-handle handle-intermediate" data-action="resize-intermediate-trans" data-trans-id="${tr.id}" title="Drag to adjust transition duration"></div>
                            </div>
                        `;
                    }
                }

                // 3. Behavior Drawer Bar
                let behaviorHtml = '';
                if (clip.behavior && clip.behavior !== 'none') {
                    behaviorHtml = `
                        <div class="clip-behavior-bar" data-action="inspect-behavior" title="Behavior: ${clip.behavior} - Click to edit in Properties panel">
                            <span class="behavior-icon">⚡</span>
                            <span class="behavior-title">${clip.behavior}</span>
                            <span class="behavior-del-btn" data-action="del-behavior" title="Remove Behavior">✕</span>
                        </div>
                    `;
                }

                // 4. Interactive Visual Effects Chips
                const fxChips = [];
                const fx = clip.visualEffects;
                if (fx) {
                    if (fx.chromaKey) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="chromaKey" title="Chroma Key - Click to edit">🟩 Chroma <span class="fx-chip-del" data-action="del-fx" data-fx="chromaKey">✕</span></span>`);
                    if (fx.vignette) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="vignette" title="Vignette - Click to edit">🔘 Vignette ${fx.vignette}% <span class="fx-chip-del" data-action="del-fx" data-fx="vignette">✕</span></span>`);
                    if (fx.filmGrain) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="filmGrain" title="Grain - Click to edit">🎞 Grain ${fx.filmGrain}% <span class="fx-chip-del" data-action="del-fx" data-fx="filmGrain">✕</span></span>`);
                    if (fx.glow) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="glow" title="Glow - Click to edit">✨ Glow ${fx.glow}% <span class="fx-chip-del" data-action="del-fx" data-fx="glow">✕</span></span>`);
                    if (fx.scanlines) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="scanlines" title="VHS Scanlines - Click to edit">📺 VHS <span class="fx-chip-del" data-action="del-fx" data-fx="scanlines">✕</span></span>`);
                    if (fx.pixelate) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="pixelate" title="Pixelate - Click to edit">👾 Pixelate ${fx.pixelate}px <span class="fx-chip-del" data-action="del-fx" data-fx="pixelate">✕</span></span>`);
                    if (fx.sepia) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="sepia" title="Sepia - Click to edit">📜 Sepia ${fx.sepia}% <span class="fx-chip-del" data-action="del-fx" data-fx="sepia">✕</span></span>`);
                    if (fx.invert) fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="invert" title="Invert - Click to edit">🔄 Invert <span class="fx-chip-del" data-action="del-fx" data-fx="invert">✕</span></span>`);
                    if (fx.deviceFrame && fx.deviceFrame !== 'none') fxChips.push(`<span class="timeline-fx-chip" data-action="inspect-fx" data-fx="deviceFrame" title="Window Frame - Click to edit">🪟 ${fx.deviceFrame.toUpperCase()} <span class="fx-chip-del" data-action="del-fx" data-fx="deviceFrame">✕</span></span>`);
                }
                const fxChipsHtml = fxChips.length > 0 ? `<div class="clip-fx-container">${fxChips.join('')}</div>` : '';

                // 5. Studio Animation Arrows & Draggable Keyframes
                let kfHtml = '';
                if (clip.animations && clip.animations.length > 0) {
                    clip.animations.sort((a, b) => a.timeOffset - b.timeOffset);
                    for (const anim of clip.animations) {
                        const animStartPx = Math.max(0, anim.timeOffset * this.pixelsPerSecond);
                        const animWidthPx = Math.max(22, anim.duration * this.pixelsPerSecond);
                        const isAnimSelected = this.selectedAnimationId === anim.id;
                        kfHtml += `
                            <div class="studio-timeline-arrow animation-arrow ${isAnimSelected ? 'selected' : ''}" data-action="select-arrow" data-anim-id="${anim.id}" style="left: ${animStartPx}px; width: ${animWidthPx}px;" title="Animation: ${anim.name} (${anim.duration.toFixed(1)}s, ${anim.easing})">
                                <div class="arrow-tail" data-action="drag-arrow-tail" data-anim-id="${anim.id}" title="Drag tail to adjust start timing"></div>
                                <div class="arrow-body" data-action="drag-arrow-body" data-anim-id="${anim.id}" title="Click to select / Drag to slide timing">
                                    <span class="arrow-label">${anim.name}</span>
                                </div>
                                <div class="arrow-head" data-action="drag-arrow-head" data-anim-id="${anim.id}" title="Drag head to adjust duration / speed"></div>
                                <span class="arrow-del-btn" data-action="del-anim-arrow" data-anim-id="${anim.id}" title="Delete Animation Arrow">✕</span>
                            </div>
                        `;
                    }
                }
                if (clip.keyframes && clip.keyframes.length > 0) {
                    clip.keyframes.sort((a, b) => a.timeOffset - b.timeOffset);
                    for (const kf of clip.keyframes) {
                        if (clip.animations && clip.animations.some(a => a.id === kf.arrowId)) continue;
                        const kfLeft = Math.max(4, Math.min(widthPx - 4, kf.timeOffset * this.pixelsPerSecond));
                        kfHtml += `<div class="clip-keyframe-diamond" style="left: ${kfLeft}px;" data-action="drag-keyframe" data-kfid="${kf.id}" title="Keyframe: ${kf.property} = ${kf.value} (${kf.easing}) | Offset: ${kf.timeOffset.toFixed(2)}s - Drag to move timing, Click to inspect"></div>`;
                    }
                }

                clipEl.innerHTML = `
                    <div class="clip-handle clip-handle-left" data-action="trim-left" title="Trim start"></div>
                    ${transInHtml}
                    ${transInterHtml}
                    <div class="clip-body">
                        <span class="clip-title-text">${clip.title}</span>
                        ${fxChipsHtml}
                    </div>
                    ${behaviorHtml}
                    ${transOutHtml}
                    ${kfHtml}
                    <div class="clip-handle clip-handle-right" data-action="trim-right" title="Trim end"></div>
                `;

                // Clip Drag / Drop target for Effects & Transitions
                clipEl.ondragover = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    clipEl.classList.add('clip-drop-target');
                };
                clipEl.ondragleave = () => {
                    clipEl.classList.remove('clip-drop-target');
                };
                clipEl.ondrop = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clipEl.classList.remove('clip-drop-target');
                    if (window.rpaStudio) {
                        window.rpaStudio.handleToolDropOnClip(e, clip.id);
                    }
                };

                // Dragging clip, trimming left/right, or adjusting transitions/keyframes
                const onClipDragStart = (e) => {
                    if (track.locked) return;
                    if (e.button !== undefined && e.button !== 0) return;

                    const actionTarget = e.target.closest('[data-action]');
                    const action = actionTarget ? actionTarget.dataset.action : null;
                    const targetEl = actionTarget || e.target;

                    // A. Instant Delete Actions right on timeline
                    if (action === 'del-trans-in') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.transitionIn = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-trans-out') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.transitionOut = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-behavior') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.behavior = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-fx') {
                        e.stopPropagation();
                        e.preventDefault();
                        const fxKey = targetEl.dataset.fx;
                        if (clip.visualEffects) {
                            delete clip.visualEffects[fxKey];
                            if (fxKey === 'chromaKey') clip.visualEffects.chromaKey = false;
                            if (fxKey === 'scanlines') clip.visualEffects.scanlines = false;
                            if (fxKey === 'invert') clip.visualEffects.invert = false;
                            if (fxKey === 'deviceFrame') clip.visualEffects.deviceFrame = 'none';
                        }
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-intermediate-trans') {
                        e.stopPropagation();
                        e.preventDefault();
                        const transId = actionTarget.dataset.transId || actionTarget.closest('[data-trans-id]')?.dataset.transId;
                        if (clip.transitions) {
                            clip.transitions = clip.transitions.filter(t => t.id !== transId);
                        }
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-anim-arrow') {
                        e.stopPropagation();
                        e.preventDefault();
                        const animId = targetEl.dataset.animId || targetEl.closest('[data-anim-id]')?.dataset.animId;
                        if (clip.animations) {
                            clip.animations = clip.animations.filter(a => a.id !== animId);
                        }
                        if (clip.keyframes) {
                            clip.keyframes = clip.keyframes.filter(k => k.arrowId !== animId);
                        }
                        if (this.selectedAnimationId === animId) this.selectedAnimationId = null;
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }

                    // B. Select and Focus Section in Inspector (Allows drag to continue)
                    if (action === 'inspect-transition' || action === 'drag-intermediate-trans' || action === 'resize-intermediate-trans') {
                        this.selectedClipId = clip.id;
                        onClipSelected(clip);
                        if (window.rpaStudio) window.rpaStudio.focusInspectorSection('sectionTransitions');
                    }
                    if (action === 'inspect-behavior') {
                        this.selectedClipId = clip.id;
                        onClipSelected(clip);
                        if (window.rpaStudio) window.rpaStudio.focusInspectorSection('sectionBehaviors');
                    }
                    if (action === 'inspect-fx') {
                        this.selectedClipId = clip.id;
                        onClipSelected(clip);
                        if (window.rpaStudio) window.rpaStudio.focusInspectorSection('sectionVisualEffects');
                    }
                    if (action === 'select-arrow') {
                        const animId = targetEl.dataset.animId || targetEl.closest('[data-anim-id]')?.dataset.animId;
                        this.selectedAnimationId = animId;
                        const anim = clip.animations ? clip.animations.find(a => a.id === animId) : null;
                        if (anim && window.rpaStudio) {
                            window.rpaStudio.inspectAnimation(clip, anim);
                        }
                        this.render(containerEl, onClipSelected);
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    this.selectedClipId = clip.id;
                    onClipSelected(clip);

                    const startX = e.clientX;
                    const origStart = clip.startTime;
                    const origDur = clip.duration;
                    const origDurIn = clip.transitionInDuration !== undefined ? clip.transitionInDuration : 0.8;
                    const origDurOut = clip.transitionOutDuration !== undefined ? clip.transitionOutDuration : 0.8;

                    // Elements for live transition duration dragging
                    const wedgeInEl = clipEl.querySelector('.wedge-in');
                    const labelInDur = wedgeInEl ? wedgeInEl.querySelector('.wedge-dur') : null;
                    const wedgeOutEl = clipEl.querySelector('.wedge-out');
                    const labelOutDur = wedgeOutEl ? wedgeOutEl.querySelector('.wedge-dur') : null;

                    // Studio Animation Arrow Dragging
                    let targetAnim = null;
                    let origAnimOffset = 0;
                    let origAnimDur = 1.0;
                    if (action === 'drag-arrow-body' || action === 'drag-arrow-head' || action === 'drag-arrow-tail') {
                        const animId = targetEl.dataset.animId || targetEl.closest('[data-anim-id]')?.dataset.animId;
                        targetAnim = clip.animations ? clip.animations.find(a => a.id === animId) : null;
                        if (targetAnim) {
                            this.selectedAnimationId = targetAnim.id;
                            origAnimOffset = targetAnim.timeOffset;
                            origAnimDur = targetAnim.duration;
                            if (window.rpaStudio) window.rpaStudio.inspectAnimation(clip, targetAnim);
                        }
                    }

                    // Keyframe dragging
                    let targetKf = null;
                    let origKfOffset = 0;
                    if (action === 'drag-keyframe') {
                        const rawKfId = targetEl.dataset.kfid;
                        targetKf = clip.keyframes ? clip.keyframes.find(k => String(k.id) === String(rawKfId)) : null;
                        if (targetKf) {
                            origKfOffset = targetKf.timeOffset;
                            targetEl.classList.add('dragging');
                        }
                    }

                    // Intermediate Timeline Content Transition dragging
                    let targetIntermediateTrans = null;
                    let origIntermediateOffset = 0;
                    let origIntermediateDur = 0.8;
                    if (action === 'drag-intermediate-trans' || action === 'resize-intermediate-trans') {
                        const transId = targetEl.dataset.transId || targetEl.closest('[data-trans-id]')?.dataset.transId;
                        targetIntermediateTrans = clip.transitions ? clip.transitions.find(t => t.id === transId) : null;
                        if (targetIntermediateTrans) {
                            origIntermediateOffset = targetIntermediateTrans.timeOffset;
                            origIntermediateDur = targetIntermediateTrans.duration || 0.8;
                        }
                    }

                    const onClipMove = (moveEvent) => {
                        const deltaSec = (moveEvent.clientX - startX) / this.pixelsPerSecond;

                        if (action === 'resize-trans-in') {
                            // Dragging entrance transition duration on timeline
                            const maxIn = Math.max(0.2, clip.duration * 0.48);
                            clip.transitionInDuration = Math.max(0.1, Math.min(maxIn, parseFloat((origDurIn + deltaSec).toFixed(2))));
                            if (wedgeInEl) wedgeInEl.style.width = `${clip.transitionInDuration * this.pixelsPerSecond}px`;
                            if (labelInDur) labelInDur.innerText = `${clip.transitionInDuration.toFixed(1)}s`;
                            if (window.rpaStudio) {
                                const rng = document.getElementById('rngTransitionDuration');
                                if (rng) rng.value = Math.round(clip.transitionInDuration * 10);
                                const lbl = document.getElementById('lblTransitionDur');
                                if (lbl) lbl.innerText = `${clip.transitionInDuration.toFixed(1)}s`;
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'resize-trans-out') {
                            // Dragging exit transition duration on timeline (drag left to increase)
                            const maxOut = Math.max(0.2, clip.duration * 0.48);
                            clip.transitionOutDuration = Math.max(0.1, Math.min(maxOut, parseFloat((origDurOut - deltaSec).toFixed(2))));
                            if (wedgeOutEl) wedgeOutEl.style.width = `${clip.transitionOutDuration * this.pixelsPerSecond}px`;
                            if (labelOutDur) labelOutDur.innerText = `${clip.transitionOutDuration.toFixed(1)}s`;
                            if (window.rpaStudio) {
                                const rng = document.getElementById('rngTransitionDuration');
                                if (rng) rng.value = Math.round(clip.transitionOutDuration * 10);
                                const lbl = document.getElementById('lblTransitionDur');
                                if (lbl) lbl.innerText = `${clip.transitionOutDuration.toFixed(1)}s`;
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'drag-intermediate-trans' && targetIntermediateTrans) {
                            const newOffset = Math.max(0, Math.min(clip.duration - origIntermediateDur, origIntermediateOffset + deltaSec));
                            targetIntermediateTrans.timeOffset = parseFloat(newOffset.toFixed(2));
                            const wedgeEl = clipEl.querySelector(`.wedge-intermediate[data-trans-id="${targetIntermediateTrans.id}"]`);
                            if (wedgeEl) wedgeEl.style.left = `${targetIntermediateTrans.timeOffset * this.pixelsPerSecond}px`;
                            if (window.rpaStudio) {
                                window.rpaStudio.renderProperties(clip);
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'resize-intermediate-trans' && targetIntermediateTrans) {
                            const newDur = Math.max(0.2, Math.min(clip.duration - targetIntermediateTrans.timeOffset, origIntermediateDur + deltaSec));
                            targetIntermediateTrans.duration = parseFloat(newDur.toFixed(2));
                            const wedgeEl = clipEl.querySelector(`.wedge-intermediate[data-trans-id="${targetIntermediateTrans.id}"]`);
                            if (wedgeEl) {
                                wedgeEl.style.width = `${targetIntermediateTrans.duration * this.pixelsPerSecond}px`;
                                const durLbl = wedgeEl.querySelector('.wedge-dur');
                                if (durLbl) durLbl.innerText = `${targetIntermediateTrans.duration.toFixed(1)}s`;
                            }
                            if (window.rpaStudio) {
                                window.rpaStudio.renderProperties(clip);
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'drag-arrow-body' && targetAnim) {
                            const newOffset = Math.max(0, Math.min(clip.duration - origAnimDur, origAnimOffset + deltaSec));
                            targetAnim.timeOffset = parseFloat(newOffset.toFixed(2));
                            if (clip.keyframes) {
                                for (const kf of clip.keyframes) {
                                    if (kf.arrowId === targetAnim.id) {
                                        if (kf.id.endsWith('_start')) kf.timeOffset = targetAnim.timeOffset;
                                        else if (kf.id.endsWith('_end')) kf.timeOffset = parseFloat((targetAnim.timeOffset + targetAnim.duration).toFixed(2));
                                    }
                                }
                            }
                            const arrowEl = clipEl.querySelector(`.studio-timeline-arrow[data-anim-id="${targetAnim.id}"]`);
                            if (arrowEl) arrowEl.style.left = `${targetAnim.timeOffset * this.pixelsPerSecond}px`;
                            if (window.rpaStudio) window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            return;
                        }

                        if (action === 'drag-arrow-head' && targetAnim) {
                            const newDur = Math.max(0.15, Math.min(clip.duration - targetAnim.timeOffset, origAnimDur + deltaSec));
                            targetAnim.duration = parseFloat(newDur.toFixed(2));
                            if (clip.keyframes) {
                                for (const kf of clip.keyframes) {
                                    if (kf.arrowId === targetAnim.id && kf.id.endsWith('_end')) {
                                        kf.timeOffset = parseFloat((targetAnim.timeOffset + targetAnim.duration).toFixed(2));
                                    }
                                }
                            }
                            const arrowEl = clipEl.querySelector(`.studio-timeline-arrow[data-anim-id="${targetAnim.id}"]`);
                            if (arrowEl) arrowEl.style.width = `${Math.max(22, targetAnim.duration * this.pixelsPerSecond)}px`;
                            if (window.rpaStudio) {
                                const lblDur = document.getElementById('lblAnimDurationInspector');
                                if (lblDur) lblDur.innerText = `${targetAnim.duration.toFixed(1)}s`;
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'drag-arrow-tail' && targetAnim) {
                            const arrowEndTime = origAnimOffset + origAnimDur;
                            const newStart = Math.max(0, Math.min(arrowEndTime - 0.15, origAnimOffset + deltaSec));
                            targetAnim.timeOffset = parseFloat(newStart.toFixed(2));
                            targetAnim.duration = parseFloat((arrowEndTime - targetAnim.timeOffset).toFixed(2));
                            if (clip.keyframes) {
                                for (const kf of clip.keyframes) {
                                    if (kf.arrowId === targetAnim.id && kf.id.endsWith('_start')) {
                                        kf.timeOffset = targetAnim.timeOffset;
                                    }
                                }
                            }
                            const arrowEl = clipEl.querySelector(`.studio-timeline-arrow[data-anim-id="${targetAnim.id}"]`);
                            if (arrowEl) {
                                arrowEl.style.left = `${targetAnim.timeOffset * this.pixelsPerSecond}px`;
                                arrowEl.style.width = `${Math.max(22, targetAnim.duration * this.pixelsPerSecond)}px`;
                            }
                            if (window.rpaStudio) {
                                const lblDur = document.getElementById('lblAnimDurationInspector');
                                if (lblDur) lblDur.innerText = `${targetAnim.duration.toFixed(1)}s`;
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        if (action === 'drag-keyframe' && targetKf) {
                            targetKf.timeOffset = Math.max(0, Math.min(clip.duration, parseFloat((origKfOffset + deltaSec).toFixed(2))));
                            targetEl.style.left = `${targetKf.timeOffset * this.pixelsPerSecond}px`;
                            if (window.rpaStudio) {
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                            return;
                        }

                        // Vertical Cross-Track Dragging
                        const elUnderCursor = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
                        const hoveredTrackEl = elUnderCursor ? elUnderCursor.closest('.timeline-track') : null;
                        if (hoveredTrackEl && hoveredTrackEl.dataset.trackId) {
                            const newTrackId = parseInt(hoveredTrackEl.dataset.trackId, 10);
                            const newTrack = this.getTrack(newTrackId);
                            if (newTrack && !newTrack.locked && newTrackId !== clip.trackId) {
                                clip.trackId = newTrackId;
                                const newContentEl = document.getElementById(`trackContent${newTrackId}`);
                                if (newContentEl && clipEl.parentElement !== newContentEl) {
                                    newContentEl.appendChild(clipEl);
                                }
                            }
                        }

                        if (action === 'trim-left') {
                            let newStart = Math.max(0, origStart + deltaSec);
                            const snap = this.findSnapPoint(newStart, clip.id);
                            if (snap.snapped) newStart = snap.time;
                            const newDur = Math.max(0.2, (origStart + origDur) - newStart);
                            clip.startTime = newStart;
                            clip.duration = newDur;
                            if (clip.transitionInDuration > clip.duration * 0.48) clip.transitionInDuration = clip.duration * 0.48;
                            if (clip.transitionOutDuration > clip.duration * 0.48) clip.transitionOutDuration = clip.duration * 0.48;
                            if (window.rpaStudio) {
                                const pStart = document.getElementById('propStart');
                                if (pStart) pStart.value = clip.startTime.toFixed(1);
                                const pDur = document.getElementById('propDuration');
                                if (pDur) pDur.value = clip.duration.toFixed(1);
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                        } else if (action === 'trim-right') {
                            let candidateEnd = origStart + origDur + deltaSec;
                            const snap = this.findSnapPoint(candidateEnd, clip.id);
                            if (snap.snapped) candidateEnd = snap.time;
                            clip.duration = Math.max(0.2, candidateEnd - clip.startTime);
                            if (clip.transitionInDuration > clip.duration * 0.48) clip.transitionInDuration = clip.duration * 0.48;
                            if (clip.transitionOutDuration > clip.duration * 0.48) clip.transitionOutDuration = clip.duration * 0.48;
                            if (window.rpaStudio) {
                                const pDur = document.getElementById('propDuration');
                                if (pDur) pDur.value = clip.duration.toFixed(1);
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                        } else {
                            let candidateStart = Math.max(0, origStart + deltaSec);
                            const snapStart = this.findSnapPoint(candidateStart, clip.id, origStart);
                            const candidateEnd = candidateStart + origDur;
                            const snapEnd = this.findSnapPoint(candidateEnd, clip.id, origStart + origDur);

                            if (snapStart.snapped) {
                                clip.startTime = snapStart.time;
                            } else if (snapEnd.snapped) {
                                clip.startTime = Math.max(0, snapEnd.time - origDur);
                            } else {
                                clip.startTime = candidateStart;
                            }
                            if (window.rpaStudio) {
                                const pStart = document.getElementById('propStart');
                                if (pStart) pStart.value = clip.startTime.toFixed(1);
                                window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                            }
                        }

                        clipEl.style.left = `${clip.startTime * this.pixelsPerSecond}px`;
                        clipEl.style.width = `${clip.duration * this.pixelsPerSecond}px`;
                        this.updateTotalDuration();
                        if (window.rpaStudio) window.rpaStudio.updateTimelineRuler();
                    };

                    const onClipEnd = () => {
                        if (targetEl && targetEl.classList) targetEl.classList.remove('dragging');
                        window.removeEventListener('pointermove', onClipMove);
                        window.removeEventListener('pointerup', onClipEnd);
                        window.removeEventListener('mousemove', onClipMove);
                        window.removeEventListener('mouseup', onClipEnd);
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                    };

                    window.addEventListener('pointermove', onClipMove);
                    window.addEventListener('pointerup', onClipEnd);
                    window.addEventListener('mousemove', onClipMove);
                    window.addEventListener('mouseup', onClipEnd);
                };

                clipEl.onpointerdown = onClipDragStart;
                clipEl.onclick = (e) => {
                    const actionTarget = e.target.closest('[data-action]');
                    if (!actionTarget) return;
                    const action = actionTarget.dataset.action;
                    if (action === 'del-intermediate-trans') {
                        e.stopPropagation();
                        e.preventDefault();
                        const transId = actionTarget.dataset.transId || actionTarget.closest('[data-trans-id]')?.dataset.transId;
                        if (clip.transitions) {
                            clip.transitions = clip.transitions.filter(t => t.id !== transId);
                        }
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-anim-arrow') {
                        e.stopPropagation();
                        e.preventDefault();
                        const animId = actionTarget.dataset.animId;
                        if (clip.animations) {
                            clip.animations = clip.animations.filter(a => a.id !== animId);
                        }
                        if (clip.keyframes) {
                            clip.keyframes = clip.keyframes.filter(k => k.arrowId !== animId);
                        }
                        if (this.selectedAnimationId === animId) this.selectedAnimationId = null;
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'select-arrow') {
                        e.stopPropagation();
                        const animId = actionTarget.dataset.animId;
                        this.selectedAnimationId = animId;
                        const anim = clip.animations ? clip.animations.find(a => a.id === animId) : null;
                        if (anim && window.rpaStudio) {
                            window.rpaStudio.inspectAnimation(clip, anim);
                        }
                        this.render(containerEl, onClipSelected);
                        return;
                    }
                    if (action === 'del-trans-in') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.transitionIn = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-trans-out') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.transitionOut = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-behavior') {
                        e.stopPropagation();
                        e.preventDefault();
                        clip.behavior = 'none';
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                    if (action === 'del-fx') {
                        e.stopPropagation();
                        e.preventDefault();
                        const fxKey = actionTarget.dataset.fx;
                        if (clip.visualEffects) {
                            delete clip.visualEffects[fxKey];
                            if (fxKey === 'chromaKey') clip.visualEffects.chromaKey = false;
                            if (fxKey === 'scanlines') clip.visualEffects.scanlines = false;
                            if (fxKey === 'invert') clip.visualEffects.invert = false;
                            if (fxKey === 'deviceFrame') clip.visualEffects.deviceFrame = 'none';
                        }
                        this.saveSnapshot();
                        this.render(containerEl, onClipSelected);
                        if (window.rpaStudio) {
                            window.rpaStudio.renderProperties(clip);
                            window.rpaStudio.compositor.renderFrame(this, window.rpaStudio.playheadTime);
                        }
                        return;
                    }
                };

                contentEl.appendChild(clipEl);
            }

            trackEl.appendChild(headerEl);
            trackEl.appendChild(contentEl);
            containerEl.appendChild(trackEl);
        }
    }
}

window.RpaTimeline = RpaTimeline;
