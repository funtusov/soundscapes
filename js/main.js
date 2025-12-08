/**
 * MAIN - Application entry point
 */

import { AudioEngine } from './AudioEngine.js';
import { initVisualizer, animate } from './visualizer.js';
import { initControls, initModeSelector, initScaleControls, initDeviceOrientation } from './controls.js';

// Initialize audio engine
const audio = new AudioEngine();

// DOM elements
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startBtn');
const canvas = document.getElementById('canvas');

let hasStarted = false;

function initApp(e) {
    if (hasStarted) return;
    hasStarted = true;

    // Prevent phantom clicks if both events fire
    if (e && e.type === 'touchstart') e.preventDefault();

    // Request device permissions (must be in user gesture)
    initDeviceOrientation(audio);

    // Initialize audio
    audio.init();
    audio.resume();

    // Hide overlay, show controls
    overlay.classList.add('hidden');
    document.getElementById('modeSelector').style.display = 'flex';
    document.getElementById('scaleControls').style.display = 'flex';

    // Initialize UI
    initModeSelector(audio);
    initScaleControls(audio);
    initControls(audio);

    // Initialize visualizer
    initVisualizer(canvas);

    // Start animation loop
    animate(audio);
}

// Start button handlers
startBtn.addEventListener('touchend', function(e) {
    e.preventDefault();
    initApp(e);
}, { passive: false });

startBtn.addEventListener('click', initApp);
