/**
 * Oneheart Mode (Focus/Ambient Pad)
 *
 * Continuous ambient pad generator inspired by Oneheart's focus music.
 * Warm, evolving pads with slow chord changes and rich detuning.
 *
 * X-axis: Pitch (transpose chord up/down)
 * Y-axis: Voicing (tight/close to open/wide spread)
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

// Pitch range in semitones (X-axis controls transpose)
const PITCH_RANGE_SEMITONES = 12; // -12 to +12 semitones (2 octaves)

// Voicing spread multiplier range (Y-axis controls how spread out the chord is)
const VOICING_TIGHT = 0.5;  // Tight voicing (intervals compressed)
const VOICING_WIDE = 1.5;   // Wide voicing (intervals expanded)

export class OneheartMode extends BaseSynthMode {
    readonly name = 'oneheart';
    readonly hudLabels: [string, string] = ['X: Pitch', 'Y: Voicing'];
    readonly isContinuous = true;

    private nodes: OneheartNodes | null = null;
    private state: OneheartState | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private engineRef: EngineContext | null = null;
    private mood: OneheartMood = 'focus';

    // Touch-controlled parameters
    private targetPitchOffset = 0;  // Semitones offset from base
    private currentPitchOffset = 0; // Smoothly interpolated
    private targetVoicing = 1.0;    // Voicing spread multiplier
    private currentVoicing = 1.0;   // Smoothly interpolated
    private isTouching = false;

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
        const chords = preset.chords;

        // Update evolution phase (slow sine wave for breathing effect)
        state.evolutionPhase += dt * 0.1 * preset.evolutionSpeed;
        state.filterPhase += dt * 0.05;

        // Smoothly interpolate pitch and voicing
        const interpSpeed = this.isTouching ? 0.08 : 0.02; // Faster when touching
        this.currentPitchOffset += (this.targetPitchOffset - this.currentPitchOffset) * interpSpeed;
        this.currentVoicing += (this.targetVoicing - this.currentVoicing) * interpSpeed;

        // Check if it's time for a chord change
        const timeSinceChordChange = Date.now() - state.lastChordChange;
        if (timeSinceChordChange > preset.chordDuration) {
            this.triggerChordChange(engine);
        }

        // Get current chord intervals
        const chord = chords[state.currentChordIndex];

        // Evolve pad voices
        const breatheMod = 0.85 + Math.sin(state.evolutionPhase) * 0.15;

        nodes.pads.forEach((pad, padIndex) => {
            // Slowly evolve detune for organic movement
            pad.detunePhase += dt * (0.08 + padIndex * 0.02);

            // Calculate frequency with pitch offset and voicing
            if (padIndex < chord.length) {
                const baseSemitone = chord[padIndex];
                // Apply voicing: root stays fixed, intervals scale with voicing
                const voicedSemitone = padIndex === 0
                    ? baseSemitone
                    : baseSemitone * this.currentVoicing;
                // Apply pitch offset
                const finalSemitone = voicedSemitone + this.currentPitchOffset;
                const targetFreq = ONEHEART_BASE_FREQ * Math.pow(2, finalSemitone / 12);

                pad.oscs.forEach((o, oscIndex) => {
                    o.osc.frequency.setTargetAtTime(targetFreq, now, 0.3);

                    // Subtle detune drift
                    const detuneDrift = Math.sin(pad.detunePhase + oscIndex * 1.5) * 2;
                    o.osc.detune.setTargetAtTime(o.baseDetune + detuneDrift, now, 0.5);

                    // Subtle gain modulation (breathing)
                    const baseGain = o.osc.type === 'sine' ? 0.15 : 0.08;
                    const modGain = baseGain * breatheMod;
                    o.gain.gain.setTargetAtTime(modGain, now, 0.3);
                });
            }

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

        // Update HUD with pitch and voicing info
        const chordNames = ['I', 'IV', 'vi', 'V', 'iii', 'ii', 'Vsus', 'Iadd9'];
        const chordName = chordNames[state.currentChordIndex % chordNames.length] || 'I';
        const pitchStr = this.currentPitchOffset >= 0
            ? `+${Math.round(this.currentPitchOffset)}`
            : `${Math.round(this.currentPitchOffset)}`;
        const voicingStr = this.currentVoicing < 0.8 ? 'tight' : this.currentVoicing > 1.2 ? 'wide' : 'med';
        engine.updateHUD(`${chordName} ${pitchStr}st`, voicingStr);
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
        this.isTouching = true;
    }

    update(x: number, y: number, _touchId: TouchId, duration: number, engine: EngineContext): void {
        if (!this.state) return;
        this.engineRef = engine;
        this.isTouching = true;

        // X controls pitch offset (-12 to +12 semitones)
        // Center (0.5) = no offset, left = lower, right = higher
        this.targetPitchOffset = (x - 0.5) * 2 * PITCH_RANGE_SEMITONES;

        // Y controls voicing spread
        // Bottom (0) = tight/close voicing, Top (1) = wide/open voicing
        this.targetVoicing = VOICING_TIGHT + y * (VOICING_WIDE - VOICING_TIGHT);

        // Trigger chord change on initial touch (duration < 0.1s means new touch)
        if (duration < 0.1) {
            const timeSinceChange = Date.now() - this.state.lastChordChange;
            if (timeSinceChange > 2000) {
                this.triggerChordChange(engine);
            }
        }
    }

    stop(_touchId: TouchId, _releaseTime: number, _engine: EngineContext): void {
        // Mark as not touching - parameters will slowly drift back to center
        this.isTouching = false;
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
