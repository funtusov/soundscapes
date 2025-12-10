/**
 * Audio-related types and node containers
 */

import type { TouchId, WavetableVoice } from './voices';

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

export type ModeNodes = WavetableNodes | Record<string, unknown>;

// ============ GLOBAL DECLARATIONS ============

// Extend Window for Safari AudioContext
declare global {
    interface Window {
        webkitAudioContext: typeof AudioContext;
    }
}
