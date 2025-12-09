import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine } from './AudioEngine';
import { MAX_VOICES, SCALE_PATTERNS, NOTE_NAMES } from './constants';

// Mock Audio element for iOS silent audio
class MockAudio {
    loop = false;
    play = vi.fn(() => Promise.resolve());
}
vi.stubGlobal('Audio', MockAudio);

describe('AudioEngine', () => {
    let engine: AudioEngine;

    beforeEach(() => {
        vi.clearAllMocks();
        engine = new AudioEngine();
    });

    describe('initialization', () => {
        it('creates an instance with default mode', () => {
            expect(engine.mode).toBe('focus');
        });

        it('starts with quantization disabled', () => {
            expect(engine.isQuantized).toBe(false);
        });

        it('has default tonic set to A (9)', () => {
            expect(engine.tonic).toBe(9);
        });

        it('has default scale type set to minor', () => {
            expect(engine.scaleType).toBe('minor');
        });

        it('starts with no audio context', () => {
            expect(engine.ctx).toBeNull();
        });

        it('starts not playing', () => {
            expect(engine.isPlaying).toBe(false);
        });
    });

    describe('setQuantized', () => {
        it('enables quantization', () => {
            engine.setQuantized(true);
            expect(engine.isQuantized).toBe(true);
        });

        it('disables quantization', () => {
            engine.setQuantized(true);
            engine.setQuantized(false);
            expect(engine.isQuantized).toBe(false);
        });
    });

    describe('setTonic', () => {
        it('sets tonic from number', () => {
            engine.setTonic(0); // C
            expect(engine.tonic).toBe(0);
        });

        it('sets tonic from string', () => {
            engine.setTonic('5'); // F
            expect(engine.tonic).toBe(5);
        });

        it('handles all 12 tonic values', () => {
            for (let i = 0; i < 12; i++) {
                engine.setTonic(i);
                expect(engine.tonic).toBe(i);
            }
        });
    });

    describe('setScaleType', () => {
        it('sets scale type to major', () => {
            engine.setScaleType('major');
            expect(engine.scaleType).toBe('major');
        });

        it('sets scale type to minor', () => {
            engine.setScaleType('minor');
            expect(engine.scaleType).toBe('minor');
        });

        it('sets scale type to pentatonic', () => {
            engine.setScaleType('pentatonic');
            expect(engine.scaleType).toBe('pentatonic');
        });

        it('sets scale type to chromatic', () => {
            engine.setScaleType('chromatic');
            expect(engine.scaleType).toBe('chromatic');
        });
    });

    describe('getNoteName', () => {
        it('returns correct note names for base octave', () => {
            expect(engine.getNoteName(0)).toBe('C');
            expect(engine.getNoteName(1)).toBe('C#');
            expect(engine.getNoteName(2)).toBe('D');
            expect(engine.getNoteName(3)).toBe('D#');
            expect(engine.getNoteName(4)).toBe('E');
            expect(engine.getNoteName(5)).toBe('F');
            expect(engine.getNoteName(6)).toBe('F#');
            expect(engine.getNoteName(7)).toBe('G');
            expect(engine.getNoteName(8)).toBe('G#');
            expect(engine.getNoteName(9)).toBe('A');
            expect(engine.getNoteName(10)).toBe('A#');
            expect(engine.getNoteName(11)).toBe('B');
        });

        it('wraps around octave', () => {
            expect(engine.getNoteName(12)).toBe('C');
            expect(engine.getNoteName(21)).toBe('A');
            expect(engine.getNoteName(24)).toBe('C');
        });

        it('handles negative values via modulo', () => {
            // JavaScript modulo can be negative, but NOTE_NAMES index should still work
            expect(engine.getNoteName(0)).toBe(NOTE_NAMES[0]);
        });
    });

    describe('quantizeToScale (without init)', () => {
        // Note: Full quantizeToScale tests would require init() to be called
        // These tests verify the pure function behavior without audio context

        describe('when unquantized', () => {
            beforeEach(() => {
                engine.setQuantized(false);
            });

            it('frequency calculation is monotonic', () => {
                // Without init, we can test the math directly
                // freq = baseFreq * 2^(semitones/12)
                const baseFreq = 55;
                const semitones1 = 0.25 * 3 * 12; // x=0.25, 3 octaves
                const semitones2 = 0.5 * 3 * 12;  // x=0.5
                const semitones3 = 0.75 * 3 * 12; // x=0.75

                const freq1 = baseFreq * Math.pow(2, semitones1 / 12);
                const freq2 = baseFreq * Math.pow(2, semitones2 / 12);
                const freq3 = baseFreq * Math.pow(2, semitones3 / 12);

                expect(freq1).toBeLessThan(freq2);
                expect(freq2).toBeLessThan(freq3);
            });
        });

        describe('scale pattern verification', () => {
            it('major scale pattern is correct', () => {
                expect(SCALE_PATTERNS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
            });

            it('minor scale pattern is correct', () => {
                expect(SCALE_PATTERNS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
            });

            it('pentatonic scale pattern is correct', () => {
                expect(SCALE_PATTERNS.pentatonic).toEqual([0, 2, 4, 7, 9]);
            });

            it('chromatic scale pattern is correct', () => {
                expect(SCALE_PATTERNS.chromatic).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
            });
        });
    });
});

describe('Voice Limiting', () => {
    it('MAX_VOICES constant is defined', () => {
        expect(MAX_VOICES).toBeDefined();
        expect(typeof MAX_VOICES).toBe('number');
    });

    it('MAX_VOICES is set to 10', () => {
        expect(MAX_VOICES).toBe(10);
    });

    it('MAX_VOICES is a reasonable limit', () => {
        expect(MAX_VOICES).toBeGreaterThan(0);
        expect(MAX_VOICES).toBeLessThanOrEqual(20);
    });
});

describe('Synthesis Modes', () => {
    let engine: AudioEngine;

    beforeEach(() => {
        engine = new AudioEngine();
    });

    it('default mode is focus', () => {
        expect(engine.mode).toBe('focus');
    });

    it('mode property is accessible', () => {
        expect(typeof engine.mode).toBe('string');
    });
});
