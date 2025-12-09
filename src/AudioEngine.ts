/**
 * AUDIO ENGINE - Multi-mode Synthesizer
 * Properly typed with voice limiting and input validation
 */

import {
    MAX_VOICES,
    MASTER_GAIN,
    AMBIENT_MASTER_GAIN,
    VOICE_GAIN,
    DELAY_FEEDBACK_NORMAL,
    DELAY_FEEDBACK_SHAKE,
    SHAKE_DURATION_MS,
    DELAY_TIME_LEFT,
    DELAY_TIME_RIGHT,
    FILTER_MIN_FREQ,
    FILTER_MAX_FREQ,
    FILTER_Q_DEFAULT,
    FFT_SIZE,
    ANALYSER_SMOOTHING,
    ANALYSER_MIN_DB,
    ANALYSER_MAX_DB,
    VOICE_CLEANUP_BUFFER_MS,
    KARPLUS_MIN_PLUCK_INTERVAL,
    KARPLUS_REPLUCK_INTERVAL,
    KARPLUS_BUFFER_POOL_SIZE,
    KARPLUS_SYMPATHETIC_RATIOS,
    KARPLUS_SYMPATHETIC_GAIN,
    KARPLUS_DECAY_MIN,
    KARPLUS_DECAY_MAX,
    AMBIENT_BASE_FREQ,
    AMBIENT_LFO_SLOW,
    AMBIENT_LFO_MEDIUM,
    AMBIENT_LOOP_INTERVAL,
    AMBIENT_TOUCH_TIMEOUT,
    AMBIENT_CHORDS,
    NOTE_NAMES,
    SCALE_PATTERNS,
    SHAKE_ACCELERATION_THRESHOLD,
    REVERB_PRESETS,
    REVERB_CYCLE,
    TOUCH_PROFILES,
    TOUCH_TAP_MAX_DURATION,
    TOUCH_PRESS_MAX_DURATION,
    DRONE_CHORD_TYPES,
    DRONE_FILTER_SWEEP_TIME,
    ARP_SPEED_MIN,
    ARP_SPEED_MAX,
    ARP_NOTE_DURATION,
    FORMANT_VOWELS,
    FORMANT_Q,
    FORMANT_TRANSITION_TIME,
    BASS_TEMPO_MIN,
    BASS_TEMPO_MAX,
    BASS_BASE_FREQ,
    BASS_PATTERNS,
    BASS_PATTERN_ORDER,
    clamp,
    type SynthesisMode,
    type ReverbLevel,
    type TouchCategory,
    type BassPattern,
    // Oneheart imports
    ONEHEART_MASTER_GAIN,
    ONEHEART_LOOP_INTERVAL,
    ONEHEART_BASE_FREQ,
    ONEHEART_LFO_SLOW,
    ONEHEART_LFO_MEDIUM,
    ONEHEART_REVERB,
    RELAXATION_REVERB,
    ONEHEART_PRESETS,
    type OneheartMood,
    // Texture imports
    NOISE_TEXTURE_SETTINGS,
    NOISE_TYPES,
    DEFAULT_TEXTURE_VOLUME,
    TAPE_HISS_SETTINGS,
    type NoiseType,
} from './constants';

// ============ TYPE DEFINITIONS ============

export type TouchId = number | string;

// Extend Window for Safari AudioContext
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

// Voice types for each synthesis mode
interface WavetableVoice {
    osc: OscillatorNode;
    gain: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
}

interface DroneVoiceOsc {
    osc: OscillatorNode;
    gain: GainNode;
    interval: number;
}

interface DroneVoice {
    oscs: DroneVoiceOsc[];
    masterGain: GainNode;
    filterEnv: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
}

interface FMVoice {
    carrier: OscillatorNode;
    carrierGain: GainNode;
    modulator: OscillatorNode;
    modulatorGain: GainNode;
}

interface ArpVoice {
    osc: OscillatorNode;
    gain: GainNode;
    currentStep: number;
    intervalId: ReturnType<typeof setInterval> | null;
    pattern: number[];
    baseFreq: number;
}

interface KarplusVoice {
    lastRepluck: number;
}

interface PooledBuffer {
    buffer: AudioBuffer;
    size: number;
    inUse: boolean;
}

interface FormantFilter {
    filter: BiquadFilterNode;
    gain: GainNode;
}

interface FormantVoice {
    source: OscillatorNode;
    noiseSource: AudioBufferSourceNode;
    noiseMix: GainNode;
    sourceMix: GainNode;
    formants: FormantFilter[];
    masterGain: GainNode;
    currentVowel: string;
}

interface BassState {
    osc: OscillatorNode;
    subOsc: OscillatorNode;
    gain: GainNode;
    subGain: GainNode;
    currentStep: number;
    intervalId: ReturnType<typeof setTimeout> | null;
    pattern: BassPattern;
    baseFreq: number;
    targetFreq: number;
    lastTempo: number;
    isActive: boolean;
}

interface AmbientDroneOsc {
    osc: OscillatorNode;
    gain: GainNode;
    baseDetune: number;
}

interface AmbientDroneVoice {
    oscs: AmbientDroneOsc[];
    voiceGain: GainNode;
    panner: StereoPannerNode;
    baseFreq: number;
    panBase: number;
    detunePhase: number;
    panPhase: number;
}

interface NoiseBed {
    source: AudioBufferSourceNode;
    bandpass: BiquadFilterNode;
    lowpass: BiquadFilterNode;
    gain: GainNode;
    panner: StereoPannerNode;
    filterPhase: number;
}

interface ShimmerPartial {
    osc: OscillatorNode;
    gain: GainNode;
    tremolo: OscillatorNode;
    tremoloGain: GainNode;
    ratio: number;
}

interface ShimmerLayer {
    partials: ShimmerPartial[];
    masterGain: GainNode;
}

interface AmbientState {
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    microPhase: number;
    mesoPhase: number;
    macroPhase: number;
    walkX: number;
    walkY: number;
    walkVelX: number;
    walkVelY: number;
    isActive: boolean;
    touchActive: boolean;
}

interface OrientationParams {
    pan: number;
    filterMod: number;
    lfoRate: number;
    shake: number;
    compass: number;  // Alpha (compass heading) 0-360
}

// ============ ONEHEART MODE INTERFACES ============

interface OneheartPadOsc {
    osc: OscillatorNode;
    gain: GainNode;
    baseDetune: number;
    panPosition: number;
}

interface OneheartPadVoice {
    oscs: OneheartPadOsc[];
    voiceGain: GainNode;
    panner: StereoPannerNode;
    noteFreq: number;
    detunePhase: number;
}

interface OneheartState {
    currentChordIndex: number;
    nextChordIndex: number;
    chordTransitionProgress: number;  // 0-1 during crossfade
    lastChordChange: number;          // Timestamp
    filterPhase: number;
    evolutionPhase: number;
    brightness: number;
    isActive: boolean;
}

interface OneheartNodes {
    pads: OneheartPadVoice[];
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    masterGain: GainNode;
}

interface TextureNodes {
    noiseBuffer: AudioBuffer;
    noiseSource: AudioBufferSourceNode | null;
    gain: GainNode;
    filter: BiquadFilterNode;
    filter2?: BiquadFilterNode;  // For bandpass (tape hiss)
    lfo?: OscillatorNode;        // LFO for wave-like modulation
    lfoGain?: GainNode;          // LFO depth control
}

interface NoteInfo {
    freq: number;
    semitone: number;
    noteName: string;
    octave: number;
    isQuantized: boolean;
}

// Node container types
interface WavetableNodes {
    voices: Map<TouchId, WavetableVoice>;
}

interface DroneNodes {
    voices: Map<TouchId, DroneVoice>;
}

interface FMNodes {
    voices: Map<TouchId, FMVoice>;
    ratio: number;
}

interface ArpNodes {
    voices: Map<TouchId, ArpVoice>;
}

interface KarplusNodes {
    voices: Map<TouchId, KarplusVoice>;
    lastPluck: number;
}

interface FormantNodes {
    voices: Map<TouchId, FormantVoice>;
}

interface AmbientNodes {
    drones: AmbientDroneVoice[];
    noiseBed: NoiseBed;
    shimmer: ShimmerLayer;
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    baseFreq: number;
    currentChordIndex: number;
    chordTransitionTime: number;
}

type ModeNodes = WavetableNodes | DroneNodes | FMNodes | ArpNodes | KarplusNodes | FormantNodes | AmbientNodes | OneheartNodes | Record<string, unknown>;

// ============ AUDIO ENGINE CLASS ============

export class AudioEngine {
    ctx: AudioContext | null = null;
    masterGain: GainNode | null = null;
    filter: BiquadFilterNode | null = null;
    panner: StereoPannerNode | null = null;
    delayFeedback: GainNode | null = null;
    analyser: AnalyserNode | null = null;
    isPlaying = false;
    dataArray: Float32Array | null = null;
    mode: SynthesisMode = 'focus';
    nodes: ModeNodes = {};
    touches = new Map<TouchId, unknown>();
    orientationParams: OrientationParams = { pan: 0, filterMod: 0, lfoRate: 0, shake: 0, compass: 0 };
    isQuantized = false;
    tonic = 9; // A
    scaleType = 'minor';
    scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    silentAudio: HTMLAudioElement;
    ambientState: AmbientState | null = null;
    ambientInterval: ReturnType<typeof setInterval> | null = null;
    ambientTouchTimeout: ReturnType<typeof setTimeout> | null = null;
    bassState: BassState | null = null;
    bassInterval: ReturnType<typeof setInterval> | null = null;

    // Oneheart mode state
    oneheartState: OneheartState | null = null;
    oneheartInterval: ReturnType<typeof setInterval> | null = null;
    oneheartMood: OneheartMood = 'focus';

    // Oneheart touch parameters
    private oneheartTargetNoiseMix = 0;     // Focus: X = texture
    private oneheartCurrentNoiseMix = 0;
    private oneheartTargetVoicing = 1.0;    // Focus: Y = voicing
    private oneheartCurrentVoicing = 1.0;
    private oneheartTargetDepth = 0;        // Relaxation: X = depth
    private oneheartCurrentDepth = 0;
    private oneheartTargetDrift = 0.3;      // Relaxation: Y = drift
    private oneheartCurrentDrift = 0.3;
    private oneheartIsTouching = false;
    private oneheartNoisePhase = 0;

    // Texture state
    noiseNodes: TextureNodes | null = null;
    tapeHissNodes: TextureNodes | null = null;
    noiseEnabled = false;
    tapeHissEnabled = false;
    noiseType: NoiseType = 'waves';
    textureVolume = DEFAULT_TEXTURE_VOLUME;

    // Buffer pool for Karplus-Strong to avoid repeated allocations
    private karplusBufferPool: PooledBuffer[] = [];

    // Reverb effect chain
    private convolver: ConvolverNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private reverbDryGain: GainNode | null = null;
    reverbLevel: ReverbLevel = 'off';
    private impulseResponses: Map<ReverbLevel, AudioBuffer> = new Map();

    // Touch envelope state
    private currentFilterFreq: number = FILTER_MAX_FREQ;
    private releaseFilterTarget: number = FILTER_MIN_FREQ;

    constructor() {
        // Silent audio for iOS unlock
        this.silentAudio = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNAAAAAAAAAAAAAAAAAAAA");
        this.silentAudio.loop = true;
    }

    init(): void {
        if (this.ctx) {
            try { this.ctx.close(); } catch (e) { /* ignore */ }
        }

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();

        // Master chain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0;

        // Analyser
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
        this.analyser.minDecibels = ANALYSER_MIN_DB;
        this.analyser.maxDecibels = ANALYSER_MAX_DB;
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);

        // Filter
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = FILTER_Q_DEFAULT;
        this.filter.frequency.value = FILTER_MAX_FREQ;

        // Panner
        this.panner = this.ctx.createStereoPanner();

        // Initialize reverb (creates convolver, wet/dry gains, impulse responses)
        this.initReverb();

        // Delay
        const delayL = this.ctx.createDelay();
        const delayR = this.ctx.createDelay();
        this.delayFeedback = this.ctx.createGain();
        delayL.delayTime.value = DELAY_TIME_LEFT;
        delayR.delayTime.value = DELAY_TIME_RIGHT;
        this.delayFeedback.gain.value = DELAY_FEEDBACK_NORMAL;

        // Routing with reverb
        // Signal flow: Filter → Panner → [Dry/Wet split] → MasterGain → Analyser → Destination
        this.filter.connect(this.panner);

        // Dry path: Panner → DryGain → MasterGain
        this.panner.connect(this.reverbDryGain!);
        this.reverbDryGain!.connect(this.masterGain);

        // Wet path: Panner → Convolver → WetGain → MasterGain
        this.panner.connect(this.convolver!);
        this.convolver!.connect(this.reverbWetGain!);
        this.reverbWetGain!.connect(this.masterGain);

        // Master output
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        // Delay feedback loop (from master)
        this.masterGain.connect(delayL);
        this.masterGain.connect(delayR);
        delayL.connect(this.delayFeedback);
        delayR.connect(this.delayFeedback);
        this.delayFeedback.connect(delayL);
        this.delayFeedback.connect(delayR);
        delayL.connect(this.analyser);
        delayR.connect(this.analyser);

        this.initMode(this.mode);
    }

    // ============ VOICE COUNT HELPERS ============

    private getVoiceCount(): number {
        if ('voices' in this.nodes && this.nodes.voices instanceof Map) {
            return this.nodes.voices.size;
        }
        return 0;
    }

    private canAddVoice(): boolean {
        return this.getVoiceCount() < MAX_VOICES;
    }

    // ============ MODE INITIALIZATION ============

    initMode(mode: SynthesisMode): void {
        this.cleanupMode();
        this.mode = mode;

        switch (mode) {
            case 'wavetable': this.initWavetable(); break;
            case 'drone': this.initDrone(); break;
            case 'fm': this.initFM(); break;
            case 'arpeggiator': this.initArpeggiator(); break;
            case 'karplus': this.initKarplus(); break;
            case 'formant': this.initFormant(); break;
            case 'ambient': this.initAmbient(); break;
            case 'bassline': this.initBassline(); break;
            case 'focus':
                this.oneheartMood = 'focus';
                this.initOneheart();
                break;
            case 'relaxation':
                this.oneheartMood = 'relaxation';
                this.initOneheart();
                break;
        }

        this.updateHUDLabels();
    }

    private cleanupOscillator(osc: OscillatorNode | null | undefined): void {
        if (!osc) return;
        // Disconnect first to remove from audio graph, then stop
        // This ensures cleanup even if stop() throws (already stopped)
        try { osc.disconnect(); } catch (e) { /* ignore */ }
        try { osc.stop(); } catch (e) { /* ignore */ }
    }

    private cleanupGain(gain: GainNode | null | undefined): void {
        if (!gain) return;
        try { gain.disconnect(); } catch (e) { /* ignore */ }
    }

    // ============ BUFFER POOL FOR KARPLUS-STRONG ============

    private getPooledBuffer(size: number): AudioBuffer | null {
        if (!this.ctx) return null;

        // Look for an available buffer of the right size
        for (const pooled of this.karplusBufferPool) {
            if (!pooled.inUse && pooled.size >= size && pooled.size <= size * 2) {
                pooled.inUse = true;
                return pooled.buffer;
            }
        }

        // Create a new buffer if pool isn't full
        if (this.karplusBufferPool.length < KARPLUS_BUFFER_POOL_SIZE) {
            const buffer = this.ctx.createBuffer(1, size, this.ctx.sampleRate);
            this.karplusBufferPool.push({ buffer, size, inUse: true });
            return buffer;
        }

        // Pool is full and no suitable buffer found - create temporary one
        return this.ctx.createBuffer(1, size, this.ctx.sampleRate);
    }

    private releasePooledBuffer(buffer: AudioBuffer): void {
        for (const pooled of this.karplusBufferPool) {
            if (pooled.buffer === buffer) {
                pooled.inUse = false;
                return;
            }
        }
        // Buffer wasn't in pool (temporary), let GC handle it
    }

    // ============ TOUCH CATEGORY DETECTION ============

    private getTouchCategory(duration: number): TouchCategory {
        if (duration < TOUCH_TAP_MAX_DURATION) return 'tap';
        if (duration < TOUCH_PRESS_MAX_DURATION) return 'press';
        return 'hold';
    }

    private applyReleaseEnvelope(duration: number): void {
        if (!this.ctx || !this.filter || !this.reverbWetGain) return;

        const category = this.getTouchCategory(duration);
        const profile = TOUCH_PROFILES[category];
        const now = this.ctx.currentTime;

        // Apply filter release shaping
        if (profile.brightnessHold) {
            // Tap: keep filter bright, then snap shut
            this.filter.frequency.setTargetAtTime(
                this.currentFilterFreq,
                now,
                profile.filterReleaseTime
            );
            // Quick close after a brief delay
            this.filter.frequency.setTargetAtTime(
                this.releaseFilterTarget,
                now + profile.releaseTime * 0.5,
                profile.filterReleaseTime
            );
        } else {
            // Press/Hold: gradually close filter
            this.filter.frequency.setTargetAtTime(
                this.releaseFilterTarget,
                now,
                profile.filterReleaseTime
            );
        }

        // Apply reverb boost for longer touches
        if (profile.reverbBoost > 0 && this.reverbLevel !== 'off') {
            const currentWet = REVERB_PRESETS[this.reverbLevel].wet;
            const boostedWet = Math.min(1, currentWet + profile.reverbBoost);

            // Boost reverb during release for longer tail
            this.reverbWetGain.gain.setTargetAtTime(boostedWet, now, 0.05);

            // Return to normal after release
            setTimeout(() => {
                if (this.ctx && this.reverbWetGain && this.reverbLevel !== 'off') {
                    this.reverbWetGain.gain.setTargetAtTime(
                        REVERB_PRESETS[this.reverbLevel].wet,
                        this.ctx.currentTime,
                        0.3
                    );
                }
            }, profile.releaseTime * 1000 + 200);
        }

        // Restore filter after release completes
        setTimeout(() => {
            if (this.ctx && this.filter && this.getVoiceCount() === 0) {
                this.filter.frequency.setTargetAtTime(
                    this.currentFilterFreq,
                    this.ctx.currentTime,
                    0.1
                );
            }
        }, profile.releaseTime * 1000 + 300);
    }

    // ============ CONVOLUTION REVERB ============

    private generateImpulseResponse(decayTime: number): AudioBuffer {
        if (!this.ctx) throw new Error('No audio context');

        const sampleRate = this.ctx.sampleRate;
        const length = Math.floor(sampleRate * decayTime);
        const buffer = this.ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);

            // Generate filtered noise (lowpass to make it more coherent)
            let prevSample = 0;
            const filterCoeff = 0.85; // Higher = more filtering = smoother

            for (let i = 0; i < length; i++) {
                // Exponential decay envelope
                const decay = Math.exp(-3 * i / length);

                // Generate lowpass-filtered noise for more coherent reverb
                const noise = Math.random() * 2 - 1;
                const filtered = prevSample * filterCoeff + noise * (1 - filterCoeff);
                prevSample = filtered;

                // Stereo decorrelation
                const stereoOffset = channel === 0 ? 1.0 : 0.93;
                data[i] = filtered * decay * stereoOffset;

                // Strong early reflections (first 100ms)
                if (i < sampleRate * 0.1) {
                    // Add discrete early reflections
                    const reflectionTimes = [0.01, 0.023, 0.037, 0.052, 0.071, 0.089];
                    for (const rt of reflectionTimes) {
                        const reflectionSample = Math.floor(rt * sampleRate);
                        if (i === reflectionSample) {
                            const reflectionGain = 0.7 * Math.exp(-rt * 10);
                            data[i] += (channel === 0 ? 1 : -1) * reflectionGain;
                        }
                    }
                }
            }

            // Normalize
            let maxVal = 0;
            for (let i = 0; i < length; i++) {
                maxVal = Math.max(maxVal, Math.abs(data[i]));
            }
            if (maxVal > 0) {
                const normalize = 1.0 / maxVal;
                for (let i = 0; i < length; i++) {
                    data[i] *= normalize;
                }
            }
        }

        return buffer;
    }

    private initReverb(): void {
        if (!this.ctx) return;

        // Create convolver
        this.convolver = this.ctx.createConvolver();

        // Create wet/dry mix gains
        this.reverbWetGain = this.ctx.createGain();
        this.reverbDryGain = this.ctx.createGain();

        // Generate impulse responses for each level
        for (const level of REVERB_CYCLE) {
            if (level !== 'off') {
                const preset = REVERB_PRESETS[level];
                const ir = this.generateImpulseResponse(preset.decay);
                this.impulseResponses.set(level, ir);
            }
        }

        // Set initial state (off)
        this.reverbWetGain.gain.value = 0;
        this.reverbDryGain.gain.value = 1;

        // Set default IR (on) so convolver is ready
        const defaultIR = this.impulseResponses.get('on');
        if (defaultIR) {
            this.convolver.buffer = defaultIR;
        }
    }

    setReverbLevel(level: ReverbLevel): void {
        if (!this.ctx || !this.reverbWetGain || !this.reverbDryGain || !this.convolver) return;

        const now = this.ctx.currentTime;
        const preset = REVERB_PRESETS[level];

        // Update wet/dry mix with smooth transition
        this.reverbWetGain.gain.setTargetAtTime(preset.wet, now, 0.1);
        this.reverbDryGain.gain.setTargetAtTime(preset.dry, now, 0.1);

        // Update impulse response if not off
        if (level !== 'off') {
            const ir = this.impulseResponses.get(level);
            if (ir) {
                this.convolver.buffer = ir;
            }
        }

        this.reverbLevel = level;
    }

    cycleReverb(): ReverbLevel {
        const currentIndex = REVERB_CYCLE.indexOf(this.reverbLevel);
        const nextIndex = (currentIndex + 1) % REVERB_CYCLE.length;
        const nextLevel = REVERB_CYCLE[nextIndex];
        this.setReverbLevel(nextLevel);
        return nextLevel;
    }

    /** Set reverb wet mix directly (for relaxation depth control) */
    setReverbWet(wet: number): void {
        if (!this.ctx || !this.reverbWetGain) return;
        const now = this.ctx.currentTime;
        this.reverbWetGain.gain.setTargetAtTime(clamp(wet, 0, 1), now, 0.3);
    }

    cleanupMode(): void {
        if (this.ambientInterval) {
            clearInterval(this.ambientInterval);
            this.ambientInterval = null;
        }
        if (this.ambientTouchTimeout) {
            clearTimeout(this.ambientTouchTimeout);
            this.ambientTouchTimeout = null;
        }
        if (this.bassInterval) {
            clearInterval(this.bassInterval);
            this.bassInterval = null;
        }
        if (this.oneheartInterval) {
            clearInterval(this.oneheartInterval);
            this.oneheartInterval = null;
        }
        if (this.oneheartState) {
            this.oneheartState = null;
        }

        // Cleanup oneheart pads
        if ('pads' in this.nodes && Array.isArray(this.nodes.pads)) {
            for (const pad of this.nodes.pads as OneheartPadVoice[]) {
                for (const o of pad.oscs) {
                    this.cleanupOscillator(o.osc);
                    this.cleanupGain(o.gain);
                }
                this.cleanupGain(pad.voiceGain);
                try { pad.panner.disconnect(); } catch (e) { /* ignore */ }
            }
        }
        // Cleanup oneheart master gain
        if ('masterGain' in this.nodes && this.nodes !== null && typeof this.nodes === 'object') {
            const n = this.nodes as OneheartNodes;
            if (n.masterGain) this.cleanupGain(n.masterGain);
        }
        if (this.bassState) {
            if (this.bassState.intervalId) {
                clearTimeout(this.bassState.intervalId);
            }
            this.cleanupOscillator(this.bassState.osc);
            this.cleanupOscillator(this.bassState.subOsc);
            this.cleanupGain(this.bassState.gain);
            this.cleanupGain(this.bassState.subGain);
            this.bassState = null;
        }

        // Cleanup wavetable/theremin/fm/chords voices
        if ('voices' in this.nodes && this.nodes.voices instanceof Map) {
            for (const voice of this.nodes.voices.values()) {
                const v = voice as Record<string, unknown>;
                this.cleanupOscillator(v.osc as OscillatorNode);
                this.cleanupOscillator(v.lfo as OscillatorNode);
                this.cleanupOscillator(v.vibrato as OscillatorNode);
                this.cleanupOscillator(v.carrier as OscillatorNode);
                this.cleanupOscillator(v.modulator as OscillatorNode);
                this.cleanupGain(v.gain as GainNode);
                this.cleanupGain(v.lfoGain as GainNode);
                this.cleanupGain(v.vibratoGain as GainNode);
                this.cleanupGain(v.carrierGain as GainNode);
                this.cleanupGain(v.modulatorGain as GainNode);

                // Cleanup oscs arrays (for formant, drone, etc.)
                if (Array.isArray(v.oscs)) {
                    for (const o of v.oscs) {
                        const oscObj = o as { osc?: OscillatorNode; gain?: GainNode };
                        if (oscObj.osc) this.cleanupOscillator(oscObj.osc);
                        if (oscObj.gain) this.cleanupGain(oscObj.gain);
                    }
                }
            }
        }

        // Cleanup ambient mode drones
        if ('drones' in this.nodes && Array.isArray(this.nodes.drones)) {
            for (const drone of this.nodes.drones as AmbientDroneVoice[]) {
                for (const o of drone.oscs) {
                    this.cleanupOscillator(o.osc);
                    this.cleanupGain(o.gain);
                }
                this.cleanupGain(drone.voiceGain);
                try { drone.panner.disconnect(); } catch (e) { /* ignore */ }
            }
        }

        // Cleanup noise bed
        if ('noiseBed' in this.nodes && this.nodes.noiseBed) {
            const nb = this.nodes.noiseBed as NoiseBed;
            try {
                nb.source.stop();
                nb.source.disconnect();
                nb.bandpass.disconnect();
                nb.lowpass.disconnect();
                nb.gain.disconnect();
                nb.panner.disconnect();
            } catch (e) { /* ignore */ }
        }

        // Cleanup shimmer
        if ('shimmer' in this.nodes && this.nodes.shimmer) {
            const sh = this.nodes.shimmer as ShimmerLayer;
            for (const p of sh.partials) {
                this.cleanupOscillator(p.osc);
                this.cleanupOscillator(p.tremolo);
                this.cleanupGain(p.gain);
                this.cleanupGain(p.tremoloGain);
            }
            this.cleanupGain(sh.masterGain);
        }

        // Cleanup LFOs
        if ('lfoSlow' in this.nodes) this.cleanupOscillator(this.nodes.lfoSlow as OscillatorNode);
        if ('lfoMedium' in this.nodes) this.cleanupOscillator(this.nodes.lfoMedium as OscillatorNode);
        if ('lfo' in this.nodes) this.cleanupOscillator(this.nodes.lfo as OscillatorNode);
        if ('lfo1' in this.nodes) this.cleanupOscillator(this.nodes.lfo1 as OscillatorNode);
        if ('lfo2' in this.nodes) this.cleanupOscillator(this.nodes.lfo2 as OscillatorNode);
        if ('noiseSource' in this.nodes) this.cleanupOscillator(this.nodes.noiseSource as OscillatorNode);

        this.nodes = {};
    }

    // ============ WAVETABLE MODE ============

    private initWavetable(): void {
        this.nodes = { voices: new Map<TouchId, WavetableVoice>() } as WavetableNodes;
    }

    private updateWavetable(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as WavetableNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return; // Voice limiting

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.value = 220;
            gain.gain.value = 0;

            lfo.frequency.value = 2;
            lfoGain.gain.value = 0;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.detune);

            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            lfo.start();

            nodes.voices.set(touchId, { osc, gain, lfo, lfoGain });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 55);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.005);
        voice.gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.005);

        // Y axis: waveform bands with modulation depth within each band
        // Each band is 0.25 of the Y range
        // Position within band (0-1) controls modulation depth
        let waveType: OscillatorType;
        let posInBand: number;

        if (y < 0.25) {
            waveType = 'sine';
            posInBand = y / 0.25;
        } else if (y < 0.5) {
            waveType = 'triangle';
            posInBand = (y - 0.25) / 0.25;
        } else if (y < 0.75) {
            waveType = 'sawtooth';
            posInBand = (y - 0.5) / 0.25;
        } else {
            waveType = 'square';
            posInBand = (y - 0.75) / 0.25;
        }

        voice.osc.type = waveType;

        // Modulation depth: bottom of band = 0, top of band = max (50 cents)
        const maxModDepth = 50;
        const modDepth = posInBand * maxModDepth;

        // LFO rate increases slightly with duration
        const durationFactor = Math.min(1, duration / 3);
        const lfoRate = 2 + durationFactor * 4;

        voice.lfoGain.gain.setTargetAtTime(modDepth, now, 0.05);
        voice.lfo.frequency.setTargetAtTime(lfoRate, now, 0.1);

        // Display frequency in Hz alongside note name
        const freqHz = Math.round(note.freq);
        const modIndicator = posInBand > 0.1 ? ' ~' : '';
        this.updateHUD(note.noteName + note.octave + ' ' + freqHz + 'Hz', waveType + modIndicator);
    }

    private stopWavetableVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as WavetableNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.gain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.lfoGain);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ DRONE/PAD MODE ============

    private initDrone(): void {
        this.nodes = { voices: new Map<TouchId, DroneVoice>() } as DroneNodes;
    }

    private getChordType(y: number): { name: string; intervals: readonly number[] } {
        const types = Object.entries(DRONE_CHORD_TYPES);
        const index = Math.floor(y * types.length);
        const [name, intervals] = types[Math.min(index, types.length - 1)];
        return { name, intervals };
    }

    private updateDrone(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as DroneNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;

            const chord = this.getChordType(y);
            const oscs: DroneVoiceOsc[] = [];

            const masterGain = this.ctx.createGain();
            masterGain.gain.value = 0;

            // LFO for gentle movement
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();
            lfo.type = 'sine';
            lfo.frequency.value = 0.2;
            lfoGain.gain.value = 3;
            lfo.connect(lfoGain);
            lfo.start();

            // Filter envelope gain for sweep effect
            const filterEnv = this.ctx.createGain();
            filterEnv.gain.value = 0;

            // Create oscillators for each chord note
            for (const interval of chord.intervals) {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.value = 110;
                gain.gain.value = 0.15 / chord.intervals.length;

                // Connect LFO for subtle detuning
                lfoGain.connect(osc.detune);

                osc.connect(gain);
                gain.connect(masterGain);
                osc.start();

                oscs.push({ osc, gain, interval });
            }

            masterGain.connect(this.filter);

            nodes.voices.set(touchId, { oscs, masterGain, filterEnv, lfo, lfoGain });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 2, 55);
        const chord = this.getChordType(y);

        // Update frequencies based on chord type
        voice.oscs.forEach((o, i) => {
            const interval = i < chord.intervals.length ? chord.intervals[i] : 0;
            const freq = note.freq * Math.pow(2, interval / 12);
            o.osc.frequency.setTargetAtTime(freq, now, 0.1);
            o.interval = interval;
        });

        // Duration affects filter sweep and richness
        const durationFactor = Math.min(1, duration / DRONE_FILTER_SWEEP_TIME);
        voice.lfoGain.gain.setTargetAtTime(2 + durationFactor * 8, now, 0.2);
        voice.lfo.frequency.setTargetAtTime(0.15 + durationFactor * 0.3, now, 0.3);

        // Fade in
        voice.masterGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.1);

        this.updateHUD(note.noteName + note.octave, chord.name + (durationFactor > 0.5 ? ' ~' : ''));
    }

    private stopDroneVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as DroneNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.masterGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            voice.oscs.forEach(o => {
                this.cleanupOscillator(o.osc);
                this.cleanupGain(o.gain);
            });
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.lfoGain);
            this.cleanupGain(voice.masterGain);
            this.cleanupGain(voice.filterEnv);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ FM SYNTHESIS MODE ============

    private initFM(): void {
        this.nodes = { voices: new Map<TouchId, FMVoice>(), ratio: 1 } as FMNodes;
    }

    private getFMRatio(y: number): { ratio: number; name: string } {
        // Y position selects FM ratio from 1:1 to 1:8 with musical names
        const ratios = [
            { ratio: 1, name: 'unison' },
            { ratio: 2, name: 'octave' },
            { ratio: 3, name: 'fifth+' },
            { ratio: 4, name: '2oct' },
            { ratio: 5, name: 'maj3+' },
            { ratio: 6, name: 'fifth++' },
            { ratio: 7, name: 'min7+' },
            { ratio: 8, name: '3oct' }
        ];
        const index = Math.floor(y * ratios.length);
        return ratios[Math.min(index, ratios.length - 1)];
    }

    private updateFM(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as FMNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;

            const carrier = this.ctx.createOscillator();
            const carrierGain = this.ctx.createGain();
            const modulator = this.ctx.createOscillator();
            const modulatorGain = this.ctx.createGain();

            carrier.type = 'sine';
            carrier.frequency.value = 220;
            modulator.type = 'sine';
            modulator.frequency.value = 220;
            carrierGain.gain.value = 0;
            modulatorGain.gain.value = 0;

            modulator.connect(modulatorGain);
            modulatorGain.connect(carrier.frequency);
            carrier.connect(carrierGain);
            carrierGain.connect(this.filter);

            carrier.start();
            modulator.start();

            nodes.voices.set(touchId, { carrier, carrierGain, modulator, modulatorGain });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 55);
        const carrierFreq = note.freq;

        // Y controls ratio, duration controls modulation index
        const { ratio, name } = this.getFMRatio(y);
        const durationFactor = Math.min(1, duration / 2);
        const modIndex = 1 + durationFactor * 8; // Index ranges 1-9 based on duration
        const modFreq = carrierFreq * ratio;

        voice.carrier.frequency.setTargetAtTime(carrierFreq, now, 0.02);
        voice.modulator.frequency.setTargetAtTime(modFreq, now, 0.02);
        voice.modulatorGain.gain.setTargetAtTime(modIndex * carrierFreq, now, 0.02);
        voice.carrierGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.02);

        this.updateHUD(note.noteName + note.octave, ratio + ':1 ' + name);
    }

    private stopFMVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as FMNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.carrierGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.carrier);
            this.cleanupOscillator(voice.modulator);
            this.cleanupGain(voice.carrierGain);
            this.cleanupGain(voice.modulatorGain);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ ARPEGGIATOR MODE ============

    private initArpeggiator(): void {
        this.nodes = { voices: new Map<TouchId, ArpVoice>() } as ArpNodes;
    }

    private getArpPattern(y: number): { pattern: number[]; name: string } {
        const patterns = [
            { pattern: [0, 4, 7, 12], name: 'up' },
            { pattern: [12, 7, 4, 0], name: 'down' },
            { pattern: [0, 4, 7, 12, 7, 4], name: 'updown' },
            { pattern: [0, 7, 4, 12], name: 'alt' }
        ];
        const index = Math.floor(y * patterns.length);
        return patterns[Math.min(index, patterns.length - 1)];
    }

    private updateArpeggiator(x: number, y: number, touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as ArpNodes;
        const now = this.ctx.currentTime;

        const note = this.quantizeToScale(x, 2, 110);
        const { pattern, name } = this.getArpPattern(y);

        // Speed based on duration: longer hold = faster arpeggio
        const durationFactor = Math.min(1, duration / 2);
        const speed = ARP_SPEED_MIN + durationFactor * (ARP_SPEED_MAX - ARP_SPEED_MIN);
        const intervalMs = 1000 / speed;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = note.freq;
            gain.gain.value = 0;

            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();

            const voice: ArpVoice = {
                osc,
                gain,
                currentStep: 0,
                intervalId: null,
                pattern: [...pattern],
                baseFreq: note.freq
            };

            // Start the arpeggio
            voice.intervalId = setInterval(() => {
                if (!this.ctx) return;
                const stepNow = this.ctx.currentTime;

                voice.currentStep = (voice.currentStep + 1) % voice.pattern.length;
                const semitones = voice.pattern[voice.currentStep];
                const freq = voice.baseFreq * Math.pow(2, semitones / 12);

                // Note envelope: quick attack, decay based on note duration
                voice.osc.frequency.setTargetAtTime(freq, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN * ARP_NOTE_DURATION, stepNow + intervalMs * 0.001 * 0.7, 0.02);
            }, intervalMs);

            // Initial note
            gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.01);

            nodes.voices.set(touchId, voice);
        } else {
            const voice = nodes.voices.get(touchId)!;

            // Update base frequency and pattern
            voice.baseFreq = note.freq;
            voice.pattern = [...pattern];

            // Update speed by restarting interval
            if (voice.intervalId) {
                clearInterval(voice.intervalId);
            }

            voice.intervalId = setInterval(() => {
                if (!this.ctx) return;
                const stepNow = this.ctx.currentTime;

                voice.currentStep = (voice.currentStep + 1) % voice.pattern.length;
                const semitones = voice.pattern[voice.currentStep];
                const freq = voice.baseFreq * Math.pow(2, semitones / 12);

                voice.osc.frequency.setTargetAtTime(freq, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN * ARP_NOTE_DURATION, stepNow + intervalMs * 0.001 * 0.7, 0.02);
            }, intervalMs);
        }

        this.updateHUD(note.noteName + note.octave, name + ' ' + Math.round(speed) + 'hz');
    }

    private stopArpVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as ArpNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;

        // Stop the interval
        if (voice.intervalId) {
            clearInterval(voice.intervalId);
            voice.intervalId = null;
        }

        voice.gain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupGain(voice.gain);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ KARPLUS-STRONG MODE ============

    private initKarplus(): void {
        this.nodes = { voices: new Map<TouchId, KarplusVoice>(), lastPluck: 0 } as KarplusNodes;
    }

    private pluckString(freq: number, brightness: number, decay: number, gain: number = 0.4): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as KarplusNodes;
        const now = this.ctx.currentTime;

        if (now - nodes.lastPluck < KARPLUS_MIN_PLUCK_INTERVAL) return;
        nodes.lastPluck = now;

        const bufferSize = Math.floor(this.ctx.sampleRate / freq);
        const buffer = this.getPooledBuffer(bufferSize);
        if (!buffer) return;

        const data = buffer.getChannelData(0);

        // Fill with noise and apply lowpass filter
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        for (let i = 1; i < bufferSize; i++) {
            data[i] = data[i] * brightness + data[i - 1] * (1 - brightness);
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const env = this.ctx.createGain();
        env.gain.setValueAtTime(gain, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + decay);

        const lpf = this.ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = freq * (1 + brightness * 3);

        source.connect(lpf);
        lpf.connect(env);
        env.connect(this.filter);
        source.start();
        source.stop(now + decay + 0.5);

        // Release buffer back to pool after sound finishes
        setTimeout(() => {
            try { source.disconnect(); env.disconnect(); lpf.disconnect(); } catch (e) { /* ignore */ }
            this.releasePooledBuffer(buffer);
        }, (decay + 1) * 1000);
    }

    private pluckSympathetic(baseFreq: number, brightness: number, decay: number): void {
        // Trigger sympathetic resonance on related strings
        for (const ratio of KARPLUS_SYMPATHETIC_RATIOS) {
            const sympatheticFreq = baseFreq * ratio;
            // Only trigger if in audible range
            if (sympatheticFreq < 4000) {
                // Delayed trigger with reduced gain
                setTimeout(() => {
                    this.pluckString(
                        sympatheticFreq,
                        brightness * 0.5,  // Softer attack
                        decay * 0.6,       // Shorter decay
                        KARPLUS_SYMPATHETIC_GAIN
                    );
                }, 20 + Math.random() * 30); // Slight random delay for natural feel
            }
        }
    }

    private updateKarplus(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        const nodes = this.nodes as KarplusNodes;
        const now = Date.now() / 1000;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;
            nodes.voices.set(touchId, { lastRepluck: 0 });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 110);

        // Y controls decay time instead of brightness
        const decay = KARPLUS_DECAY_MIN + y * (KARPLUS_DECAY_MAX - KARPLUS_DECAY_MIN);
        const brightness = 0.4 + (1 - y) * 0.4; // Brighter at top (shorter decay)

        if (duration < 0.2) {
            this.pluckString(note.freq, brightness, decay);
            // Trigger sympathetic strings on initial pluck
            this.pluckSympathetic(note.freq, brightness, decay);
            voice.lastRepluck = now;
        } else if (duration > 0.5 && now - voice.lastRepluck > KARPLUS_REPLUCK_INTERVAL) {
            this.pluckString(note.freq, brightness * 0.8, decay * 0.7);
            voice.lastRepluck = now;
        }

        const decayStr = y < 0.33 ? 'short' : y < 0.66 ? 'med' : 'long';
        const modeStr = duration > 0.5 ? 'bow' : 'pluck';
        this.updateHUD(note.noteName + note.octave, modeStr + ' ' + decayStr);
    }

    // ============ FORMANT/VOICE MODE ============

    private initFormant(): void {
        this.nodes = { voices: new Map<TouchId, FormantVoice>() } as FormantNodes;
    }

    private getVowel(y: number): { name: string; formants: readonly number[] } {
        const vowels = Object.entries(FORMANT_VOWELS);
        const index = Math.floor(y * vowels.length);
        const [name, formants] = vowels[Math.min(index, vowels.length - 1)];
        return { name, formants };
    }

    private createFormantVoice(freq: number): FormantVoice | null {
        if (!this.ctx || !this.filter) return null;

        // Create source oscillator (sawtooth for rich harmonics)
        const source = this.ctx.createOscillator();
        source.type = 'sawtooth';
        source.frequency.value = freq;

        // Create noise source for breath/consonant sounds
        const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.5, this.ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const noiseMix = this.ctx.createGain();
        noiseMix.gain.value = 0.02; // Subtle breath

        const sourceMix = this.ctx.createGain();
        sourceMix.gain.value = 0.8;

        // Create parallel formant filters
        const formants: FormantFilter[] = [];
        const masterGain = this.ctx.createGain();
        masterGain.gain.value = 0;

        const vowel = this.getVowel(0.5); // Start with middle vowel
        for (let i = 0; i < 3; i++) {
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.value = vowel.formants[i];
            filter.Q.value = FORMANT_Q[i];

            const gain = this.ctx.createGain();
            gain.gain.value = 0.4 / (i + 1); // Higher formants quieter

            // Connect both source and noise to filter
            source.connect(sourceMix);
            noiseSource.connect(noiseMix);
            sourceMix.connect(filter);
            noiseMix.connect(filter);
            filter.connect(gain);
            gain.connect(masterGain);

            formants.push({ filter, gain });
        }

        masterGain.connect(this.filter);
        source.start();
        noiseSource.start();

        return {
            source,
            noiseSource,
            noiseMix,
            sourceMix,
            formants,
            masterGain,
            currentVowel: vowel.name
        };
    }

    private updateFormant(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as FormantNodes;
        const now = this.ctx.currentTime;

        const note = this.quantizeToScale(x, 2, 55);
        const { name, formants: vowelFormants } = this.getVowel(y);

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;
            const voice = this.createFormantVoice(note.freq);
            if (!voice) return;
            nodes.voices.set(touchId, voice);
        }

        const voice = nodes.voices.get(touchId)!;

        // Update pitch
        voice.source.frequency.setTargetAtTime(note.freq, now, 0.02);

        // Update formant frequencies with smooth transition
        voice.formants.forEach((f, i) => {
            f.filter.frequency.setTargetAtTime(vowelFormants[i], now, FORMANT_TRANSITION_TIME);
        });

        // Duration affects breathiness and vibrato
        const durationFactor = Math.min(1, duration / 2);
        const breathiness = 0.02 + durationFactor * 0.05;
        voice.noiseMix.gain.setTargetAtTime(breathiness, now, 0.1);

        // Add vibrato with duration
        const vibratoDepth = durationFactor * 8;
        voice.source.detune.setTargetAtTime(
            Math.sin(now * 5) * vibratoDepth,
            now,
            0.05
        );

        // Fade in
        voice.masterGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.05);
        voice.currentVowel = name;

        this.updateHUD(note.noteName + note.octave, name + (durationFactor > 0.3 ? ' ~' : ''));
    }

    private stopFormantVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as FormantNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.masterGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.source);
            try { voice.noiseSource.stop(); voice.noiseSource.disconnect(); } catch (e) { /* ignore */ }
            this.cleanupGain(voice.noiseMix);
            this.cleanupGain(voice.sourceMix);
            voice.formants.forEach(f => {
                try { f.filter.disconnect(); } catch (e) { /* ignore */ }
                this.cleanupGain(f.gain);
            });
            this.cleanupGain(voice.masterGain);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ AMBIENT MODE v2 ============

    private initAmbient(): void {
        if (!this.ctx || !this.filter) return;

        this.ambientState = {
            x: 0.5,
            y: 0.5,
            targetX: 0.5,
            targetY: 0.5,
            microPhase: Math.random() * Math.PI * 2,
            mesoPhase: Math.random() * Math.PI * 2,
            macroPhase: Math.random() * Math.PI * 2,
            walkX: 0.5,
            walkY: 0.5,
            walkVelX: 0,
            walkVelY: 0,
            isActive: false,
            touchActive: false
        };

        const drones: AmbientDroneVoice[] = [];
        const droneCount = 4;
        const baseFreq = AMBIENT_BASE_FREQ;
        const voiceRatios = [1, 1.5, 2, 3];
        const panPositions = [-0.6, -0.2, 0.2, 0.6];

        for (let v = 0; v < droneCount; v++) {
            const drone = this.createAmbientDroneVoice(baseFreq * voiceRatios[v], panPositions[v]);
            if (drone) drones.push(drone);
        }

        const noiseBed = this.createNoiseBed();
        const shimmer = this.createShimmerLayer(baseFreq);

        const lfoSlow = this.ctx.createOscillator();
        lfoSlow.type = 'sine';
        lfoSlow.frequency.value = AMBIENT_LFO_SLOW;
        lfoSlow.start();

        const lfoMedium = this.ctx.createOscillator();
        lfoMedium.type = 'sine';
        lfoMedium.frequency.value = AMBIENT_LFO_MEDIUM;
        lfoMedium.start();

        this.nodes = {
            drones,
            noiseBed,
            shimmer,
            lfoSlow,
            lfoMedium,
            baseFreq,
            currentChordIndex: 0,
            chordTransitionTime: 0
        } as AmbientNodes;

        this.startAmbientLoop();
    }

    private createAmbientDroneVoice(freq: number, panPosition: number): AmbientDroneVoice | null {
        if (!this.ctx || !this.filter) return null;

        const oscs: AmbientDroneOsc[] = [];
        const detuneAmounts = [-3, 0, 3];

        const voiceGain = this.ctx.createGain();
        voiceGain.gain.value = 0;

        const panner = this.ctx.createStereoPanner();
        panner.pan.value = panPosition;

        voiceGain.connect(panner);
        panner.connect(this.filter);

        for (let i = 0; i < 3; i++) {
            const osc = this.ctx.createOscillator();
            const oscGain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.detune.value = detuneAmounts[i];
            oscGain.gain.value = 0.25;

            osc.connect(oscGain);
            oscGain.connect(voiceGain);
            osc.start();

            oscs.push({ osc, gain: oscGain, baseDetune: detuneAmounts[i] });
        }

        return {
            oscs,
            voiceGain,
            panner,
            baseFreq: freq,
            panBase: panPosition,
            detunePhase: Math.random() * Math.PI * 2,
            panPhase: Math.random() * Math.PI * 2
        };
    }

    private createNoiseBed(): NoiseBed | null {
        if (!this.ctx || !this.filter) return null;

        const bufferSize = this.ctx.sampleRate * 2;
        const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);

        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + white * 0.0990460;
            b1 = 0.96300 * b1 + white * 0.2965164;
            b2 = 0.57000 * b2 + white * 1.0526913;
            data[i] = (b0 + b1 + b2) * 0.08;
        }

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const bandpass = this.ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 300;
        bandpass.Q.value = 0.5;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 800;

        const noiseGain = this.ctx.createGain();
        noiseGain.gain.value = 0;

        const noisePanner = this.ctx.createStereoPanner();
        noisePanner.pan.value = 0;

        noiseSource.connect(bandpass);
        bandpass.connect(lowpass);
        lowpass.connect(noiseGain);
        noiseGain.connect(noisePanner);
        noisePanner.connect(this.filter);
        noiseSource.start();

        return {
            source: noiseSource,
            bandpass,
            lowpass,
            gain: noiseGain,
            panner: noisePanner,
            filterPhase: Math.random() * Math.PI * 2
        };
    }

    private createShimmerLayer(baseFreq: number): ShimmerLayer | null {
        if (!this.ctx || !this.filter) return null;

        const partials: ShimmerPartial[] = [];
        const partialRatios = [3, 4, 5];

        const shimmerGain = this.ctx.createGain();
        shimmerGain.gain.value = 0;
        shimmerGain.connect(this.filter);

        for (let i = 0; i < partialRatios.length; i++) {
            const osc = this.ctx.createOscillator();
            const oscGain = this.ctx.createGain();
            const tremolo = this.ctx.createOscillator();
            const tremoloGain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = baseFreq * partialRatios[i];
            oscGain.gain.value = 0.015 / (i + 1);

            tremolo.type = 'sine';
            tremolo.frequency.value = 0.3 + Math.random() * 0.5;
            tremoloGain.gain.value = oscGain.gain.value * 0.3;

            tremolo.connect(tremoloGain);
            tremoloGain.connect(oscGain.gain);

            osc.connect(oscGain);
            oscGain.connect(shimmerGain);

            osc.start();
            tremolo.start();

            partials.push({
                osc,
                gain: oscGain,
                tremolo,
                tremoloGain,
                ratio: partialRatios[i]
            });
        }

        return { partials, masterGain: shimmerGain };
    }

    private startAmbientLoop(): void {
        if (!this.ctx || !this.masterGain) return;

        if (this.ambientInterval) clearInterval(this.ambientInterval);

        const now = this.ctx.currentTime;
        const nodes = this.nodes as AmbientNodes;

        this.masterGain.gain.setTargetAtTime(AMBIENT_MASTER_GAIN, now, 1.5);

        nodes.drones.forEach((drone, i) => {
            const level = i === 0 ? 0.10 : 0.06;
            drone.voiceGain.gain.setTargetAtTime(level, now + i * 0.5, 1.2);
        });

        if (nodes.noiseBed) {
            nodes.noiseBed.gain.gain.setTargetAtTime(0.025, now + 1.0, 2.0);
        }

        if (nodes.shimmer) {
            nodes.shimmer.masterGain.gain.setTargetAtTime(0.04, now + 1.5, 2.0);
        }

        if (this.ambientState) {
            this.ambientState.isActive = true;
        }
        this.isPlaying = true;

        this.ambientInterval = setInterval(() => {
            if (this.mode !== 'ambient' || !this.ctx) {
                if (this.ambientInterval) clearInterval(this.ambientInterval);
                return;
            }
            this.evolveAmbient();
        }, AMBIENT_LOOP_INTERVAL);
    }

    private evolveAmbient(): void {
        if (!this.ctx || !this.ambientState) return;

        const now = this.ctx.currentTime;
        const state = this.ambientState;
        const nodes = this.nodes as AmbientNodes;
        const dt = 0.016;

        state.microPhase += dt * 0.8;
        state.mesoPhase += dt * 0.08;
        state.macroPhase += dt * 0.008;

        state.walkVelX += (Math.random() - 0.5) * 0.0008;
        state.walkVelY += (Math.random() - 0.5) * 0.0008;
        state.walkVelX *= 0.98;
        state.walkVelY *= 0.98;
        state.walkX += state.walkVelX;
        state.walkY += state.walkVelY;

        if (state.walkX < 0.1) state.walkVelX += 0.001;
        if (state.walkX > 0.9) state.walkVelX -= 0.001;
        if (state.walkY < 0.1) state.walkVelY += 0.001;
        if (state.walkY > 0.9) state.walkVelY -= 0.001;
        state.walkX = clamp(state.walkX, 0, 1);
        state.walkY = clamp(state.walkY, 0, 1);

        const macroInfluence = 0.3;
        const walkInfluence = 0.4;
        const touchInfluence = state.touchActive ? 0.5 : 0.1;

        const macroDriftX = 0.5 + Math.sin(state.macroPhase) * 0.3;
        const macroDriftY = 0.5 + Math.cos(state.macroPhase * 0.7) * 0.3;

        const blendedX = macroDriftX * macroInfluence + state.walkX * walkInfluence + state.targetX * touchInfluence;
        const blendedY = macroDriftY * macroInfluence + state.walkY * walkInfluence + state.targetY * touchInfluence;

        state.x += (blendedX - state.x) * 0.02;
        state.y += (blendedY - state.y) * 0.02;

        const baseFreq = 55 + state.x * 110;

        nodes.drones.forEach((drone, i) => {
            drone.detunePhase += dt * (0.1 + i * 0.03);
            drone.panPhase += dt * (0.05 + i * 0.02);

            const mesoMod = Math.sin(state.mesoPhase + i * 0.5) * 1;
            const freqRatio = drone.baseFreq / nodes.baseFreq;
            const newFreq = baseFreq * freqRatio;

            drone.oscs.forEach((o, j) => {
                o.osc.frequency.setTargetAtTime(newFreq, now, 0.5);
                const detuneWander = Math.sin(drone.detunePhase + j * 2) * 1.5;
                const targetDetune = o.baseDetune + detuneWander + mesoMod;
                o.osc.detune.setTargetAtTime(targetDetune, now, 0.4);
            });

            const panWander = Math.sin(drone.panPhase) * 0.08;
            const newPan = clamp(drone.panBase + panWander, -1, 1);
            drone.panner.pan.setTargetAtTime(newPan, now, 0.5);

            const breatheMod = 0.92 + Math.sin(state.mesoPhase + i * 0.7) * 0.08;
            const baseLevel = i === 0 ? 0.10 : 0.06;
            const yMod = i > 1 ? (1 - state.y * 0.2) : 1;
            drone.voiceGain.gain.setTargetAtTime(baseLevel * breatheMod * yMod, now, 0.3);
        });

        if (nodes.noiseBed) {
            const noise = nodes.noiseBed;
            noise.filterPhase += dt * 0.03;

            const noiseCenter = 200 + state.y * 200 + Math.sin(noise.filterPhase) * 50;
            noise.bandpass.frequency.setTargetAtTime(noiseCenter, now, 0.8);
            noise.bandpass.Q.setTargetAtTime(0.5 + state.y * 0.5, now, 0.5);

            const noiseLevel = 0.015 + state.y * 0.025;
            noise.gain.gain.setTargetAtTime(noiseLevel, now, 0.4);

            const noisePan = Math.sin(noise.filterPhase * 0.2) * 0.2;
            noise.panner.pan.setTargetAtTime(noisePan, now, 0.5);
        }

        if (nodes.shimmer) {
            const shimmer = nodes.shimmer;
            shimmer.partials.forEach((p, i) => {
                const shimmerFreq = baseFreq * p.ratio;
                p.osc.frequency.setTargetAtTime(shimmerFreq, now, 0.5);

                const shimmerLevel = (0.008 + state.y * 0.015) / (i + 1);
                p.gain.gain.setTargetAtTime(shimmerLevel, now, 0.5);

                const tremoloRate = 0.3 + Math.sin(state.mesoPhase + i) * 0.2;
                p.tremolo.frequency.setTargetAtTime(tremoloRate, now, 0.8);
            });

            const shimmerMaster = 0.02 + state.y * 0.04;
            shimmer.masterGain.gain.setTargetAtTime(shimmerMaster, now, 0.5);
        }

        const noteName = this.getNoteName(Math.round(12 * Math.log2(baseFreq / 55)) + 9);
        const moodWord = state.y < 0.33 ? 'deep' : state.y < 0.66 ? 'calm' : 'airy';
        this.updateHUD(noteName + ' ' + Math.round(baseFreq) + 'Hz', moodWord + ' ' + (state.touchActive ? '◉' : '○'));
    }

    private updateAmbient(x: number, y: number, duration = 0): void {
        if (!this.ambientState || !this.ctx) return;

        const state = this.ambientState;
        const nodes = this.nodes as AmbientNodes;
        const now = this.ctx.currentTime;
        const influence = Math.min(1, 0.4 + duration * 0.4);
        state.targetX = state.targetX * (1 - influence) + x * influence;
        state.targetY = state.targetY * (1 - influence) + y * influence;

        // Trigger chord change on new touch (when not already active)
        if (!state.touchActive) {
            // Cycle to next chord
            nodes.currentChordIndex = (nodes.currentChordIndex + 1) % AMBIENT_CHORDS.length;
            nodes.chordTransitionTime = now;

            // Apply new chord intervals to drones
            const chord = AMBIENT_CHORDS[nodes.currentChordIndex];
            const baseFreq = 55 + state.x * 110;

            nodes.drones.forEach((drone, i) => {
                if (i < chord.length) {
                    const chordInterval = chord[i];
                    const newFreq = baseFreq * Math.pow(2, chordInterval / 12);
                    drone.oscs.forEach(o => {
                        o.osc.frequency.setTargetAtTime(newFreq, now, 0.3);
                    });
                    drone.baseFreq = newFreq;
                }
            });
        }

        state.touchActive = true;

        if (this.ambientTouchTimeout) clearTimeout(this.ambientTouchTimeout);
        this.ambientTouchTimeout = setTimeout(() => {
            if (this.ambientState) this.ambientState.touchActive = false;
        }, AMBIENT_TOUCH_TIMEOUT);
    }

    // ============ BASSLINE MODE (Continuous Ostinato) ============

    private initBassline(): void {
        if (!this.ctx || !this.filter) return;

        // Create persistent bass oscillators
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = BASS_BASE_FREQ;
        gain.gain.value = 0;

        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.value = BASS_BASE_FREQ / 2;
        subGain.gain.value = 0;

        osc.connect(gain);
        subOsc.connect(subGain);
        gain.connect(this.filter);
        subGain.connect(this.filter);

        osc.start();
        subOsc.start();

        this.bassState = {
            osc,
            subOsc,
            gain,
            subGain,
            currentStep: 0,
            intervalId: null,
            pattern: 'pulse',
            baseFreq: BASS_BASE_FREQ,
            targetFreq: BASS_BASE_FREQ,
            lastTempo: 120,
            isActive: false
        };

        // Start the continuous bass loop
        this.startBassLoop();
    }

    private getBassPattern(y: number): BassPattern {
        const index = Math.floor(y * BASS_PATTERN_ORDER.length);
        return BASS_PATTERN_ORDER[Math.min(index, BASS_PATTERN_ORDER.length - 1)];
    }

    private getTempoFromCompass(): number {
        const compass = this.orientationParams.compass;
        const normalized = compass / 360;
        return BASS_TEMPO_MIN + normalized * (BASS_TEMPO_MAX - BASS_TEMPO_MIN);
    }

    private startBassLoop(): void {
        if (!this.ctx || !this.masterGain || !this.bassState) return;

        const now = this.ctx.currentTime;
        this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.5);
        this.bassState.isActive = true;
        this.isPlaying = true;

        // Start the sequencer
        this.scheduleBassStep();

        // Update tempo from compass periodically
        this.bassInterval = setInterval(() => {
            if (this.mode !== 'bassline' || !this.bassState) {
                if (this.bassInterval) clearInterval(this.bassInterval);
                return;
            }
            this.updateBassHUD();
        }, 100);
    }

    private scheduleBassStep(): void {
        if (!this.ctx || !this.bassState) return;

        const state = this.bassState;
        const pattern = BASS_PATTERNS[state.pattern];
        const tempo = this.getTempoFromCompass();
        const beatDuration = 60 / tempo;
        const totalPatternDuration = beatDuration * 1000;

        const stepData = pattern[state.currentStep];
        const semitoneOffset = stepData[0];
        const stepDuration = stepData[1] * totalPatternDuration;

        // Smoothly interpolate to target frequency
        state.baseFreq += (state.targetFreq - state.baseFreq) * 0.3;

        // Play the note
        this.playBassNote(state, semitoneOffset);

        // Schedule next step
        state.intervalId = setTimeout(() => {
            if (!this.bassState) return;
            this.bassState.currentStep = (this.bassState.currentStep + 1) % pattern.length;
            this.scheduleBassStep();
        }, stepDuration);
    }

    private playBassNote(state: BassState, semitoneOffset: number): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const freq = state.baseFreq * Math.pow(2, semitoneOffset / 12);
        const subFreq = freq / 2;

        // Quick attack envelope for punchy bass
        state.osc.frequency.setTargetAtTime(freq, now, 0.005);
        state.subOsc.frequency.setTargetAtTime(subFreq, now, 0.005);

        // Punch envelope: quick attack, medium decay
        state.gain.gain.cancelScheduledValues(now);
        state.gain.gain.setValueAtTime(0.001, now);
        state.gain.gain.linearRampToValueAtTime(VOICE_GAIN * 0.8, now + 0.01);
        state.gain.gain.exponentialRampToValueAtTime(VOICE_GAIN * 0.3, now + 0.15);

        state.subGain.gain.cancelScheduledValues(now);
        state.subGain.gain.setValueAtTime(0.001, now);
        state.subGain.gain.linearRampToValueAtTime(VOICE_GAIN * 0.6, now + 0.01);
        state.subGain.gain.exponentialRampToValueAtTime(VOICE_GAIN * 0.25, now + 0.2);
    }

    private updateBassline(x: number, y: number): void {
        if (!this.bassState || !this.ctx) return;

        // X controls root note (morph target)
        const note = this.quantizeToScale(x, 2, BASS_BASE_FREQ);
        this.bassState.targetFreq = note.freq;

        // Y controls pattern - change pattern on touch
        const newPattern = this.getBassPattern(y);
        if (newPattern !== this.bassState.pattern) {
            this.bassState.pattern = newPattern;
            this.bassState.currentStep = 0; // Reset to start of new pattern
        }

        this.updateBassHUD();
    }

    private updateBassHUD(): void {
        if (!this.bassState) return;

        const tempo = this.getTempoFromCompass();
        const noteName = this.getNoteName(Math.round(12 * Math.log2(this.bassState.baseFreq / BASS_BASE_FREQ)));
        const octave = Math.floor(Math.log2(this.bassState.baseFreq / BASS_BASE_FREQ)) + 1;
        const bpmStr = Math.round(tempo) + ' BPM';

        this.updateHUD(noteName + octave, this.bassState.pattern + ' ' + bpmStr);
    }

    // ============ ONEHEART MODE ============

    private initOneheart(): void {
        if (!this.ctx || !this.filter) return;

        const preset = ONEHEART_PRESETS[this.oneheartMood];
        const chords = preset.chords;

        this.oneheartState = {
            currentChordIndex: 0,
            nextChordIndex: 1,
            chordTransitionProgress: 0,
            lastChordChange: Date.now(),
            filterPhase: 0,
            evolutionPhase: Math.random() * Math.PI * 2,
            brightness: preset.brightness,
            isActive: false
        };

        // Create pad voices for each note in the first chord
        const pads: OneheartPadVoice[] = [];
        const chord = chords[0];

        for (let i = 0; i < chord.length; i++) {
            const semitone = chord[i];
            const freq = ONEHEART_BASE_FREQ * Math.pow(2, semitone / 12);
            const pad = this.createOneheartPadVoice(freq, i, chord.length);
            if (pad) pads.push(pad);
        }

        // Create LFOs for modulation
        const lfoSlow = this.ctx.createOscillator();
        lfoSlow.type = 'sine';
        lfoSlow.frequency.value = ONEHEART_LFO_SLOW;
        lfoSlow.start();

        const lfoMedium = this.ctx.createOscillator();
        lfoMedium.type = 'sine';
        lfoMedium.frequency.value = ONEHEART_LFO_MEDIUM;
        lfoMedium.start();

        // Create master gain for oneheart mode
        const oneheartMaster = this.ctx.createGain();
        oneheartMaster.gain.value = 0;
        oneheartMaster.connect(this.filter);

        this.nodes = {
            pads,
            lfoSlow,
            lfoMedium,
            masterGain: oneheartMaster
        } as OneheartNodes;

        // Set long reverb for Oneheart mode
        this.setOneheartReverb();
        this.reverbLevel = 'on'; // Mark reverb as active for UI

        // Enable waves noise by default with low texture volume
        this.textureVolume = 0.2; // 20% texture volume
        if (!this.noiseEnabled) {
            this.startNoise();
            this.noiseEnabled = true;
        }

        // Start the evolution loop
        this.startOneheartLoop();
    }

    private createOneheartPadVoice(freq: number, index: number, totalNotes: number): OneheartPadVoice | null {
        if (!this.ctx || !this.filter) return null;

        const preset = ONEHEART_PRESETS[this.oneheartMood];
        const oscs: OneheartPadOsc[] = [];
        const numOscs = 4; // 4 oscillators per pad voice for rich sound

        // Create voice gain
        const voiceGain = this.ctx.createGain();
        voiceGain.gain.value = 0;

        // Create panner for stereo spread
        const panner = this.ctx.createStereoPanner();
        // Spread notes across stereo field
        const panPosition = (index / (totalNotes - 1)) * 1.2 - 0.6; // -0.6 to 0.6
        panner.pan.value = totalNotes > 1 ? panPosition : 0;

        voiceGain.connect(panner);

        // Get the oneheart master gain from nodes if available
        const nodes = this.nodes as OneheartNodes;
        if (nodes.masterGain) {
            panner.connect(nodes.masterGain);
        } else {
            panner.connect(this.filter);
        }

        // Create detuned oscillators
        for (let i = 0; i < numOscs; i++) {
            const osc = this.ctx.createOscillator();
            const oscGain = this.ctx.createGain();

            // Mix of sine (warm) and triangle (presence)
            osc.type = i < 2 ? 'sine' : 'triangle';
            osc.frequency.value = freq;

            // Detune spread: -12 to +12 cents based on preset
            const detuneSpread = preset.detuneAmount;
            const baseDetune = ((i / (numOscs - 1)) * 2 - 1) * detuneSpread;
            osc.detune.value = baseDetune;

            // Quieter for sine oscillators, louder for triangle
            const gainValue = osc.type === 'sine' ? 0.15 : 0.08;
            oscGain.gain.value = gainValue;

            osc.connect(oscGain);
            oscGain.connect(voiceGain);
            osc.start();

            oscs.push({
                osc,
                gain: oscGain,
                baseDetune,
                panPosition: (i / (numOscs - 1)) * 0.4 - 0.2
            });
        }

        return {
            oscs,
            voiceGain,
            panner,
            noteFreq: freq,
            detunePhase: Math.random() * Math.PI * 2
        };
    }

    private setOneheartReverb(): void {
        if (!this.ctx || !this.convolver || !this.reverbWetGain || !this.reverbDryGain) return;

        // Select reverb based on mood (relaxation has longer, wetter reverb)
        const reverb = this.oneheartMood === 'relaxation' ? RELAXATION_REVERB : ONEHEART_REVERB;

        // Generate impulse response for selected reverb
        const ir = this.generateImpulseResponse(reverb.decay);
        this.convolver.buffer = ir;

        // Set wet/dry mix
        const now = this.ctx.currentTime;
        this.reverbWetGain.gain.setTargetAtTime(reverb.wet, now, 0.5);
        this.reverbDryGain.gain.setTargetAtTime(reverb.dry, now, 0.5);
    }

    private startOneheartLoop(): void {
        if (!this.ctx || !this.masterGain) return;

        const now = this.ctx.currentTime;
        const nodes = this.nodes as OneheartNodes;

        // Fade in master gain over 3 seconds
        this.masterGain.gain.setTargetAtTime(ONEHEART_MASTER_GAIN, now, 1.0);

        // Fade in pad voices with staggered timing
        nodes.pads.forEach((pad, i) => {
            const delay = i * 0.5; // Stagger by 0.5 seconds
            pad.voiceGain.gain.setTargetAtTime(0.18, now + delay, 2.0);
        });

        // Fade in oneheart master
        nodes.masterGain.gain.setTargetAtTime(1.0, now, 1.5);

        if (this.oneheartState) {
            this.oneheartState.isActive = true;
        }
        this.isPlaying = true;

        // Start the evolution loop
        this.oneheartInterval = setInterval(() => {
            if ((this.mode !== 'focus' && this.mode !== 'relaxation') || !this.ctx) {
                if (this.oneheartInterval) clearInterval(this.oneheartInterval);
                return;
            }
            this.evolveOneheart();
        }, ONEHEART_LOOP_INTERVAL);
    }

    private evolveOneheart(): void {
        if (!this.ctx || !this.oneheartState) return;

        const now = this.ctx.currentTime;
        const state = this.oneheartState;
        const nodes = this.nodes as OneheartNodes;
        const preset = ONEHEART_PRESETS[this.oneheartMood];
        const dt = ONEHEART_LOOP_INTERVAL / 1000;
        const isRelaxation = this.oneheartMood === 'relaxation';

        // Update evolution phase (slow sine wave for breathing effect)
        state.evolutionPhase += dt * 0.1 * preset.evolutionSpeed;
        state.filterPhase += dt * 0.05;
        this.oneheartNoisePhase += dt * 0.15;

        // Smoothly interpolate parameters based on mood
        const interpSpeed = this.oneheartIsTouching ? 0.08 : 0.02;

        if (isRelaxation) {
            this.oneheartCurrentDepth += (this.oneheartTargetDepth - this.oneheartCurrentDepth) * interpSpeed;
            this.oneheartCurrentDrift += (this.oneheartTargetDrift - this.oneheartCurrentDrift) * interpSpeed;
        } else {
            this.oneheartCurrentNoiseMix += (this.oneheartTargetNoiseMix - this.oneheartCurrentNoiseMix) * interpSpeed;
            this.oneheartCurrentVoicing += (this.oneheartTargetVoicing - this.oneheartCurrentVoicing) * interpSpeed;
        }

        // Check if it's time for a chord change
        const timeSinceChordChange = Date.now() - state.lastChordChange;
        if (timeSinceChordChange > preset.chordDuration) {
            this.triggerOneheartChordChange();
        }

        // Calculate drift-influenced modulation depth for relaxation
        const driftMod = isRelaxation ? this.oneheartCurrentDrift : 0.5;
        const breatheAmount = 0.1 + driftMod * 0.15;
        const breatheMod = 1 - breatheAmount + Math.sin(state.evolutionPhase) * breatheAmount;

        nodes.pads.forEach((pad, padIndex) => {
            // Slowly evolve detune for organic movement (faster with drift)
            const detuneSpeed = isRelaxation ? 0.05 + this.oneheartCurrentDrift * 0.1 : 0.08;
            pad.detunePhase += dt * (detuneSpeed + padIndex * 0.02);

            pad.oscs.forEach((o, oscIndex) => {
                // Detune drift (more with relaxation drift)
                const detuneDriftAmount = isRelaxation ? 2 + this.oneheartCurrentDrift * 4 : 2;
                const detuneDrift = Math.sin(pad.detunePhase + oscIndex * 1.5) * detuneDriftAmount;
                o.osc.detune.setTargetAtTime(o.baseDetune + detuneDrift, now, 0.5);

                // Subtle gain modulation (breathing)
                const baseGain = o.osc.type === 'sine' ? 0.15 : 0.08;
                const modGain = baseGain * breatheMod;
                o.gain.gain.setTargetAtTime(modGain, now, 0.3);
            });

            // Panning drift (more stereo movement with drift)
            const panDriftAmount = isRelaxation ? 0.1 + this.oneheartCurrentDrift * 0.2 : 0.1;
            const panDrift = Math.sin(pad.detunePhase * 0.3) * panDriftAmount;
            const basePan = nodes.pads.length > 1
                ? (padIndex / (nodes.pads.length - 1)) * 1.2 - 0.6
                : 0;
            pad.panner.pan.setTargetAtTime(clamp(basePan + panDrift, -1, 1), now, 0.5);
        });

        // Evolve filter (slow sweep)
        if (this.filter) {
            const filterRange = preset.filterRange[1] - preset.filterRange[0];
            const filterCenter = preset.filterRange[0] + filterRange / 2;
            const filterMod = Math.sin(state.filterPhase) * filterRange * 0.3;
            let targetFilter = filterCenter + filterMod;

            // Relaxation: depth darkens the filter
            if (isRelaxation && 'depthFilterMult' in preset) {
                const depthPreset = preset as typeof preset & { depthFilterMult: readonly [number, number] };
                const filterMult = depthPreset.depthFilterMult[0] +
                    this.oneheartCurrentDepth * (depthPreset.depthFilterMult[1] - depthPreset.depthFilterMult[0]);
                targetFilter *= filterMult;
            }

            // Also consider device tilt for filter control
            const tiltFactor = 1 - this.orientationParams.filterMod;
            const finalFilter = preset.filterRange[0] + (targetFilter - preset.filterRange[0]) * tiltFactor;

            this.filter.frequency.setTargetAtTime(clamp(finalFilter, preset.filterRange[0], preset.filterRange[1]), now, 0.5);
        }

        // Relaxation: depth affects reverb wet mix
        if (isRelaxation && 'depthReverbRange' in preset) {
            const depthPreset = preset as typeof preset & { depthReverbRange: readonly [number, number] };
            const wetMix = depthPreset.depthReverbRange[0] +
                this.oneheartCurrentDepth * (depthPreset.depthReverbRange[1] - depthPreset.depthReverbRange[0]);
            this.setReverbWet(wetMix);
        }

        // Update HUD based on mood
        this.updateOneheartHUD(state);
    }

    private updateOneheartHUD(state: OneheartState): void {
        const isRelaxation = this.oneheartMood === 'relaxation';
        const chordNames = isRelaxation
            ? ['sus4', 'Fsus', 'Gsus', 'add9', 'Am7']
            : ['I', 'IV', 'vi', 'V', 'iii', 'ii', 'Vsus', 'Iadd9'];
        const chordName = chordNames[state.currentChordIndex % chordNames.length] || 'I';

        if (isRelaxation) {
            const depthPercent = Math.round(this.oneheartCurrentDepth * 100);
            const depthStr = depthPercent < 20 ? 'surface' : depthPercent > 70 ? 'deep' : `${depthPercent}%`;
            const driftStr = this.oneheartCurrentDrift < 0.4 ? 'still' : this.oneheartCurrentDrift > 0.7 ? 'flowing' : 'gentle';
            this.updateHUD(`Relax ${depthStr}`, `${chordName} ${driftStr}`);
        } else {
            const noisePercent = Math.round(this.oneheartCurrentNoiseMix * 100);
            const noiseStr = noisePercent === 0 ? 'clean' : `tex ${noisePercent}%`;
            const voicingStr = this.oneheartCurrentVoicing < 0.8 ? 'tight' : this.oneheartCurrentVoicing > 1.2 ? 'wide' : 'med';
            this.updateHUD(`Focus ${noiseStr}`, `${chordName} ${voicingStr}`);
        }
    }

    private triggerOneheartChordChange(): void {
        if (!this.ctx || !this.oneheartState) return;

        const state = this.oneheartState;
        const nodes = this.nodes as OneheartNodes;
        const preset = ONEHEART_PRESETS[this.oneheartMood];
        const chords = preset.chords;
        const now = this.ctx.currentTime;

        // Move to next chord
        state.currentChordIndex = (state.currentChordIndex + 1) % chords.length;
        state.lastChordChange = Date.now();

        const newChord = chords[state.currentChordIndex];

        // Crossfade to new chord frequencies
        nodes.pads.forEach((pad, i) => {
            if (i < newChord.length) {
                const semitone = newChord[i];
                const newFreq = ONEHEART_BASE_FREQ * Math.pow(2, semitone / 12);

                pad.oscs.forEach(o => {
                    o.osc.frequency.setTargetAtTime(newFreq, now, 3.0); // Slow 3-second glide
                });
                pad.noteFreq = newFreq;
            }
        });
    }

    private updateOneheart(x?: number, y?: number, duration?: number): void {
        if (!this.oneheartState || !this.ctx) return;

        this.oneheartIsTouching = true;

        // Handle X/Y parameters based on mood
        if (x !== undefined && y !== undefined) {
            if (this.oneheartMood === 'relaxation') {
                // Relaxation: X = depth, Y = drift
                this.oneheartTargetDepth = x;
                this.oneheartTargetDrift = y;
            } else {
                // Focus: X = texture, Y = voicing
                this.oneheartTargetNoiseMix = x;
                this.oneheartTargetVoicing = 0.5 + y; // 0.5 to 1.5 range
            }
        }

        // Trigger chord change on initial touch
        if (duration !== undefined && duration < 0.1) {
            const timeSinceChange = Date.now() - this.oneheartState.lastChordChange;
            if (timeSinceChange > 2000) {
                this.triggerOneheartChordChange();
            }
        }
    }

    /** Set mood for oneheart mode - now deprecated, use initMode('focus') or initMode('relaxation') */
    setOneheartMood(mood: OneheartMood): void {
        // Mood is now set by selecting mode directly
        // This method is kept for backwards compatibility but switches mode instead
        if (this.oneheartMood === mood) return;
        const newMode = mood === 'focus' ? 'focus' : 'relaxation';
        this.initMode(newMode);
    }

    getOneheartMood(): OneheartMood {
        return this.oneheartMood;
    }

    // ============ TEXTURE GENERATORS ============

    private createNoiseBuffer(duration = 2): AudioBuffer {
        if (!this.ctx) throw new Error('AudioContext not initialized');

        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }

        return buffer;
    }

    toggleNoise(): boolean {
        if (!this.ctx || !this.filter) return this.noiseEnabled;

        if (this.noiseEnabled) {
            // Turn off
            this.stopNoise();
            this.noiseEnabled = false;
        } else {
            // Turn on
            this.startNoise();
            this.noiseEnabled = true;
        }

        return this.noiseEnabled;
    }

    cycleNoiseType(): NoiseType {
        const currentIndex = NOISE_TYPES.indexOf(this.noiseType);
        const nextIndex = (currentIndex + 1) % NOISE_TYPES.length;
        this.noiseType = NOISE_TYPES[nextIndex];

        // If noise is playing, restart with new type
        if (this.noiseEnabled) {
            this.stopNoise();
            this.startNoise();
        }

        return this.noiseType;
    }

    setNoiseType(type: NoiseType): void {
        if (this.noiseType === type) return;
        this.noiseType = type;

        // If noise is playing, restart with new type
        if (this.noiseEnabled) {
            this.stopNoise();
            this.startNoise();
        }
    }

    getNoiseType(): NoiseType {
        return this.noiseType;
    }

    setTextureVolume(volume: number): void {
        this.textureVolume = Math.max(0, Math.min(1, volume));

        // Update noise volume if playing
        if (this.noiseNodes && this.ctx) {
            const settings = NOISE_TEXTURE_SETTINGS[this.noiseType];
            const baseGain = settings.baseGain * this.textureVolume;
            const now = this.ctx.currentTime;
            this.noiseNodes.gain.gain.setTargetAtTime(baseGain * (1 - settings.lfoDepth), now, 0.1);
            if (this.noiseNodes.lfoGain) {
                this.noiseNodes.lfoGain.gain.setTargetAtTime(baseGain * settings.lfoDepth, now, 0.1);
            }
        }

        // Update tape hiss volume if playing
        if (this.tapeHissNodes && this.ctx) {
            const baseGain = TAPE_HISS_SETTINGS.baseGain * this.textureVolume;
            const now = this.ctx.currentTime;
            this.tapeHissNodes.gain.gain.setTargetAtTime(baseGain * (1 - TAPE_HISS_SETTINGS.lfoDepth), now, 0.1);
            if (this.tapeHissNodes.lfoGain) {
                this.tapeHissNodes.lfoGain.gain.setTargetAtTime(baseGain * TAPE_HISS_SETTINGS.lfoDepth, now, 0.1);
            }
        }
    }

    getTextureVolume(): number {
        return this.textureVolume;
    }

    private startNoise(): void {
        if (!this.ctx || !this.filter) return;

        const settings = NOISE_TEXTURE_SETTINGS[this.noiseType];
        const noiseBuffer = this.createNoiseBuffer(4);

        // Create noise source
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // Create filter (lowpass for warmer sound)
        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = settings.filterFreq;
        noiseFilter.Q.value = 0.7;

        // Create gain node with texture volume applied
        const baseGain = settings.baseGain * this.textureVolume;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.value = baseGain * (1 - settings.lfoDepth);

        // Create LFO for wave-like modulation
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = settings.lfoRate;

        // LFO gain controls modulation depth
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = baseGain * settings.lfoDepth;

        // Connect LFO to gain's gain parameter for amplitude modulation
        lfo.connect(lfoGain);
        lfoGain.connect(noiseGain.gain);

        // Connect: noise -> filter -> gain -> master filter
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.filter);

        noiseSource.start();
        lfo.start();

        this.noiseNodes = {
            noiseBuffer,
            noiseSource,
            gain: noiseGain,
            filter: noiseFilter,
            lfo,
            lfoGain
        };
    }

    private stopNoise(): void {
        if (!this.noiseNodes || !this.ctx) return;

        const now = this.ctx.currentTime;

        // Fade out
        this.noiseNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        // Stop after fade
        const nodes = this.noiseNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
            // Cleanup LFO nodes
            if (nodes.lfo) {
                try {
                    nodes.lfo.stop();
                    nodes.lfo.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfoGain) {
                try {
                    nodes.lfoGain.disconnect();
                } catch (e) { /* ignore */ }
            }
            try {
                nodes.gain.disconnect();
                nodes.filter.disconnect();
            } catch (e) { /* ignore */ }
        }, 500);

        this.noiseNodes = null;
    }

    toggleTapeHiss(): boolean {
        if (!this.ctx || !this.filter) return this.tapeHissEnabled;

        if (this.tapeHissEnabled) {
            // Turn off
            this.stopTapeHiss();
            this.tapeHissEnabled = false;
        } else {
            // Turn on
            this.startTapeHiss();
            this.tapeHissEnabled = true;
        }

        return this.tapeHissEnabled;
    }

    private startTapeHiss(): void {
        if (!this.ctx || !this.filter) return;

        const noiseBuffer = this.createNoiseBuffer(3);

        // Create noise source
        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        // Create highpass filter (removes low rumble)
        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = TAPE_HISS_SETTINGS.filterLow;
        highpass.Q.value = 0.3;

        // Create lowpass filter (removes harsh highs)
        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = TAPE_HISS_SETTINGS.filterHigh;
        lowpass.Q.value = 0.3;

        // Create gain with base level (minimum when LFO is at bottom)
        const tapeGain = this.ctx.createGain();
        tapeGain.gain.value = TAPE_HISS_SETTINGS.baseGain * (1 - TAPE_HISS_SETTINGS.lfoDepth);

        // Create LFO for slow wave-like modulation
        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = TAPE_HISS_SETTINGS.lfoRate;

        // LFO gain controls modulation depth
        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = TAPE_HISS_SETTINGS.baseGain * TAPE_HISS_SETTINGS.lfoDepth;

        // Connect LFO to gain's gain parameter for amplitude modulation
        lfo.connect(lfoGain);
        lfoGain.connect(tapeGain.gain);

        // Connect: noise -> highpass -> lowpass -> gain -> master filter
        noiseSource.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(tapeGain);
        tapeGain.connect(this.filter);

        noiseSource.start();
        lfo.start();

        this.tapeHissNodes = {
            noiseBuffer,
            noiseSource,
            gain: tapeGain,
            filter: highpass,
            filter2: lowpass,
            lfo,
            lfoGain
        };
    }

    private stopTapeHiss(): void {
        if (!this.tapeHissNodes || !this.ctx) return;

        const now = this.ctx.currentTime;

        // Fade out
        this.tapeHissNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        // Stop after fade
        const nodes = this.tapeHissNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
            // Cleanup LFO nodes
            if (nodes.lfo) {
                try {
                    nodes.lfo.stop();
                    nodes.lfo.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfoGain) {
                try {
                    nodes.lfoGain.disconnect();
                } catch (e) { /* ignore */ }
            }
            try {
                nodes.gain.disconnect();
                nodes.filter.disconnect();
                if (nodes.filter2) nodes.filter2.disconnect();
            } catch (e) { /* ignore */ }
        }, 500);

        this.tapeHissNodes = null;
    }

    setVolume(level: number): void {
        if (!this.ctx || !this.masterGain) return;

        // level is 0-100, convert to gain 0-1
        const gain = clamp(level / 100, 0, 1);
        const now = this.ctx.currentTime;

        this.masterGain.gain.setTargetAtTime(gain, now, 0.1);
    }

    // ============ COMMON METHODS ============

    private updateHUD(freq: string, harm: string): void {
        const freqEl = document.getElementById('val-freq');
        const harmEl = document.getElementById('val-harm');
        if (freqEl) freqEl.innerText = freq;
        if (harmEl) harmEl.innerText = harm;
    }

    private updateHUDLabels(): void {
        const labels: Record<SynthesisMode, [string, string]> = {
            wavetable: ['X: Pitch | β: Cutoff', 'Y: Waveform | γ: Q'],
            drone: ['X: Root | β: Cutoff', 'Y: Chord | γ: Q'],
            fm: ['X: Pitch | β: Cutoff', 'Y: Ratio | γ: Q'],
            arpeggiator: ['X: Root | β: Cutoff', 'Y: Pattern | γ: Q'],
            karplus: ['X: Note | β: Cutoff', 'Y: Decay | γ: Q'],
            formant: ['X: Pitch | β: Cutoff', 'Y: Vowel | γ: Q'],
            ambient: ['X: Drift | β: Cutoff', 'Y: Bright | Tap: Chord'],
            bassline: ['X: Root | α: Tempo', 'Y: Pattern | Compass'],
            focus: ['X: Texture | Y: Voicing', 'Focus Mode | Tap: Chord'],
            relaxation: ['X: Depth | Y: Drift', 'Relax Mode | Tap: Chord']
        };

        const l = labels[this.mode];

        const blEl = document.getElementById('hud-bl');
        const brEl = document.getElementById('hud-br');
        if (blEl) blEl.innerText = l[0];
        if (brEl) brEl.innerText = l[1];
    }

    quantizeToScale(x: number, octaves = 3, baseFreq = 55): NoteInfo {
        if (!this.isQuantized) {
            const semitones = x * octaves * 12;
            const freq = baseFreq * Math.pow(2, semitones / 12);
            const nearestSemitone = Math.round(semitones);
            const noteName = this.getNoteName(this.tonic + nearestSemitone);
            const octave = Math.floor(nearestSemitone / 12) + 2;
            return { freq, semitone: semitones, noteName, octave, isQuantized: false };
        }

        const pattern = SCALE_PATTERNS[this.scaleType] || SCALE_PATTERNS.minor;
        const notesPerOctave = pattern.length;
        const totalNotes = notesPerOctave * octaves;

        const noteIndex = Math.floor(x * totalNotes);
        const octave = Math.floor(noteIndex / notesPerOctave);
        const degree = noteIndex % notesPerOctave;
        const semitone = this.tonic + octave * 12 + pattern[degree];

        return {
            freq: baseFreq * Math.pow(2, (pattern[degree] + octave * 12) / 12),
            semitone: pattern[degree] + octave * 12,
            noteName: this.getNoteName(semitone),
            octave: octave + 2,
            isQuantized: true
        };
    }

    setQuantized(enabled: boolean): void {
        this.isQuantized = enabled;
    }

    getNoteName(semitone: number): string {
        return NOTE_NAMES[semitone % 12];
    }

    setTonic(tonic: string | number): void {
        this.tonic = typeof tonic === 'string' ? parseInt(tonic, 10) : tonic;
    }

    setScaleType(scaleType: string): void {
        this.scaleType = scaleType;
    }

    resume(): void {
        this.silentAudio.play().catch(() => { /* ignore */ });
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    start(_touchId: TouchId = 0): void {
        if (!this.ctx) this.init();
        if (this.ctx!.state === 'suspended') this.ctx!.resume();

        const now = this.ctx!.currentTime;

        // Ambient, Bassline, Focus, and Relaxation are continuous modes - they manage their own master gain
        if (this.mode === 'ambient' || this.mode === 'bassline' || this.mode === 'focus' || this.mode === 'relaxation') {
            return;
        }

        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.05);
        }
        this.isPlaying = true;
    }

    stop(touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (this.mode === 'ambient') return;
        if (this.mode === 'focus' || this.mode === 'relaxation') {
            this.oneheartIsTouching = false;
            return;
        }

        // Get touch category and profile for release shaping
        const category = this.getTouchCategory(duration);
        const profile = TOUCH_PROFILES[category];
        const releaseTime = profile.releaseTime;

        // Apply filter and reverb release shaping
        this.applyReleaseEnvelope(duration);

        switch (this.mode) {
            case 'wavetable': this.stopWavetableVoice(touchId, releaseTime); break;
            case 'drone': this.stopDroneVoice(touchId, releaseTime); break;
            case 'fm': this.stopFMVoice(touchId, releaseTime); break;
            case 'arpeggiator': this.stopArpVoice(touchId, releaseTime); break;
            case 'karplus':
                const kNodes = this.nodes as KarplusNodes;
                if (kNodes.voices) kNodes.voices.delete(touchId);
                break;
            case 'formant': this.stopFormantVoice(touchId, releaseTime); break;
            case 'bassline': return; // Bassline is continuous, doesn't stop on touch end
        }

        if (this.getVoiceCount() === 0 && this.masterGain) {
            this.masterGain.gain.setTargetAtTime(0, now, releaseTime);
            this.isPlaying = false;
        }
    }

    update(x: number, y: number, touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx) return;

        // Input validation - clamp coordinates to [0, 1]
        const clampedX = clamp(x, 0, 1);
        const clampedY = clamp(y, 0, 1);

        switch (this.mode) {
            case 'wavetable': this.updateWavetable(clampedX, clampedY, duration, touchId); break;
            case 'drone': this.updateDrone(clampedX, clampedY, duration, touchId); break;
            case 'fm': this.updateFM(clampedX, clampedY, duration, touchId); break;
            case 'arpeggiator': this.updateArpeggiator(clampedX, clampedY, touchId, duration); break;
            case 'karplus': this.updateKarplus(clampedX, clampedY, duration, touchId); break;
            case 'formant': this.updateFormant(clampedX, clampedY, duration, touchId); break;
            case 'ambient': this.updateAmbient(clampedX, clampedY, duration); break;
            case 'bassline': this.updateBassline(clampedX, clampedY); break;
            case 'focus':
            case 'relaxation': this.updateOneheart(clampedX, clampedY, duration); break;
        }
    }

    getAnalysis(): Float32Array | null {
        if (this.analyser && this.dataArray) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.analyser.getFloatFrequencyData(this.dataArray as any);
            return this.dataArray;
        }
        return null;
    }

    updateOrientation(beta: number | null, _gamma: number | null, alpha: number | null): void {
        if (!this.ctx || !this.filter) return;
        const now = this.ctx.currentTime;

        // Beta (forward/back tilt) controls filter cutoff
        const clampedBeta = clamp(beta || 0, 0, 90);
        const filterMod = clampedBeta / 90;
        this.orientationParams.filterMod = filterMod;

        const tiltCutoff = FILTER_MIN_FREQ * Math.pow(FILTER_MAX_FREQ / FILTER_MIN_FREQ, 1 - filterMod);
        this.currentFilterFreq = tiltCutoff; // Track for release envelope
        this.filter.frequency.setTargetAtTime(tiltCutoff, now, 0.1);

        // Alpha (compass heading) - currently unused, reserved for future use
        const compassHeading = alpha ?? 0;
        this.orientationParams.compass = compassHeading;

        // Update UI indicators
        const tiltEl = document.getElementById('val-tilt');
        if (tiltEl) {
            tiltEl.innerText = `${Math.round(tiltCutoff)}Hz`;
        }
    }

    updateMotion(acceleration: DeviceMotionEventAcceleration | null, rotationRate: DeviceMotionEventRotationRate | null): void {
        if (!this.ctx || !this.delayFeedback) return;
        const now = this.ctx.currentTime;

        if (rotationRate) {
            const rotMagnitude = Math.sqrt(
                (rotationRate.alpha || 0) ** 2 +
                (rotationRate.beta || 0) ** 2 +
                (rotationRate.gamma || 0) ** 2
            );
            this.orientationParams.lfoRate = rotMagnitude;
        }

        if (acceleration) {
            const accMagnitude = Math.sqrt(
                (acceleration.x || 0) ** 2 +
                (acceleration.y || 0) ** 2 +
                (acceleration.z || 0) ** 2
            );
            this.orientationParams.shake = accMagnitude;

            if (accMagnitude > SHAKE_ACCELERATION_THRESHOLD) {
                this.delayFeedback.gain.setTargetAtTime(DELAY_FEEDBACK_SHAKE, now, 0.02);
                setTimeout(() => {
                    if (this.ctx && this.delayFeedback) {
                        this.delayFeedback.gain.setTargetAtTime(DELAY_FEEDBACK_NORMAL, this.ctx.currentTime, 0.3);
                    }
                }, SHAKE_DURATION_MS);
            }

            const motionLabel = accMagnitude > SHAKE_ACCELERATION_THRESHOLD ? 'SHAKE!' :
                               accMagnitude > 1.5 ? 'Active' : 'Steady';
            const motionEl = document.getElementById('val-motion');
            if (motionEl) motionEl.innerText = motionLabel;
        }
    }
}
