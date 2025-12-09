/**
 * Oneheart Mode (Focus/Ambient Pad)
 *
 * Continuous ambient pad generator inspired by Oneheart's focus music.
 * Warm, evolving pads with slow chord changes and rich detuning.
 * Touch triggers chord transitions.
 */

import type {
    TouchId,
    OneheartPadVoice,
    OneheartPadOsc,
    OneheartState,
} from '../types';
import { BaseSynthMode, EngineContext } from './base';
import {
    ONEHEART_BASE_FREQ,
    ONEHEART_LFO_SLOW,
    ONEHEART_LFO_MEDIUM,
    ONEHEART_LOOP_INTERVAL,
    ONEHEART_MASTER_GAIN,
    ONEHEART_REVERB,
    ONEHEART_PRESETS,
    type OneheartMood,
    clamp,
} from '../constants';

interface OneheartNodes {
    pads: OneheartPadVoice[];
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    masterGain: GainNode;
}

export class OneheartMode extends BaseSynthMode {
    readonly name = 'oneheart';
    readonly hudLabels: [string, string] = ['Focus', 'Evolving'];
    readonly isContinuous = true;

    private nodes: OneheartNodes | null = null;
    private state: OneheartState | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private engineRef: EngineContext | null = null;
    private mood: OneheartMood = 'focus';

    setMood(mood: OneheartMood): void {
        this.mood = mood;
    }

    getMood(): OneheartMood {
        return this.mood;
    }

    init(engine: EngineContext): void {
        const { ctx, filter } = engine;
        this.engineRef = engine;

        const preset = ONEHEART_PRESETS[this.mood];
        const chords = preset.chords;

        this.state = {
            currentChordIndex: 0,
            nextChordIndex: 1,
            chordTransitionProgress: 0,
            lastChordChange: Date.now(),
            filterPhase: 0,
            evolutionPhase: Math.random() * Math.PI * 2,
            brightness: preset.brightness,
            isActive: false,
        };

        // Create oneheart master gain
        const oneheartMaster = ctx.createGain();
        oneheartMaster.gain.value = 0;
        oneheartMaster.connect(filter);

        // Create LFOs for modulation
        const lfoSlow = ctx.createOscillator();
        lfoSlow.type = 'sine';
        lfoSlow.frequency.value = ONEHEART_LFO_SLOW;
        lfoSlow.start();

        const lfoMedium = ctx.createOscillator();
        lfoMedium.type = 'sine';
        lfoMedium.frequency.value = ONEHEART_LFO_MEDIUM;
        lfoMedium.start();

        // Create pad voices for each note in the first chord
        const pads: OneheartPadVoice[] = [];
        const chord = chords[0];

        this.nodes = {
            pads,
            lfoSlow,
            lfoMedium,
            masterGain: oneheartMaster,
        };

        for (let i = 0; i < chord.length; i++) {
            const semitone = chord[i];
            const freq = ONEHEART_BASE_FREQ * Math.pow(2, semitone / 12);
            const pad = this.createPadVoice(ctx, oneheartMaster, freq, i, chord.length);
            if (pad) pads.push(pad);
        }

        // Set long reverb for Oneheart mode
        if (engine.setReverb) {
            engine.setReverb(ONEHEART_REVERB.decay, ONEHEART_REVERB.wet, ONEHEART_REVERB.dry);
        }

        // Start the evolution loop
        this.startLoop(engine);
    }

    private createPadVoice(
        ctx: AudioContext,
        destination: GainNode,
        freq: number,
        index: number,
        totalNotes: number
    ): OneheartPadVoice | null {
        const preset = ONEHEART_PRESETS[this.mood];
        const oscs: OneheartPadOsc[] = [];
        const numOscs = 4; // 4 oscillators per pad voice for rich sound

        // Create voice gain
        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0;

        // Create panner for stereo spread
        const panner = ctx.createStereoPanner();
        // Spread notes across stereo field
        const panPosition = totalNotes > 1 ? (index / (totalNotes - 1)) * 1.2 - 0.6 : 0;
        panner.pan.value = panPosition;

        voiceGain.connect(panner);
        panner.connect(destination);

        // Create detuned oscillators
        for (let i = 0; i < numOscs; i++) {
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();

            // Mix of sine (warm) and triangle (presence)
            osc.type = i < 2 ? 'sine' : 'triangle';
            osc.frequency.value = freq;

            // Detune spread: -12 to +12 cents based on preset
            const detuneSpread = preset.detuneAmount;
            const baseDetune = ((i / (numOscs - 1)) * 2 - 1) * detuneSpread;
            osc.detune.value = baseDetune;

            // Quieter for sine oscillators, louder for triangle
            const gainValue = osc.type === 'sine' ? 0.15 : 0.08;
            oscGain.gain.value = gainValue;

            osc.connect(oscGain);
            oscGain.connect(voiceGain);
            osc.start();

            oscs.push({
                osc,
                gain: oscGain,
                baseDetune,
                panPosition: (i / (numOscs - 1)) * 0.4 - 0.2,
            });
        }

        return {
            oscs,
            voiceGain,
            panner,
            noteFreq: freq,
            detunePhase: Math.random() * Math.PI * 2,
        };
    }

    private startLoop(engine: EngineContext): void {
        if (this.loopInterval) clearInterval(this.loopInterval);

        const now = engine.ctx.currentTime;

        // Fade in master gain
        engine.masterGain.gain.setTargetAtTime(ONEHEART_MASTER_GAIN, now, 1.0);

        if (this.nodes) {
            // Fade in pad voices with staggered timing
            this.nodes.pads.forEach((pad, i) => {
                const delay = i * 0.5;
                pad.voiceGain.gain.setTargetAtTime(0.18, now + delay, 2.0);
            });

            // Fade in oneheart master
            this.nodes.masterGain.gain.setTargetAtTime(1.0, now, 1.5);
        }

        if (this.state) {
            this.state.isActive = true;
        }

        // Start the evolution loop
        this.loopInterval = setInterval(() => {
            if (!this.engineRef) {
                if (this.loopInterval) clearInterval(this.loopInterval);
                return;
            }
            this.evolve(this.engineRef);
        }, ONEHEART_LOOP_INTERVAL);
    }

    private evolve(engine: EngineContext): void {
        if (!this.state || !this.nodes) return;

        const now = engine.ctx.currentTime;
        const state = this.state;
        const nodes = this.nodes;
        const preset = ONEHEART_PRESETS[this.mood];
        const dt = ONEHEART_LOOP_INTERVAL / 1000;

        // Update evolution phase (slow sine wave for breathing effect)
        state.evolutionPhase += dt * 0.1 * preset.evolutionSpeed;
        state.filterPhase += dt * 0.05;

        // Check if it's time for a chord change
        const timeSinceChordChange = Date.now() - state.lastChordChange;
        if (timeSinceChordChange > preset.chordDuration) {
            this.triggerChordChange(engine);
        }

        // Evolve pad voices
        const breatheMod = 0.85 + Math.sin(state.evolutionPhase) * 0.15;

        nodes.pads.forEach((pad, padIndex) => {
            // Slowly evolve detune for organic movement
            pad.detunePhase += dt * (0.08 + padIndex * 0.02);

            pad.oscs.forEach((o, oscIndex) => {
                // Subtle detune drift
                const detuneDrift = Math.sin(pad.detunePhase + oscIndex * 1.5) * 2;
                o.osc.detune.setTargetAtTime(o.baseDetune + detuneDrift, now, 0.5);

                // Subtle gain modulation (breathing)
                const baseGain = o.osc.type === 'sine' ? 0.15 : 0.08;
                const modGain = baseGain * breatheMod;
                o.gain.gain.setTargetAtTime(modGain, now, 0.3);
            });

            // Subtle panning drift
            const panDrift = Math.sin(pad.detunePhase * 0.3) * 0.1;
            const basePan = nodes.pads.length > 1
                ? (padIndex / (nodes.pads.length - 1)) * 1.2 - 0.6
                : 0;
            pad.panner.pan.setTargetAtTime(clamp(basePan + panDrift, -1, 1), now, 0.5);
        });

        // Evolve filter (slow sweep)
        const filterRange = preset.filterRange[1] - preset.filterRange[0];
        const filterCenter = preset.filterRange[0] + filterRange / 2;
        const filterMod = Math.sin(state.filterPhase) * filterRange * 0.3;
        const targetFilter = filterCenter + filterMod;

        // Also consider device tilt for filter control
        const tiltFactor = 1 - engine.orientationParams.filterMod;
        const finalFilter = preset.filterRange[0] + (targetFilter - preset.filterRange[0]) * tiltFactor;

        engine.filter.frequency.setTargetAtTime(finalFilter, now, 0.5);

        // Update HUD
        const chordNames = ['I', 'IV', 'vi', 'V', 'iii', 'ii', 'Vsus', 'Iadd9'];
        const chordName = chordNames[state.currentChordIndex % chordNames.length] || 'I';
        engine.updateHUD('Focus', chordName + ' ○');
    }

    private triggerChordChange(engine: EngineContext): void {
        if (!this.state || !this.nodes) return;

        const state = this.state;
        const nodes = this.nodes;
        const preset = ONEHEART_PRESETS[this.mood];
        const chords = preset.chords;
        const now = engine.ctx.currentTime;

        // Move to next chord
        state.currentChordIndex = (state.currentChordIndex + 1) % chords.length;
        state.lastChordChange = Date.now();

        const newChord = chords[state.currentChordIndex];

        // Crossfade to new chord frequencies
        nodes.pads.forEach((pad, i) => {
            if (i < newChord.length) {
                const semitone = newChord[i];
                const newFreq = ONEHEART_BASE_FREQ * Math.pow(2, semitone / 12);

                pad.oscs.forEach((o) => {
                    o.osc.frequency.setTargetAtTime(newFreq, now, 3.0); // Slow 3-second glide
                });
                pad.noteFreq = newFreq;
            }
        });
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Oneheart is continuous, no per-touch voices
    }

    update(_x: number, _y: number, _touchId: TouchId, _duration: number, engine: EngineContext): void {
        // Touch triggers a chord change
        if (!this.state) return;
        this.engineRef = engine;

        // Only trigger chord change if enough time has passed (prevent spam)
        const timeSinceChange = Date.now() - this.state.lastChordChange;
        if (timeSinceChange > 2000) {
            this.triggerChordChange(engine);
        }
    }

    stop(_touchId: TouchId, _releaseTime: number, _engine: EngineContext): void {
        // Oneheart is continuous, doesn't stop on touch end
    }

    cleanup(): void {
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }

        if (this.nodes) {
            // Clean up pads
            for (const pad of this.nodes.pads) {
                for (const o of pad.oscs) {
                    this.cleanupOscillator(o.osc);
                    this.cleanupGain(o.gain);
                }
                this.cleanupGain(pad.voiceGain);
                try { pad.panner.disconnect(); } catch { /* ignore */ }
            }

            // Clean up LFOs
            this.cleanupOscillator(this.nodes.lfoSlow);
            this.cleanupOscillator(this.nodes.lfoMedium);

            // Clean up master gain
            this.cleanupGain(this.nodes.masterGain);

            this.nodes = null;
        }

        this.state = null;
        this.engineRef = null;
    }

    getVoiceCount(): number {
        return this.state?.isActive ? 1 : 0;
    }
}
