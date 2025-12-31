/**
 * CONTROLS - Input handling (touch, mouse, device orientation)
 */

import { addRipple, setCursor, removeCursor, getCanvasSize } from './visualizer';
import { LoopRecorder } from './LoopRecorder';
import { AudioRecorder } from './AudioRecorder';
import type { AudioEngine } from './AudioEngine';
import { clamp, TOUCH_TAP_MAX_DURATION, TOUCH_PRESS_MAX_DURATION, type NoiseType } from './constants';
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

/**
 * Update scale controls elevation based on whether secondary bar is visible
 */
export function updateScaleControlsPosition(_audio: AudioEngine): void {
    // Scale controls no longer need elevation - only one bar now
}

export function initControls(audio: AudioEngine) {
    // Mouse events - only handle left button (button 0)
    window.addEventListener('mousedown', e => {
        const target = e.target as Element | null;
        if (target?.closest('.mode-selector')) return;
        if (target?.closest('.scale-controls')) return;
        if (target?.closest('.loop-controls')) return;
        if (target?.closest('.texture-controls')) return;
        if (target?.closest('.beats-controls')) return;
        if (target?.closest('.hand-viz')) return;
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
        if (target.closest('.hand-viz')) return;
        e.preventDefault();
        for (const touch of Array.from(e.changedTouches)) {
            handleStart(touch.clientX, touch.clientY, touch.identifier, audio);
        }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
        const target = e.target as Element;
        if (target.closest('.mode-selector')) return;
        if (target.closest('.scale-controls')) return;
        if (target.closest('.loop-controls')) return;
        if (target.closest('.texture-controls')) return;
        if (target.closest('.beats-controls')) return;
        if (target.closest('.hand-viz')) return;
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
        if (target.closest('.hand-viz')) return;
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

    // Canvas height already excludes control bar (CSS: calc(100% - 90px))
    // Ignore touches outside the canvas
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
    // Canvas height already excludes control bar (CSS: calc(100% - 90px))
    const normY = clamp(1 - (touchData.y / height), 0, 1);

    // Record event if loop recorder is recording
    if (loopRecorder && loopRecorder.isRecording) {
        loopRecorder.recordEvent('end', normX, normY, touchId);
    }

    activeTouches.delete(touchId);
    removeCursor(touchId);
    audio.stop(touchId, duration);
}

export function initModeSelector(_audio: AudioEngine) {
    // Mode selector removed - only wavetable mode for now
}

export function initScaleControls(audio: AudioEngine) {
    const quantizeSummary = document.getElementById('quantizeSummary')!;
    const quantizeOptions = document.getElementById('quantizeOptions')!;
    const quantizeOffBtn = document.getElementById('quantizeOffBtn')!;
    const tonicSelect = document.getElementById('tonicSelect') as HTMLSelectElement;
    const scaleSelect = document.getElementById('scaleSelect') as HTMLSelectElement;

    // Scale type short names for display
    const scaleShortNames: Record<string, string> = {
        major: 'maj',
        minor: 'min',
        pent_maj: 'pent',
        pent_min: 'pent',
        blues: 'blues',
        dorian: 'dor',
        lydian: 'lyd',
        mixolydian: 'mixo',
        harm_min: 'harm',
        whole_tone: 'whole',
        chromatic: 'chr'
    };

    // Note names
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    // Update summary button text
    const updateSummary = () => {
        if (!audio.isQuantized) {
            quantizeSummary.textContent = 'Quantize';
            quantizeSummary.classList.remove('active');
            quantizeOffBtn.classList.add('active');
        } else {
            const tonic = noteNames[parseInt(tonicSelect.value, 10)];
            const scaleType = scaleSelect.value;
            const shortName = scaleShortNames[scaleType] || scaleType;
            // Show minor indicator for minor scales
            const minorIndicator = scaleType === 'minor' || scaleType === 'pent_min' || scaleType === 'harm_min' ? 'm' : '';
            quantizeSummary.textContent = `${tonic}${minorIndicator} ${shortName}`;
            quantizeSummary.classList.add('active');
            quantizeOffBtn.classList.remove('active');
        }
    };

    // Handle summary button click
    let justTouched = false;
    const handleSummaryClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        // Prevent double-firing on touch devices
        if (e.type === 'touchend') {
            justTouched = true;
            setTimeout(() => { justTouched = false; }, 100);
        } else if (e.type === 'click' && justTouched) {
            return;
        }

        if (!audio.isQuantized) {
            // If off, turn on quantization with current settings
            audio.setQuantized(true);
            updateSummary();
        } else {
            // If on, toggle options panel
            quantizeOptions.classList.toggle('expanded');
        }
    };

    // Close options panel
    const closeOptions = () => {
        quantizeOptions.classList.remove('expanded');
    };

    // Handle "Off" button (turn off quantization)
    let justTouchedOff = false;
    const handleQuantizeOff = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        // Prevent double-firing on touch devices
        if (e.type === 'touchend') {
            justTouchedOff = true;
            setTimeout(() => { justTouchedOff = false; }, 100);
        } else if (e.type === 'click' && justTouchedOff) {
            return;
        }

        audio.setQuantized(false);
        updateSummary();
        closeOptions();
    };

    // Handle tonic/scale change (enable quantization if not already)
    const handleScaleChange = () => {
        if (!audio.isQuantized) {
            audio.setQuantized(true);
        }
        audio.setTonic(tonicSelect.value);
        audio.setScaleType(scaleSelect.value);
        updateSummary();
        closeOptions();
    };

    quantizeSummary.addEventListener('click', handleSummaryClick);
    quantizeSummary.addEventListener('touchend', handleSummaryClick);

    quantizeOffBtn.addEventListener('click', handleQuantizeOff);
    quantizeOffBtn.addEventListener('touchend', handleQuantizeOff);

    tonicSelect.addEventListener('change', handleScaleChange);
    scaleSelect.addEventListener('change', handleScaleChange);

    // Prevent clicks on options panel from propagating to canvas
    quantizeOptions.addEventListener('click', (e) => e.stopPropagation());
    quantizeOptions.addEventListener('touchstart', (e) => e.stopPropagation());
    quantizeOptions.addEventListener('touchend', (e) => e.stopPropagation());

    // Close options when clicking outside
    document.addEventListener('click', (e) => {
        const target = e.target as Element;
        if (!target.closest('.quantize-control')) {
            closeOptions();
        }
    });

    // Initialize summary
    updateSummary();

    // Range control (octaves + location)
    const rangeSummary = document.getElementById('rangeSummary')!;
    const rangeOptions = document.getElementById('rangeOptions')!;
    const rangeOctBtns = rangeOptions.querySelectorAll('.range-oct-btn');
    const rangeLocBtns = rangeOptions.querySelectorAll('.range-loc-btn');

    const locationNames: Record<string, string> = {
        bass: 'Bass',
        mid: 'Mid',
        treble: 'Treble'
    };

    const updateRangeSummary = () => {
        const range = audio.getRange();
        rangeSummary.textContent = `${range.octaves} ${locationNames[range.location]}`;
    };

    const closeRangeOptions = () => {
        rangeOptions.classList.remove('expanded');
    };

    // Summary button toggles options panel
    let justTouchedRange = false;
    const handleRangeSummaryClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'touchend') {
            justTouchedRange = true;
            setTimeout(() => { justTouchedRange = false; }, 100);
        } else if (e.type === 'click' && justTouchedRange) {
            return;
        }
        rangeOptions.classList.toggle('expanded');
    };

    rangeSummary.addEventListener('click', handleRangeSummaryClick);
    rangeSummary.addEventListener('touchend', handleRangeSummaryClick);

    // Octave buttons
    rangeOctBtns.forEach(btn => {
        const handleOctClick = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            const octaves = parseInt((btn as HTMLElement).dataset.oct || '3', 10);
            audio.setRangeOctaves(octaves);
            rangeOctBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateRangeSummary();
        };
        btn.addEventListener('click', handleOctClick);
        btn.addEventListener('touchend', handleOctClick);
    });

    // Location buttons
    rangeLocBtns.forEach(btn => {
        const handleLocClick = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            const location = (btn as HTMLElement).dataset.loc as 'bass' | 'mid' | 'treble';
            audio.setRangeLocation(location);
            rangeLocBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            updateRangeSummary();
        };
        btn.addEventListener('click', handleLocClick);
        btn.addEventListener('touchend', handleLocClick);
    });

    // Prevent clicks on options panel from propagating to canvas
    rangeOptions.addEventListener('click', (e) => e.stopPropagation());
    rangeOptions.addEventListener('touchstart', (e) => e.stopPropagation());
    rangeOptions.addEventListener('touchend', (e) => e.stopPropagation());

    // Close range options when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!rangeOptions.contains(e.target as Node) && !rangeSummary.contains(e.target as Node)) {
            closeRangeOptions();
        }
    });

    // Initialize summary
    updateRangeSummary();

    // Envelope button handler
    const envelopeBtn = document.getElementById('envelopeBtn')!;
    const handleEnvelopeToggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const envelope = audio.cycleEnvelope();
        envelopeBtn.textContent = envelope.name;
    };

    envelopeBtn.addEventListener('click', handleEnvelopeToggle);
    envelopeBtn.addEventListener('touchend', handleEnvelopeToggle);

    // Arp button handler
    const arpBtn = document.getElementById('arpBtn')!;
    const handleArpToggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        const enabled = audio.toggleArp();
        arpBtn.classList.toggle('active', enabled);
    };

    arpBtn.addEventListener('click', handleArpToggle);
    arpBtn.addEventListener('touchend', handleArpToggle);
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

    // Helper to prevent double-firing on touch devices
    const createTouchSafeHandler = (handler: () => void) => {
        let justTouched = false;
        return (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            if (e.type === 'touchend') {
                justTouched = true;
                setTimeout(() => { justTouched = false; }, 100);
            } else if (e.type === 'click' && justTouched) {
                return;
            }
            handler();
        };
    };

    // Toggle loop controls visibility
    const handleLoopToggle = createTouchSafeHandler(() => {
        const isExpanded = loopControls.classList.toggle('expanded');
        // Also set inline style since it has higher specificity than CSS classes
        loopControls.style.display = isExpanded ? 'flex' : 'none';
        loopToggleBtn.classList.toggle('active', isExpanded);
    });

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
    const handleRecord = createTouchSafeHandler(() => {
        if (loopRecorder!.isRecording) {
            loopRecorder!.stopRecording();
        } else {
            // Stop playback if playing, then start recording
            if (loopRecorder!.isPlaying) {
                loopRecorder!.stopPlayback();
            }
            loopRecorder!.startRecording();
        }
    });
    recordBtn.addEventListener('click', handleRecord);
    recordBtn.addEventListener('touchend', handleRecord);

    // Play button handler
    const handlePlay = createTouchSafeHandler(() => {
        if (loopRecorder!.isPlaying) {
            loopRecorder!.stopPlayback();
        } else {
            loopRecorder!.startPlayback();
        }
    });
    playBtn.addEventListener('click', handlePlay);
    playBtn.addEventListener('touchend', handlePlay);

    // Clear button handler
    const handleClear = createTouchSafeHandler(() => {
        loopRecorder!.clearLoop();
    });
    clearBtn.addEventListener('click', handleClear);
    clearBtn.addEventListener('touchend', handleClear);
}

export function initEffectsControls(audio: AudioEngine) {
    const reverbSummary = document.getElementById('reverbSummary')!;
    const reverbOptions = document.getElementById('reverbOptions')!;
    const reverbOffBtn = document.getElementById('reverbOffBtn')!;
    const reverbSizeSlider = document.getElementById('reverbSizeSlider') as HTMLInputElement;
    const reverbMixSlider = document.getElementById('reverbMixSlider') as HTMLInputElement;

    // Track reverb state
    let reverbEnabled = false;
    let reverbSize = 60; // 0-100
    let reverbMix = 50;  // 0-100

    const updateReverbSummary = () => {
        if (!reverbEnabled) {
            reverbSummary.textContent = 'Reverb';
            reverbSummary.classList.remove('active');
            reverbOffBtn.classList.add('active');
        } else {
            reverbSummary.textContent = `Reverb ${reverbMix}%`;
            reverbSummary.classList.add('active');
            reverbOffBtn.classList.remove('active');
        }
    };

    const applyReverb = () => {
        if (!reverbEnabled) {
            audio.setReverbLevel('off');
        } else {
            // Size affects reverb intensity, mix affects wet/dry balance
            const sizeMultiplier = 0.5 + (reverbSize / 100) * 0.5; // 0.5-1.0
            const wet = (reverbMix / 100) * sizeMultiplier;
            const dry = 1 - wet * 0.4; // Keep some dry signal
            audio.setReverbLevel('on');
            audio.setReverbParams(0, wet, dry);
        }
    };

    const closeReverbOptions = () => {
        reverbOptions.classList.remove('expanded');
    };

    // Summary button toggles options panel or turns on reverb
    let justTouchedReverb = false;
    const handleReverbSummaryClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'touchend') {
            justTouchedReverb = true;
            setTimeout(() => { justTouchedReverb = false; }, 100);
        } else if (e.type === 'click' && justTouchedReverb) {
            return;
        }

        if (!reverbEnabled) {
            // Turn on reverb
            reverbEnabled = true;
            applyReverb();
            updateReverbSummary();
        }
        // Toggle options panel
        reverbOptions.classList.toggle('expanded');
    };

    reverbSummary.addEventListener('click', handleReverbSummaryClick);
    reverbSummary.addEventListener('touchend', handleReverbSummaryClick);

    // Off button
    const handleOffClick = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        reverbEnabled = false;
        applyReverb();
        updateReverbSummary();
        closeReverbOptions();
    };
    reverbOffBtn.addEventListener('click', handleOffClick);
    reverbOffBtn.addEventListener('touchend', handleOffClick);

    // Size slider (affects decay character)
    reverbSizeSlider.addEventListener('input', () => {
        reverbSize = parseInt(reverbSizeSlider.value, 10);
        if (!reverbEnabled) {
            reverbEnabled = true;
        }
        applyReverb();
        updateReverbSummary();
    });

    // Mix slider
    reverbMixSlider.addEventListener('input', () => {
        reverbMix = parseInt(reverbMixSlider.value, 10);
        if (!reverbEnabled) {
            reverbEnabled = true;
        }
        applyReverb();
        updateReverbSummary();
    });

    // Prevent clicks on options panel from propagating to canvas
    reverbOptions.addEventListener('click', (e) => e.stopPropagation());
    reverbOptions.addEventListener('touchstart', (e) => e.stopPropagation());
    reverbOptions.addEventListener('touchend', (e) => e.stopPropagation());

    // Close options when clicking elsewhere
    document.addEventListener('click', (e) => {
        if (!reverbOptions.contains(e.target as Node) && !reverbSummary.contains(e.target as Node)) {
            closeReverbOptions();
        }
    });

    // Initialize
    updateReverbSummary();

    // Compass pan button handler
    const compassPanBtn = document.getElementById('compassPanBtn')!;

    let justTouchedPan = false;
    const handlePanToggle = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();
        if (e.type === 'touchend') {
            justTouchedPan = true;
            setTimeout(() => { justTouchedPan = false; }, 100);
        } else if (e.type === 'click' && justTouchedPan) {
            return;
        }
        const enabled = audio.toggleCompassPan();
        compassPanBtn.classList.toggle('active', enabled);
    };

    compassPanBtn.addEventListener('click', handlePanToggle);
    compassPanBtn.addEventListener('touchend', handlePanToggle);
}

export function initTextureControls(audio: AudioEngine) {
    const noiseSummary = document.getElementById('noiseSummary')!;
    const noiseOptions = document.getElementById('noiseOptions')!;
    const noiseTypeBtns = noiseOptions.querySelectorAll('.noise-type-btn');
    const volumeSlider = document.getElementById('volumeSlider') as HTMLInputElement;
    const textureVolumeSlider = document.getElementById('textureVolumeSlider') as HTMLInputElement;

    // Noise type display names
    const noiseTypeNames: Record<string, string> = {
        off: 'Ambience',
        waves: 'Waves',
        rain: 'Rain',
        wind: 'Wind',
        fire: 'Fire'
    };

    // Update summary button and active states
    const updateNoiseUI = () => {
        const type = audio.getNoiseType();
        const isActive = audio.noiseEnabled;

        // Update summary text
        noiseSummary.textContent = isActive ? noiseTypeNames[type] : 'Ambience';
        noiseSummary.classList.toggle('active', isActive);

        // Update type button active states
        noiseTypeBtns.forEach(btn => {
            const btnType = (btn as HTMLElement).dataset.type;
            const isCurrentType = isActive ? btnType === type : btnType === 'off';
            btn.classList.toggle('active', isCurrentType);
        });
    };

    // Toggle options panel (with touch-safe handling)
    let justTouchedNoise = false;
    const toggleOptions = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (e.type === 'touchend') {
            justTouchedNoise = true;
            setTimeout(() => { justTouchedNoise = false; }, 100);
        } else if (e.type === 'click' && justTouchedNoise) {
            return;
        }

        noiseOptions.classList.toggle('expanded');
    };

    // Close options panel
    const closeOptions = () => {
        noiseOptions.classList.remove('expanded');
    };

    // Handle noise type selection (with touch-safe handling)
    let justTouchedNoiseType = false;
    const handleTypeSelect = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (e.type === 'touchend') {
            justTouchedNoiseType = true;
            setTimeout(() => { justTouchedNoiseType = false; }, 100);
        } else if (e.type === 'click' && justTouchedNoiseType) {
            return;
        }

        const btn = e.currentTarget as HTMLElement;
        const type = btn.dataset.type;

        if (type === 'off') {
            audio.setNoiseEnabled(false);
        } else if (type) {
            audio.setNoiseType(type as NoiseType);
            audio.setNoiseEnabled(true);
        }

        updateNoiseUI();
        closeOptions();
    };

    noiseSummary.addEventListener('click', toggleOptions);
    noiseSummary.addEventListener('touchend', toggleOptions);

    noiseTypeBtns.forEach(btn => {
        btn.addEventListener('click', handleTypeSelect);
        btn.addEventListener('touchend', handleTypeSelect);
    });

    // Prevent clicks on options panel from propagating to canvas
    noiseOptions.addEventListener('click', (e) => e.stopPropagation());
    noiseOptions.addEventListener('touchstart', (e) => e.stopPropagation());
    noiseOptions.addEventListener('touchend', (e) => e.stopPropagation());

    // Close options when clicking outside
    document.addEventListener('click', (e) => {
        const target = e.target as Element;
        if (!target.closest('.noise-control')) {
            closeOptions();
        }
    });

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

    // Initialize UI
    updateNoiseUI();
    textureVolumeSlider.value = String(Math.round(audio.getTextureVolume() * 100));
}

export function initRecordControls(audio: AudioEngine) {
    const recordBtn = document.getElementById('recordBtn')!;
    const recordIcon = recordBtn.querySelector('.record-icon')!;
    const recordTime = document.getElementById('recordTime')!;

    const recorder = new AudioRecorder(audio);

    // Update UI based on state
    recorder.setOnStateChange((state, duration) => {
        if (state === 'recording') {
            recordBtn.classList.add('recording');
            recordIcon.textContent = '■';
            recordTime.textContent = duration !== undefined
                ? AudioRecorder.formatDuration(duration)
                : '0:00';
        } else {
            recordBtn.classList.remove('recording');
            recordIcon.textContent = '●';
            recordTime.textContent = '';
        }
    });

    // Touch-safe handler
    let justTouched = false;
    const handleRecord = (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (e.type === 'touchend') {
            justTouched = true;
            setTimeout(() => { justTouched = false; }, 100);
        } else if (e.type === 'click' && justTouched) {
            return;
        }

        if (recorder.getState() === 'recording') {
            recorder.stop();
        } else {
            recorder.start();
        }
    };

    recordBtn.addEventListener('click', handleRecord);
    recordBtn.addEventListener('touchend', handleRecord);
}
