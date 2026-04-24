/**
 * ===================================================
 *  Air Canvas — Finger Drawing using Webcam
 *  BTech Major Project
 *  Uses MediaPipe Hands for real-time hand tracking
 * ===================================================
 */

// ─── DOM Elements ────────────────────────────────────
const videoEl        = document.getElementById('webcam');
const drawCanvas     = document.getElementById('draw-canvas');
const uiCanvas       = document.getElementById('ui-canvas');
const fingerCursor   = document.getElementById('finger-cursor');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingStatus  = document.getElementById('loading-status');
const fpsCounter     = document.getElementById('fps-counter');
const handStatusEl   = document.getElementById('hand-status');
const statusText     = handStatusEl.querySelector('.status-text');
const toastEl        = document.getElementById('toast');
const toastMsg       = document.getElementById('toast-message');
const cameraOffNote  = document.getElementById('camera-off-notice');

// Buttons
const btnDraw    = document.getElementById('btn-draw');
const btnErase   = document.getElementById('btn-erase');
const btnUndo    = document.getElementById('btn-undo');
const btnClear   = document.getElementById('btn-clear');
const btnSave    = document.getElementById('btn-save');
const btnCamTog  = document.getElementById('btn-camera-toggle');

// Controls
const colorPalette  = document.getElementById('color-palette');
const customColorIn = document.getElementById('custom-color');
const brushSlider   = document.getElementById('brush-size');
const brushPreview  = document.getElementById('brush-preview');
const brushLabel    = document.getElementById('brush-size-label');

// Canvases contexts
const drawCtx = drawCanvas.getContext('2d');
const uiCtx   = uiCanvas.getContext('2d');

// ─── App State ───────────────────────────────────────
const state = {
    mode: 'draw',           // 'draw' | 'erase'
    color: '#ef4444',
    brushSize: 5,
    isDrawing: false,
    prevPoint: null,
    cameraOn: true,
    handDetected: false,
    history: [],            // undo stack (canvas snapshots)
    maxHistory: 20,
    gesture: 'none',        // 'draw' | 'move' | 'fist' | 'none'
    filter: 'none',         // current webcam filter
    filterIntensity: 100,   // filter intensity 0-100
};

// FPS tracking
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;

// ─── Canvas Sizing ───────────────────────────────────
function resizeCanvases() {
    const container = document.getElementById('canvas-container');
    const w = container.clientWidth;
    const h = container.clientHeight;

    drawCanvas.width = w;
    drawCanvas.height = h;
    uiCanvas.width = w;
    uiCanvas.height = h;

    // Restore drawing from the last history entry
    if (state.history.length > 0) {
        const img = new Image();
        img.onload = () => drawCtx.drawImage(img, 0, 0, w, h);
        img.src = state.history[state.history.length - 1];
    }
}

window.addEventListener('resize', resizeCanvases);

// ─── Utility: Toast ──────────────────────────────────
function showToast(message, duration = 2500) {
    toastMsg.textContent = message;
    toastEl.classList.remove('hidden');
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => toastEl.classList.add('hidden'), 350);
    }, duration);
}

// ─── History / Undo ──────────────────────────────────
function saveToHistory() {
    const dataUrl = drawCanvas.toDataURL();
    state.history.push(dataUrl);
    if (state.history.length > state.maxHistory) {
        state.history.shift();
    }
}

function undo() {
    if (state.history.length === 0) {
        showToast('Nothing to undo');
        return;
    }
    state.history.pop(); // remove current
    if (state.history.length > 0) {
        const img = new Image();
        img.onload = () => {
            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
            drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
        };
        img.src = state.history[state.history.length - 1];
    } else {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }
    showToast('Undo');
}

// ─── Drawing Functions ───────────────────────────────
function drawLine(x1, y1, x2, y2) {
    drawCtx.beginPath();
    drawCtx.moveTo(x1, y1);
    drawCtx.lineTo(x2, y2);

    if (state.mode === 'erase') {
        drawCtx.globalCompositeOperation = 'destination-out';
        drawCtx.strokeStyle = 'rgba(0,0,0,1)';
        drawCtx.lineWidth = state.brushSize * 3;
    } else {
        drawCtx.globalCompositeOperation = 'source-over';
        drawCtx.strokeStyle = state.color;
        drawCtx.lineWidth = state.brushSize;
    }

    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.stroke();
}

// ─── Finger Detection Helpers ────────────────────────
/**
 * Check if a finger is extended by comparing tip y vs pip y
 * For thumb: compare tip x vs ip x
 */
function isFingerExtended(landmarks, fingerTip, fingerPip, isThumb = false) {
    if (isThumb) {
        // Thumb: compare x distance from wrist
        return Math.abs(landmarks[fingerTip].x - landmarks[0].x) >
               Math.abs(landmarks[fingerPip].x - landmarks[0].x);
    }
    // Regular finger: tip is above pip (y is smaller = higher on screen)
    return landmarks[fingerTip].y < landmarks[fingerPip].y;
}

function detectGesture(landmarks) {
    const indexUp  = isFingerExtended(landmarks, 8, 6);
    const middleUp = isFingerExtended(landmarks, 12, 10);
    const ringUp   = isFingerExtended(landmarks, 16, 14);
    const pinkyUp  = isFingerExtended(landmarks, 20, 18);
    // const thumbUp  = isFingerExtended(landmarks, 4, 3, true);

    // ✌️ Two fingers up (index + middle) → Move / navigate (no drawing)
    if (indexUp && middleUp && !ringUp && !pinkyUp) {
        return 'move';
    }
    // ☝️ Only index finger up → Draw
    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        return 'draw';
    }
    // ✊ Fist (no fingers up)
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
        return 'fist';
    }

    return 'none';
}

// ─── Draw the UI overlay (hand skeleton etc) ─────────
function drawUIOverlay(landmarks) {
    uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);

    const w = uiCanvas.width;
    const h = uiCanvas.height;

    // Connections for hand skeleton
    const connections = [
        [0,1],[1,2],[2,3],[3,4],       // Thumb
        [0,5],[5,6],[6,7],[7,8],       // Index
        [0,9],[9,10],[10,11],[11,12],  // Middle  // adjusted: 0->9 for cleaner look
        [0,13],[13,14],[14,15],[15,16],// Ring
        [0,17],[17,18],[18,19],[19,20],// Pinky
        [5,9],[9,13],[13,17]           // Palm
    ];

    // Draw connections
    uiCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    uiCtx.lineWidth = 1.5;
    connections.forEach(([a, b]) => {
        uiCtx.beginPath();
        uiCtx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
        uiCtx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
        uiCtx.stroke();
    });

    // Draw landmarks
    landmarks.forEach((lm, i) => {
        const x = lm.x * w;
        const y = lm.y * h;
        const radius = [4, 8, 12, 16, 20].includes(i) ? 5 : 3; // fingertips bigger

        uiCtx.beginPath();
        uiCtx.arc(x, y, radius, 0, 2 * Math.PI);
        uiCtx.fillStyle = [4, 8, 12, 16, 20].includes(i)
            ? 'rgba(124, 58, 237, 0.9)'
            : 'rgba(6, 182, 212, 0.7)';
        uiCtx.fill();
    });

    // Highlight index finger tip
    const tipX = landmarks[8].x * w;
    const tipY = landmarks[8].y * h;
    uiCtx.beginPath();
    uiCtx.arc(tipX, tipY, 8, 0, 2 * Math.PI);
    uiCtx.strokeStyle = state.gesture === 'draw' ? 'rgba(34,197,94,0.9)' : 'rgba(124,58,237,0.8)';
    uiCtx.lineWidth = 2;
    uiCtx.stroke();
}

// ─── MediaPipe Results Handler ───────────────────────
let lastSaveTime = 0;

function onResults(results) {
    // FPS calculation
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        currentFps = frameCount;
        frameCount = 0;
        lastFpsTime = now;
        fpsCounter.textContent = currentFps + ' FPS';
    }

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        // Update hand status
        if (!state.handDetected) {
            state.handDetected = true;
            handStatusEl.classList.remove('not-detected');
            handStatusEl.classList.add('detected');
            statusText.textContent = 'Hand Detected';
        }

        // Detect gesture
        const gesture = detectGesture(landmarks);
        state.gesture = gesture;

        const w = drawCanvas.width;
        const h = drawCanvas.height;
        const tipX = landmarks[8].x * w;
        const tipY = landmarks[8].y * h;

        // Update cursor position (mirrored)
        const container = document.getElementById('canvas-container');
        const containerRect = container.getBoundingClientRect();
        // Since we mirror the canvas with CSS scaleX(-1), we need to flip cursor x
        const mirroredX = containerRect.width - (tipX / w) * containerRect.width;
        const mirroredY = (tipY / h) * containerRect.height;
        fingerCursor.style.left = mirroredX + 'px';
        fingerCursor.style.top = mirroredY + 'px';
        fingerCursor.classList.remove('hidden');

        if (gesture === 'draw') {
            fingerCursor.classList.add('drawing');

            if (state.prevPoint) {
                drawLine(state.prevPoint.x, state.prevPoint.y, tipX, tipY);
            }
            state.prevPoint = { x: tipX, y: tipY };
            state.isDrawing = true;

        } else {
            fingerCursor.classList.remove('drawing');

            // If we were drawing and now stopped, save to history
            if (state.isDrawing) {
                const timeSinceSave = now - lastSaveTime;
                if (timeSinceSave > 300) {
                    saveToHistory();
                    lastSaveTime = now;
                }
                state.isDrawing = false;
            }
            state.prevPoint = null;
        }

        // Draw hand skeleton overlay
        drawUIOverlay(landmarks);

    } else {
        // No hand detected
        if (state.handDetected) {
            state.handDetected = false;
            handStatusEl.classList.remove('detected');
            handStatusEl.classList.add('not-detected');
            statusText.textContent = 'No Hand';
        }

        if (state.isDrawing) {
            saveToHistory();
            lastSaveTime = now;
            state.isDrawing = false;
        }
        state.prevPoint = null;
        state.gesture = 'none';
        fingerCursor.classList.add('hidden');
        fingerCursor.classList.remove('drawing');
        uiCtx.clearRect(0, 0, uiCanvas.width, uiCanvas.height);
    }
}

// ─── Initialize MediaPipe Hands ──────────────────────
async function initMediaPipe() {
    loadingStatus.textContent = 'Loading MediaPipe Hands model...';

    const hands = new Hands({
        locateFile: (file) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
        }
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
    });

    hands.onResults(onResults);

    loadingStatus.textContent = 'Requesting camera access...';

    try {
        const camera = new Camera(videoEl, {
            onFrame: async () => {
                await hands.send({ image: videoEl });
            },
            width: 1280,
            height: 720,
        });

        await camera.start();
        state.cameraOn = true;
        cameraOffNote.classList.add('hidden');

        // Hide loading overlay
        loadingStatus.textContent = 'Ready!';
        setTimeout(() => {
            loadingOverlay.classList.add('hidden');
            resizeCanvases();
            showToast('✨ Air Canvas is ready — raise your index finger to draw!');
        }, 600);

        // Store camera reference for toggling
        window._airCamera = camera;
        window._airHands = hands;

    } catch (err) {
        console.error('Camera error:', err);
        loadingStatus.textContent = 'Camera access denied. Please allow camera permissions.';
        showToast('⚠️ Camera access denied');
    }
}

// ─── Event Listeners ─────────────────────────────────

// Mode switching
btnDraw.addEventListener('click', () => {
    state.mode = 'draw';
    btnDraw.classList.add('active');
    btnErase.classList.remove('active');
    showToast('🖌️ Draw mode');
});

btnErase.addEventListener('click', () => {
    state.mode = 'erase';
    btnErase.classList.add('active');
    btnDraw.classList.remove('active');
    showToast('🧹 Eraser mode');
});

// Color selection
colorPalette.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    state.color = swatch.dataset.color;
    brushPreview.style.background = state.color;

    // Switch to draw mode when picking a color
    state.mode = 'draw';
    btnDraw.classList.add('active');
    btnErase.classList.remove('active');
});

customColorIn.addEventListener('input', (e) => {
    state.color = e.target.value;
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    brushPreview.style.background = state.color;

    state.mode = 'draw';
    btnDraw.classList.add('active');
    btnErase.classList.remove('active');
});

// Brush size
brushSlider.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
    const size = state.brushSize * 2;
    brushPreview.style.width = size + 'px';
    brushPreview.style.height = size + 'px';
    brushLabel.textContent = state.brushSize + 'px';
});

// ─── Filters ─────────────────────────────────────────
const filterGrid = document.getElementById('filter-grid');
const filterIntensitySlider = document.getElementById('filter-intensity');
const filterIntensityLabel = document.getElementById('filter-intensity-label');

// Filter definitions: maps filter name → CSS filter string at 100% intensity
const FILTER_MAP = {
    none:        () => 'none',
    grayscale:   (i) => `grayscale(${i})`,
    sepia:       (i) => `sepia(${i})`,
    invert:      (i) => `invert(${i})`,
    blur:        (i) => `blur(${i * 4}px)`,
    neon:        (i) => `contrast(${1 + i * 0.6}) brightness(${1 + i * 0.2}) saturate(${1 + i * 1.2})`,
    nightvision: (i) => `brightness(${1 + i * 0.5}) saturate(${1 - i * 0.7}) hue-rotate(${i * 80}deg)`,
    vintage:     (i) => `sepia(${i * 0.4}) contrast(${1 + i * 0.15}) brightness(${1 - i * 0.1}) saturate(${1 + i * 0.3})`,
    thermal:     (i) => `saturate(${1 + i * 2}) hue-rotate(${i * 180}deg) contrast(${1 + i * 0.4})`,
};

function applyFilter() {
    // Remove all existing filter classes
    videoEl.className = 'webcam-video';

    const intensity = state.filterIntensity / 100;
    if (state.filter === 'none' || intensity === 0) {
        videoEl.style.filter = '';
    } else {
        videoEl.style.filter = FILTER_MAP[state.filter](intensity);
    }
}

filterGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    filterGrid.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    state.filter = btn.dataset.filter;
    applyFilter();

    const filterName = btn.querySelector('span:last-child').textContent;
    showToast(`🎨 Filter: ${filterName}`);
});

filterIntensitySlider.addEventListener('input', (e) => {
    state.filterIntensity = parseInt(e.target.value);
    filterIntensityLabel.textContent = state.filterIntensity + '%';
    applyFilter();
});

// Actions
btnUndo.addEventListener('click', undo);

btnClear.addEventListener('click', () => {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    saveToHistory();
    showToast('🗑️ Canvas cleared');
});

btnSave.addEventListener('click', () => {
    // Create a composite image: drawing on dark background
    const saveCanvas = document.createElement('canvas');
    saveCanvas.width = drawCanvas.width;
    saveCanvas.height = drawCanvas.height;
    const saveCtx = saveCanvas.getContext('2d');

    // Dark background
    saveCtx.fillStyle = '#0a0a0f';
    saveCtx.fillRect(0, 0, saveCanvas.width, saveCanvas.height);

    // Draw the artwork
    saveCtx.drawImage(drawCanvas, 0, 0);

    // Add watermark
    saveCtx.font = '14px Inter, sans-serif';
    saveCtx.fillStyle = 'rgba(148, 163, 184, 0.4)';
    saveCtx.textAlign = 'right';
    saveCtx.fillText('Air Canvas — Finger Drawing', saveCanvas.width - 16, saveCanvas.height - 16);

    // Download
    const link = document.createElement('a');
    link.download = `air-canvas-${Date.now()}.png`;
    link.href = saveCanvas.toDataURL('image/png');
    link.click();
    showToast('💾 Drawing saved!');
});

// Camera toggle
btnCamTog.addEventListener('click', async () => {
    if (state.cameraOn) {
        videoEl.srcObject?.getTracks().forEach(t => t.stop());
        videoEl.srcObject = null;
        state.cameraOn = false;
        cameraOffNote.classList.remove('hidden');
        showToast('📷 Camera off');
    } else {
        // Restart
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
            videoEl.srcObject = stream;
            state.cameraOn = true;
            cameraOffNote.classList.add('hidden');

            // Re-init mediapipe processing
            const hands = window._airHands;
            const camera = new Camera(videoEl, {
                onFrame: async () => {
                    await hands.send({ image: videoEl });
                },
                width: 1280,
                height: 720,
            });
            await camera.start();
            window._airCamera = camera;

            showToast('📷 Camera on');
        } catch (err) {
            showToast('⚠️ Could not restart camera');
        }
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }
    if (e.key === 'd' || e.key === 'D') {
        btnDraw.click();
    }
    if (e.key === 'e' || e.key === 'E') {
        btnErase.click();
    }
    if (e.key === 'c' || e.key === 'C') {
        if (!e.ctrlKey) btnClear.click();
    }
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        btnSave.click();
    }
});

// ─── Initialize ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    resizeCanvases();
    brushPreview.style.background = state.color;
    initMediaPipe();
});
