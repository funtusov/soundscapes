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

// ============ BUFFER POOL CONSTANTS ============

/** Maximum number of buffers to keep in Karplus-Strong pool */
export const KARPLUS_BUFFER_POOL_SIZE = 8;

/** Standard buffer sizes for pooling (covers common frequency ranges) */
export const KARPLUS_BUFFER_SIZES = [128, 256, 512, 1024, 2048] as const;

// ============ TOUCH PROFILE CONSTANTS ============

/** Touch category thresholds */
export const TOUCH_TAP_MAX_DURATION = 0.2;
export const TOUCH_PRESS_MAX_DURATION = 1.0;

/** Touch profiles for envelope shaping */
export const TOUCH_PROFILES = {
    tap: {
        maxDuration: 0.2,
        releaseTime: 0.05,
        filterReleaseTime: 0.02,    // filter snaps shut quickly
        reverbBoost: 0,              // stay dry
        brightnessHold: true         // stays bright through release
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
        filterReleaseTime: 0.4,      // filter closes slowly
        reverbBoost: 0.3,            // more reverb tail
        brightnessHold: false
    }
} as const;

export type TouchCategory = keyof typeof TOUCH_PROFILES;

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
    'oneheart'
] as const;

export type SynthesisMode = typeof SYNTHESIS_MODES[number];

// ============ DRONE MODE CONSTANTS ============

/** Chord intervals for drone mode (semitones from root) */
export const DRONE_CHORD_TYPES = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    sus4: [0, 5, 7],
    seventh: [0, 4, 7, 10],
    minor7: [0, 3, 7, 10],
    power: [0, 7, 12]
} as const;

/** Drone mode filter sweep time */
export const DRONE_FILTER_SWEEP_TIME = 2.0;

// ============ ARPEGGIATOR CONSTANTS ============

/** Arpeggiator patterns (intervals from root) */
export const ARP_PATTERNS = {
    up: [0, 4, 7, 12],
    down: [12, 7, 4, 0],
    updown: [0, 4, 7, 12, 7, 4],
    random: [0, 4, 7, 12]  // Will be randomized at runtime
} as const;

/** Arpeggiator speed range (notes per second) */
export const ARP_SPEED_MIN = 2;
export const ARP_SPEED_MAX = 16;

/** Arpeggiator note duration as fraction of interval */
export const ARP_NOTE_DURATION = 0.8;

// ============ FORMANT/VOICE CONSTANTS ============

/** Formant frequencies for vowels [F1, F2, F3] in Hz */
export const FORMANT_VOWELS = {
    a: [800, 1200, 2500],   // "ah"
    e: [400, 2200, 2800],   // "eh"
    i: [280, 2300, 3000],   // "ee"
    o: [450, 800, 2500],    // "oh"
    u: [325, 700, 2500]     // "oo"
} as const;

/** Formant filter Q values */
export const FORMANT_Q = [10, 12, 8];

/** Formant transition time */
export const FORMANT_TRANSITION_TIME = 0.15;

// ============ ENHANCED KARPLUS CONSTANTS ============

/** Karplus body resonance frequencies (ratios of fundamental) */
export const KARPLUS_BODY_RESONANCES = [1.0, 2.0, 3.5];

/** Karplus sympathetic string ratios */
export const KARPLUS_SYMPATHETIC_RATIOS = [1.5, 2.0, 3.0];

/** Karplus sympathetic string gain */
export const KARPLUS_SYMPATHETIC_GAIN = 0.15;

/** Karplus decay range (seconds) */
export const KARPLUS_DECAY_MIN = 0.5;
export const KARPLUS_DECAY_MAX = 4.0;

// ============ AMBIENT CHORD CONSTANTS ============

/** Ambient mode chord progressions (semitone offsets from base) */
export const AMBIENT_CHORDS = [
    [0, 7, 12],      // Power chord / fifth
    [0, 5, 12],      // Sus4
    [0, 4, 7],       // Major
    [0, 3, 7],       // Minor
    [0, 7, 14],      // Octave + fifth
    [0, 5, 7]        // Sus4 close
] as const;

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

// ============ BASSLINE MODE CONSTANTS ============

/** Bassline tempo range (BPM) mapped from compass heading */
export const BASS_TEMPO_MIN = 60;
export const BASS_TEMPO_MAX = 180;

/** Bassline base frequency (low bass range) */
export const BASS_BASE_FREQ = 41.2; // E1

/** Bassline patterns (semitone offsets from root, with durations)
 * Y-axis controls complexity: simple at bottom, complex at top
 * Each step is [semitone_offset, duration_fraction_of_beat]
 */
export const BASS_PATTERNS = {
    // Simple: just root
    pulse: [[0, 1]],
    // Root-fifth basic
    bounce: [[0, 0.5], [7, 0.5]],
    // Classic walking: root, third, fifth, approach
    walk: [[0, 0.25], [4, 0.25], [7, 0.25], [5, 0.25]],
    // Chromatic approach walking bass
    chromatic: [[0, 0.25], [3, 0.25], [5, 0.25], [6, 0.25]],
    // Bebop-style with passing tones
    bebop: [[0, 0.25], [2, 0.125], [3, 0.125], [5, 0.25], [7, 0.25]],
    // Syncopated funk
    funk: [[0, 0.375], [0, 0.125], [5, 0.25], [7, 0.25]],
    // Complex jazz walking with octave jump
    jazz: [[0, 0.25], [4, 0.25], [7, 0.125], [12, 0.125], [10, 0.25]]
} as const;

export type BassPattern = keyof typeof BASS_PATTERNS;

/** Order of bass patterns for Y-axis selection (simple → complex) */
export const BASS_PATTERN_ORDER: BassPattern[] = ['pulse', 'bounce', 'walk', 'chromatic', 'bebop', 'funk', 'jazz'];

// ============ ONEHEART MODE CONSTANTS ============

/** Oneheart mood modes */
export type OneheartMood = 'focus' | 'relaxation' | 'sleep';

/** Oneheart master gain */
export const ONEHEART_MASTER_GAIN = 0.7;

/** Oneheart evolution loop interval in ms (~60fps) */
export const ONEHEART_LOOP_INTERVAL = 16;

/** Oneheart chord change interval in ms (20-30 seconds) */
export const ONEHEART_CHORD_DURATION = 25000;

/** Oneheart chord crossfade time in ms */
export const ONEHEART_CHORD_TRANSITION = 6000;

/** Oneheart base frequency (low, warm) */
export const ONEHEART_BASE_FREQ = 65.41; // C2

/** Oneheart LFO rates (very slow for dreamy movement) */
export const ONEHEART_LFO_SLOW = 0.02;    // ~50 second cycle
export const ONEHEART_LFO_MEDIUM = 0.08;  // ~12 second cycle

/** Oneheart filter range */
export const ONEHEART_FILTER_MIN = 200;
export const ONEHEART_FILTER_MAX = 3000;
export const ONEHEART_FILTER_SWEEP_TIME = 20000; // 20 seconds for full sweep

/** Oneheart detune range for pad voices (cents) */
export const ONEHEART_DETUNE_RANGE = 12;

/** Focus mode chord progressions (semitone intervals from root)
 * Using maj7, add9, sus2 for dreamy, uplifting sound
 */
export const ONEHEART_FOCUS_CHORDS = [
    // Cmaj7
    [0, 4, 7, 11],
    // Fmaj7 (IV)
    [5, 9, 12, 16],
    // Am7 (vi)
    [9, 12, 16, 19],
    // G (V add9)
    [7, 11, 14, 21],
    // Emin7 (iii)
    [4, 7, 11, 14],
    // Dm7 (ii)
    [2, 5, 9, 12],
    // Gsus4
    [7, 12, 14, 19],
    // Cadd9
    [0, 4, 7, 14],
] as const;

/** Relaxation mode chords (sus chords, warmer) */
export const ONEHEART_RELAXATION_CHORDS = [
    [0, 5, 7, 12],      // Csus4
    [5, 10, 12, 17],    // Fsus4
    [7, 12, 14, 19],    // Gsus4
    [0, 5, 7, 14],      // Csus2
    [9, 12, 16, 21],    // Am add9
] as const;

/** Sleep mode chords (minor, sparse, darker) */
export const ONEHEART_SLEEP_CHORDS = [
    [0, 3, 7],          // Cm
    [5, 8, 12],         // Fm
    [7, 10, 14],        // Gm
    [3, 7, 10],         // Eb
    [0, 7, 12],         // C5 (power, sparse)
] as const;

/** Oneheart reverb preset (long, lush tail) */
export const ONEHEART_REVERB = {
    decay: 6.0,         // 6 second tail
    wet: 0.65,
    dry: 0.5,
    damping: 0.5        // High frequency rolloff factor
} as const;

/** Focus mode preset */
export const FOCUS_PRESET = {
    chords: ONEHEART_FOCUS_CHORDS,
    chordDuration: 25000,
    filterRange: [400, 3000] as const,
    textureLevel: 0.05,     // Very subtle vinyl
    reverbDecay: 6.0,
    evolutionSpeed: 1.0,    // Normal speed
    brightness: 0.7,        // Brighter for focus
    padCount: 4,            // 4-voice pad
    detuneAmount: 8,        // Cents of detune per voice
} as const;

/** Relaxation mode preset (future) */
export const RELAXATION_PRESET = {
    chords: ONEHEART_RELAXATION_CHORDS,
    chordDuration: 35000,
    filterRange: [300, 2000] as const,
    textureLevel: 0.15,
    reverbDecay: 8.0,
    evolutionSpeed: 0.7,
    brightness: 0.5,
    padCount: 4,
    detuneAmount: 12,
} as const;

/** Sleep mode preset (future) */
export const SLEEP_PRESET = {
    chords: ONEHEART_SLEEP_CHORDS,
    chordDuration: 45000,
    filterRange: [150, 1200] as const,
    textureLevel: 0.25,
    reverbDecay: 10.0,
    evolutionSpeed: 0.4,
    brightness: 0.25,
    padCount: 3,
    detuneAmount: 15,
} as const;

/** Mood presets map */
export const ONEHEART_PRESETS = {
    focus: FOCUS_PRESET,
    relaxation: RELAXATION_PRESET,
    sleep: SLEEP_PRESET,
} as const;

// ============ TEXTURE CONSTANTS ============

/** Vinyl crackle settings */
export const VINYL_SETTINGS = {
    baseGain: 0.018,        // Base volume level
    filterFreq: 2500,       // Lowpass filter cutoff
    lfoRate: 0.08,          // Wave cycle speed (~12 sec cycle)
    lfoDepth: 0.9,          // How much LFO affects gain (0-1)
    lfoShape: 'sine',       // Wave shape for ocean-like feel
} as const;

/** Tape hiss settings */
export const TAPE_HISS_SETTINGS = {
    baseGain: 0.012,        // Base volume level
    filterLow: 1500,        // Highpass filter cutoff
    filterHigh: 6000,       // Lowpass filter cutoff
    lfoRate: 0.05,          // Slower wave (~20 sec cycle)
    lfoDepth: 0.85,         // How much LFO affects gain
} as const;
