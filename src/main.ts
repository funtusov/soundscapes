/**
 * MAIN - Application entry point
 */

import { AudioEngine } from './AudioEngine';
import { initVisualizer, initMelFilterbank, animate } from './visualizer';
import { initControls, initModeSelector, initScaleControls, initLoopControls, initEffectsControls, initTextureControls, initDeviceOrientation } from './controls';

// Initialize audio engine
const audio = new AudioEngine();

// DOM elements
const overlay = document.getElementById('overlay')!;
const startBtn = document.getElementById('startBtn')!;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

let hasStarted = false;

function initApp(e?: Event) {
    if (hasStarted) return;
    hasStarted = true;

    // Prevent phantom clicks if both events fire
    if (e && e.type === 'touchstart') e.preventDefault();

    // Request device permissions (must be in user gesture)
    initDeviceOrientation(audio);

    // Initialize audio
    audio.init();
    audio.resume();

    // Initialize mel filterbank for spectrogram (once, not lazily)
    initMelFilterbank(audio);

    // Hide overlay, show controls
    overlay.classList.add('hidden');
    document.getElementById('modeSelector')!.style.display = 'flex';
    document.getElementById('scaleControls')!.style.display = 'flex';
    document.getElementById('loopControls')!.style.display = 'flex';
    document.getElementById('effectsControls')!.style.display = 'flex';
    document.getElementById('textureControls')!.style.display = audio.mode === 'oneheart' ? 'flex' : 'none';

    // Initialize UI
    initModeSelector(audio);
    initScaleControls(audio);
    initLoopControls(audio);
    initEffectsControls(audio);
    initTextureControls(audio);
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
