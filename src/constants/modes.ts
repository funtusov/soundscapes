/**
 * Mode-specific constants
 * Currently only wavetable mode is used - other mode constants removed.
 */

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
