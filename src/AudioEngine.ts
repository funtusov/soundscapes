/**
 * AUDIO ENGINE - Wavetable Synthesizer
 * Provides shared audio infrastructure for the wavetable synthesis mode
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
    FILTER_Q_MIN,
    FILTER_Q_MAX,
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
    type ReverbLevel,
    type TouchCategory,
    // Texture imports
    NOISE_TEXTURE_SETTINGS,
    NOISE_TYPES,
    DEFAULT_TEXTURE_VOLUME,
    TAPE_HISS_SETTINGS,
    type NoiseType,
    // ADSR envelope imports
    ADSR_PRESETS,
    type ADSRPreset,
} from './constants';

// Import mode system
import { getMode, type SynthMode, type EngineContext } from './modes';

// Import types from centralized type definitions
import type { TouchId, TextureNodes, VoiceDisplayInfo } from './types';
import type { OrientationParams, NoteInfo, ModeNodes } from './types';

// Declare global webkitAudioContext for Safari compatibility
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}

// Re-export TouchId for backwards compatibility
export type { TouchId };

// ============ AUDIO ENGINE CLASS ============

export class AudioEngine {
    ctx: AudioContext | null = null;
    masterGain: GainNode | null = null;
    handGain: GainNode | null = null;
    filter: BiquadFilterNode | null = null;
    panner: StereoPannerNode | null = null;
    delayFeedback: GainNode | null = null;
    analyser: AnalyserNode | null = null;
    isPlaying = false;
    dataArray: Float32Array | null = null;
    nodes: ModeNodes = {};
    touches = new Map<TouchId, unknown>();
    orientationParams: OrientationParams = { pan: 0, filterMod: 0, lfoRate: 0, shake: 0, compass: 0 };
    isQuantized = true;
    tonic = 7; // G
    scaleType = 'pent_min';

    // Frequency range: octaves + location
    private locationBaseFreqs = {
        bass: 55,   // A1 - sub-bass/bass territory
        mid: 110,   // A2 - mid range, good default
        high: 220   // A3 - treble territory
    } as const;
    rangeOctaves = 3;
    rangeLocation: 'bass' | 'mid' | 'high' = 'mid';
    scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    silentAudio: HTMLAudioElement;

    // Texture state
    noiseNodes: TextureNodes | null = null;
    tapeHissNodes: TextureNodes | null = null;
    noiseEnabled = false;
    tapeHissEnabled = false;
    noiseType: NoiseType = 'waves';
    textureVolume = DEFAULT_TEXTURE_VOLUME;

    // Voice display registry for HUD
    private voiceRegistry = new Map<TouchId, VoiceDisplayInfo>();

    // ADSR envelope preset
    envelopeIndex = 0; // Default to "Pad"

    // Arpeggio state
    arpEnabled = false;
    arpRate = 4; // Notes per second

    // Compass pan state
    compassPanEnabled = false;
    private compassPanAnchor: number | null = null;

    // Reverb effect chain
    private convolver: ConvolverNode | null = null;
    private reverbWetGain: GainNode | null = null;
    private reverbDryGain: GainNode | null = null;
    reverbLevel: ReverbLevel = 'off';
    private impulseResponses: Map<ReverbLevel, AudioBuffer> = new Map();

    // Touch envelope state
    private currentFilterFreq: number = FILTER_MAX_FREQ;
    private releaseFilterTarget: number = FILTER_MIN_FREQ;

    // Current mode instance
    private currentMode: SynthMode | null = null;

    // Hand (webcam) onset shaping
    private handAttackSeconds: number | null = null;

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

        // Hand (webcam) gain: multiplicative volume control without fighting UI slider/start/stop.
        this.handGain = this.ctx.createGain();
        this.handGain.gain.value = 1;

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
        this.reverbDryGain!.connect(this.handGain);

        // Wet path: Panner → Convolver → WetGain → MasterGain
        this.panner.connect(this.convolver!);
        this.convolver!.connect(this.reverbWetGain!);
        this.reverbWetGain!.connect(this.handGain);

        // Hand gain → Master gain
        this.handGain.connect(this.masterGain);

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

        this.initMode();
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
    private getEngineContext(touchId?: TouchId): EngineContext {
        const isHand = typeof touchId === 'string' && touchId.startsWith('hand');
        const baseEnvelope = ADSR_PRESETS[this.envelopeIndex];
        const envelope = isHand && this.handAttackSeconds !== null
            ? { ...baseEnvelope, attack: clamp(this.handAttackSeconds, 0.001, 0.25) }
            : baseEnvelope;
        return {
            ctx: this.ctx!,
            filter: this.filter!,
            masterGain: this.masterGain!,
            currentTime: this.ctx!.currentTime,
            // Hand (webcam) control is intentionally continuous for a "theremin-ish" feel.
            isQuantized: isHand ? false : this.isQuantized,
            tonic: this.tonic,
            scaleType: this.scaleType,
            rangeOctaves: this.rangeOctaves,
            rangeBaseFreq: this.locationBaseFreqs[this.rangeLocation],
            envelope,
            arpEnabled: this.arpEnabled,
            arpRate: this.arpRate,
            orientationParams: this.orientationParams,
            updateHUD: (freq, harm) => this.updateHUD(freq, harm),
            registerVoice: (info) => this.registerVoice(info),
            updateVoice: (touchId, info) => this.updateVoice(touchId, info),
            unregisterVoice: (touchId) => this.unregisterVoice(touchId),
            setReverb: (decay, wet, dry) => this.setReverbParams(decay, wet, dry),
            setReverbWet: (wet) => this.setReverbWet(wet),
        };
    }

    /** Hand (webcam): set attack time (seconds) for the next onset. */
    setHandAttackSeconds(seconds: number): void {
        this.handAttackSeconds = seconds;
    }

    initMode(): void {
        // Cleanup previous mode
        if (this.currentMode) {
            this.currentMode.cleanup();
        }
        this.cleanupMode();

        // Get wavetable mode instance
        const modeInstance = getMode();
        if (modeInstance && this.ctx && this.filter && this.masterGain) {
            this.currentMode = modeInstance;
            this.currentMode.init(this.getEngineContext());
        }
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

    /** Set reverb wet mix directly */
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
    }

    cleanupMode(): void {
        this.nodes = {};
        this.voiceRegistry.clear();
        this.renderVoiceList();
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
            this.stopNoise();
            this.noiseEnabled = false;
        } else {
            this.startNoise();
            this.noiseEnabled = true;
        }

        return this.noiseEnabled;
    }

    setNoiseEnabled(enabled: boolean): void {
        if (!this.ctx || !this.filter) return;
        if (enabled === this.noiseEnabled) return;

        if (enabled) {
            this.startNoise();
            this.noiseEnabled = true;
        } else {
            this.stopNoise();
            this.noiseEnabled = false;
        }
    }

    cycleNoiseType(): NoiseType {
        const currentIndex = NOISE_TYPES.indexOf(this.noiseType);
        const nextIndex = (currentIndex + 1) % NOISE_TYPES.length;
        this.noiseType = NOISE_TYPES[nextIndex];

        if (this.noiseEnabled) {
            this.stopNoise();
            this.startNoise();
        }

        return this.noiseType;
    }

    setNoiseType(type: NoiseType): void {
        if (this.noiseType === type) return;
        this.noiseType = type;

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

        if (this.noiseNodes && this.ctx) {
            const settings = NOISE_TEXTURE_SETTINGS[this.noiseType];
            const baseGain = settings.baseGain * this.textureVolume;
            const now = this.ctx.currentTime;
            this.noiseNodes.gain.gain.setTargetAtTime(baseGain * (1 - settings.lfoDepth), now, 0.1);
            if (this.noiseNodes.lfoGain) {
                this.noiseNodes.lfoGain.gain.setTargetAtTime(baseGain * settings.lfoDepth, now, 0.1);
            }
        }

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

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = settings.filterFreq;
        noiseFilter.Q.value = 0.7;

        const baseGain = settings.baseGain * this.textureVolume;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.value = baseGain * (1 - settings.lfoDepth);

        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = settings.lfoRate;

        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = baseGain * settings.lfoDepth;

        lfo.connect(lfoGain);
        lfoGain.connect(noiseGain.gain);

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
        this.noiseNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        const nodes = this.noiseNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
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
            this.stopTapeHiss();
            this.tapeHissEnabled = false;
        } else {
            this.startTapeHiss();
            this.tapeHissEnabled = true;
        }

        return this.tapeHissEnabled;
    }

    private startTapeHiss(): void {
        if (!this.ctx || !this.filter) return;

        const noiseBuffer = this.createNoiseBuffer(3);

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = TAPE_HISS_SETTINGS.filterLow;
        highpass.Q.value = 0.3;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = TAPE_HISS_SETTINGS.filterHigh;
        lowpass.Q.value = 0.3;

        const tapeGain = this.ctx.createGain();
        tapeGain.gain.value = TAPE_HISS_SETTINGS.baseGain * (1 - TAPE_HISS_SETTINGS.lfoDepth);

        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = TAPE_HISS_SETTINGS.lfoRate;

        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = TAPE_HISS_SETTINGS.baseGain * TAPE_HISS_SETTINGS.lfoDepth;

        lfo.connect(lfoGain);
        lfoGain.connect(tapeGain.gain);

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
        this.tapeHissNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        const nodes = this.tapeHissNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
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

        const gain = clamp(level / 100, 0, 1);
        const now = this.ctx.currentTime;

        this.masterGain.gain.setTargetAtTime(gain, now, 0.1);
    }

    /**
     * Hand control (webcam): multiplicative volume (0..1).
     * This stacks with the UI volume slider and touch envelopes.
     */
    setHandVolume(level: number): void {
        if (!this.ctx || !this.handGain) return;

        const gain = clamp(level, 0, 1);
        const now = this.ctx.currentTime;
        this.handGain.gain.setTargetAtTime(gain, now, 0.08);
    }

    /**
     * Hand control (webcam): set filter cutoff via a normalized control value.
     * `filterMod=1` => FILTER_MIN_FREQ (80Hz), `filterMod=0` => FILTER_MAX_FREQ (8000Hz).
     */
    setHandFilterMod(filterMod: number): void {
        if (!this.ctx || !this.filter) return;

        const mod = clamp(filterMod, 0, 1);
        const now = this.ctx.currentTime;

        const cutoff = FILTER_MIN_FREQ * Math.pow(FILTER_MAX_FREQ / FILTER_MIN_FREQ, 1 - mod);
        this.orientationParams.filterMod = mod;
        this.currentFilterFreq = cutoff;
        this.filter.frequency.setTargetAtTime(cutoff, now, 0.1);

        const tiltEl = document.getElementById('val-tilt');
        if (tiltEl) {
            tiltEl.innerText = `${Math.round(cutoff)}Hz`;
        }
    }

    /**
     * Hand control (webcam): set filter resonance (Q) via a normalized control value (0..1).
     * Uses an exponential mapping for musical feel: low values are more precise.
     */
    setHandFilterQ(resonance: number): void {
        if (!this.ctx || !this.filter) return;

        const t = clamp(resonance, 0, 1);
        const now = this.ctx.currentTime;

        const q = FILTER_Q_MIN * Math.pow(FILTER_Q_MAX / FILTER_Q_MIN, t);
        this.filter.Q.setTargetAtTime(q, now, 0.1);
    }

    // ============ COMMON METHODS ============

    /** @deprecated Use registerVoice/unregisterVoice instead */
    private updateHUD(_freq: string, _harm: string): void {
        // Legacy method - voice display now handled by voice registry
    }

    /** Register a voice for HUD display */
    registerVoice(info: VoiceDisplayInfo): void {
        this.voiceRegistry.set(info.touchId, info);
        this.renderVoiceList();
    }

    /** Update an existing voice's display info */
    updateVoice(touchId: TouchId, info: Partial<VoiceDisplayInfo>): void {
        const existing = this.voiceRegistry.get(touchId);
        if (existing) {
            this.voiceRegistry.set(touchId, { ...existing, ...info });
            this.renderVoiceList();
        }
    }

    /** Unregister a voice from HUD display */
    unregisterVoice(touchId: TouchId): void {
        this.voiceRegistry.delete(touchId);
        this.renderVoiceList();
    }

    /** Render the voice list to the HUD */
    private renderVoiceList(): void {
        const container = document.getElementById('voiceList');
        if (!container) return;

        if (this.voiceRegistry.size === 0) {
            container.innerHTML = '<div class="voice-placeholder">--</div>';
            return;
        }

        const voices = Array.from(this.voiceRegistry.values())
            .sort((a, b) => String(a.touchId).localeCompare(String(b.touchId)));

        container.innerHTML = voices.map(v =>
            `<div class="voice-entry"><span class="note">${v.noteName}${v.octave}</span> <span class="freq">${Math.round(v.freq)}Hz</span> <span class="wave">/ ${v.waveform}</span></div>`
        ).join('');
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

    /** Get current scale pattern (array of semitone offsets) */
    getScalePattern(): number[] {
        return SCALE_PATTERNS[this.scaleType] || SCALE_PATTERNS.pent_min;
    }

    /** Set range octaves */
    setRangeOctaves(octaves: number): void {
        this.rangeOctaves = octaves;
    }

    /** Set range location */
    setRangeLocation(location: 'bass' | 'mid' | 'high'): void {
        this.rangeLocation = location;
    }

    /** Get current range info */
    getRange(): { octaves: number; location: string; baseFreq: number } {
        return {
            octaves: this.rangeOctaves,
            location: this.rangeLocation,
            baseFreq: this.locationBaseFreqs[this.rangeLocation]
        };
    }

    /** Get range info for visualizer (octave count and positions) */
    getRangeInfo(): { octaves: number; baseFreq: number; name: string } {
        const locationNames = { bass: 'Bass', mid: 'Mid', high: 'High' };
        return {
            octaves: this.rangeOctaves,
            baseFreq: this.locationBaseFreqs[this.rangeLocation],
            name: `${this.rangeOctaves} ${locationNames[this.rangeLocation]}`
        };
    }

    /** Cycle through ADSR envelope presets */
    cycleEnvelope(): ADSRPreset {
        this.envelopeIndex = (this.envelopeIndex + 1) % ADSR_PRESETS.length;
        return ADSR_PRESETS[this.envelopeIndex];
    }

    /** Get current ADSR envelope preset */
    getEnvelope(): ADSRPreset {
        return ADSR_PRESETS[this.envelopeIndex];
    }

    /** Set envelope by name */
    setEnvelopeByName(name: string): boolean {
        const index = ADSR_PRESETS.findIndex(p => p.name === name);
        if (index >= 0) {
            this.envelopeIndex = index;
            return true;
        }
        return false;
    }

    /** Toggle arpeggio mode */
    toggleArp(): boolean {
        this.arpEnabled = !this.arpEnabled;
        return this.arpEnabled;
    }

    /** Set arpeggio enabled state */
    setArpEnabled(enabled: boolean): void {
        this.arpEnabled = enabled;
    }

    /** Set arpeggio rate (notes per second) */
    setArpRate(rate: number): void {
        this.arpRate = Math.max(2, Math.min(16, rate));
    }

    /** Toggle compass-controlled panning */
    toggleCompassPan(): boolean {
        this.compassPanEnabled = !this.compassPanEnabled;
        if (this.compassPanEnabled) {
            // Set the anchor to current compass heading
            this.compassPanAnchor = this.orientationParams.compass;
        } else {
            // Reset pan to center
            if (this.panner && this.ctx) {
                this.panner.pan.setTargetAtTime(0, this.ctx.currentTime, 0.1);
            }
            this.orientationParams.pan = 0;
            this.compassPanAnchor = null;
        }
        return this.compassPanEnabled;
    }

    /** Re-anchor compass pan to current heading */
    reanchorCompassPan(): void {
        if (this.compassPanEnabled) {
            this.compassPanAnchor = this.orientationParams.compass;
        }
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

        // Delegate to mode class
        if (this.currentMode) {
            this.currentMode.start(touchId, this.getEngineContext(touchId));
        }

        if (this.masterGain) {
            this.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.05);
        }
        this.isPlaying = true;
    }

    stop(
        touchId: TouchId = 0,
        duration = 0,
        options?: { applyReleaseEnvelope?: boolean }
    ): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const category = this.getTouchCategory(duration);
        const profile = TOUCH_PROFILES[category];
        const releaseTime = profile.releaseTime;

        if (this.currentMode) {
            if (options?.applyReleaseEnvelope !== false) {
                this.applyReleaseEnvelope(duration);
            }
            this.currentMode.stop(touchId, releaseTime, this.getEngineContext(touchId));

            if (this.currentMode.getVoiceCount() === 0 && this.masterGain) {
                this.masterGain.gain.setTargetAtTime(0, now, releaseTime);
                this.isPlaying = false;
            }
        }
    }

    update(x: number, y: number, touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx) return;

        const clampedX = clamp(x, 0, 1);
        const clampedY = clamp(y, 0, 1);

        if (this.currentMode) {
            this.currentMode.update(clampedX, clampedY, touchId, duration, this.getEngineContext(touchId));
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

    /** Get a MediaStream for recording the audio output */
    getRecordingStream(): MediaStream | null {
        if (!this.ctx || !this.masterGain) return null;

        const dest = this.ctx.createMediaStreamDestination();
        this.masterGain.connect(dest);
        return dest.stream;
    }

    updateOrientation(beta: number | null, _gamma: number | null, alpha: number | null): void {
        if (!this.ctx || !this.filter) return;
        const now = this.ctx.currentTime;

        const clampedBeta = clamp(beta || 0, 0, 90);
        const filterMod = clampedBeta / 90;
        this.orientationParams.filterMod = filterMod;

        const tiltCutoff = FILTER_MIN_FREQ * Math.pow(FILTER_MAX_FREQ / FILTER_MIN_FREQ, 1 - filterMod);
        this.currentFilterFreq = tiltCutoff;
        this.filter.frequency.setTargetAtTime(tiltCutoff, now, 0.1);

        const compassHeading = alpha ?? 0;
        this.orientationParams.compass = compassHeading;

        // Apply compass-controlled panning
        if (this.compassPanEnabled && this.panner && this.compassPanAnchor !== null) {
            // Calculate difference from anchor (accounting for wrap-around at 360)
            let diff = compassHeading - this.compassPanAnchor;
            // Normalize to -180 to 180
            while (diff > 180) diff -= 360;
            while (diff < -180) diff += 360;
            // Use sine for natural spatial audio:
            // 0° (facing source) = center, 90° = full right,
            // 180° (behind) = center, 270° = full left
            const panValue = Math.sin(diff * Math.PI / 180);
            this.panner.pan.setTargetAtTime(panValue, now, 0.05);
            this.orientationParams.pan = panValue;
        }

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
