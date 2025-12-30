/**
 * Core audio constants - gain, filter, timing, effects
 */

// ============ AUDIO GAIN CONSTANTS ============

/** Maximum number of simultaneous voices to prevent CPU overload */
export const MAX_VOICES = 10;

/** Master gain level when playing */
export const MASTER_GAIN = 0.7;

/** Ambient mode master gain (quieter) */
export const AMBIENT_MASTER_GAIN = 0.5;

/** Default voice gain */
export const VOICE_GAIN = 0.3;

/** Delay feedback gain (normal) */
export const DELAY_FEEDBACK_NORMAL = 0.25;

/** Delay feedback gain (shake triggered) */
export const DELAY_FEEDBACK_SHAKE = 0.6;

/** Shake trigger duration in ms */
export const SHAKE_DURATION_MS = 300;

/** Left delay time in seconds */
export const DELAY_TIME_LEFT = 0.25;

/** Right delay time in seconds */
export const DELAY_TIME_RIGHT = 0.35;

// ============ FILTER CONSTANTS ============

/** Minimum filter cutoff frequency in Hz */
export const FILTER_MIN_FREQ = 80;

/** Maximum filter cutoff frequency in Hz */
export const FILTER_MAX_FREQ = 8000;

/** Filter Q range minimum */
export const FILTER_Q_MIN = 0.5;

/** Filter Q range maximum */
export const FILTER_Q_MAX = 15;

/** Default filter Q value */
export const FILTER_Q_DEFAULT = 1;

// ============ ANALYSER CONSTANTS ============

/** FFT size for frequency analysis */
export const FFT_SIZE = 4096;

/** Analyser smoothing time constant */
export const ANALYSER_SMOOTHING = 0.1;

/** Analyser minimum decibels */
export const ANALYSER_MIN_DB = -100;

/** Analyser maximum decibels */
export const ANALYSER_MAX_DB = -10;

// ============ TIMING CONSTANTS ============

/** Voice release time in seconds (base) */
export const RELEASE_TIME_BASE = 0.1;

/** Maximum additional release time based on duration */
export const RELEASE_TIME_MAX_ADDITION = 1.4;

/** Voice cleanup buffer time in ms */
export const VOICE_CLEANUP_BUFFER_MS = 200;

// ============ MOTION CONSTANTS ============

/** Acceleration threshold for shake detection */
export const SHAKE_ACCELERATION_THRESHOLD = 5;

/** FM ratio rotation threshold */
export const FM_ROTATION_THRESHOLD = 30;

// ============ FILTER LFO CONSTANTS ============

/** Filter LFO rate when centered (fast, subtle) */
export const FILTER_LFO_RATE_CENTER = 8;

/** Filter LFO rate when fully tilted (slow, dramatic) */
export const FILTER_LFO_RATE_TILTED = 0.5;

/** Filter LFO depth when centered (minimal) */
export const FILTER_LFO_DEPTH_CENTER = 0;

/** Filter LFO depth when fully tilted (Hz range of sweep) */
export const FILTER_LFO_DEPTH_TILTED = 3000;

// ============ REVERB CONSTANTS ============

/** Reverb levels with wet/dry mix and decay time */
export const REVERB_PRESETS = {
    off: { wet: 0, dry: 1, decay: 0 },
    on: { wet: 0.8, dry: 0.6, decay: 2.5 }
} as const;

export type ReverbLevel = keyof typeof REVERB_PRESETS;

/** Order for cycling through reverb levels */
export const REVERB_CYCLE: ReverbLevel[] = ['off', 'on'];

/** Delay toggle presets */
export const DELAY_PRESETS = {
    off: { feedback: 0, mix: 0 },
    on: { feedback: 0.4, mix: 0.3 }
} as const;

export type DelayLevel = keyof typeof DELAY_PRESETS;

/** Sample rate for impulse response generation */
export const REVERB_SAMPLE_RATE = 48000;

// ============ TOUCH PROFILE CONSTANTS ============

/** Touch category thresholds */
export const TOUCH_TAP_MAX_DURATION = 0.2;
export const TOUCH_PRESS_MAX_DURATION = 1.0;

/** Touch profiles for envelope shaping */
export const TOUCH_PROFILES = {
    tap: {
        maxDuration: 0.2,
        releaseTime: 0.05,
        filterReleaseTime: 0.02,
        reverbBoost: 0,
        brightnessHold: true
    },
    press: {
        maxDuration: 1.0,
        releaseTime: 0.25,
        filterReleaseTime: 0.15,
        reverbBoost: 0.15,
        brightnessHold: false
    },
    hold: {
        maxDuration: Infinity,
        releaseTime: 0.8,
        filterReleaseTime: 0.4,
        reverbBoost: 0.3,
        brightnessHold: false
    }
} as const;

export type TouchCategory = keyof typeof TOUCH_PROFILES;

// ============ FREQUENCY CONSTANTS ============

/** Note names for display */
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Scale patterns by name */
export const SCALE_PATTERNS: Record<string, number[]> = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    // Backwards-compatible alias (major pentatonic)
    pentatonic: [0, 2, 4, 7, 9],
    pent_maj: [0, 2, 4, 7, 9],           // Major pentatonic
    pent_min: [0, 3, 5, 7, 10],          // Minor pentatonic
    blues: [0, 3, 5, 6, 7, 10],          // Blues scale (minor pent + blue note)
    dorian: [0, 2, 3, 5, 7, 9, 10],      // Jazz/funk mode
    lydian: [0, 2, 4, 6, 7, 9, 11],      // Dreamy/ethereal mode
    mixolydian: [0, 2, 4, 5, 7, 9, 10],  // Rock/blues mode
    harm_min: [0, 2, 3, 5, 7, 8, 11],    // Harmonic minor
    whole_tone: [0, 2, 4, 6, 8, 10],     // Dreamy/impressionist
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// ============ ARPEGGIO / CHORD CONSTANTS ============

/** Chord types with intervals (semitones from root) */
export const CHORD_INTERVALS = {
    major: [0, 4, 7],       // Major triad
    minor: [0, 3, 7],       // Minor triad
    dim: [0, 3, 6],         // Diminished triad
    aug: [0, 4, 8],         // Augmented triad
    sus4: [0, 5, 7],        // Suspended 4th
    power: [0, 7, 12],      // Power chord (for pentatonics)
} as const;

export type ChordType = keyof typeof CHORD_INTERVALS;

/**
 * Diatonic chord qualities for each scale degree
 * Maps scale type to an array of chord types (one per scale degree)
 */
export const DIATONIC_CHORDS: Record<string, ChordType[]> = {
    // Major: I-maj, ii-min, iii-min, IV-maj, V-maj, vi-min, vii°-dim
    major: ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim'],
    // Natural minor: i-min, ii°-dim, III-maj, iv-min, v-min, VI-maj, VII-maj
    minor: ['minor', 'dim', 'major', 'minor', 'minor', 'major', 'major'],
    // Harmonic minor: i-min, ii°-dim, III+-aug, iv-min, V-maj, VI-maj, vii°-dim
    harm_min: ['minor', 'dim', 'aug', 'minor', 'major', 'major', 'dim'],
    // Dorian: i-min, ii-min, III-maj, IV-maj, v-min, vi°-dim, VII-maj
    dorian: ['minor', 'minor', 'major', 'major', 'minor', 'dim', 'major'],
    // Lydian: I-maj, II-maj, iii-min, iv°-dim, V-maj, vi-min, vii-min
    lydian: ['major', 'major', 'minor', 'dim', 'major', 'minor', 'minor'],
    // Mixolydian: I-maj, ii-min, iii°-dim, IV-maj, v-min, vi-min, VII-maj
    mixolydian: ['major', 'minor', 'dim', 'major', 'minor', 'minor', 'major'],
    // Pentatonic major: Use power chords for ambiguity (1, 2, 3, 5, 6)
    pent_maj: ['major', 'minor', 'minor', 'major', 'minor'],
    // Pentatonic minor: Use minor/power chords (1, b3, 4, 5, b7)
    pent_min: ['minor', 'major', 'sus4', 'power', 'minor'],
    // Blues: Similar to pentatonic minor
    blues: ['minor', 'major', 'sus4', 'dim', 'power', 'minor'],
    // Whole tone: All augmented
    whole_tone: ['aug', 'aug', 'aug', 'aug', 'aug', 'aug'],
    // Chromatic: Default to major
    chromatic: ['major', 'minor', 'major', 'minor', 'major', 'major', 'minor', 'major', 'minor', 'major', 'minor', 'dim'],
};

/** Default arpeggio rate (notes per second) */
export const ARP_DEFAULT_RATE = 6;

/** Arpeggio rate range */
export const ARP_RATE_MIN = 2;
export const ARP_RATE_MAX = 16;

// ============ LOOP RECORDER CONSTANTS ============

/** Base offset for playback touch IDs to avoid conflicts */
export const LOOP_TOUCH_ID_OFFSET = 10000;

/** Touch ID offset per loop iteration */
export const LOOP_ITERATION_OFFSET = 1000;

// ============ ADSR ENVELOPE PRESETS ============

/** ADSR envelope preset type */
export interface ADSRPreset {
    name: string;
    attack: number;   // Attack time in seconds
    decay: number;    // Decay time in seconds
    sustain: number;  // Sustain level (0-1)
    release: number;  // Release time in seconds
}

/** Available ADSR envelope presets */
export const ADSR_PRESETS: ADSRPreset[] = [
    {
        name: 'Pad',
        attack: 0.005,   // Instant attack
        decay: 0.0,      // No decay
        sustain: 1.0,    // Full sustain
        release: 0.3,    // Medium release
    },
    {
        name: 'Swell',
        attack: 0.6,     // Slow fade-in
        decay: 0.0,      // No decay
        sustain: 1.0,    // Full sustain
        release: 1.2,    // Long dreamy release
    },
    {
        name: 'Pluck',
        attack: 0.001,   // Instant attack
        decay: 0.4,      // Decay over 400ms
        sustain: 0.35,   // Settles to 35% - noticeable drop
        release: 0.15,   // Quick release
    },
    {
        name: 'Soft',
        attack: 0.15,    // Gentle 150ms rise
        decay: 0.2,      // Slight bloom-and-settle
        sustain: 0.8,    // High sustain
        release: 0.5,    // Gentle release
    },
];

// ============ SYNTHESIS MODE TYPES ============

/** Available synthesis modes */
export const SYNTHESIS_MODES = ['wavetable'] as const;

export type SynthesisMode = typeof SYNTHESIS_MODES[number];

// ============ UTILITY FUNCTIONS ============

/** Clamp a value between min and max */
export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** Convert Hz to Mel scale */
export function hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700);
}

/** Convert Mel scale to Hz */
export function melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}
