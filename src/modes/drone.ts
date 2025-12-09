/**
 * Drone/Pad Synthesis Mode
 *
 * X-axis: Root note (quantized to scale if enabled)
 * Y-axis: Chord type selection (major, minor, sus4, 7th, etc.)
 * Duration: Affects filter sweep and LFO intensity
 */

import type { TouchId, DroneVoice, DroneVoiceOsc } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';
import { DRONE_CHORD_TYPES, DRONE_FILTER_SWEEP_TIME } from '../constants';

export class DroneMode extends BaseSynthMode {
    readonly name = 'drone';
    readonly hudLabels: [string, string] = ['X: Root | β: Cutoff', 'Y: Chord | γ: Q'];

    private voices = new Map<TouchId, DroneVoice>();

    init(_engine: EngineContext): void {
        this.voices = new Map();
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update()
    }

    private getChordType(y: number): { name: string; intervals: readonly number[] } {
        const types = Object.entries(DRONE_CHORD_TYPES);
        const index = Math.floor(y * types.length);
        const [name, intervals] = types[Math.min(index, types.length - 1)];
        return { name, intervals };
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        const { ctx, filter } = engine;
        const now = ctx.currentTime;

        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;

            const chord = this.getChordType(y);
            const oscs: DroneVoiceOsc[] = [];

            const masterGain = ctx.createGain();
            masterGain.gain.value = 0;

            // LFO for gentle movement
            const lfo = ctx.createOscillator();
            const lfoGain = ctx.createGain();
            lfo.type = 'sine';
            lfo.frequency.value = 0.2;
            lfoGain.gain.value = 3;
            lfo.connect(lfoGain);
            lfo.start();

            // Filter envelope gain for sweep effect
            const filterEnv = ctx.createGain();
            filterEnv.gain.value = 0;

            // Create oscillators for each chord note
            for (const interval of chord.intervals) {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = 'sawtooth';
                osc.frequency.value = 110;
                gain.gain.value = 0.15 / chord.intervals.length;

                // Connect LFO for subtle detuning
                lfoGain.connect(osc.detune);

                osc.connect(gain);
                gain.connect(masterGain);
                osc.start();

                oscs.push({ osc, gain, interval });
            }

            masterGain.connect(filter);

            this.voices.set(touchId, { oscs, masterGain, filterEnv, lfo, lfoGain });
        }

        const voice = this.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 2, 55, engine);
        const chord = this.getChordType(y);

        // Update frequencies based on chord type
        voice.oscs.forEach((o, i) => {
            const interval = i < chord.intervals.length ? chord.intervals[i] : 0;
            const freq = note.freq * Math.pow(2, interval / 12);
            o.osc.frequency.setTargetAtTime(freq, now, 0.1);
            o.interval = interval;
        });

        // Duration affects filter sweep and richness
        const durationFactor = Math.min(1, duration / DRONE_FILTER_SWEEP_TIME);
        voice.lfoGain.gain.setTargetAtTime(2 + durationFactor * 8, now, 0.2);
        voice.lfo.frequency.setTargetAtTime(0.15 + durationFactor * 0.3, now, 0.3);

        // Fade in
        voice.masterGain.gain.setTargetAtTime(VOICE_GAIN, now, 0.1);

        engine.updateHUD(note.noteName + note.octave, chord.name + (durationFactor > 0.5 ? ' ~' : ''));
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;
        voice.masterGain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            voice.oscs.forEach(o => {
                this.cleanupOscillator(o.osc);
                this.cleanupGain(o.gain);
            });
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.lfoGain);
            this.cleanupGain(voice.masterGain);
            this.cleanupGain(voice.filterEnv);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            voice.oscs.forEach(o => {
                this.cleanupOscillator(o.osc);
                this.cleanupGain(o.gain);
            });
            this.cleanupOscillator(voice.lfo);
            this.cleanupGain(voice.lfoGain);
            this.cleanupGain(voice.masterGain);
            this.cleanupGain(voice.filterEnv);
        }
        this.voices.clear();
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
