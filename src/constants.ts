/**
 * CONSTANTS - Centralized configuration values
 */

// ============ AUDIO CONSTANTS ============

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

// ============ VISUALIZER CONSTANTS ============

/** Number of frames in spectrogram history */
export const SPECTROGRAM_HISTORY = 120;

/** Number of mel frequency bins */
export const MEL_BINS = 256;

/** Mel filterbank minimum frequency */
export const MEL_MIN_FREQ = 20;

/** Mel filterbank maximum frequency */
export const MEL_MAX_FREQ = 8000;

/** Spectrogram display minimum value */
export const SPECTROGRAM_MIN_VAL = -90;

/** Spectrogram display maximum value */
export const SPECTROGRAM_MAX_VAL = -20;

// ============ UI CONSTANTS ============

/** Height of the control bar at bottom of screen */
export const CONTROL_BAR_HEIGHT = 130;

/** Cursor glow radius in pixels */
export const CURSOR_GLOW_RADIUS = 60;

/** Cursor center dot radius in pixels */
export const CURSOR_DOT_RADIUS = 5;

/** Initial ripple radius */
export const RIPPLE_INITIAL_RADIUS = 10;

/** Ripple expansion rate per frame */
export const RIPPLE_EXPANSION_RATE = 2;

/** Ripple opacity decay rate per frame */
export const RIPPLE_DECAY_RATE = 0.02;

// ============ TIMING CONSTANTS ============

/** Voice release time in seconds (base) */
export const RELEASE_TIME_BASE = 0.1;

/** Maximum additional release time based on duration */
export const RELEASE_TIME_MAX_ADDITION = 1.4;

/** Voice cleanup buffer time in ms */
export const VOICE_CLEANUP_BUFFER_MS = 200;

/** Karplus-Strong minimum pluck interval in seconds */
export const KARPLUS_MIN_PLUCK_INTERVAL = 0.03;

/** Karplus-Strong auto-repluck interval in seconds */
export const KARPLUS_REPLUCK_INTERVAL = 0.25;

/** Karplus-Strong decay duration in seconds */
export const KARPLUS_DECAY_DURATION = 2;

// ============ AMBIENT MODE CONSTANTS ============

/** Ambient mode base frequency */
export const AMBIENT_BASE_FREQ = 110;

/** Ambient slow LFO frequency (Hz) - ~33 second cycle */
export const AMBIENT_LFO_SLOW = 0.03;

/** Ambient medium LFO frequency (Hz) - ~8 second cycle */
export const AMBIENT_LFO_MEDIUM = 0.12;

/** Ambient evolution loop interval in ms (~60fps) */
export const AMBIENT_LOOP_INTERVAL = 16;

/** Ambient touch timeout in ms */
export const AMBIENT_TOUCH_TIMEOUT = 200;

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

// ============ MOTION CONSTANTS ============

/** Acceleration threshold for shake detection */
export const SHAKE_ACCELERATION_THRESHOLD = 5;

/** FM ratio rotation threshold */
export const FM_ROTATION_THRESHOLD = 30;

// ============ REVERB CONSTANTS ============

/** Reverb levels with wet/dry mix and decay time */
export const REVERB_PRESETS = {
    off: { wet: 0, dry: 1, decay: 0 },
    high: { wet: 0.8, dry: 0.6, decay: 3.0 }
} as const;

export type ReverbLevel = keyof typeof REVERB_PRESETS;

/** Order for cycling through reverb levels */
export const REVERB_CYCLE: ReverbLevel[] = ['off', 'high'];

/** Sample rate for impulse response generation */
export const REVERB_SAMPLE_RATE = 48000;

// ============ BUFFER POOL CONSTANTS ============

/** Maximum number of buffers to keep in Karplus-Strong pool */
export const KARPLUS_BUFFER_POOL_SIZE = 8;

/** Standard buffer sizes for pooling (covers common frequency ranges) */
export const KARPLUS_BUFFER_SIZES = [128, 256, 512, 1024, 2048] as const;

// ============ LOOP RECORDER CONSTANTS ============

/** Base offset for playback touch IDs to avoid conflicts */
export const LOOP_TOUCH_ID_OFFSET = 10000;

/** Touch ID offset per loop iteration */
export const LOOP_ITERATION_OFFSET = 1000;

// ============ SYNTHESIS MODE TYPES ============

/** Available synthesis modes */
export const SYNTHESIS_MODES = [
    'wavetable',
    'theremin',
    'fm',
    'chords',
    'karplus',
    'granular',
    'ambient'
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
