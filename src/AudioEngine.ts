/**
 * AUDIO ENGINE - Multi-mode Synthesizer
 * Coordinates mode classes and provides shared audio infrastructure
 */

import {
    MASTER_GAIN,
    DELAY_TIME_LEFT,
    DELAY_TIME_RIGHT,
    DELAY_FEEDBACK_NORMAL,
    DELAY_FEEDBACK_SHAKE,
    SHAKE_DURATION_MS,
    FILTER_MIN_FREQ,
    FILTER_MAX_FREQ,
    FILTER_Q_DEFAULT,
    FFT_SIZE,
    ANALYSER_SMOOTHING,
    ANALYSER_MIN_DB,
    ANALYSER_MAX_DB,
    SHAKE_ACCELERATION_THRESHOLD,
    REVERB_PRESETS,
    REVERB_CYCLE,
    TOUCH_PROFILES,
    TOUCH_TAP_MAX_DURATION,
    TOUCH_PRESS_MAX_DURATION,
    NOTE_NAMES,
    SCALE_PATTERNS,
    clamp,
    type SynthesisMode,
    type ReverbLevel,
    type TouchCategory,
    type OneheartMood,
    // Texture imports
    NOISE_TEXTURE_SETTINGS,
    NOISE_TYPES,
    DEFAULT_TEXTURE_VOLUME,
    TAPE_HISS_SETTINGS,
    type NoiseType,
} from './constants';

// Import mode system
import { getMode, type SynthMode, type EngineContext } from './modes';

// Import beat engine
import { BeatEngine } from './beats/BeatEngine';

// Types are defined inline below for now (TODO: migrate to ./types)

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
    pattern: number[];
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

    // Oneheart mode state (now handled by mode classes)
    oneheartMood: OneheartMood = 'focus';

    // Texture state
    noiseNodes: TextureNodes | null = null;
    tapeHissNodes: TextureNodes | null = null;
    noiseEnabled = false;
    tapeHissEnabled = false;
    noiseType: NoiseType = 'waves';
    textureVolume = DEFAULT_TEXTURE_VOLUME;


    // Reverb effect chain
    private convolver: ConvolverNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private reverbDryGain: GainNode | null = null;
    reverbLevel: ReverbLevel = 'off';
    private impulseResponses: Map<ReverbLevel, AudioBuffer> = new Map();

    // Touch envelope state
    private currentFilterFreq: number = FILTER_MAX_FREQ;
    private releaseFilterTarget: number = FILTER_MIN_FREQ;

    // Current mode instance (from mode registry)
    private currentMode: SynthMode | null = null;

    // Beat engine (runs independently of mode)
    beatEngine: BeatEngine | null = null;

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

        // Initialize beat engine (routes to analyser, bypassing delay AND reverb)
        this.beatEngine = new BeatEngine();
        this.beatEngine.init(this.ctx, this.analyser);

        this.initMode(this.mode);
    }

    // ============ VOICE COUNT HELPERS ============

    private getVoiceCount(): number {
        if ('voices' in this.nodes && this.nodes.voices instanceof Map) {
            return this.nodes.voices.size;
        }
        return 0;
    }

    // ============ MODE INITIALIZATION ============

    /**
     * Create the engine context that mode classes need
     */
    private getEngineContext(): EngineContext {
        return {
            ctx: this.ctx!,
            filter: this.filter!,
            masterGain: this.masterGain!,
            currentTime: this.ctx!.currentTime,
            isQuantized: this.isQuantized,
            tonic: this.tonic,
            scaleType: this.scaleType,
            orientationParams: this.orientationParams,
            updateHUD: (freq, harm) => this.updateHUD(freq, harm),
            setReverb: (decay, wet, dry) => this.setReverbParams(decay, wet, dry),
            setReverbWet: (wet) => this.setReverbWet(wet),
        };
    }

    initMode(mode: SynthesisMode): void {
        // Cleanup previous mode
        if (this.currentMode) {
            this.currentMode.cleanup();
        }
        this.cleanupMode();
        this.mode = mode;

        // Get mode instance from registry
        const modeInstance = getMode(mode);
        if (modeInstance && this.ctx && this.filter && this.masterGain) {
            this.currentMode = modeInstance;
            this.currentMode.init(this.getEngineContext());
        }

        // Set mood for focus/relaxation modes
        if (mode === 'focus') {
            this.oneheartMood = 'focus';
        } else if (mode === 'relaxation') {
            this.oneheartMood = 'relaxation';
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

    /** Set reverb parameters directly (used by mode classes) */
    setReverbParams(_decay: number, wet: number, dry: number): void {
        if (!this.ctx || !this.reverbWetGain || !this.reverbDryGain) return;
        const now = this.ctx.currentTime;
        this.reverbWetGain.gain.setTargetAtTime(clamp(wet, 0, 1), now, 0.3);
        this.reverbDryGain.gain.setTargetAtTime(clamp(dry, 0, 1), now, 0.3);
        // Note: decay parameter would require regenerating the impulse response
        // For now, we just adjust wet/dry mix
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
            relaxation: ['X: Depth | Y: Drift', 'Relax Mode | Tap: Chord'],
            beats: ['X: Pattern | Density', 'Y: Kick | Pitch/Punch']
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

    start(touchId: TouchId = 0): void {
        if (!this.ctx) this.init();
        if (this.ctx!.state === 'suspended') this.ctx!.resume();

        const now = this.ctx!.currentTime;

        // Beats mode: touch just sets pattern, play/stop via button
        if (this.mode === 'beats') {
            // Auto-start beats on first touch if not playing
            if (this.beatEngine && !this.beatEngine.getIsPlaying()) {
                this.beatEngine.start();
            }
            return;
        }

        // Delegate to mode class if available
        if (this.currentMode) {
            // Continuous modes manage their own master gain
            if (this.currentMode.isContinuous) {
                this.currentMode.start(touchId, this.getEngineContext());
                return;
            }
            this.currentMode.start(touchId, this.getEngineContext());
        }

        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.05);
        }
        this.isPlaying = true;
    }

    stop(touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // Beats mode: lifting finger doesn't stop the beat
        if (this.mode === 'beats') {
            return;
        }

        // Get touch category and profile for release shaping
        const category = this.getTouchCategory(duration);
        const profile = TOUCH_PROFILES[category];
        const releaseTime = profile.releaseTime;

        // Delegate to mode class if available
        if (this.currentMode) {
            // Continuous modes don't stop on touch end
            if (this.currentMode.isContinuous) {
                this.currentMode.stop(touchId, releaseTime, this.getEngineContext());
                return;
            }

            // Apply filter and reverb release shaping
            this.applyReleaseEnvelope(duration);
            this.currentMode.stop(touchId, releaseTime, this.getEngineContext());

            if (this.currentMode.getVoiceCount() === 0 && this.masterGain) {
                this.masterGain.gain.setTargetAtTime(0, now, releaseTime);
                this.isPlaying = false;
            }
            return;
        }
    }

    update(x: number, y: number, touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx) return;

        // Input validation - clamp coordinates to [0, 1]
        const clampedX = clamp(x, 0, 1);
        const clampedY = clamp(y, 0, 1);

        // Beats mode: control pattern with X/Y
        if (this.mode === 'beats' && this.beatEngine) {
            this.beatEngine.setPattern(clampedX, clampedY);
            // Update HUD with pattern info
            const densityLabel = clampedX < 0.3 ? 'Simple' : clampedX < 0.7 ? 'Medium' : 'Complex';
            const punchLabel = clampedY < 0.3 ? 'Deep' : clampedY < 0.7 ? 'Balanced' : 'Punchy';
            this.updateHUD(densityLabel, punchLabel);
            return;
        }

        // Delegate to mode class if available
        if (this.currentMode) {
            this.currentMode.update(clampedX, clampedY, touchId, duration, this.getEngineContext());
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
