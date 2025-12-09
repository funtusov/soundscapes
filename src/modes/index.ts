/**
 * Synthesis Modes Registry
 *
 * Exports all synthesis modes and provides a registry for mode lookup.
 */

export type { SynthMode, EngineContext } from './base';
export { BaseSynthMode } from './base';
export { WavetableMode } from './wavetable';
export { DroneMode } from './drone';
export { FMMode } from './fm';
export { ArpeggiatorMode } from './arpeggiator';
export { KarplusMode } from './karplus';
export { FormantMode } from './formant';
// export { AmbientMode } from './ambient';      // TODO: Extract
// export { BasslineMode } from './bassline';    // TODO: Extract
// export { OneheartMode } from './oneheart';    // TODO: Extract

import type { SynthMode } from './base';
import type { SynthesisMode } from '../constants/audio';
import { WavetableMode } from './wavetable';
import { DroneMode } from './drone';
import { FMMode } from './fm';
import { ArpeggiatorMode } from './arpeggiator';
import { KarplusMode } from './karplus';
import { FormantMode } from './formant';

/**
 * Registry of all available synthesis modes
 * Maps mode name to mode instance
 */
export const modeRegistry: Partial<Record<SynthesisMode, SynthMode>> = {
    wavetable: new WavetableMode(),
    drone: new DroneMode(),
    fm: new FMMode(),
    arpeggiator: new ArpeggiatorMode(),
    karplus: new KarplusMode(),
    formant: new FormantMode(),
    // ambient, bassline, oneheart still in AudioEngine
};

/**
 * Get a mode instance by name
 */
export function getMode(name: SynthesisMode): SynthMode | undefined {
    return modeRegistry[name];
}

/**
 * Check if a mode has been extracted to the new architecture
 */
export function isModeExtracted(name: SynthesisMode): boolean {
    return name in modeRegistry;
}
