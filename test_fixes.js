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
window.RpaSfxGenerator = function() {
    return { addToTimeline: async () => null };
};
global.RpaSfxGenerator = window.RpaSfxGenerator;

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

console.log('\n--- ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
process.exit(0);
