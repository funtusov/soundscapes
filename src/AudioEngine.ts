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
    FILTER_Q_MIN,
    FILTER_Q_MAX,
    FILTER_Q_DEFAULT,
    FFT_SIZE,
    ANALYSER_SMOOTHING,
    ANALYSER_MIN_DB,
    ANALYSER_MAX_DB,
    RELEASE_TIME_BASE,
    RELEASE_TIME_MAX_ADDITION,
    VOICE_CLEANUP_BUFFER_MS,
    KARPLUS_MIN_PLUCK_INTERVAL,
    KARPLUS_REPLUCK_INTERVAL,
    KARPLUS_DECAY_DURATION,
    KARPLUS_BUFFER_POOL_SIZE,
    AMBIENT_BASE_FREQ,
    AMBIENT_LFO_SLOW,
    AMBIENT_LFO_MEDIUM,
    AMBIENT_LOOP_INTERVAL,
    AMBIENT_TOUCH_TIMEOUT,
    NOTE_NAMES,
    SCALE_PATTERNS,
    SHAKE_ACCELERATION_THRESHOLD,
    FM_ROTATION_THRESHOLD,
    clamp,
    type SynthesisMode
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

interface ThereminVoice {
    osc: OscillatorNode;
    gain: GainNode;
    vibrato: OscillatorNode;
    vibratoGain: GainNode;
}

interface FMVoice {
    carrier: OscillatorNode;
    carrierGain: GainNode;
    modulator: OscillatorNode;
    modulatorGain: GainNode;
}

interface ChordVoice {
    osc: OscillatorNode;
    gain: GainNode;
}

interface KarplusVoice {
    lastRepluck: number;
}

interface PooledBuffer {
    buffer: AudioBuffer;
    size: number;
    inUse: boolean;
}

interface GranularOsc {
    osc: OscillatorNode;
    gain: GainNode;
}

interface GranularVoice {
    oscs: GranularOsc[];
    lfo: OscillatorNode;
    lfoGain: GainNode;
}

interface DroneOsc {
    osc: OscillatorNode;
    gain: GainNode;
    baseDetune: number;
}

interface DroneVoice {
    oscs: DroneOsc[];
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

interface ThereminNodes {
    voices: Map<TouchId, ThereminVoice>;
}

interface FMNodes {
    voices: Map<TouchId, FMVoice>;
    ratio: number;
}

interface ChordsNodes {
    voices: Map<TouchId, ChordVoice>;
}

interface KarplusNodes {
    voices: Map<TouchId, KarplusVoice>;
    lastPluck: number;
}

interface GranularNodes {
    voices: Map<TouchId, GranularVoice>;
}

interface AmbientNodes {
    drones: DroneVoice[];
    noiseBed: NoiseBed;
    shimmer: ShimmerLayer;
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    baseFreq: number;
}

type ModeNodes = WavetableNodes | ThereminNodes | FMNodes | ChordsNodes | KarplusNodes | GranularNodes | AmbientNodes | Record<string, unknown>;

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
    mode: SynthesisMode = 'wavetable';
    nodes: ModeNodes = {};
    touches = new Map<TouchId, unknown>();
    orientationParams: OrientationParams = { pan: 0, filterMod: 0, lfoRate: 0, shake: 0 };
    isQuantized = false;
    tonic = 9; // A
    scaleType = 'minor';
    scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
    silentAudio: HTMLAudioElement;
    ambientState: AmbientState | null = null;
    ambientInterval: ReturnType<typeof setInterval> | null = null;
    ambientTouchTimeout: ReturnType<typeof setTimeout> | null = null;

    // Buffer pool for Karplus-Strong to avoid repeated allocations
    private karplusBufferPool: PooledBuffer[] = [];

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

        // Delay
        const delayL = this.ctx.createDelay();
        const delayR = this.ctx.createDelay();
        this.delayFeedback = this.ctx.createGain();
        delayL.delayTime.value = DELAY_TIME_LEFT;
        delayR.delayTime.value = DELAY_TIME_RIGHT;
        this.delayFeedback.gain.value = DELAY_FEEDBACK_NORMAL;

        // Routing
        this.filter.connect(this.panner);
        this.panner.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

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
            case 'theremin': this.initTheremin(); break;
            case 'fm': this.initFM(); break;
            case 'chords': this.initChords(); break;
            case 'karplus': this.initKarplus(); break;
            case 'granular': this.initGranular(); break;
            case 'ambient': this.initAmbient(); break;
        }

        this.updateHUDLabels();
    }

    private cleanupOscillator(osc: OscillatorNode | null | undefined): void {
        if (!osc) return;
        try { osc.stop(); osc.disconnect(); } catch (e) { /* ignore */ }
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

    cleanupMode(): void {
        if (this.ambientInterval) {
            clearInterval(this.ambientInterval);
            this.ambientInterval = null;
        }
        if (this.ambientTouchTimeout) {
            clearTimeout(this.ambientTouchTimeout);
            this.ambientTouchTimeout = null;
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

                // Granular oscs
                if (Array.isArray(v.oscs)) {
                    for (const o of v.oscs) {
                        this.cleanupOscillator((o as GranularOsc).osc);
                        this.cleanupGain((o as GranularOsc).gain);
                    }
                }
            }
        }

        // Cleanup ambient mode drones
        if ('drones' in this.nodes && Array.isArray(this.nodes.drones)) {
            for (const drone of this.nodes.drones as DroneVoice[]) {
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

        if (y < 0.25) voice.osc.type = 'sine';
        else if (y < 0.5) voice.osc.type = 'triangle';
        else if (y < 0.75) voice.osc.type = 'sawtooth';
        else voice.osc.type = 'square';

        const durationFactor = Math.min(1, duration / 3);
        voice.lfoGain.gain.setTargetAtTime(durationFactor * 30, now, 0.1);
        voice.lfo.frequency.setTargetAtTime(2 + durationFactor * 4, now, 0.1);

        this.updateHUD(note.noteName + note.octave, voice.osc.type + (duration > 0.5 ? ' ~' : ''));
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

    // ============ THEREMIN MODE ============

    private initTheremin(): void {
        this.nodes = { voices: new Map<TouchId, ThereminVoice>() } as ThereminNodes;
    }

    private updateTheremin(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as ThereminNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const vibrato = this.ctx.createOscillator();
            const vibratoGain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0;
            vibrato.frequency.value = 5;
            vibratoGain.gain.value = 0;

            vibrato.connect(vibratoGain);
            vibratoGain.connect(osc.frequency);
            osc.connect(gain);
            gain.connect(this.filter);

            osc.start();
            vibrato.start();

            nodes.voices.set(touchId, { osc, gain, vibrato, vibratoGain });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 110);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.05);
        voice.gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.02);

        const durationFactor = Math.min(1, duration / 2);
        const vibratoDepth = y * 15 + durationFactor * 10;
        voice.vibratoGain.gain.setTargetAtTime(vibratoDepth, now, 0.05);
        voice.vibrato.frequency.setTargetAtTime(5 + durationFactor * 2, now, 0.1);

        this.updateHUD(note.noteName + note.octave, nodes.voices.size + ' voice' + (duration > 0.5 ? ' ♪' : ''));
    }

    private stopThereminVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as ThereminNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.gain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.vibrato);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.vibratoGain);
            nodes.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    // ============ FM SYNTHESIS MODE ============

    private initFM(): void {
        this.nodes = { voices: new Map<TouchId, FMVoice>(), ratio: 1 } as FMNodes;
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

        const durationFactor = Math.min(1, duration / 3);
        const baseIndex = y * 4;
        const modIndex = baseIndex + durationFactor * 6;
        const modFreq = carrierFreq * nodes.ratio;

        voice.carrier.frequency.setTargetAtTime(carrierFreq, now, 0.02);
        voice.modulator.frequency.setTargetAtTime(modFreq, now, 0.02);
        voice.modulatorGain.gain.setTargetAtTime(modIndex * carrierFreq, now, 0.02);
        voice.carrierGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.02);

        this.updateHUD(note.noteName + note.octave, 'idx:' + modIndex.toFixed(1) + (durationFactor > 0.3 ? '⚡' : ''));
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

    // ============ CHORDS MODE ============

    private initChords(): void {
        this.nodes = { voices: new Map<TouchId, ChordVoice>() } as ChordsNodes;
    }

    private updateChords(x: number, _y: number, touchId: TouchId = 0, duration = 0): void {
        if (!this.ctx || !this.filter) return;
        const nodes = this.nodes as ChordsNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(this.filter);
            gain.gain.value = 0;
            osc.start();
            nodes.voices.set(touchId, { osc, gain });
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 110);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.02);
        voice.gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.02);

        const durationFactor = Math.min(1, duration / 2);
        if (durationFactor < 0.33) voice.osc.type = 'sine';
        else if (durationFactor < 0.66) voice.osc.type = 'triangle';
        else voice.osc.type = 'sawtooth';

        this.updateHUD(note.noteName + note.octave, nodes.voices.size + ' voice ' + voice.osc.type.substring(0, 3));
    }

    private stopChordVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as ChordsNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
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

    private pluckString(freq: number, brightness: number): void {
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
        env.gain.setValueAtTime(0.4, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + KARPLUS_DECAY_DURATION);

        const lpf = this.ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = freq * (1 + brightness * 3);

        source.connect(lpf);
        lpf.connect(env);
        env.connect(this.filter);
        source.start();
        source.stop(now + KARPLUS_DECAY_DURATION + 0.5);

        // Release buffer back to pool after sound finishes
        setTimeout(() => {
            try { source.disconnect(); env.disconnect(); lpf.disconnect(); } catch (e) { /* ignore */ }
            this.releasePooledBuffer(buffer);
        }, (KARPLUS_DECAY_DURATION + 1) * 1000);
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

        if (duration < 0.2) {
            this.pluckString(note.freq, 0.3 + y * 0.6);
            voice.lastRepluck = now;
        } else if (duration > 0.5 && now - voice.lastRepluck > KARPLUS_REPLUCK_INTERVAL) {
            this.pluckString(note.freq, 0.2 + y * 0.4);
            voice.lastRepluck = now;
        }

        const modeStr = duration > 0.5 ? 'bow' : 'pluck';
        this.updateHUD(note.noteName + note.octave, modeStr + ' ' + nodes.voices.size + 'str');
    }

    // ============ GRANULAR MODE ============

    private initGranular(): void {
        this.nodes = { voices: new Map<TouchId, GranularVoice>() } as GranularNodes;
    }

    private createGranularVoice(): GranularVoice | null {
        if (!this.ctx || !this.filter) return null;

        const oscs: GranularOsc[] = [];
        const baseFreq = 110;

        for (let i = 0; i < 4; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = (['sine', 'triangle', 'sine', 'triangle'] as OscillatorType[])[i];
            osc.frequency.value = baseFreq * (1 + i * 0.5);
            osc.detune.value = (Math.random() - 0.5) * 20;
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            oscs.push({ osc, gain });
        }

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 0.1;
        lfoGain.gain.value = 10;
        lfo.connect(lfoGain);
        lfo.start();
        oscs.forEach(o => lfoGain.connect(o.osc.frequency));

        return { oscs, lfo, lfoGain };
    }

    private updateGranular(x: number, y: number, duration = 0, touchId: TouchId = 0): void {
        if (!this.ctx) return;
        const nodes = this.nodes as GranularNodes;
        const now = this.ctx.currentTime;

        if (!nodes.voices.has(touchId)) {
            if (!this.canAddVoice()) return;
            const voice = this.createGranularVoice();
            if (!voice) return;
            nodes.voices.set(touchId, voice);
        }

        const voice = nodes.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 2, 55);
        const baseFreq = note.freq;
        const durationFactor = Math.min(1, duration / 4);

        voice.oscs.forEach((o, i) => {
            const freq = baseFreq * (1 + i * 0.5 * (0.5 + y));
            o.osc.frequency.setTargetAtTime(freq, now, 0.1);
            const detune = (Math.random() - 0.5) * 20 + durationFactor * 30 * (i - 1.5);
            o.osc.detune.setTargetAtTime(detune, now, 0.3);
            const baseLevel = (i < 2) ? 0.25 : (y > i * 0.2 ? 0.15 : 0);
            const durationBoost = durationFactor * 0.08 * (i > 1 ? 1 : 0);
            o.gain.gain.setTargetAtTime(baseLevel + durationBoost, now, 0.1);
        });

        voice.lfo.frequency.setTargetAtTime(0.05 + y * 0.5 + durationFactor * 0.3, now, 0.1);
        voice.lfoGain.gain.setTargetAtTime(10 + durationFactor * 20, now, 0.1);

        this.updateHUD(note.noteName + note.octave, nodes.voices.size + 'g ' + Math.round(durationFactor * 100) + '%');
    }

    private stopGranularVoice(touchId: TouchId, releaseTime = 0.1): void {
        if (!this.ctx) return;
        const nodes = this.nodes as GranularNodes;
        if (!nodes.voices?.has(touchId)) return;

        const voice = nodes.voices.get(touchId)!;
        const now = this.ctx.currentTime;
        voice.oscs.forEach(o => o.gain.gain.setTargetAtTime(0, now, releaseTime));

        setTimeout(() => {
            voice.oscs.forEach(o => {
                this.cleanupOscillator(o.osc);
                this.cleanupGain(o.gain);
            });
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.lfoGain);
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

        const drones: DroneVoice[] = [];
        const droneCount = 4;
        const baseFreq = AMBIENT_BASE_FREQ;
        const voiceRatios = [1, 1.5, 2, 3];
        const panPositions = [-0.6, -0.2, 0.2, 0.6];

        for (let v = 0; v < droneCount; v++) {
            const drone = this.createDroneVoice(baseFreq * voiceRatios[v], panPositions[v]);
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
            baseFreq
        } as AmbientNodes;

        this.startAmbientLoop();
    }

    private createDroneVoice(freq: number, panPosition: number): DroneVoice | null {
        if (!this.ctx || !this.filter) return null;

        const oscs: DroneOsc[] = [];
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
        if (!this.ambientState) return;

        const state = this.ambientState;
        const influence = Math.min(1, 0.4 + duration * 0.4);
        state.targetX = state.targetX * (1 - influence) + x * influence;
        state.targetY = state.targetY * (1 - influence) + y * influence;
        state.touchActive = true;

        if (this.ambientTouchTimeout) clearTimeout(this.ambientTouchTimeout);
        this.ambientTouchTimeout = setTimeout(() => {
            if (this.ambientState) this.ambientState.touchActive = false;
        }, AMBIENT_TOUCH_TIMEOUT);
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
            theremin: ['X: Note | β: Cutoff', 'Y: Vibrato | γ: Q'],
            fm: ['X: Pitch | β: Cutoff', 'Y: Mod | γ: Q'],
            chords: ['X: Note | β: Cutoff', 'Multi-touch | γ: Q'],
            karplus: ['X: Note | β: Cutoff', 'Y: Bright | γ: Q'],
            granular: ['X: Base | β: Cutoff', 'Y: Density | γ: Q'],
            ambient: ['X: Pitch drift | β: Cutoff', 'Y: Brightness | γ: Q']
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

        if (this.mode === 'ambient') {
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

        const releaseTime = RELEASE_TIME_BASE + Math.min(RELEASE_TIME_MAX_ADDITION, duration * 0.3);

        switch (this.mode) {
            case 'wavetable': this.stopWavetableVoice(touchId, releaseTime); break;
            case 'theremin': this.stopThereminVoice(touchId, releaseTime); break;
            case 'fm': this.stopFMVoice(touchId, releaseTime); break;
            case 'chords': this.stopChordVoice(touchId, releaseTime); break;
            case 'karplus':
                const kNodes = this.nodes as KarplusNodes;
                if (kNodes.voices) kNodes.voices.delete(touchId);
                break;
            case 'granular': this.stopGranularVoice(touchId, releaseTime); break;
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
            case 'theremin': this.updateTheremin(clampedX, clampedY, duration, touchId); break;
            case 'fm': this.updateFM(clampedX, clampedY, duration, touchId); break;
            case 'chords': this.updateChords(clampedX, clampedY, touchId, duration); break;
            case 'karplus': this.updateKarplus(clampedX, clampedY, duration, touchId); break;
            case 'granular': this.updateGranular(clampedX, clampedY, duration, touchId); break;
            case 'ambient': this.updateAmbient(clampedX, clampedY, duration); break;
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

    updateOrientation(beta: number | null, gamma: number | null): void {
        if (!this.ctx || !this.filter) return;
        const now = this.ctx.currentTime;

        const clampedBeta = clamp(beta || 0, 0, 90);
        const filterMod = clampedBeta / 90;
        this.orientationParams.filterMod = filterMod;

        const tiltCutoff = FILTER_MIN_FREQ * Math.pow(FILTER_MAX_FREQ / FILTER_MIN_FREQ, 1 - filterMod);
        this.filter.frequency.setTargetAtTime(tiltCutoff, now, 0.1);

        const clampedGamma = clamp(gamma || 0, -45, 45);
        const gammaNorm = Math.abs(clampedGamma) / 45;
        this.orientationParams.pan = gammaNorm;

        const targetQ = FILTER_Q_MIN + (gammaNorm * (FILTER_Q_MAX - FILTER_Q_MIN));
        this.filter.Q.setTargetAtTime(targetQ, now, 0.1);

        const tiltEl = document.getElementById('val-tilt');
        if (tiltEl) tiltEl.innerText = `${Math.round(tiltCutoff)}Hz Q:${targetQ.toFixed(1)}`;
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

            if (this.mode === 'fm') {
                const fmNodes = this.nodes as FMNodes;
                if (fmNodes.ratio !== undefined) {
                    fmNodes.ratio = 1 + Math.floor(rotMagnitude / FM_ROTATION_THRESHOLD);
                }
            }
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
