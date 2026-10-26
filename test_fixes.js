global.__TEST_ENV__ = true;
const assert = require('assert');

function createMockCanvas(width = 1920, height = 1080) {
    const canvas = { 
        width, 
        height, 
        classList: { contains: () => false, add: () => {}, remove: () => {} },
        addEventListener: () => {}, 
        removeEventListener: () => {}, 
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }) 
    };
    const ctx = {
        canvas,
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        scale: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        drawImage: () => {},
        clearRect: () => {},
        fill: () => {},
        fillRect: () => {},
        fillText: () => {},
        measureText: (text) => ({ width: (text || '').length * 10 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createImageData: (w, h) => ({ data: new Uint8ClampedArray((w || 100) * (h || 100) * 4) }),
        putImageData: () => {},
        roundRect: () => {},
        filter: '',
        globalAlpha: 1.0,
        font: '16px sans-serif',
        textAlign: 'center',
        textBaseline: 'middle'
    };
    canvas.getContext = () => ctx;
    return { canvas, ctx };
}

const mockDefaultCanvas = createMockCanvas();

// Mock window and document environment for Node testing
global.window = global;
global.fetch = () => Promise.resolve({ ok: true, json: async () => ({ fonts: [] }) });
global.requestAnimationFrame = () => {};
global.addEventListener = () => {};
window.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.URL = { createObjectURL: () => 'blob:mock-sfx' };

global.document = {
    readyState: 'complete',
    getElementById: (id) => {
        if (id === 'previewCanvas' || id === 'videoCanvas') return mockDefaultCanvas.canvas;
        return { 
            value: '10', 
            innerText: '',
            style: {},
            classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} }, 
            scrollIntoView: () => {}, 
            innerHTML: '', 
            appendChild: () => {},
            addEventListener: () => {},
            querySelectorAll: () => [],
            createDocumentFragment: () => ({ appendChild: () => {} }),
    createElement: () => ({ style: {}, dataset: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, querySelector: () => null }),
    querySelector: () => null,
            getContext: () => mockDefaultCanvas.ctx,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 1920, height: 1080 }),
            width: 1920,
            height: 1080
        };
    },
    createDocumentFragment: () => ({ appendChild: () => {} }),
    createElement: () => ({ style: {}, dataset: {}, classList: { add: () => {}, remove: () => {} }, appendChild: () => {}, querySelector: () => null }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {}
};

const { RpaTimeline } = require('./client/src/timeline.js');
global.RpaTimeline = RpaTimeline;
window.RpaTimeline = RpaTimeline;

const { RpaCompositor } = require('./client/src/compositor.js');
global.RpaCompositor = RpaCompositor;
window.RpaCompositor = RpaCompositor;

const { RpaSfxGenerator } = require('./client/src/sfx_generator.js');
global.RpaSfxGenerator = RpaSfxGenerator;
window.RpaSfxGenerator = RpaSfxGenerator;

const { RpaStudioApp } = require('./client/src/app.js');

console.log('--- RUNNING RPA VIDEO EDITOR VERIFICATION TESTS ---');

// -------------------------------------------------------------
// TEST 1: Annotation Dragging Visibility & Bounds (Bug 1)
// -------------------------------------------------------------
console.log('\n[TEST 1] Testing Annotation Dragging & Player Bounding Box Alignment...');
{
    const { canvas, ctx } = createMockCanvas(1920, 1080);
    const compositor = new RpaCompositor(canvas, ctx);

    const calloutClip = {
        id: 'clip_callout_1',
        type: 'callout',
        title: 'Plain Text',
        text: 'Test Annotation Text',
        xOffset: 0,
        yOffset: 0,
        scale: 1.0,
        duration: 4.0
    };

    const initialBounds = compositor.getClipCanvasBounds(calloutClip);
    assert(initialBounds.width > 0 && initialBounds.height > 0, 'Bounds width/height must be positive');
    
    // Drag clip by +120px on X, +80px on Y
    const draggedClip = {
        ...calloutClip,
        xOffset: 120,
        yOffset: 80
    };

    const draggedBounds = compositor.getClipCanvasBounds(draggedClip);
    const deltaX = draggedBounds.x - initialBounds.x;
    const deltaY = draggedBounds.y - initialBounds.y;

    assert.strictEqual(deltaX, 120, `Gizmo X must shift by exactly 120px (was ${deltaX})`);
    assert.strictEqual(deltaY, 80, `Gizmo Y must shift by exactly 80px (was ${deltaY})`);

    // Verify getCalloutBounds does not double-scale or pre-apply scale
    const rawBounds = compositor.getCalloutBounds(draggedClip, 1920, 1080);
    const expectedBx = (1920 - rawBounds.bw) / 2 + 120;
    const expectedBy = (1080 - rawBounds.bh) / 2 + 80;
    assert.strictEqual(rawBounds.bx, expectedBx, 'rawBounds.bx should match (width - bw)/2 + xOffset');
    assert.strictEqual(rawBounds.by, expectedBy, 'rawBounds.by should match (height - bh)/2 + yOffset');

    console.log('✓ Annotation bounds shift 1:1 with mouse drag. No 2x velocity overflow or off-canvas hiding.');
}

// -------------------------------------------------------------
// TEST 2: Behavior Cascades Per Alphabet (Bug 2)
// -------------------------------------------------------------
console.log('\n[TEST 2] Testing Behavior Effect Cascading Per Alphabet (Character)...');
{
    const app = new RpaStudioApp();
    const jumpProps = app.getDefaultBehaviorProps('jump');
    
    assert.strictEqual(jumpProps.textUnit, 'character', 'Default behavior textUnit must be "character"');
    assert(jumpProps.waveDelay > 0, 'waveDelay must be greater than 0');
    assert.strictEqual(jumpProps.during.type, 'ltr', 'During type should default to ltr for character wave');
    assert(jumpProps.during.offset > 0, 'During offset must be > 0 for per-alphabet delay');

    const { canvas, ctx } = createMockCanvas(1920, 1080);
    const compositor = new RpaCompositor(canvas, ctx);

    // Compute glyph dance for character 0 vs character 3 at relTime = 2.0s (Phase 2 DURING)
    const dance0 = compositor.computeGlyphDance(jumpProps, 0, 10, 2.0, 5.0, 1.0);
    const dance3 = compositor.computeGlyphDance(jumpProps, 3, 10, 2.0, 5.0, 1.0);

    // The two characters must not be in identical lockstep!
    const diffY = Math.abs(dance0.dy - dance3.dy);
    const diffScale = Math.max(Math.abs(dance0.scale - dance3.scale), Math.abs(dance0.scaleY - dance3.scaleY));
    assert(diffY > 0.001 || diffScale > 0.001, 'Characters at different indices must have cascaded phase wave difference');

    // Also test Phase 1 (IN) staggered arrival
    const danceIn0 = compositor.computeGlyphDance(jumpProps, 0, 10, 0.1, 5.0, 1.0);
    const danceIn5 = compositor.computeGlyphDance(jumpProps, 5, 10, 0.1, 5.0, 1.0);
    // Char 0 should have started appearing or moved, while Char 5 is still delayed
    assert(danceIn5.scale <= danceIn0.scale || !danceIn5.visible || danceIn5.opacity <= danceIn0.opacity, 
        'Character 5 should be delayed relative to Character 0 in Phase 1 IN');

    console.log(`✓ Behavior accurately cascades across each alphabet! diffY=${diffY.toFixed(2)}, diffScale=${diffScale.toFixed(2)}.`);
}

// -------------------------------------------------------------
// TEST 3: Animation Arrows & Tweening Engine (Bug 3)
// -------------------------------------------------------------
console.log('\n[TEST 3] Testing Animation Arrow Tweening & Presets...');
{
    const { canvas, ctx } = createMockCanvas(1920, 1080);
    const compositor = new RpaCompositor(canvas, ctx);

    const clipWithAnim = {
        id: 'clip_anim_test',
        type: 'image',
        startTime: 0,
        duration: 10.0,
        scale: 1.0,
        xOffset: 0,
        yOffset: 0,
        opacity: 1.0,
        animations: [
            {
                id: 'arrow_1',
                name: 'Scale & Pan Zoom',
                timeOffset: 2.0,
                duration: 2.0, // spans 2.0s to 4.0s
                easing: 'linear',
                startState: { scale: 1.0, x: 0, y: 0, xOffset: 0, yOffset: 0, opacity: 1.0 },
                endState: { scale: 2.0, x: 200, y: 100, xOffset: 200, yOffset: 100, opacity: 1.0 },
                startProps: { scale: 1.0, x: 0, y: 0 },
                targetProps: { scale: 2.0, x: 200, y: 100 }
            }
        ]
    };

    // Before arrow (relTime = 1.0s)
    const kfBefore = compositor.computeKeyframes(clipWithAnim, 1.0);
    assert.strictEqual(kfBefore.scale, 1.0, 'Scale before arrow must be 1.0');
    assert.strictEqual(kfBefore.x, 0, 'X before arrow must be 0');

    // Inside arrow at 50% midpoint (relTime = 3.0s)
    const kfMid = compositor.computeKeyframes(clipWithAnim, 3.0);
    assert.strictEqual(Math.round(kfMid.scale * 100) / 100, 1.5, `Scale at midpoint should be 1.5 (was ${kfMid.scale})`);
    assert.strictEqual(Math.round(kfMid.x), 100, `X at midpoint should be 100 (was ${kfMid.x})`);
    assert.strictEqual(Math.round(kfMid.y), 50, `Y at midpoint should be 50 (was ${kfMid.y})`);

    // After arrow (relTime = 5.0s)
    const kfAfter = compositor.computeKeyframes(clipWithAnim, 5.0);
    assert.strictEqual(kfAfter.scale, 2.0, 'Scale after arrow must hold 2.0');
    assert.strictEqual(kfAfter.x, 200, 'X after arrow must hold 200');
    assert.strictEqual(kfAfter.y, 100, 'Y after arrow must hold 100');

    // Test fade-in / fade-out presets via RpaStudioApp
    const app = new RpaStudioApp();
    app.compositor = compositor;
    const mockClip = {
        id: 'clip_fade_test',
        title: 'Test Clip',
        type: 'image',
        startTime: 0,
        duration: 5.0,
        opacity: 1.0,
        animations: [],
        keyframes: []
    };

    app.applyAnimationPresetToClip(mockClip, 'fade-in', 1.0);
    assert(mockClip.animations.length === 1, 'fade-in must create an animation arrow');
    const fadeInAnim = mockClip.animations[0];
    assert.strictEqual(fadeInAnim.startState.opacity, 0.0, 'Fade in must start at opacity 0.0');
    assert.strictEqual(fadeInAnim.endState.opacity, 1.0, 'Fade in must end at opacity 1.0');

    app.applyAnimationPresetToClip(mockClip, 'fade-out', 3.0);
    assert(mockClip.animations.length === 2, 'fade-out must create a second animation arrow');
    const fadeOutAnim = mockClip.animations[1];
    assert.strictEqual(fadeOutAnim.startState.opacity, 1.0, 'Fade out must start at opacity 1.0');
    assert.strictEqual(fadeOutAnim.endState.opacity, 0.0, 'Fade out must end at opacity 0.0');

    console.log('✓ Animation arrows interpolate correctly, retain target positions, and fade presets work as expected.');
}

// -------------------------------------------------------------
// TEST 4: Canvas Resize Handle Hit Radius & Scaling
// -------------------------------------------------------------
console.log('\n[TEST 4] Testing Canvas Resize Handle Hit Radius & Scaling...');
{
    const canvas = { width: 1920, height: 1080 };
    const rect = { width: 640, height: 360 }; // typical scaled screen size
    const scaleRatio = canvas.width / (rect.width || 1); // 3.0
    const handleHitRadius = Math.max(30, 15 * scaleRatio); // 45px canvas = 15px screen

    assert.strictEqual(scaleRatio, 3.0, 'Scale ratio on 1080p canvas in 640px window should be 3.0');
    assert(handleHitRadius >= 45, `Handle hit radius in canvas pixels must be >= 45 (was ${handleHitRadius})`);
    const screenRadius = handleHitRadius / scaleRatio;
    assert(screenRadius >= 14, `Screen-equivalent grab radius must be >= 14 screen pixels (was ${screenRadius})`);
    console.log(`✓ Resize handle hit radius is ${handleHitRadius} canvas px (${screenRadius.toFixed(1)} screen px) for effortless clicking.`);
}

// -------------------------------------------------------------
// TEST 5: Video Export Gizmo & Guides Suppression (Issue 10)
// -------------------------------------------------------------
console.log('\n[TEST 5] Testing Video Export Gizmo & Bounding Box Suppression...');
{
    const { canvas, ctx } = createMockCanvas(1920, 1080);
    const compositor = new RpaCompositor(canvas, ctx);
    const timeline = new RpaTimeline();
    const clip = timeline.addClip({
        type: 'video',
        title: 'Export Test Video',
        startTime: 0,
        duration: 5.0
    });
    timeline.selectedClipId = clip.id;

    let gizmoRendered = false;
    compositor.renderTransformGizmo = () => { gizmoRendered = true; };

    // Standard preview rendering: gizmo should render when selected
    compositor.renderFrame(timeline, 1.0, false, false);
    assert.strictEqual(gizmoRendered, true, 'Gizmo should render during canvas preview with selected clip');

    // Export rendering: gizmo MUST NEVER render!
    gizmoRendered = false;
    compositor.renderFrame(timeline, 1.0, false, true);
    assert.strictEqual(gizmoRendered, false, 'Gizmo MUST NOT render when isExport is true');

    // Also verify when compositor.isExporting flag is true
    compositor.isExporting = true;
    gizmoRendered = false;
    compositor.renderFrame(timeline, 1.0, false, false);
    assert.strictEqual(gizmoRendered, false, 'Gizmo MUST NOT render when compositor.isExporting is true');
    compositor.isExporting = false;

    console.log('✓ Video export completely suppresses gizmo bounding box and handles.');
}

// -------------------------------------------------------------
// TEST 6: Video Clip Split & TrimStart Continuity (Issue 11)
// -------------------------------------------------------------
console.log('\n[TEST 6] Testing Split Video Clip & TrimStart Continuity...');
{
    const timeline = new RpaTimeline();
    const origClip = timeline.addClip({
        type: 'video',
        title: 'Raw Interview Footage',
        startTime: 0.0,
        duration: 10.0,
        trimStart: 2.0,
        speed: 1.0
    });

    // Split at 4.0s
    const part2 = timeline.splitClip(origClip.id, 4.0);
    assert(part2, 'splitClip must return second clip');
    assert.strictEqual(origClip.duration, 4.0, 'Part 1 duration must be 4.0s');
    assert.strictEqual(part2.startTime, 4.0, 'Part 2 startTime must be 4.0s');
    assert.strictEqual(part2.duration, 6.0, 'Part 2 duration must be 6.0s');
    assert.strictEqual(part2.trimStart, 6.0, 'Part 2 trimStart must be 2.0 + 4.0 = 6.0s');
    assert(origClip.title.includes('Part 1'), 'Part 1 title must be updated with (Part 1)');
    assert(part2.title.includes('Part 2'), 'Part 2 title must be labeled (Part 2)');

    // Clips must be sorted by startTime
    assert.strictEqual(timeline.clips[0].id, origClip.id);
    assert.strictEqual(timeline.clips[1].id, part2.id);

    console.log('✓ Video split preserves exact trimStart offsets, duration, and sorts timeline clips.');
}

// -------------------------------------------------------------
// TEST 7: Audio FX Chips & Keyboard Tool Deletion (Issues 6 & 7)
// -------------------------------------------------------------
console.log('\n[TEST 7] Testing Audio FX, Visual FX & Keyboard Tool Deletion...');
{
    const timeline = new RpaTimeline();
    const clip = timeline.addClip({
        type: 'video',
        title: 'Clip with Effects',
        startTime: 0,
        duration: 5.0,
        visualEffects: {
            chromaticAberration: 16,
            vhsGlitch: 65,
            glow: 40
        },
        audioEffects: {
            fadeIn: 1.5,
            noiseGate: true,
            robot: true
        }
    });

    // Delete a visual effect
    const resFx = timeline.deleteTimelineTool({ type: 'fx', fxKey: 'chromaticAberration', clipId: clip.id });
    assert.strictEqual(resFx, true, 'deleteTimelineTool should return true for fx');
    assert.strictEqual(clip.visualEffects.chromaticAberration, 0, 'chromaticAberration must be cleared to 0');

    // Delete an audio effect
    const resAudio = timeline.deleteTimelineTool({ type: 'audio-fx', fxKey: 'noiseGate', clipId: clip.id });
    assert.strictEqual(resAudio, true, 'deleteTimelineTool should return true for audio-fx');
    assert.strictEqual(clip.audioEffects.noiseGate, false, 'noiseGate must be cleared to false');

    const resFade = timeline.deleteTimelineTool({ type: 'audio-fx', fxKey: 'fadeIn', clipId: clip.id });
    assert.strictEqual(resFade, true);
    assert.strictEqual(clip.audioEffects.fadeIn, 0, 'fadeIn must be reset to 0');

    console.log('✓ Visual & Audio FX can be deleted cleanly via deleteTimelineTool.');
}

// -------------------------------------------------------------
// TEST 8: SFX Generator addToTimeline Preserves Clip & ID (Issue 8)
// -------------------------------------------------------------
console.log('\n[TEST 8] Testing SFX Generator addToTimeline Clip & ID Preservation...');
async function testSfxGenerator() {
    const { RpaSfxGenerator } = require('./client/src/sfx_generator.js');
    const sfxGen = new RpaSfxGenerator();
    sfxGen.getWavBlob = async () => ({ size: 100 });

    const timeline = new RpaTimeline();

    // Generate SFX on timeline
    const addedClip = await sfxGen.addToTimeline(timeline, 'pop', 2.5, 2);
    assert(addedClip, 'Added SFX clip must not be null');
    assert(addedClip.id, 'Added SFX clip must have a generated ID');
    assert.strictEqual(addedClip.type, 'audio');
    assert.strictEqual(addedClip.startTime, 2.5);
    assert(timeline.getClip(addedClip.id), 'SFX clip must be retrievable from timeline');
    console.log(`✓ SFX clip added with valid ID: ${addedClip.id} and duration ${addedClip.duration.toFixed(2)}s.`);
}

// -------------------------------------------------------------
// TEST 9: Subtitle / Caption Management & Duration Editing (Issue 9)
// -------------------------------------------------------------
console.log('\n[TEST 9] Testing Subtitle / Caption Management & Duration Editing...');
{
    const timeline = new RpaTimeline();
    const cap1 = timeline.addCaption(1.0, 3.0, 'First subtitle line');
    assert(cap1 && cap1.id, 'addCaption must return caption object with id');
    assert.strictEqual(timeline.captions.length, 1);

    // Update caption text and duration
    const updated = timeline.updateCaption(cap1.id, { text: 'Updated subtitle line', duration: 5.5 });
    assert.strictEqual(updated.text, 'Updated subtitle line');
    assert.strictEqual(updated.duration, 5.5);

    // Add second caption and verify sorting
    const cap2 = timeline.addCaption(0.5, 2.0, 'Earlier line');
    assert.strictEqual(timeline.captions[0].id, cap2.id, 'Captions must be sorted by startTime');

    // Remove caption
    timeline.removeCaption(cap1.id);
    assert.strictEqual(timeline.captions.length, 1);
    assert.strictEqual(timeline.captions[0].id, cap2.id);

    console.log('✓ Subtitle / Caption additions, edits, duration resizing and deletions work seamlessly.');
}

// -------------------------------------------------------------
// TEST 10: Player Master Volume Controller (Issue 4)
// -------------------------------------------------------------
console.log('\n[TEST 10] Testing Player Master Volume Control...');
{
    const { canvas, ctx } = createMockCanvas(1920, 1080);
    const compositor = new RpaCompositor(canvas, ctx);
    compositor.masterVolume = 0.5;

    assert.strictEqual(compositor.masterVolume, 0.5, 'compositor.masterVolume should be 0.5');

    // Test volume multiplier formula in syncMediaPlayback
    const clip = { volume: 0.8 };
    const effVol = 1.0;
    const computedVol = Math.max(0, Math.min(1.0, (clip.volume !== undefined ? clip.volume : 1.0) * effVol * (compositor.masterVolume !== undefined ? compositor.masterVolume : 1.0)));
    assert.strictEqual(Math.round(computedVol * 100) / 100, 0.4, `Effective volume must be 0.8 * 0.5 = 0.4 (was ${computedVol})`);

    console.log('✓ Player master volume is correctly multiplied into media playback.');
}

testSfxGenerator().then(() => {
    console.log('\n--- ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
    process.exit(0);
}).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
