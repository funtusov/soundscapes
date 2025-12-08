/**
 * CONTROLS - Input handling (touch, mouse, device orientation)
 */

import { addRipple, setCursor, removeCursor, getCanvasSize } from './visualizer';
import { LoopRecorder } from './LoopRecorder';
import type { AudioEngine } from './AudioEngine';
import { CONTROL_BAR_HEIGHT, clamp, type SynthesisMode } from './constants';

interface TouchData {
    x: number;
    y: number;
    startTime: number;
}

type TouchId = number | string;

const activeTouches = new Map<TouchId, TouchData>();
let loopRecorder: LoopRecorder | null = null;

export function initControls(audio: AudioEngine) {
    // Mouse events
    window.addEventListener('mousedown', e => handleStart(e.clientX, e.clientY, 'mouse', audio));
    window.addEventListener('mousemove', e => {
        if (activeTouches.has('mouse')) handleMove(e.clientX, e.clientY, 'mouse', audio);
    });
    window.addEventListener('mouseup', () => handleEnd('mouse', audio));

    // Touch events
    window.addEventListener('touchstart', e => {
        const target = e.target as Element;
        if (target.closest('.mode-selector')) return;
        if (target.closest('.scale-controls')) return;
        if (target.closest('.loop-controls')) return;
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
            handleStart(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
            handleMove(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchend', e => {
        const target = e.target as Element;
        if (target.closest('.mode-selector')) return;
        if (target.closest('.scale-controls')) return;
        if (target.closest('.loop-controls')) return;
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
            handleEnd(touch.identifier, audio);
        }
    });

    window.addEventListener('touchcancel', e => {
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
            handleEnd(touch.identifier, audio);
        }
    });
}

function handleStart(x: number, y: number, touchId: TouchId, audio: AudioEngine) {
    const { width, height } = getCanvasSize();

    // Ignore touches in the control area
    if (y > height - CONTROL_BAR_HEIGHT) return;

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = clamp(1 - (y / (height - CONTROL_BAR_HEIGHT)), 0, 1);

    if (audio.ctx) {
        audio.start(touchId);
        audio.update(normX, normY, touchId);
    }

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('start', normX, normY, touchId);
    }

    activeTouches.set(touchId, { x, y, startTime: Date.now() });
    addRipple(x, y);
}

function handleMove(x: number, y: number, touchId: TouchId, audio: AudioEngine) {
    if (!activeTouches.has(touchId)) return;

    const { width, height } = getCanvasSize();

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = clamp(1 - (y / (height - CONTROL_BAR_HEIGHT)), 0, 1);

    const touchData = activeTouches.get(touchId)!;
    const duration = (Date.now() - touchData.startTime) / 1000;

    audio.update(normX, normY, touchId, duration);
    activeTouches.set(touchId, { x, y, startTime: touchData.startTime });

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('move', normX, normY, touchId);
    }

    if (Math.random() > 0.9) addRipple(x, y);
}

function handleEnd(touchId: TouchId, audio: AudioEngine) {
    const touchData = activeTouches.get(touchId);
    if (!touchData) return;

    const duration = (Date.now() - touchData.startTime) / 1000;
    const { width, height } = getCanvasSize();
    const normX = touchData.x / width;
    const normY = clamp(1 - (touchData.y / (height - CONTROL_BAR_HEIGHT)), 0, 1);

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('end', normX, normY, touchId);
    }

    activeTouches.delete(touchId);
    removeCursor(touchId);
    audio.stop(touchId, duration);
}

export function initModeSelector(audio: AudioEngine) {
    const buttons = document.querySelectorAll('.mode-btn');
    buttons.forEach(btn => {
        const handler = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            audio.initMode((btn as HTMLElement).dataset.mode as SynthesisMode);
        };
        btn.addEventListener('click', handler);
        btn.addEventListener('touchend', handler);
    });
}

export function initScaleControls(audio: AudioEngine) {
    const quantizeBtn = document.getElementById('quantizeBtn')!;
    const scaleOptions = document.getElementById('scaleOptions')!;
    const tonicSelect = document.getElementById('tonicSelect') as HTMLSelectElement;
    const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;

    // Toggle quantization
    const handleQuantizeToggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        const isQuantized = !audio.isQuantized;
        audio.setQuantized(isQuantized);

        quantizeBtn.classList.toggle('active', isQuantized);
        scaleOptions.classList.toggle('visible', isQuantized);
    };

    quantizeBtn.addEventListener('click', handleQuantizeToggle);
    quantizeBtn.addEventListener('touchend', handleQuantizeToggle);

    tonicSelect.addEventListener('change', () => {
        audio.setTonic(tonicSelect.value);
    });

    scaleSelect.addEventListener('change', () => {
        audio.setScaleType(scaleSelect.value);
    });
}

// Extend window for iOS device orientation/motion permissions
declare global {
    interface DeviceOrientationEvent {
        requestPermission?: () => Promise<'granted' | 'denied'>;
    }
    interface DeviceMotionEvent {
        requestPermission?: () => Promise<'granted' | 'denied'>;
    }
}

export function initDeviceOrientation(audio: AudioEngine) {
    const DeviceOrientationEventConstructor = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<string>;
    };
    const DeviceMotionEventConstructor = DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<string>;
    };

    const needsOrientationPermission = typeof DeviceOrientationEventConstructor.requestPermission === 'function';
    const needsMotionPermission = typeof DeviceMotionEventConstructor.requestPermission === 'function';

    if (needsOrientationPermission || needsMotionPermission) {
        const promises: Promise<string>[] = [];

        if (needsOrientationPermission) {
            promises.push(
                DeviceOrientationEventConstructor.requestPermission!()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
                        }
                        return 'o:' + state;
                    })
                    .catch((err: Error) => 'o:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        if (needsMotionPermission) {
            promises.push(
                DeviceMotionEventConstructor.requestPermission!()
                    .then(state => {
                        if (state === 'granted') {
                            window.addEventListener('devicemotion', e => {
                                const acc = e.acceleration || e.accelerationIncludingGravity;
                                audio.updateMotion(acc, e.rotationRate);
                            }, true);
                        }
                        return 'm:' + state;
                    })
                    .catch((err: Error) => 'm:' + (err.name || err.message || 'err').substring(0, 15))
            );
        }

        Promise.all(promises).then(results => {
            document.getElementById('val-motion')!.innerText = results.join(' ');
        });
    } else {
        window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma), true);
        window.addEventListener('devicemotion', e => {
            const acc = e.acceleration || e.accelerationIncludingGravity;
            audio.updateMotion(acc, e.rotationRate);
        }, true);
        document.getElementById('val-motion')!.innerText = 'auto';
    }
}

export function initLoopControls(audio: AudioEngine) {
    loopRecorder = new LoopRecorder(audio);

    const recordBtn = document.getElementById('loopRecordBtn')!;
    const playBtn = document.getElementById('loopPlayBtn') as HTMLButtonElement;
    const clearBtn = document.getElementById('loopClearBtn') as HTMLButtonElement;
    const statusEl = document.getElementById('loopStatus')!;

    // Update UI based on state changes
    loopRecorder.onStateChange = (state) => {
        // Update record button
        recordBtn.classList.toggle('recording', state.isRecording);
        recordBtn.querySelector('.loop-icon')!.textContent = state.isRecording ? '■' : '●';

        // Update play button
        playBtn.disabled = !state.hasLoop;
        playBtn.classList.toggle('playing', state.isPlaying);
        playBtn.querySelector('.loop-icon')!.textContent = state.isPlaying ? '■' : '▶';

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
    const handleRecord = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (loopRecorder!.isRecording) {
            loopRecorder!.stopRecording();
        } else {
            // Stop playback if playing, then start recording
            if (loopRecorder!.isPlaying) {
                loopRecorder!.stopPlayback();
            }
            loopRecorder!.startRecording();
        }
    };
    recordBtn.addEventListener('click', handleRecord);
    recordBtn.addEventListener('touchend', handleRecord);

    // Play button handler
    const handlePlay = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (loopRecorder!.isPlaying) {
            loopRecorder!.stopPlayback();
        } else {
            loopRecorder!.startPlayback();
        }
    };
    playBtn.addEventListener('click', handlePlay);
    playBtn.addEventListener('touchend', handlePlay);

    // Clear button handler
    const handleClear = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        loopRecorder!.clearLoop();
    };
    clearBtn.addEventListener('click', handleClear);
    clearBtn.addEventListener('touchend', handleClear);
}

export function initEffectsControls(audio: AudioEngine) {
    const reverbBtn = document.getElementById('reverbBtn')!;

    const updateReverbButton = () => {
        const level = audio.reverbLevel;
        const label = level === 'off' ? 'Reverb: Off' :
                      level === 'low' ? 'Reverb: Low' :
                      level === 'mid' ? 'Reverb: Mid' : 'Reverb: High';
        reverbBtn.textContent = label;
        reverbBtn.classList.toggle('active', level !== 'off');
    };

    const handleReverb = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        audio.cycleReverb();
        updateReverbButton();
    };

    reverbBtn.addEventListener('click', handleReverb);
    reverbBtn.addEventListener('touchend', handleReverb);

    // Initialize button state
    updateReverbButton();
}
