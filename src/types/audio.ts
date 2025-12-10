/**
 * Audio-related types and node containers
 */

import type {
    TouchId,
    WavetableVoice,
    DroneVoice,
    FMVoice,
    ArpVoice,
    KarplusVoice,
    FormantVoice,
    AmbientDroneVoice,
    NoiseBed,
    ShimmerLayer,
    OneheartPadVoice,
} from './voices';

// ============ ORIENTATION/INPUT PARAMS ============

export interface OrientationParams {
    pan: number;
    filterMod: number;
    lfoRate: number;
    shake: number;
    compass: number;  // Alpha (compass heading) 0-360
}

export interface NoteInfo {
    freq: number;
    semitone: number;
    noteName: string;
    octave: number;
    isQuantized: boolean;
}

/** Voice info for HUD display */
export interface VoiceDisplayInfo {
    touchId: TouchId;
    noteName: string;
    octave: number;
    freq: number;
    waveform: string;  // e.g. "sine", "saw↔square"
}

// ============ MODE NODE CONTAINERS ============

export interface WavetableNodes {
    voices: Map<TouchId, WavetableVoice>;
}

export interface DroneNodes {
    voices: Map<TouchId, DroneVoice>;
}

export interface FMNodes {
    voices: Map<TouchId, FMVoice>;
    ratio: number;
}

export interface ArpNodes {
    voices: Map<TouchId, ArpVoice>;
}

export interface KarplusNodes {
    voices: Map<TouchId, KarplusVoice>;
    lastPluck: number;
}

export interface FormantNodes {
    voices: Map<TouchId, FormantVoice>;
}

export interface AmbientNodes {
    drones: AmbientDroneVoice[];
    noiseBed: NoiseBed;
    shimmer: ShimmerLayer;
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    baseFreq: number;
    currentChordIndex: number;
    chordTransitionTime: number;
}

export interface OneheartNodes {
    pads: OneheartPadVoice[];
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    masterGain: GainNode;
}

export type ModeNodes =
    | WavetableNodes
    | DroneNodes
    | FMNodes
    | ArpNodes
    | KarplusNodes
    | FormantNodes
    | AmbientNodes
    | OneheartNodes
    | Record<string, unknown>;

// ============ GLOBAL DECLARATIONS ============

// Extend Window for Safari AudioContext
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}
