/**
 * Visualizer and UI constants
 */

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
