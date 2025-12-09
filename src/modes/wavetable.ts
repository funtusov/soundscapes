/**
 * Wavetable Synthesis Mode
 *
 * X-axis: Pitch (quantized to scale if enabled)
 * Y-axis: Waveform selection (sine, triangle, saw, square) with vibrato depth
 */

import type { TouchId, WavetableVoice } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';

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

            osc.type = 'sawtooth';
            osc.frequency.value = 220;
            gain.gain.value = 0;

            lfo.frequency.value = 2;
            lfoGain.gain.value = 0;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.detune);

            osc.connect(gain);
            gain.connect(filter);
            osc.start();
            lfo.start();

            this.voices.set(touchId, { osc, gain, lfo, lfoGain });
        }

        const voice = this.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 55, engine);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.005);
        voice.gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.005);

        // Y axis: waveform bands with modulation depth within each band
        let waveType: OscillatorType;
        let posInBand: number;

        if (y < 0.25) {
            waveType = 'sine';
            posInBand = y / 0.25;
        } else if (y < 0.5) {
            waveType = 'triangle';
            posInBand = (y - 0.25) / 0.25;
        } else if (y < 0.75) {
            waveType = 'sawtooth';
            posInBand = (y - 0.5) / 0.25;
        } else {
            waveType = 'square';
            posInBand = (y - 0.75) / 0.25;
        }

        voice.osc.type = waveType;

        // Modulation depth: bottom of band = 0, top of band = max (50 cents)
        const maxModDepth = 50;
        const modDepth = posInBand * maxModDepth;

        // LFO rate increases slightly with duration
        const durationFactor = Math.min(1, duration / 3);
        const lfoRate = 2 + durationFactor * 4;

        voice.lfoGain.gain.setTargetAtTime(modDepth, now, 0.05);
        voice.lfo.frequency.setTargetAtTime(lfoRate, now, 0.1);

        // Update HUD
        const freqHz = Math.round(note.freq);
        const modIndicator = posInBand > 0.1 ? ' ~' : '';
        engine.updateHUD(note.noteName + note.octave + ' ' + freqHz + 'Hz', waveType + modIndicator);
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;
        voice.gain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.lfoGain);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            this.cleanupOscillator(voice.osc);
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.gain);
            this.cleanupGain(voice.lfoGain);
        }
        this.voices.clear();
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
