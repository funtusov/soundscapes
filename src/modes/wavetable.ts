/**
 * Wavetable Synthesis Mode
 *
 * X-axis: Pitch (quantized to scale if enabled)
 * Y-axis: Smooth waveform morphing (sine → triangle → saw → square)
 */

import type { TouchId, WavetableVoice } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';
import { SHAKE_ACCELERATION_THRESHOLD } from '../constants';

// Number of harmonics for waveform synthesis
const NUM_HARMONICS = 32;

// Waveform harmonic coefficients (imaginary = sine components)
interface WaveformCoeffs {
    real: Float32Array;
    imag: Float32Array;
}

/**
 * Generate harmonic coefficients for each waveform type
 */
function generateWaveformCoeffs(): WaveformCoeffs[] {
    const waveforms: WaveformCoeffs[] = [];

    // SINE: Only fundamental
    const sineReal = new Float32Array(NUM_HARMONICS);
    const sineImag = new Float32Array(NUM_HARMONICS);
    sineImag[1] = 1;
    waveforms.push({ real: sineReal, imag: sineImag });

    // TRIANGLE: Odd harmonics with 1/n² amplitude, alternating sign
    const triReal = new Float32Array(NUM_HARMONICS);
    const triImag = new Float32Array(NUM_HARMONICS);
    for (let n = 1; n < NUM_HARMONICS; n += 2) {
        const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
        triImag[n] = sign * (1 / (n * n));
    }
    waveforms.push({ real: triReal, imag: triImag });

    // SAWTOOTH: All harmonics with 1/n amplitude
    const sawReal = new Float32Array(NUM_HARMONICS);
    const sawImag = new Float32Array(NUM_HARMONICS);
    for (let n = 1; n < NUM_HARMONICS; n++) {
        sawImag[n] = (n % 2 === 0 ? -1 : 1) * (1 / n);
    }
    waveforms.push({ real: sawReal, imag: sawImag });

    // SQUARE: Odd harmonics with 1/n amplitude
    const sqReal = new Float32Array(NUM_HARMONICS);
    const sqImag = new Float32Array(NUM_HARMONICS);
    for (let n = 1; n < NUM_HARMONICS; n += 2) {
        sqImag[n] = 1 / n;
    }
    waveforms.push({ real: sqReal, imag: sqImag });

    return waveforms;
}

// Pre-generate waveform coefficients
const WAVEFORM_COEFFS = generateWaveformCoeffs();
const WAVEFORM_NAMES = ['sine', 'triangle', 'saw', 'square'];

// Loudness compensation factors (inverse of relative RMS energy)
// Sine=1.0, Triangle≈0.9, Saw≈0.5, Square≈0.6
const LOUDNESS_COMPENSATION = [1.0, 0.9, 0.5, 0.6];

/**
 * Interpolate between two waveforms
 */
function interpolateWaveforms(
    coeffsA: WaveformCoeffs,
    coeffsB: WaveformCoeffs,
    t: number
): WaveformCoeffs {
    const real = new Float32Array(NUM_HARMONICS);
    const imag = new Float32Array(NUM_HARMONICS);

    for (let i = 0; i < NUM_HARMONICS; i++) {
        real[i] = coeffsA.real[i] * (1 - t) + coeffsB.real[i] * t;
        imag[i] = coeffsA.imag[i] * (1 - t) + coeffsB.imag[i] * t;
    }

    return { real, imag };
}

/**
 * Get loudness compensation factor for Y position
 * Returns a gain multiplier to equalize perceived loudness
 */
function getLoudnessCompensation(y: number): number {
    const scaledY = y * 3; // 0-3 range
    const waveIndex = Math.min(2, Math.floor(scaledY));
    const t = scaledY - waveIndex;

    // Interpolate between compensation factors
    const compA = LOUDNESS_COMPENSATION[waveIndex];
    const compB = LOUDNESS_COMPENSATION[waveIndex + 1];
    return compA * (1 - t) + compB * t;
}

export class WavetableMode extends BaseSynthMode {
    readonly name = 'wavetable';
    readonly hudLabels: [string, string] = ['X: Pitch | β: Cutoff', 'Y: Waveform | γ: Q'];

    private voices = new Map<TouchId, WavetableVoice>();

    init(_engine: EngineContext): void {
        this.voices = new Map();
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update() for this mode
    }

    /**
     * Get or create a PeriodicWave for the given Y position
     */
    private getMorphedWave(ctx: AudioContext, y: number): PeriodicWave {
        // Map Y to waveform interpolation
        // y=0 → sine, y=0.33 → triangle, y=0.67 → saw, y=1 → square
        const scaledY = y * 3; // 0-3 range
        const waveIndex = Math.min(2, Math.floor(scaledY));
        const t = scaledY - waveIndex;

        const coeffsA = WAVEFORM_COEFFS[waveIndex];
        const coeffsB = WAVEFORM_COEFFS[waveIndex + 1];
        const morphed = interpolateWaveforms(coeffsA, coeffsB, t);

        return ctx.createPeriodicWave(morphed.real, morphed.imag, { disableNormalization: false });
    }

    /**
     * Get waveform name for HUD display
     */
    private getWaveformName(y: number): string {
        const scaledY = y * 3;
        const waveIndex = Math.min(2, Math.floor(scaledY));
        const t = scaledY - waveIndex;

        if (t < 0.1) {
            return WAVEFORM_NAMES[waveIndex];
        } else if (t > 0.9) {
            return WAVEFORM_NAMES[waveIndex + 1];
        } else {
            // Show morphing indicator
            return `${WAVEFORM_NAMES[waveIndex]}↔${WAVEFORM_NAMES[waveIndex + 1]}`;
        }
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        const { ctx, filter } = engine;
        const now = ctx.currentTime;

        // Create voice if it doesn't exist
        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();

            // Tremolo chain: tremoloLfo → tremoloDepth → tremoloGain → gain.gain
            const tremoloLfo = ctx.createOscillator();
            const tremoloDepth = ctx.createGain();  // Controls how much tremolo
            const tremoloGain = ctx.createGain();   // Applies tremolo to output

            // Start with sine wave
            const initialWave = this.getMorphedWave(ctx, y);
            osc.setPeriodicWave(initialWave);
            osc.frequency.value = 220;
            gain.gain.value = 0;

            // Vibrato LFO (pitch modulation)
            lfo.frequency.value = 2;
            lfoGain.gain.value = 0;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.detune);

            // Tremolo LFO (amplitude modulation)
            // Signal: osc → gain → tremoloGain → filter
            // Tremolo: tremoloLfo → tremoloDepth → tremoloGain.gain
            tremoloLfo.frequency.value = 6;  // Faster rate for tremolo
            tremoloDepth.gain.value = 0;     // Start with no tremolo
            tremoloGain.gain.value = 1;      // Base gain of 1

            tremoloLfo.connect(tremoloDepth);
            tremoloDepth.connect(tremoloGain.gain);

            osc.connect(gain);
            gain.connect(tremoloGain);
            tremoloGain.connect(filter);
            osc.start();
            lfo.start();
            tremoloLfo.start();

            this.voices.set(touchId, { osc, gain, lfo, lfoGain, tremoloLfo, tremoloGain, tremoloDepth });

            // Register voice for HUD display
            engine.registerVoice({
                touchId,
                noteName: '--',
                octave: 0,
                freq: 220,
                waveform: 'sine'
            });
        }

        const voice = this.voices.get(touchId)!;
        const note = this.quantizeToScale(x, engine.rangeOctaves, engine.rangeBaseFreq, engine);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.005);

        // Apply loudness compensation to equalize perceived volume across waveforms
        const compensation = getLoudnessCompensation(y);
        const compensatedGain = VOICE_GAIN * compensation;
        voice.gain.gain.setTargetAtTime(compensatedGain, now, 0.005);

        // Morph waveform based on Y position
        const morphedWave = this.getMorphedWave(ctx, y);
        voice.osc.setPeriodicWave(morphedWave);

        // Get shake intensity from orientation params
        const shake = engine.orientationParams.shake;
        const isShaking = shake > SHAKE_ACCELERATION_THRESHOLD;
        const shakeIntensity = isShaking ? Math.min(1, (shake - SHAKE_ACCELERATION_THRESHOLD) / 10) : 0;

        // Vibrato depth increases with Y and shake
        const baseVibratoDepth = 30 + y * 40; // 30-70 cents base
        const shakeVibratoBoost = shakeIntensity * 80; // Up to 80 cents extra on shake
        const modDepth = baseVibratoDepth * 0.5 + shakeVibratoBoost;

        // LFO rate: faster on shake for more intense effect
        const durationFactor = Math.min(1, duration / 3);
        const baseLfoRate = 2 + durationFactor * 4;
        const lfoRate = baseLfoRate + shakeIntensity * 6; // Speed up on shake

        voice.lfoGain.gain.setTargetAtTime(modDepth, now, 0.05);
        voice.lfo.frequency.setTargetAtTime(lfoRate, now, 0.1);

        // Tremolo: only active on shake
        // tremoloDepth controls amplitude modulation amount (0 = none, 0.5 = ±50% volume swing)
        const tremoloAmount = shakeIntensity * 0.4; // Up to 40% volume modulation
        const tremoloRate = 6 + shakeIntensity * 8;  // 6-14 Hz tremolo rate
        voice.tremoloDepth.gain.setTargetAtTime(tremoloAmount, now, 0.02);
        voice.tremoloLfo.frequency.setTargetAtTime(tremoloRate, now, 0.05);

        // Update voice registry for HUD
        const waveformName = this.getWaveformName(y);
        engine.updateVoice(touchId, {
            noteName: note.noteName,
            octave: note.octave,
            freq: note.freq,
            waveform: waveformName
        });
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;
        voice.gain.gain.setTargetAtTime(0, now, releaseTime);
        voice.tremoloDepth.gain.setTargetAtTime(0, now, releaseTime); // Fade out tremolo

        // Unregister voice from HUD immediately
        engine.unregisterVoice(touchId);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.lfo);
            this.cleanupOscillator(voice.tremoloLfo);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.lfoGain);
            this.cleanupGain(voice.tremoloGain);
            this.cleanupGain(voice.tremoloDepth);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.lfo);
            this.cleanupOscillator(voice.tremoloLfo);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.lfoGain);
            this.cleanupGain(voice.tremoloGain);
            this.cleanupGain(voice.tremoloDepth);
        }
        this.voices.clear();
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
