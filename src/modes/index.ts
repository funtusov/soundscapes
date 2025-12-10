/**
 * Synthesis Modes Registry
 *
 * Exports all synthesis modes and provides a registry for mode lookup.
 */

export type { SynthMode, EngineContext } from './base';
export { BaseSynthMode } from './base';
export { WavetableMode } from './wavetable';

import type { SynthMode } from './base';
import { WavetableMode } from './wavetable';

// Single mode - wavetable synthesis
const wavetableMode = new WavetableMode();

/**
 * Get the wavetable mode instance
 */
export function getMode(): SynthMode {
    return wavetableMode;
}
