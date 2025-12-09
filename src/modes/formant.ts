/**
 * Formant/Voice Synthesis Mode
 *
 * Simulates vocal sounds using parallel formant filters.
 * X-axis: Pitch (quantized to scale if enabled)
 * Y-axis: Vowel selection (a, e, i, o, u)
 * Duration: Controls breathiness and vibrato
 */

import type { TouchId, FormantVoice, FormantFilter } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';
import { FORMANT_VOWELS, FORMANT_Q, FORMANT_TRANSITION_TIME } from '../constants';

export class FormantMode extends BaseSynthMode {
    readonly name = 'formant';
    readonly hudLabels: [string, string] = ['X: Pitch | β: Cutoff', 'Y: Vowel | γ: Q'];

    private voices = new Map<TouchId, FormantVoice>();

    init(_engine: EngineContext): void {
        this.voices = new Map();
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update()
    }

    private getVowel(y: number): { name: string; formants: readonly number[] } {
        const vowels = Object.entries(FORMANT_VOWELS);
        const index = Math.floor(y * vowels.length);
        const [name, formants] = vowels[Math.min(index, vowels.length - 1)];
        return { name, formants };
    }

    private createFormantVoice(freq: number, engine: EngineContext): FormantVoice | null {
        const { ctx, filter } = engine;

        // Create source oscillator (sawtooth for rich harmonics)
        const source = ctx.createOscillator();
        source.type = 'sawtooth';
        source.frequency.value = freq;

        // Create noise source for breath/consonant sounds
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }
        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const noiseMix = ctx.createGain();
        noiseMix.gain.value = 0.02;

        const sourceMix = ctx.createGain();
        sourceMix.gain.value = 0.8;

        // Create parallel formant filters
        const formants: FormantFilter[] = [];
        const masterGain = ctx.createGain();
        masterGain.gain.value = 0;

        const vowel = this.getVowel(0.5);
        for (let i = 0; i < 3; i++) {
            const formantFilter = ctx.createBiquadFilter();
            formantFilter.type = 'bandpass';
            formantFilter.frequency.value = vowel.formants[i];
            formantFilter.Q.value = FORMANT_Q[i];

            const gain = ctx.createGain();
            gain.gain.value = 0.4 / (i + 1);

            source.connect(sourceMix);
            noiseSource.connect(noiseMix);
            sourceMix.connect(formantFilter);
            noiseMix.connect(formantFilter);
            formantFilter.connect(gain);
            gain.connect(masterGain);

            formants.push({ filter: formantFilter, gain });
        }

        masterGain.connect(filter);
        source.start();
        noiseSource.start();

        return {
            source,
            noiseSource,
            noiseMix,
            sourceMix,
            formants,
            masterGain,
            currentVowel: vowel.name
        };
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        const { ctx } = engine;
        const now = ctx.currentTime;

        const note = this.quantizeToScale(x, 2, 55, engine);
        const { name, formants: vowelFormants } = this.getVowel(y);

        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;
            const voice = this.createFormantVoice(note.freq, engine);
            if (!voice) return;
            this.voices.set(touchId, voice);
        }

        const voice = this.voices.get(touchId)!;

        // Update pitch
        voice.source.frequency.setTargetAtTime(note.freq, now, 0.02);

        // Update formant frequencies with smooth transition
        voice.formants.forEach((f, i) => {
            f.filter.frequency.setTargetAtTime(vowelFormants[i], now, FORMANT_TRANSITION_TIME);
        });

        // Duration affects breathiness and vibrato
        const durationFactor = Math.min(1, duration / 2);
        const breathiness = 0.02 + durationFactor * 0.05;
        voice.noiseMix.gain.setTargetAtTime(breathiness, now, 0.1);

        // Add vibrato with duration
        const vibratoDepth = durationFactor * 8;
        voice.source.detune.setTargetAtTime(
            Math.sin(now * 5) * vibratoDepth,
            now,
            0.05
        );

        // Fade in
        voice.masterGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.05);
        voice.currentVowel = name;

        engine.updateHUD(note.noteName + note.octave, name + (durationFactor > 0.3 ? ' ~' : ''));
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;
        voice.masterGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.source);
            try { voice.noiseSource.stop(); voice.noiseSource.disconnect(); } catch (e) { /* ignore */ }
            this.cleanupGain(voice.noiseMix);
            this.cleanupGain(voice.sourceMix);
            voice.formants.forEach(f => {
                try { f.filter.disconnect(); } catch (e) { /* ignore */ }
                this.cleanupGain(f.gain);
            });
            this.cleanupGain(voice.masterGain);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            this.cleanupOscillator(voice.source);
            try { voice.noiseSource.stop(); voice.noiseSource.disconnect(); } catch (e) { /* ignore */ }
            this.cleanupGain(voice.noiseMix);
            this.cleanupGain(voice.sourceMix);
            voice.formants.forEach(f => {
                try { f.filter.disconnect(); } catch (e) { /* ignore */ }
                this.cleanupGain(f.gain);
            });
            this.cleanupGain(voice.masterGain);
        }
        this.voices.clear();
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
