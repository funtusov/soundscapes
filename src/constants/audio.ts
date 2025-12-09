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
    pentatonic: [0, 2, 4, 7, 9],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

// ============ LOOP RECORDER CONSTANTS ============

/** Base offset for playback touch IDs to avoid conflicts */
export const LOOP_TOUCH_ID_OFFSET = 10000;

/** Touch ID offset per loop iteration */
export const LOOP_ITERATION_OFFSET = 1000;

// ============ SYNTHESIS MODE TYPES ============

/** Available synthesis modes */
export const SYNTHESIS_MODES = [
    'wavetable',
    'drone',
    'fm',
    'arpeggiator',
    'karplus',
    'formant',
    'ambient',
    'bassline',
    'focus',
    'relaxation'
] as const;

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
