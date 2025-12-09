/**
 * Bassline Mode (Continuous Ostinato)
 *
 * A continuous bass pattern player that responds to touch and device orientation.
 * X-axis: Root note
 * Y-axis: Pattern complexity
 * Compass heading: Tempo (60-180 BPM)
 */

import type { TouchId, BassState } from '../types';
import { BaseSynthMode, EngineContext, VOICE_GAIN } from './base';
import {
    BASS_BASE_FREQ,
    BASS_PATTERNS,
    BASS_PATTERN_ORDER,
    BASS_TEMPO_MIN,
    BASS_TEMPO_MAX,
    MASTER_GAIN,
    type BassPattern,
} from '../constants';

export class BasslineMode extends BaseSynthMode {
    readonly name = 'bassline';
    readonly hudLabels: [string, string] = ['X: Root | α: Tempo', 'Y: Pattern | Compass'];
    readonly isContinuous = true;

    private state: BassState | null = null;
    private hudInterval: ReturnType<typeof setInterval> | null = null;
    private engineRef: EngineContext | null = null;

    init(engine: EngineContext): void {
        const { ctx, filter } = engine;
        this.engineRef = engine;

        // Create persistent bass oscillators
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = BASS_BASE_FREQ;
        gain.gain.value = 0;

        const subOsc = ctx.createOscillator();
        const subGain = ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.value = BASS_BASE_FREQ / 2;
        subGain.gain.value = 0;

        osc.connect(gain);
        subOsc.connect(subGain);
        gain.connect(filter);
        subGain.connect(filter);

        osc.start();
        subOsc.start();

        this.state = {
            osc,
            subOsc,
            gain,
            subGain,
            currentStep: 0,
            intervalId: null,
            pattern: 'pulse',
            baseFreq: BASS_BASE_FREQ,
            targetFreq: BASS_BASE_FREQ,
            lastTempo: 120,
            isActive: false
        };

        // Start the continuous bass loop
        this.startBassLoop(engine);
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Bassline is continuous, no per-touch voices
    }

    private getBassPattern(y: number): BassPattern {
        const index = Math.floor(y * BASS_PATTERN_ORDER.length);
        return BASS_PATTERN_ORDER[Math.min(index, BASS_PATTERN_ORDER.length - 1)];
    }

    private getTempoFromCompass(engine: EngineContext): number {
        const compass = engine.orientationParams.compass;
        const normalized = compass / 360;
        return BASS_TEMPO_MIN + normalized * (BASS_TEMPO_MAX - BASS_TEMPO_MIN);
    }

    private startBassLoop(engine: EngineContext): void {
        if (!this.state) return;

        const now = engine.ctx.currentTime;
        engine.masterGain.gain.setTargetAtTime(MASTER_GAIN, now, 0.5);
        this.state.isActive = true;

        // Start the sequencer
        this.scheduleBassStep(engine);

        // Update HUD periodically
        this.hudInterval = setInterval(() => {
            if (!this.state || !this.engineRef) {
                if (this.hudInterval) clearInterval(this.hudInterval);
                return;
            }
            this.updateBassHUD(this.engineRef);
        }, 100);
    }

    private scheduleBassStep(engine: EngineContext): void {
        if (!this.state) return;

        const state = this.state;
        const pattern = BASS_PATTERNS[state.pattern];
        const tempo = this.getTempoFromCompass(engine);
        const beatDuration = 60 / tempo;
        const totalPatternDuration = beatDuration * 1000;

        const stepData = pattern[state.currentStep];
        const semitoneOffset = stepData[0];
        const stepDuration = stepData[1] * totalPatternDuration;

        // Smoothly interpolate to target frequency
        state.baseFreq += (state.targetFreq - state.baseFreq) * 0.3;

        // Play the note
        this.playBassNote(state, semitoneOffset, engine);

        // Schedule next step
        state.intervalId = setTimeout(() => {
            if (!this.state || !this.engineRef) return;
            this.state.currentStep = (this.state.currentStep + 1) % pattern.length;
            this.scheduleBassStep(this.engineRef);
        }, stepDuration);
    }

    private playBassNote(state: BassState, semitoneOffset: number, engine: EngineContext): void {
        const now = engine.ctx.currentTime;

        const freq = state.baseFreq * Math.pow(2, semitoneOffset / 12);
        const subFreq = freq / 2;

        // Quick attack envelope for punchy bass
        state.osc.frequency.setTargetAtTime(freq, now, 0.005);
        state.subOsc.frequency.setTargetAtTime(subFreq, now, 0.005);

        // Punch envelope: quick attack, medium decay
        state.gain.gain.cancelScheduledValues(now);
        state.gain.gain.setValueAtTime(0.001, now);
        state.gain.gain.linearRampToValueAtTime(VOICE_GAIN * 0.8, now + 0.01);
        state.gain.gain.exponentialRampToValueAtTime(VOICE_GAIN * 0.3, now + 0.15);

        state.subGain.gain.cancelScheduledValues(now);
        state.subGain.gain.setValueAtTime(0.001, now);
        state.subGain.gain.linearRampToValueAtTime(VOICE_GAIN * 0.6, now + 0.01);
        state.subGain.gain.exponentialRampToValueAtTime(VOICE_GAIN * 0.25, now + 0.2);
    }

    update(x: number, y: number, _touchId: TouchId, _duration: number, engine: EngineContext): void {
        if (!this.state) return;
        this.engineRef = engine;

        // X controls root note (morph target)
        const note = this.quantizeToScale(x, 2, BASS_BASE_FREQ, engine);
        this.state.targetFreq = note.freq;

        // Y controls pattern
        const newPattern = this.getBassPattern(y);
        if (newPattern !== this.state.pattern) {
            this.state.pattern = newPattern;
            this.state.currentStep = 0;
        }

        this.updateBassHUD(engine);
    }

    private updateBassHUD(engine: EngineContext): void {
        if (!this.state) return;

        const tempo = this.getTempoFromCompass(engine);
        const noteName = this.getNoteName(Math.round(12 * Math.log2(this.state.baseFreq / BASS_BASE_FREQ)));
        const octave = Math.floor(Math.log2(this.state.baseFreq / BASS_BASE_FREQ)) + 1;
        const bpmStr = Math.round(tempo) + ' BPM';

        engine.updateHUD(noteName + octave, this.state.pattern + ' ' + bpmStr);
    }

    stop(_touchId: TouchId, _releaseTime: number, _engine: EngineContext): void {
        // Bassline is continuous, doesn't stop on touch end
    }

    cleanup(): void {
        if (this.hudInterval) {
            clearInterval(this.hudInterval);
            this.hudInterval = null;
        }

        if (this.state) {
            if (this.state.intervalId) {
                clearTimeout(this.state.intervalId);
            }
            this.cleanupOscillator(this.state.osc);
            this.cleanupOscillator(this.state.subOsc);
            this.cleanupGain(this.state.gain);
            this.cleanupGain(this.state.subGain);
            this.state = null;
        }

        this.engineRef = null;
    }

    getVoiceCount(): number {
        return this.state?.isActive ? 1 : 0;
    }
}
