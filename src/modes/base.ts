/**
 * Base interface and types for synthesis modes
 */

import type { TouchId, NoteInfo, VoiceDisplayInfo } from '../types';
import { MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS, NOTE_NAMES, SCALE_PATTERNS, DIATONIC_CHORDS, CHORD_INTERVALS, type ADSRPreset, type ChordType } from '../constants';

/**
 * Shared engine context passed to modes
 * Contains the audio nodes and state that modes need access to
 */
export interface EngineContext {
    ctx: AudioContext;
    filter: BiquadFilterNode;
    masterGain: GainNode;
    currentTime: number;
    // Scale/quantization state
    isQuantized: boolean;
    tonic: number;
    scaleType: string;
    // Frequency range
    rangeOctaves: number;
    rangeBaseFreq: number;
    // ADSR envelope preset
    envelope: ADSRPreset;
    // Arpeggio state
    arpEnabled: boolean;
    arpRate: number;
    // Orientation parameters (for continuous modes)
    orientationParams: {
        pan: number;
        filterMod: number;
        lfoRate: number;
        vibratoHz: number;
        shake: number;
        compass: number;
    };
    // HUD update callback (deprecated - use voice registry)
    updateHUD: (freq: string, harm: string) => void;
    // Voice registry for multi-voice HUD display
    registerVoice: (info: VoiceDisplayInfo) => void;
    updateVoice: (touchId: TouchId, info: Partial<VoiceDisplayInfo>) => void;
    unregisterVoice: (touchId: TouchId) => void;
    // Reverb control callback (for Oneheart mode)
    setReverb?: (decay: number, wet: number, dry: number) => void;
    // Reverb wet mix control (for relaxation depth control)
    setReverbWet?: (wet: number) => void;
}

// Re-export constants for modes to use
export { MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS };

/**
 * Base interface that all synthesis modes must implement
 */
export interface SynthMode {
    /** Unique identifier for this mode */
    readonly name: string;

    /** HUD labels for this mode [bottom-left, bottom-right] */
    readonly hudLabels: [string, string];

    /**
     * Initialize the mode - create initial node structure
     * Called when switching to this mode
     */
    init(engine: EngineContext): void;

    /**
     * Start a new voice/touch
     * @param touchId - Unique identifier for this touch
     * @param engine - Engine context
     */
    start(touchId: TouchId, engine: EngineContext): void;

    /**
     * Update parameters based on position and duration
     * @param x - Normalized X position (0-1)
     * @param y - Normalized Y position (0-1)
     * @param touchId - Touch identifier
     * @param duration - Touch duration in seconds
     * @param engine - Engine context
     */
    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void;

    /**
     * Stop a voice/touch with release
     * @param touchId - Touch identifier
     * @param releaseTime - Release time in seconds
     * @param engine - Engine context
     */
    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void;

    /**
     * Clean up all resources when switching modes
     */
    cleanup(): void;

    /**
     * Get current voice count for polyphony limiting
     */
    getVoiceCount(): number;

    /**
     * Whether this mode is continuous (doesn't stop on touch end)
     * Ambient, Bassline, and Oneheart are continuous
     */
    readonly isContinuous: boolean;
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseSynthMode implements SynthMode {
    abstract readonly name: string;
    abstract readonly hudLabels: [string, string];
    readonly isContinuous: boolean = false;

    abstract init(engine: EngineContext): void;
    abstract start(touchId: TouchId, engine: EngineContext): void;
    abstract update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void;
    abstract stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void;
    abstract cleanup(): void;
    abstract getVoiceCount(): number;

    /**
     * Helper to safely stop and disconnect an oscillator
     */
    protected cleanupOscillator(osc: OscillatorNode | undefined | null): void {
        if (!osc) return;
        try { osc.disconnect(); } catch (e) { /* ignore */ }
        try { osc.stop(); } catch (e) { /* ignore */ }
    }

    /**
     * Helper to safely disconnect a gain node
     */
    protected cleanupGain(gain: GainNode | undefined | null): void {
        if (!gain) return;
        try { gain.disconnect(); } catch (e) { /* ignore */ }
    }

    /**
     * Get note name from semitone
     */
    protected getNoteName(semitone: number): string {
        return NOTE_NAMES[((semitone % 12) + 12) % 12];
    }

    /**
     * Quantize X position to scale, returning frequency and note info
     */
    protected quantizeToScale(x: number, octaves: number, baseFreq: number, engine: EngineContext): NoteInfo & { degree: number } {
        if (!engine.isQuantized) {
            const semitones = x * octaves * 12;
            const freq = baseFreq * Math.pow(2, semitones / 12);
            const nearestSemitone = Math.round(semitones);
            const noteName = this.getNoteName(engine.tonic + nearestSemitone);
            const octave = Math.floor(nearestSemitone / 12) + 2;
            return { freq, semitone: semitones, noteName, octave, isQuantized: false, degree: 0 };
        }

        const pattern = SCALE_PATTERNS[engine.scaleType] || SCALE_PATTERNS.minor;
        const notesPerOctave = pattern.length;
        const totalNotes = notesPerOctave * octaves;

        const noteIndex = Math.floor(x * totalNotes);
        const octave = Math.floor(noteIndex / notesPerOctave);
        const degree = noteIndex % notesPerOctave;
        const semitone = engine.tonic + octave * 12 + pattern[degree];

        return {
            freq: baseFreq * Math.pow(2, (pattern[degree] + octave * 12) / 12),
            semitone: pattern[degree] + octave * 12,
            noteName: this.getNoteName(semitone),
            octave: octave + 2,
            isQuantized: true,
            degree
        };
    }

    /**
     * Get diatonic chord type for a scale degree
     */
    protected getDiatonicChordType(scaleType: string, degree: number): ChordType {
        const chordMap = DIATONIC_CHORDS[scaleType] || DIATONIC_CHORDS.minor;
        return chordMap[degree % chordMap.length] || 'minor';
    }

    /**
     * Get chord frequencies (arpeggio notes) from a root frequency and chord type
     */
    protected getArpChordFrequencies(rootFreq: number, chordType: ChordType): number[] {
        const intervals = CHORD_INTERVALS[chordType] || CHORD_INTERVALS.minor;
        return intervals.map(semitones => rootFreq * Math.pow(2, semitones / 12));
    }

    /**
     * Get chord name for display
     */
    protected getArpChordName(noteName: string, chordType: ChordType): string {
        const suffixes: Record<ChordType, string> = {
            major: '',
            minor: 'm',
            dim: '°',
            aug: '+',
            sus4: 'sus4',
            power: '5',
        };
        return noteName + (suffixes[chordType] || '');
    }
}
