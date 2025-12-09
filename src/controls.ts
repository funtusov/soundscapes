/**
 * CONTROLS - Input handling (touch, mouse, device orientation)
 */

import { addRipple, setCursor, removeCursor, getCanvasSize } from './visualizer';
import { LoopRecorder } from './LoopRecorder';
import type { AudioEngine } from './AudioEngine';
import { clamp, TOUCH_TAP_MAX_DURATION, TOUCH_PRESS_MAX_DURATION, type SynthesisMode } from './constants';
import { haptic } from 'ios-haptics';

interface TouchData {
    x: number;
    y: number;
    startTime: number;
    crossedPress: boolean;  // Has crossed tap→press threshold (0.2s)
    crossedHold: boolean;   // Has crossed press→hold threshold (1.0s)
}

// ============ HAPTIC FEEDBACK ============

/**
 * Trigger haptic feedback using ios-haptics library (iOS 18+) or Android vibrate API
 */
function triggerHaptic(): void {
    // Try Android/standard Vibration API first
    if ('vibrate' in navigator) {
        navigator.vibrate(10);
        return;
    }

    // iOS Safari 18+ via ios-haptics library
    try {
        haptic();
    } catch {
        // Haptics not supported, fail silently
    }
}

type TouchId = number | string;

const activeTouches = new Map<TouchId, TouchData>();
let loopRecorder: LoopRecorder | null = null;

export function initControls(audio: AudioEngine) {
    // Mouse events - only handle left button (button 0)
    window.addEventListener('mousedown', e => {
        if (e.button !== 0) return; // Only left-click
        handleStart(e.clientX, e.clientY, 'mouse', audio);
    });
    window.addEventListener('mousemove', e => {
        if (activeTouches.has('mouse')) handleMove(e.clientX, e.clientY, 'mouse', audio);
    });
    window.addEventListener('mouseup', e => {
        if (e.button !== 0) return; // Only left-click
        handleEnd('mouse', audio);
    });

    // Stop sounds when window loses focus or mouse leaves
    window.addEventListener('blur', () => {
        if (activeTouches.has('mouse')) {
            handleEnd('mouse', audio);
        }
    });

    // Fallback: stop sounds if mouse leaves window during drag
    document.addEventListener('mouseleave', () => {
        if (activeTouches.has('mouse')) {
            handleEnd('mouse', audio);
        }
    });

    // Touch events
    window.addEventListener('touchstart', e => {
        const target = e.target as Element;
        if (target.closest('.mode-selector')) return;
        if (target.closest('.scale-controls')) return;
        if (target.closest('.loop-controls')) return;
        if (target.closest('.texture-controls')) return;
        if (target.closest('.beats-controls')) return;
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
        if (target.closest('.texture-controls')) return;
        if (target.closest('.beats-controls')) return;
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

    // Ignore touches below the canvas (in control area)
    if (y > height) return;

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = clamp(1 - (y / height), 0, 1);

    if (audio.ctx) {
        audio.start(touchId);
        audio.update(normX, normY, touchId);
    }

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('start', normX, normY, touchId);
    }

    activeTouches.set(touchId, { x, y, startTime: Date.now(), crossedPress: false, crossedHold: false });
    addRipple(x, y);
}

function handleMove(x: number, y: number, touchId: TouchId, audio: AudioEngine) {
    if (!activeTouches.has(touchId)) return;

    const { width, height } = getCanvasSize();

    setCursor(x, y, touchId);

    const normX = x / width;
    const normY = clamp(1 - (y / height), 0, 1);

    const touchData = activeTouches.get(touchId)!;
    const duration = (Date.now() - touchData.startTime) / 1000;

    // Check for duration threshold crossings and trigger haptic feedback
    let { crossedPress, crossedHold } = touchData;

    // Tap → Press threshold (0.2s)
    if (!crossedPress && duration >= TOUCH_TAP_MAX_DURATION) {
        crossedPress = true;
        triggerHaptic();
    }

    // Press → Hold threshold (1.0s)
    if (!crossedHold && duration >= TOUCH_PRESS_MAX_DURATION) {
        crossedHold = true;
        triggerHaptic();
    }

    audio.update(normX, normY, touchId, duration);
    activeTouches.set(touchId, { x, y, startTime: touchData.startTime, crossedPress, crossedHold });

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
    const normY = clamp(1 - (touchData.y / height), 0, 1);

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('end', normX, normY, touchId);
    }

    activeTouches.delete(touchId);
    removeCursor(touchId);
    audio.stop(touchId, duration);
}

export function initModeSelector(audio: AudioEngine) {
    const select = document.getElementById('modeSelect') as HTMLSelectElement;
    if (!select) return;

    select.addEventListener('change', (e) => {
        e.stopPropagation();
        const mode = select.value as SynthesisMode;
        audio.initMode(mode);
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
                            window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma, e.alpha), true);
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
        window.addEventListener('deviceorientation', e => audio.updateOrientation(e.beta, e.gamma, e.alpha), true);
        window.addEventListener('devicemotion', e => {
            const acc = e.acceleration || e.accelerationIncludingGravity;
            audio.updateMotion(acc, e.rotationRate);
        }, true);
        document.getElementById('val-motion')!.innerText = 'auto';
    }
}

export function initLoopControls(audio: AudioEngine) {
    loopRecorder = new LoopRecorder(audio);

    const loopControls = document.getElementById('loopControls')!;
    const loopToggleBtn = document.getElementById('loopToggleBtn')!;
    const recordBtn = document.getElementById('loopRecordBtn')!;
    const playBtn = document.getElementById('loopPlayBtn') as HTMLButtonElement;
    const clearBtn = document.getElementById('loopClearBtn') as HTMLButtonElement;
    const statusEl = document.getElementById('loopStatus')!;

    // Toggle loop controls visibility
    const handleLoopToggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const isExpanded = loopControls.classList.toggle('expanded');
        loopToggleBtn.classList.toggle('active', isExpanded);
    };

    loopToggleBtn.addEventListener('click', handleLoopToggle);
    loopToggleBtn.addEventListener('touchend', handleLoopToggle);

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
        reverbBtn.textContent = level === 'off' ? 'Reverb' : 'Reverb';
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

    // Update button state when mode changes (oneheart enables reverb by default)
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            setTimeout(updateReverbButton, 100);
        });
    }
}

export function initTextureControls(audio: AudioEngine) {
    const noiseBtn = document.getElementById('noiseBtn')!;
    const tapeBtn = document.getElementById('tapeBtn')!;
    const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
    const textureVolumeSlider = document.getElementById('textureVolumeSlider') as HTMLInputElement;
    const textureControls = document.getElementById('textureControls')!;

    // Noise type display names
    const noiseTypeNames: Record<string, string> = {
        waves: 'Waves',
        rain: 'Rain',
        wind: 'Wind',
        fire: 'Fire'
    };

    // Update button text to show current noise type
    const updateNoiseButtonText = () => {
        const type = audio.getNoiseType();
        const isActive = audio.noiseEnabled;
        noiseBtn.textContent = noiseTypeNames[type] || type;
        noiseBtn.classList.toggle('active', isActive);
    };

    // Show texture controls for focus, relaxation, and wavetable modes
    const updateVisibility = () => {
        const showTextures = audio.mode === 'focus' || audio.mode === 'relaxation' || audio.mode === 'wavetable';
        textureControls.style.display = showTextures ? 'flex' : 'none';
    };

    // Noise toggle (short press) and cycle type (long press)
    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    let isLongPress = false;

    const handleNoiseStart = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            // Long press: cycle noise type
            audio.cycleNoiseType();
            updateNoiseButtonText();
        }, 500);
    };

    const handleNoiseEnd = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        if (!isLongPress) {
            // Short press: toggle on/off
            audio.toggleNoise();
            updateNoiseButtonText();
        }
    };

    noiseBtn.addEventListener('mousedown', handleNoiseStart);
    noiseBtn.addEventListener('mouseup', handleNoiseEnd);
    noiseBtn.addEventListener('mouseleave', () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
    });
    noiseBtn.addEventListener('touchstart', handleNoiseStart);
    noiseBtn.addEventListener('touchend', handleNoiseEnd);

    // Tape hiss toggle
    const handleTape = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const enabled = audio.toggleTapeHiss();
        tapeBtn.classList.toggle('active', enabled);
    };

    tapeBtn.addEventListener('click', handleTape);
    tapeBtn.addEventListener('touchend', handleTape);

    // Texture volume slider
    textureVolumeSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const value = parseInt(textureVolumeSlider.value, 10) / 100;
        audio.setTextureVolume(value);
    });

    // Prevent touch events from propagating to canvas
    textureVolumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    textureVolumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
    textureVolumeSlider.addEventListener('touchend', (e) => e.stopPropagation());

    // Master volume slider
    volumeSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const value = parseInt(volumeSlider.value, 10);
        audio.setVolume(value);
    });

    // Prevent touch events from propagating to canvas
    volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
    volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());

    // Sync UI state with audio engine state
    const syncUIState = () => {
        updateVisibility();
        updateNoiseButtonText();
        tapeBtn.classList.toggle('active', audio.tapeHissEnabled);

        // Sync slider values with engine state
        textureVolumeSlider.value = String(Math.round(audio.getTextureVolume() * 100));
    };

    // Initialize visibility and button state
    syncUIState();

    // Update visibility and state when mode changes
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            setTimeout(syncUIState, 100);
        });
    }
}

export function initBeatsControls(audio: AudioEngine) {
    const beatsControls = document.getElementById('beatsControls')!;
    const playBtn = document.getElementById('beatsPlayBtn')!;
    const tempoSlider = document.getElementById('tempoSlider') as HTMLInputElement;
    const tempoValue = document.getElementById('tempoValue')!;
    const volumeSlider = document.getElementById('beatsVolumeSlider') as HTMLInputElement;

    // Show/hide beats controls based on mode
    const updateVisibility = () => {
        beatsControls.style.display = audio.mode === 'beats' ? 'flex' : 'none';
    };

    // Update play button state
    const updatePlayButton = () => {
        const isPlaying = audio.beatEngine?.getIsPlaying() ?? false;
        playBtn.textContent = isPlaying ? '■' : '▶';
        playBtn.classList.toggle('playing', isPlaying);
    };

    // Play/Stop toggle
    const handlePlay = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        audio.beatEngine?.toggle();
        updatePlayButton();
    };

    playBtn.addEventListener('click', handlePlay);
    playBtn.addEventListener('touchend', handlePlay);

    // Tempo slider
    tempoSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const bpm = parseInt(tempoSlider.value, 10);
        audio.beatEngine?.setTempo(bpm);
        tempoValue.textContent = String(bpm);
    });

    // Prevent touch events from propagating
    tempoSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    tempoSlider.addEventListener('touchmove', (e) => e.stopPropagation());
    tempoSlider.addEventListener('touchend', (e) => e.stopPropagation());

    // Volume slider
    volumeSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const vol = parseInt(volumeSlider.value, 10) / 100;
        audio.beatEngine?.setVolume(vol);
    });

    // Prevent touch events from propagating
    volumeSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    volumeSlider.addEventListener('touchmove', (e) => e.stopPropagation());
    volumeSlider.addEventListener('touchend', (e) => e.stopPropagation());

    // Initialize state
    updateVisibility();
    updatePlayButton();

    // Sync tempo slider with engine
    if (audio.beatEngine) {
        tempoSlider.value = String(audio.beatEngine.getTempo());
        tempoValue.textContent = String(audio.beatEngine.getTempo());
        volumeSlider.value = String(Math.round(audio.beatEngine.getVolume() * 100));
    }

    // Update visibility and state when mode changes
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
        modeSelect.addEventListener('change', () => {
            setTimeout(() => {
                updateVisibility();
                updatePlayButton();
            }, 100);
        });
    }
}
