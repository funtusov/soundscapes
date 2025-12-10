/**
 * Voice interfaces for each synthesis mode
 */

export type TouchId = number | string;

// ============ WAVETABLE MODE ============

export interface WavetableVoice {
    osc: OscillatorNode;
    gain: GainNode;
    lfo: OscillatorNode;           // Vibrato (pitch modulation)
    lfoGain: GainNode;
    tremoloLfo: OscillatorNode;    // Tremolo (amplitude modulation)
    tremoloGain: GainNode;
    tremoloDepth: GainNode;        // Controls tremolo amount
}

// ============ DRONE MODE ============

export interface DroneVoiceOsc {
    osc: OscillatorNode;
    gain: GainNode;
    interval: number;
}

export interface DroneVoice {
    oscs: DroneVoiceOsc[];
    masterGain: GainNode;
    filterEnv: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
}

// ============ FM MODE ============

export interface FMVoice {
    carrier: OscillatorNode;
    carrierGain: GainNode;
    modulator: OscillatorNode;
    modulatorGain: GainNode;
}

// ============ ARPEGGIATOR MODE ============

export interface ArpVoice {
    osc: OscillatorNode;
    gain: GainNode;
    currentStep: number;
    intervalId: ReturnType<typeof setInterval> | null;
    pattern: number[];
    baseFreq: number;
}

// ============ KARPLUS-STRONG MODE ============

export interface KarplusVoice {
    lastRepluck: number;
}

export interface PooledBuffer {
    buffer: AudioBuffer;
    size: number;
    inUse: boolean;
}

// ============ FORMANT MODE ============

export interface FormantFilter {
    filter: BiquadFilterNode;
    gain: GainNode;
}

export interface FormantVoice {
    source: OscillatorNode;
    noiseSource: AudioBufferSourceNode;
    noiseMix: GainNode;
    sourceMix: GainNode;
    formants: FormantFilter[];
    masterGain: GainNode;
    currentVowel: string;
}

// ============ BASSLINE MODE ============

import type { BassPattern } from '../constants';

export interface BassState {
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

// ============ AMBIENT MODE ============

export interface AmbientDroneOsc {
    osc: OscillatorNode;
    gain: GainNode;
    baseDetune: number;
}

export interface AmbientDroneVoice {
    oscs: AmbientDroneOsc[];
    voiceGain: GainNode;
    panner: StereoPannerNode;
    baseFreq: number;
    panBase: number;
    detunePhase: number;
    panPhase: number;
}

export interface NoiseBed {
    source: AudioBufferSourceNode;
    bandpass: BiquadFilterNode;
    lowpass: BiquadFilterNode;
    gain: GainNode;
    panner: StereoPannerNode;
    filterPhase: number;
}

export interface ShimmerPartial {
    osc: OscillatorNode;
    gain: GainNode;
    tremolo: OscillatorNode;
    tremoloGain: GainNode;
    ratio: number;
}

export interface ShimmerLayer {
    partials: ShimmerPartial[];
    masterGain: GainNode;
}

export interface AmbientState {
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

// ============ ONEHEART MODE ============

export interface OneheartPadOsc {
    osc: OscillatorNode;
    gain: GainNode;
    baseDetune: number;
    panPosition: number;
}

export interface OneheartPadVoice {
    oscs: OneheartPadOsc[];
    voiceGain: GainNode;
    panner: StereoPannerNode;
    noteFreq: number;
    detunePhase: number;
}

export interface OneheartState {
    currentChordIndex: number;
    nextChordIndex: number;
    chordTransitionProgress: number;
    lastChordChange: number;
    filterPhase: number;
    evolutionPhase: number;
    brightness: number;
    isActive: boolean;
}

// ============ TEXTURE NODES ============

export interface TextureNodes {
    noiseBuffer: AudioBuffer;
    noiseSource: AudioBufferSourceNode | null;
    gain: GainNode;
    filter: BiquadFilterNode;
    filter2?: BiquadFilterNode;
    lfo?: OscillatorNode;
    lfoGain?: GainNode;
}
