import { describe, it, expect } from 'vitest';
import {
    clamp,
    hzToMel,
    melToHz,
    SCALE_PATTERNS,
    NOTE_NAMES,
    MAX_VOICES,
    FILTER_MIN_FREQ,
    FILTER_MAX_FREQ
} from './constants';

describe('clamp', () => {
    it('returns value when within range', () => {
        expect(clamp(0.5, 0, 1)).toBe(0.5);
        expect(clamp(50, 0, 100)).toBe(50);
    });

    it('returns min when value is below range', () => {
        expect(clamp(-1, 0, 1)).toBe(0);
        expect(clamp(-100, 0, 100)).toBe(0);
    });

    it('returns max when value is above range', () => {
        expect(clamp(2, 0, 1)).toBe(1);
        expect(clamp(200, 0, 100)).toBe(100);
    });

    it('handles edge cases', () => {
        expect(clamp(0, 0, 1)).toBe(0);
        expect(clamp(1, 0, 1)).toBe(1);
        expect(clamp(0, 0, 0)).toBe(0);
    });

    it('handles negative ranges', () => {
        expect(clamp(-5, -10, -1)).toBe(-5);
        expect(clamp(-15, -10, -1)).toBe(-10);
        expect(clamp(0, -10, -1)).toBe(-1);
    });
});

describe('hzToMel / melToHz', () => {
    it('converts 0 Hz to 0 mel', () => {
        expect(hzToMel(0)).toBe(0);
    });

    it('converts 1000 Hz to approximately 1000 mel', () => {
        // 1000 Hz is roughly 1000 mel by design of the scale
        const mel = hzToMel(1000);
        expect(mel).toBeGreaterThan(900);
        expect(mel).toBeLessThan(1100);
    });

    it('round-trips correctly', () => {
        const frequencies = [20, 100, 440, 1000, 4000, 8000];
        for (const freq of frequencies) {
            const mel = hzToMel(freq);
            const backToHz = melToHz(mel);
            expect(backToHz).toBeCloseTo(freq, 5);
        }
    });

    it('maintains monotonic relationship', () => {
        const freqs = [100, 200, 400, 800, 1600];
        const mels = freqs.map(hzToMel);
        for (let i = 1; i < mels.length; i++) {
            expect(mels[i]).toBeGreaterThan(mels[i - 1]);
        }
    });
});

describe('SCALE_PATTERNS', () => {
    it('has major scale with 7 notes', () => {
        expect(SCALE_PATTERNS.major).toHaveLength(7);
        expect(SCALE_PATTERNS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
    });

    it('has minor scale with 7 notes', () => {
        expect(SCALE_PATTERNS.minor).toHaveLength(7);
        expect(SCALE_PATTERNS.minor).toEqual([0, 2, 3, 5, 7, 8, 10]);
    });

    it('has pentatonic scale with 5 notes', () => {
        expect(SCALE_PATTERNS.pentatonic).toHaveLength(5);
        expect(SCALE_PATTERNS.pentatonic).toEqual([0, 2, 4, 7, 9]);
    });

    it('has chromatic scale with 12 notes', () => {
        expect(SCALE_PATTERNS.chromatic).toHaveLength(12);
        expect(SCALE_PATTERNS.chromatic).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('all patterns start with 0 (root)', () => {
        for (const pattern of Object.values(SCALE_PATTERNS)) {
            expect(pattern[0]).toBe(0);
        }
    });

    it('all pattern values are within octave (0-11)', () => {
        for (const pattern of Object.values(SCALE_PATTERNS)) {
            for (const semitone of pattern) {
                expect(semitone).toBeGreaterThanOrEqual(0);
                expect(semitone).toBeLessThanOrEqual(11);
            }
        }
    });
});

describe('NOTE_NAMES', () => {
    it('has 12 note names', () => {
        expect(NOTE_NAMES).toHaveLength(12);
    });

    it('starts with C', () => {
        expect(NOTE_NAMES[0]).toBe('C');
    });

    it('has correct chromatic sequence', () => {
        expect(NOTE_NAMES).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
    });
});

describe('Constants validation', () => {
    it('MAX_VOICES is reasonable', () => {
        expect(MAX_VOICES).toBeGreaterThan(0);
        expect(MAX_VOICES).toBeLessThanOrEqual(20);
    });

    it('filter frequency range is valid', () => {
        expect(FILTER_MIN_FREQ).toBeGreaterThan(0);
        expect(FILTER_MAX_FREQ).toBeGreaterThan(FILTER_MIN_FREQ);
        expect(FILTER_MAX_FREQ).toBeLessThanOrEqual(20000); // human hearing range
    });
});
