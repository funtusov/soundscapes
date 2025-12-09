/**
 * FM Synthesis Mode
 *
 * X-axis: Carrier frequency (quantized to scale if enabled)
 * Y-axis: Modulation ratio (1:1 to 8:1)
 * Duration: Controls modulation index (brightness)
 */

import type { TouchId, FMVoice } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';

export class FMMode extends BaseSynthMode {
    readonly name = 'fm';
    readonly hudLabels: [string, string] = ['X: Pitch | β: Cutoff', 'Y: Ratio | γ: Q'];

    private voices = new Map<TouchId, FMVoice>();

    init(_engine: EngineContext): void {
        this.voices = new Map();
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update()
    }

    private getFMRatio(y: number): { ratio: number; name: string } {
        const ratios = [
            { ratio: 1, name: 'unison' },
            { ratio: 2, name: 'octave' },
            { ratio: 3, name: 'fifth+' },
            { ratio: 4, name: '2oct' },
            { ratio: 5, name: 'maj3+' },
            { ratio: 6, name: 'fifth++' },
            { ratio: 7, name: 'min7+' },
            { ratio: 8, name: '3oct' }
        ];
        const index = Math.floor(y * ratios.length);
        return ratios[Math.min(index, ratios.length - 1)];
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        const { ctx, filter } = engine;
        const now = ctx.currentTime;

        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;

            const carrier = ctx.createOscillator();
            const carrierGain = ctx.createGain();
            const modulator = ctx.createOscillator();
            const modulatorGain = ctx.createGain();

            carrier.type = 'sine';
            carrier.frequency.value = 220;
            modulator.type = 'sine';
            modulator.frequency.value = 220;
            carrierGain.gain.value = 0;
            modulatorGain.gain.value = 0;

            modulator.connect(modulatorGain);
            modulatorGain.connect(carrier.frequency);
            carrier.connect(carrierGain);
            carrierGain.connect(filter);

            carrier.start();
            modulator.start();

            this.voices.set(touchId, { carrier, carrierGain, modulator, modulatorGain });
        }

        const voice = this.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 55, engine);
        const carrierFreq = note.freq;

        // Y controls ratio, duration controls modulation index
        const { ratio, name } = this.getFMRatio(y);
        const durationFactor = Math.min(1, duration / 2);
        const modIndex = 1 + durationFactor * 8;
        const modFreq = carrierFreq * ratio;

        voice.carrier.frequency.setTargetAtTime(carrierFreq, now, 0.02);
        voice.modulator.frequency.setTargetAtTime(modFreq, now, 0.02);
        voice.modulatorGain.gain.setTargetAtTime(modIndex * carrierFreq, now, 0.02);
        voice.carrierGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.02);

        engine.updateHUD(note.noteName + note.octave, ratio + ':1 ' + name);
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;
        voice.carrierGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.carrier);
            this.cleanupOscillator(voice.modulator);
            this.cleanupGain(voice.carrierGain);
            this.cleanupGain(voice.modulatorGain);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            this.cleanupOscillator(voice.carrier);
            this.cleanupOscillator(voice.modulator);
            this.cleanupGain(voice.carrierGain);
            this.cleanupGain(voice.modulatorGain);
        }
        this.voices.clear();
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
