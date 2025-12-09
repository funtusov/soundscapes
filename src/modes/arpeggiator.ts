/**
 * Arpeggiator Synthesis Mode
 *
 * X-axis: Root note (quantized to scale if enabled)
 * Y-axis: Arpeggio pattern (up, down, updown, alt)
 * Duration: Controls speed of arpeggiation
 */

import type { TouchId, ArpVoice } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES, VOICE_GAIN, VOICE_CLEANUP_BUFFER_MS } from './base';
import { ARP_SPEED_MIN, ARP_SPEED_MAX, ARP_NOTE_DURATION } from '../constants';

export class ArpeggiatorMode extends BaseSynthMode {
    readonly name = 'arpeggiator';
    readonly hudLabels: [string, string] = ['X: Root | β: Cutoff', 'Y: Pattern | γ: Q'];

    private voices = new Map<TouchId, ArpVoice>();
    private engineRef: EngineContext | null = null;

    init(_engine: EngineContext): void {
        this.voices = new Map();
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update()
    }

    private getArpPattern(y: number): { pattern: number[]; name: string } {
        const patterns = [
            { pattern: [0, 4, 7, 12], name: 'up' },
            { pattern: [12, 7, 4, 0], name: 'down' },
            { pattern: [0, 4, 7, 12, 7, 4], name: 'updown' },
            { pattern: [0, 7, 4, 12], name: 'alt' }
        ];
        const index = Math.floor(y * patterns.length);
        return patterns[Math.min(index, patterns.length - 1)];
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        const { ctx, filter } = engine;
        const now = ctx.currentTime;
        this.engineRef = engine;

        const note = this.quantizeToScale(x, 2, 110, engine);
        const { pattern, name } = this.getArpPattern(y);

        // Speed based on duration: longer hold = faster arpeggio
        const durationFactor = Math.min(1, duration / 2);
        const speed = ARP_SPEED_MIN + durationFactor * (ARP_SPEED_MAX - ARP_SPEED_MIN);
        const intervalMs = 1000 / speed;

        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.value = note.freq;
            gain.gain.value = 0;

            osc.connect(gain);
            gain.connect(filter);
            osc.start();

            const voice: ArpVoice = {
                osc,
                gain,
                currentStep: 0,
                intervalId: null,
                pattern: [...pattern],
                baseFreq: note.freq
            };

            // Start the arpeggio
            voice.intervalId = setInterval(() => {
                if (!this.engineRef) return;
                const stepNow = this.engineRef.ctx.currentTime;

                voice.currentStep = (voice.currentStep + 1) % voice.pattern.length;
                const semitones = voice.pattern[voice.currentStep];
                const freq = voice.baseFreq * Math.pow(2, semitones / 12);

                voice.osc.frequency.setTargetAtTime(freq, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN * ARP_NOTE_DURATION, stepNow + intervalMs * 0.001 * 0.7, 0.02);
            }, intervalMs);

            // Initial note
            gain.gain.setTargetAtTime(VOICE_GAIN, now, 0.01);

            this.voices.set(touchId, voice);
        } else {
            const voice = this.voices.get(touchId)!;

            // Update base frequency and pattern
            voice.baseFreq = note.freq;
            voice.pattern = [...pattern];

            // Update speed by restarting interval
            if (voice.intervalId) {
                clearInterval(voice.intervalId);
            }

            voice.intervalId = setInterval(() => {
                if (!this.engineRef) return;
                const stepNow = this.engineRef.ctx.currentTime;

                voice.currentStep = (voice.currentStep + 1) % voice.pattern.length;
                const semitones = voice.pattern[voice.currentStep];
                const freq = voice.baseFreq * Math.pow(2, semitones / 12);

                voice.osc.frequency.setTargetAtTime(freq, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN, stepNow, 0.005);
                voice.gain.gain.setTargetAtTime(VOICE_GAIN * ARP_NOTE_DURATION, stepNow + intervalMs * 0.001 * 0.7, 0.02);
            }, intervalMs);
        }

        engine.updateHUD(note.noteName + note.octave, name + ' ' + Math.round(speed) + 'hz');
    }

    stop(touchId: TouchId, releaseTime: number, engine: EngineContext): void {
        if (!this.voices.has(touchId)) return;

        const voice = this.voices.get(touchId)!;
        const now = engine.ctx.currentTime;

        // Stop the interval
        if (voice.intervalId) {
            clearInterval(voice.intervalId);
            voice.intervalId = null;
        }

        voice.gain.gain.setTargetAtTime(0, now, releaseTime);

        setTimeout(() => {
            this.cleanupOscillator(voice.osc);
            this.cleanupGain(voice.gain);
            this.voices.delete(touchId);
        }, releaseTime * 1000 + VOICE_CLEANUP_BUFFER_MS);
    }

    cleanup(): void {
        for (const voice of this.voices.values()) {
            if (voice.intervalId) {
                clearInterval(voice.intervalId);
            }
            this.cleanupOscillator(voice.osc);
            this.cleanupGain(voice.gain);
        }
        this.voices.clear();
        this.engineRef = null;
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
