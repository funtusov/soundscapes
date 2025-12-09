/**
 * Mode-specific constants for each synthesis mode
 */

// ============ KARPLUS-STRONG CONSTANTS ============

/** Karplus-Strong minimum pluck interval in seconds */
export const KARPLUS_MIN_PLUCK_INTERVAL = 0.03;

/** Karplus-Strong auto-repluck interval in seconds */
export const KARPLUS_REPLUCK_INTERVAL = 0.25;

/** Karplus-Strong decay duration in seconds */
export const KARPLUS_DECAY_DURATION = 2;

/** Maximum number of buffers to keep in Karplus-Strong pool */
export const KARPLUS_BUFFER_POOL_SIZE = 8;

/** Standard buffer sizes for pooling (covers common frequency ranges) */
export const KARPLUS_BUFFER_SIZES = [128, 256, 512, 1024, 2048] as const;

/** Karplus body resonance frequencies (ratios of fundamental) */
export const KARPLUS_BODY_RESONANCES = [1.0, 2.0, 3.5];

/** Karplus sympathetic string ratios */
export const KARPLUS_SYMPATHETIC_RATIOS = [1.5, 2.0, 3.0];

/** Karplus sympathetic string gain */
export const KARPLUS_SYMPATHETIC_GAIN = 0.15;

/** Karplus decay range (seconds) */
export const KARPLUS_DECAY_MIN = 0.5;
export const KARPLUS_DECAY_MAX = 4.0;

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
    random: [0, 4, 7, 12]
} as const;

/** Arpeggiator speed range (notes per second) */
export const ARP_SPEED_MIN = 2;
export const ARP_SPEED_MAX = 16;

/** Arpeggiator note duration as fraction of interval */
export const ARP_NOTE_DURATION = 0.8;

// ============ FORMANT/VOICE CONSTANTS ============

/** Formant frequencies for vowels [F1, F2, F3] in Hz */
export const FORMANT_VOWELS = {
    a: [800, 1200, 2500],
    e: [400, 2200, 2800],
    i: [280, 2300, 3000],
    o: [450, 800, 2500],
    u: [325, 700, 2500]
} as const;

/** Formant filter Q values */
export const FORMANT_Q = [10, 12, 8];

/** Formant transition time */
export const FORMANT_TRANSITION_TIME = 0.15;

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

/** Ambient mode chord progressions (semitone offsets from base) */
export const AMBIENT_CHORDS = [
    [0, 7, 12],
    [0, 5, 12],
    [0, 4, 7],
    [0, 3, 7],
    [0, 7, 14],
    [0, 5, 7]
] as const;

// ============ BASSLINE MODE CONSTANTS ============

/** Bassline tempo range (BPM) mapped from compass heading */
export const BASS_TEMPO_MIN = 60;
export const BASS_TEMPO_MAX = 180;

/** Bassline base frequency (low bass range) */
export const BASS_BASE_FREQ = 41.2; // E1

/** Bassline patterns (semitone offsets from root, with durations) */
export const BASS_PATTERNS = {
    pulse: [[0, 1]],
    bounce: [[0, 0.5], [7, 0.5]],
    walk: [[0, 0.25], [4, 0.25], [7, 0.25], [5, 0.25]],
    chromatic: [[0, 0.25], [3, 0.25], [5, 0.25], [6, 0.25]],
    bebop: [[0, 0.25], [2, 0.125], [3, 0.125], [5, 0.25], [7, 0.25]],
    funk: [[0, 0.375], [0, 0.125], [5, 0.25], [7, 0.25]],
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
export const ONEHEART_LFO_SLOW = 0.02;
export const ONEHEART_LFO_MEDIUM = 0.08;

/** Oneheart filter range */
export const ONEHEART_FILTER_MIN = 200;
export const ONEHEART_FILTER_MAX = 3000;
export const ONEHEART_FILTER_SWEEP_TIME = 20000;

/** Oneheart detune range for pad voices (cents) */
export const ONEHEART_DETUNE_RANGE = 12;

/** Focus mode chord progressions (semitone intervals from root) */
export const ONEHEART_FOCUS_CHORDS = [
    [0, 4, 7, 11],
    [5, 9, 12, 16],
    [9, 12, 16, 19],
    [7, 11, 14, 21],
    [4, 7, 11, 14],
    [2, 5, 9, 12],
    [7, 12, 14, 19],
    [0, 4, 7, 14],
] as const;

/** Relaxation mode chords (sus chords, warmer) */
export const ONEHEART_RELAXATION_CHORDS = [
    [0, 5, 7, 12],
    [5, 10, 12, 17],
    [7, 12, 14, 19],
    [0, 5, 7, 14],
    [9, 12, 16, 21],
] as const;

/** Sleep mode chords (minor, sparse, darker) */
export const ONEHEART_SLEEP_CHORDS = [
    [0, 3, 7],
    [5, 8, 12],
    [7, 10, 14],
    [3, 7, 10],
    [0, 7, 12],
] as const;

/** Oneheart reverb preset (long, lush tail) */
export const ONEHEART_REVERB = {
    decay: 6.0,
    wet: 0.65,
    dry: 0.5,
    damping: 0.5
} as const;

/** Focus mode preset */
export const FOCUS_PRESET = {
    chords: ONEHEART_FOCUS_CHORDS,
    chordDuration: 25000,
    filterRange: [400, 3000] as const,
    textureLevel: 0.05,
    reverbDecay: 6.0,
    evolutionSpeed: 1.0,
    brightness: 0.7,
    padCount: 4,
    detuneAmount: 8,
} as const;

/** Relaxation mode preset */
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

/** Sleep mode preset */
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

/** Waves texture settings (ocean-like noise) */
export const WAVES_SETTINGS = {
    baseGain: 0.018,
    filterFreq: 2500,
    lfoRate: 0.08,
    lfoDepth: 0.9,
    lfoShape: 'sine',
} as const;

/** Available noise texture types */
export const NOISE_TYPES = ['waves', 'rain', 'wind', 'fire'] as const;
export type NoiseType = typeof NOISE_TYPES[number];

/** Default texture volume (0-1) */
export const DEFAULT_TEXTURE_VOLUME = 0.7;

/** Rain texture settings */
export const RAIN_SETTINGS = {
    baseGain: 0.025,
    filterFreq: 4000,
    lfoRate: 0.15,
    lfoDepth: 0.6,
} as const;

/** Wind texture settings */
export const WIND_SETTINGS = {
    baseGain: 0.02,
    filterFreq: 1200,
    lfoRate: 0.04,
    lfoDepth: 0.95,
} as const;

/** Fire/crackling texture settings */
export const FIRE_SETTINGS = {
    baseGain: 0.015,
    filterFreq: 3000,
    lfoRate: 0.3,
    lfoDepth: 0.8,
} as const;

/** All noise texture settings by type */
export const NOISE_TEXTURE_SETTINGS = {
    waves: WAVES_SETTINGS,
    rain: RAIN_SETTINGS,
    wind: WIND_SETTINGS,
    fire: FIRE_SETTINGS,
} as const;

/** Tape hiss settings */
export const TAPE_HISS_SETTINGS = {
    baseGain: 0.012,
    filterLow: 1500,
    filterHigh: 6000,
    lfoRate: 0.05,
    lfoDepth: 0.85,
} as const;
