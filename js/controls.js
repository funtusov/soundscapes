/**
 * CONTROLS - Input handling (touch, mouse, device orientation)
 */

import { addRipple, setCursor, removeCursor, getCanvasSize } from './visualizer.js';
import { LoopRecorder } from './LoopRecorder.js';

const activeTouches = new Map();
let loopRecorder = null;

export function initControls(audio) {
    // Mouse events
    window.addEventListener('mousedown', e => handleStart(e.clientX, e.clientY, 'mouse', audio));
    window.addEventListener('mousemove', e => {
        if (activeTouches.has('mouse')) handleMove(e.clientX, e.clientY, 'mouse', audio);
    });
    window.addEventListener('mouseup', () => handleEnd('mouse', audio));

    // Touch events
    window.addEventListener('touchstart', e => {
        if (e.target.closest('.mode-selector')) return;
        if (e.target.closest('.scale-controls')) return;
        if (e.target.closest('.loop-controls')) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleStart(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleMove(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchend', e => {
        if (e.target.closest('.mode-selector')) return;
        if (e.target.closest('.scale-controls')) return;
        if (e.target.closest('.loop-controls')) return;
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleEnd(touch.identifier, audio);
        }
    });

    window.addEventListener('touchcancel', e => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            handleEnd(touch.identifier, audio);
        }
    });
}

function handleStart(x, y, touchId, audio) {
    const { width, height } = getCanvasSize();

    // Ignore touches in the control area (now 130px for all controls)
    if (y > height - 130) return;

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = 1 - (y / (height - 130));

    if (audio.ctx) {
        audio.start(touchId);
        audio.update(normX, Math.max(0, Math.min(1, normY)), touchId);
    }

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('start', normX, Math.max(0, Math.min(1, normY)), touchId);
    }

    activeTouches.set(touchId, { x, y, startTime: Date.now() });
    addRipple(x, y);
}

function handleMove(x, y, touchId, audio) {
    if (!activeTouches.has(touchId)) return;

    const { width, height } = getCanvasSize();

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = 1 - (y / (height - 130));

    const touchData = activeTouches.get(touchId);
    const duration = (Date.now() - touchData.startTime) / 1000;

    audio.update(normX, Math.max(0, Math.min(1, normY)), touchId, duration);
    activeTouches.set(touchId, { x, y, startTime: touchData.startTime });

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('move', normX, Math.max(0, Math.min(1, normY)), touchId);
    }

    if (Math.random() > 0.9) addRipple(x, y);
}

function handleEnd(touchId, audio) {
    const touchData = activeTouches.get(touchId);
    if (!touchData) return;

    const duration = (Date.now() - touchData.startTime) / 1000;
    const { width, height } = getCanvasSize();
    const normX = touchData.x / width;
    const normY = 1 - (touchData.y / (height - 130));

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('end', normX, Math.max(0, Math.min(1, normY)), touchId);
    }

    activeTouches.delete(touchId);
    removeCursor(touchId);
    audio.stop(touchId, duration);
}

export function initModeSelector(audio) {
    const buttons = document.querySelectorAll('.mode-btn');
    buttons.forEach(btn => {
        const handler = (e) => {
            e.stopPropagation();
            e.preventDefault();
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            audio.initMode(btn.dataset.mode);
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('touchend', handler);
    });
}

export function initScaleControls(audio) {
    const quantizeBtn = document.getElementById('quantizeBtn');
    const scaleOptions = document.getElementById('scaleOptions');
    const tonicSelect = document.getElementById('tonicSelect');
    const scaleSelect = document.getElementById('scaleSelect');

    // Toggle quantization
    const handleQuantizeToggle = (e) => {
        e.stopPropagation();
        e.preventDefault();

        const isQuantized = !audio.isQuantized;
        audio.setQuantized(isQuantized);

        quantizeBtn.classList.toggle('active', isQuantized);
        scaleOptions.classList.toggle('visible', isQuantized);
    };

    quantizeBtn.addEventListener('click', handleQuantizeToggle);
    quantizeBtn.addEventListener('touchend', handleQuantizeToggle);

    tonicSelect.addEventListener('change', (e) => {
        audio.setTonic(e.target.value);
    });

    scaleSelect.addEventListener('change', (e) => {
        audio.setScaleType(e.target.value);
    });
}

export function initDeviceOrientation(audio) {
    const needsOrientationPermission = typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function';
    const needsMotionPermission = typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function';

    if (needsOrientationPermission || needsMotionPermission) {
        const promises = [];

        if (needsOrientationPermission) {
            promises.push(
                DeviceOrientationEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
                        }
                        return 'o:' + state;
                    })
                    .catch(err => 'o:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        if (needsMotionPermission) {
            promises.push(
                DeviceMotionEvent.requestPermission()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('devicemotion', e => {
                                const acc = e.acceleration || e.accelerationIncludingGravity;
                                audio.updateMotion(acc, e.rotationRate);
                            }, true);
                        }
                        return 'm:' + state;
                    })
                    .catch(err => 'm:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        Promise.all(promises).then(results => {
            document.getElementById('val-motion').innerText = results.join(' ');
        });
    } else {
        if (typeof DeviceOrientationEvent !== 'undefined') {
            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
        }
        if (typeof DeviceMotionEvent !== 'undefined') {
            window.addEventListener('devicemotion', e => {
                const acc = e.acceleration || e.accelerationIncludingGravity;
                audio.updateMotion(acc, e.rotationRate);
            }, true);
        }
        document.getElementById('val-motion').innerText = 'auto';
    }
}

export function initLoopControls(audio) {
    loopRecorder = new LoopRecorder(audio);

    const recordBtn = document.getElementById('loopRecordBtn');
    const playBtn = document.getElementById('loopPlayBtn');
    const clearBtn = document.getElementById('loopClearBtn');
    const statusEl = document.getElementById('loopStatus');

    // Update UI based on state changes
    loopRecorder.onStateChange = (state) => {
        // Update record button
        recordBtn.classList.toggle('recording', state.isRecording);
        recordBtn.querySelector('.loop-icon').textContent = state.isRecording ? '■' : '●';

        // Update play button
        playBtn.disabled = !state.hasLoop;
        playBtn.classList.toggle('playing', state.isPlaying);
        playBtn.querySelector('.loop-icon').textContent = state.isPlaying ? '■' : '▶';

        // Update clear button
        clearBtn.disabled = !state.hasLoop && !state.isRecording;

        // Update status
        if (state.isRecording) {
            statusEl.textContent = 'REC';
        } else if (state.isPlaying) {
            statusEl.textContent = state.duration.toFixed(1) + 's';
        } else if (state.hasLoop) {
            statusEl.textContent = state.duration.toFixed(1) + 's';
        } else {
            statusEl.textContent = '--';
        }
    };

    // Record button handler
    const handleRecord = (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (loopRecorder.isRecording) {
            loopRecorder.stopRecording();
        } else {
            // Stop playback if playing, then start recording
            if (loopRecorder.isPlaying) {
                loopRecorder.stopPlayback();
            }
            loopRecorder.startRecording();
        }
    };
    recordBtn.addEventListener('click', handleRecord);
    recordBtn.addEventListener('touchend', handleRecord);

    // Play button handler
    const handlePlay = (e) => {
        e.stopPropagation();
        e.preventDefault();

        if (loopRecorder.isPlaying) {
            loopRecorder.stopPlayback();
        } else {
            loopRecorder.startPlayback();
        }
    };
    playBtn.addEventListener('click', handlePlay);
    playBtn.addEventListener('touchend', handlePlay);

    // Clear button handler
    const handleClear = (e) => {
        e.stopPropagation();
        e.preventDefault();
        loopRecorder.clearLoop();
    };
    clearBtn.addEventListener('click', handleClear);
    clearBtn.addEventListener('touchend', handleClear);
}
