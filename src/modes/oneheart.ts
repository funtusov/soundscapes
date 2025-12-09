/**
 * Oneheart Mode (Focus/Relaxation Ambient Pad)
 *
 * Continuous ambient pad generator inspired by Oneheart's focus music.
 * Warm, evolving pads with slow chord changes and rich detuning.
 *
 * Focus mode:
 *   X-axis: Texture (clean to textured with waves/tape blend)
 *   Y-axis: Voicing (tight/close to open/wide spread)
 *
 * Relaxation mode:
 *   X-axis: Depth (surface/dry to deep/wet with darker filter)
 *   Y-axis: Drift (still to flowing with more LFO movement)
 *
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
    RELAXATION_REVERB,
    ONEHEART_PRESETS,
    type OneheartMood,
    clamp,
} from '../constants';

// Internal noise texture nodes
interface NoiseLayer {
    source: AudioBufferSourceNode;
    filter: BiquadFilterNode;
    gain: GainNode;
    lfo: OscillatorNode;
    lfoGain: GainNode;
}

interface OneheartNodes {
    pads: OneheartPadVoice[];
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    masterGain: GainNode;
    // Noise textures
    wavesNoise: NoiseLayer | null;
    tapeNoise: NoiseLayer | null;
}

// Voicing spread multiplier range (Y-axis controls how spread out the chord is)
const VOICING_TIGHT = 0.5;  // Tight voicing (intervals compressed)
const VOICING_WIDE = 1.5;   // Wide voicing (intervals expanded)

// Noise settings
const WAVES_GAIN = 0.025;   // Max waves noise level
const TAPE_GAIN = 0.018;    // Max tape noise level
const WAVES_FILTER = 2000;  // Waves lowpass frequency
const TAPE_FILTER_LOW = 1500;  // Tape highpass
const TAPE_FILTER_HIGH = 5000; // Tape lowpass
const WAVES_LFO_RATE = 0.08;   // Slow wave modulation
const TAPE_LFO_RATE = 0.12;    // Slightly faster tape flutter

export class OneheartMode extends BaseSynthMode {
    readonly name = 'oneheart';
    readonly isContinuous = true;

    private nodes: OneheartNodes | null = null;
    private state: OneheartState | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private engineRef: EngineContext | null = null;
    private mood: OneheartMood = 'focus';

    // Focus mode parameters (X: texture, Y: voicing)
    private targetNoiseMix = 0;     // 0 = clean, 1 = full noise
    private currentNoiseMix = 0;    // Smoothly interpolated
    private targetVoicing = 1.0;    // Voicing spread multiplier
    private currentVoicing = 1.0;   // Smoothly interpolated

    // Relaxation mode parameters (X: depth, Y: drift)
    private targetDepth = 0;        // 0 = surface, 1 = deep
    private currentDepth = 0;       // Smoothly interpolated
    private targetDrift = 0.3;      // 0 = still, 1 = flowing
    private currentDrift = 0.3;     // Smoothly interpolated

    private isTouching = false;
    private noisePhase = 0;         // For modulating between wave/tape blend

    // Dynamic HUD labels based on mood
    get hudLabels(): [string, string] {
        return this.mood === 'relaxation'
            ? ['X: Depth', 'Y: Drift']
            : ['X: Texture', 'Y: Voicing'];
    }

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

        // Create noise layers (initially silent)
        const wavesNoise = this.createNoiseLayer(ctx, filter, 'waves');
        const tapeNoise = this.createNoiseLayer(ctx, filter, 'tape');

        this.nodes = {
            pads,
            lfoSlow,
            lfoMedium,
            masterGain: oneheartMaster,
            wavesNoise,
            tapeNoise,
        };

        for (let i = 0; i < chord.length; i++) {
            const semitone = chord[i];
            const freq = ONEHEART_BASE_FREQ * Math.pow(2, semitone / 12);
            const pad = this.createPadVoice(ctx, oneheartMaster, freq, i, chord.length);
            if (pad) pads.push(pad);
        }

        // Set reverb based on mood (relaxation has longer, wetter reverb)
        const reverbSettings = this.mood === 'relaxation' ? RELAXATION_REVERB : ONEHEART_REVERB;
        if (engine.setReverb) {
            engine.setReverb(reverbSettings.decay, reverbSettings.wet, reverbSettings.dry);
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

    private createNoiseBuffer(ctx: AudioContext, duration = 4): AudioBuffer {
        const sampleRate = ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }

        return buffer;
    }

    private createNoiseLayer(
        ctx: AudioContext,
        destination: BiquadFilterNode,
        type: 'waves' | 'tape'
    ): NoiseLayer {
        const noiseBuffer = this.createNoiseBuffer(ctx, 4);

        // Create noise source
        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;

        // Create filter based on type
        const filter = ctx.createBiquadFilter();
        if (type === 'waves') {
            filter.type = 'lowpass';
            filter.frequency.value = WAVES_FILTER;
            filter.Q.value = 0.7;
        } else {
            // Tape: use bandpass for hissy character
            filter.type = 'bandpass';
            filter.frequency.value = (TAPE_FILTER_LOW + TAPE_FILTER_HIGH) / 2;
            filter.Q.value = 0.5;
        }

        // Create gain (starts at 0)
        const gain = ctx.createGain();
        gain.gain.value = 0;

        // Create LFO for wave-like modulation
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = type === 'waves' ? WAVES_LFO_RATE : TAPE_LFO_RATE;

        // LFO gain controls modulation depth
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0; // Will be set based on noise mix

        // Connect LFO to gain's gain parameter for amplitude modulation
        lfo.connect(lfoGain);
        lfoGain.connect(gain.gain);

        // Connect: noise -> filter -> gain -> master filter
        source.connect(filter);
        filter.connect(gain);
        gain.connect(destination);

        source.start();
        lfo.start();

        return { source, filter, gain, lfo, lfoGain };
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
        const isRelaxation = this.mood === 'relaxation';

        // Update evolution phase (slow sine wave for breathing effect)
        state.evolutionPhase += dt * 0.1 * preset.evolutionSpeed;
        state.filterPhase += dt * 0.05;

        // Smoothly interpolate parameters based on mood
        const interpSpeed = this.isTouching ? 0.08 : 0.02; // Faster when touching

        if (isRelaxation) {
            // Relaxation mode: depth and drift
            this.currentDepth += (this.targetDepth - this.currentDepth) * interpSpeed;
            this.currentDrift += (this.targetDrift - this.currentDrift) * interpSpeed;
        } else {
            // Focus mode: texture and voicing
            this.currentNoiseMix += (this.targetNoiseMix - this.currentNoiseMix) * interpSpeed;
            this.currentVoicing += (this.targetVoicing - this.currentVoicing) * interpSpeed;
        }

        // Update noise phase for modulating blend between waves/tape
        this.noisePhase += dt * 0.15;

        // Update noise layers based on mode
        if (isRelaxation) {
            this.updateNoiseLayersRelaxation(now);
        } else {
            this.updateNoiseLayers(now);
        }

        // Check if it's time for a chord change
        const timeSinceChordChange = Date.now() - state.lastChordChange;
        if (timeSinceChordChange > preset.chordDuration) {
            this.triggerChordChange(engine);
        }

        // Get current chord intervals
        const chord = chords[state.currentChordIndex];

        // Calculate drift-influenced modulation depth for relaxation
        const driftMod = isRelaxation ? this.currentDrift : 0.5;

        // Evolve pad voices
        const breatheAmount = 0.1 + driftMod * 0.15; // More breathing with more drift
        const breatheMod = 1 - breatheAmount + Math.sin(state.evolutionPhase) * breatheAmount;

        nodes.pads.forEach((pad, padIndex) => {
            // Slowly evolve detune for organic movement (faster with drift)
            const detuneSpeed = isRelaxation
                ? 0.05 + this.currentDrift * 0.1
                : 0.08;
            pad.detunePhase += dt * (detuneSpeed + padIndex * 0.02);

            // Calculate frequency with voicing (fixed at 1.0 for relaxation)
            if (padIndex < chord.length) {
                const baseSemitone = chord[padIndex];
                const voicing = isRelaxation ? 1.0 : this.currentVoicing;
                const voicedSemitone = padIndex === 0
                    ? baseSemitone
                    : baseSemitone * voicing;
                const targetFreq = ONEHEART_BASE_FREQ * Math.pow(2, voicedSemitone / 12);

                pad.oscs.forEach((o, oscIndex) => {
                    o.osc.frequency.setTargetAtTime(targetFreq, now, 0.3);

                    // Detune drift (more with relaxation drift)
                    const detuneDriftAmount = isRelaxation ? 2 + this.currentDrift * 4 : 2;
                    const detuneDrift = Math.sin(pad.detunePhase + oscIndex * 1.5) * detuneDriftAmount;
                    o.osc.detune.setTargetAtTime(o.baseDetune + detuneDrift, now, 0.5);

                    // Subtle gain modulation (breathing)
                    const baseGain = o.osc.type === 'sine' ? 0.15 : 0.08;
                    const modGain = baseGain * breatheMod;
                    o.gain.gain.setTargetAtTime(modGain, now, 0.3);
                });
            }

            // Panning drift (more stereo movement with drift)
            const panDriftAmount = isRelaxation ? 0.1 + this.currentDrift * 0.2 : 0.1;
            const panDrift = Math.sin(pad.detunePhase * 0.3) * panDriftAmount;
            const basePan = nodes.pads.length > 1
                ? (padIndex / (nodes.pads.length - 1)) * 1.2 - 0.6
                : 0;
            pad.panner.pan.setTargetAtTime(clamp(basePan + panDrift, -1, 1), now, 0.5);
        });

        // Evolve filter (slow sweep)
        const filterRange = preset.filterRange[1] - preset.filterRange[0];
        const filterCenter = preset.filterRange[0] + filterRange / 2;
        const filterMod = Math.sin(state.filterPhase) * filterRange * 0.3;
        let targetFilter = filterCenter + filterMod;

        // Relaxation: depth darkens the filter
        if (isRelaxation && 'depthFilterMult' in preset) {
            const depthPreset = preset as typeof preset & { depthFilterMult: readonly [number, number] };
            const filterMult = depthPreset.depthFilterMult[0] +
                this.currentDepth * (depthPreset.depthFilterMult[1] - depthPreset.depthFilterMult[0]);
            targetFilter *= filterMult;
        }

        // Also consider device tilt for filter control
        const tiltFactor = 1 - engine.orientationParams.filterMod;
        const finalFilter = preset.filterRange[0] + (targetFilter - preset.filterRange[0]) * tiltFactor;

        engine.filter.frequency.setTargetAtTime(clamp(finalFilter, preset.filterRange[0], preset.filterRange[1]), now, 0.5);

        // Relaxation: depth affects reverb wet mix
        if (isRelaxation && engine.setReverbWet && 'depthReverbRange' in preset) {
            const depthPreset = preset as typeof preset & { depthReverbRange: readonly [number, number] };
            const wetMix = depthPreset.depthReverbRange[0] +
                this.currentDepth * (depthPreset.depthReverbRange[1] - depthPreset.depthReverbRange[0]);
            engine.setReverbWet(wetMix);
        }

        // Update HUD based on mood
        this.updateHUD(engine, state);
    }

    private updateHUD(engine: EngineContext, state: OneheartState): void {
        const isRelaxation = this.mood === 'relaxation';
        const chordNames = isRelaxation
            ? ['sus4', 'Fsus', 'Gsus', 'add9', 'Am7']
            : ['I', 'IV', 'vi', 'V', 'iii', 'ii', 'Vsus', 'Iadd9'];
        const chordName = chordNames[state.currentChordIndex % chordNames.length] || 'I';

        if (isRelaxation) {
            const depthPercent = Math.round(this.currentDepth * 100);
            const depthStr = depthPercent < 20 ? 'surface' : depthPercent > 70 ? 'deep' : `${depthPercent}%`;
            const driftStr = this.currentDrift < 0.4 ? 'still' : this.currentDrift > 0.7 ? 'flowing' : 'gentle';
            engine.updateHUD(`${chordName} ${depthStr}`, driftStr);
        } else {
            const noisePercent = Math.round(this.currentNoiseMix * 100);
            const noiseStr = noisePercent === 0 ? 'clean' : `tex ${noisePercent}%`;
            const voicingStr = this.currentVoicing < 0.8 ? 'tight' : this.currentVoicing > 1.2 ? 'wide' : 'med';
            engine.updateHUD(`${chordName} ${noiseStr}`, voicingStr);
        }
    }

    private updateNoiseLayers(now: number): void {
        if (!this.nodes) return;

        const { wavesNoise, tapeNoise } = this.nodes;
        if (!wavesNoise || !tapeNoise) return;

        // Calculate modulating blend between waves and tape
        // As mix increases, both layers come in, with waves/tape ratio modulating
        const blendOsc = Math.sin(this.noisePhase) * 0.5 + 0.5; // 0 to 1 oscillation

        // Waves: more prominent at lower mix, tape: more prominent at higher mix
        // But blend oscillates between them
        const wavesWeight = 1 - blendOsc * 0.6; // 0.4 to 1.0
        const tapeWeight = 0.4 + blendOsc * 0.6; // 0.4 to 1.0

        const wavesLevel = this.currentNoiseMix * WAVES_GAIN * wavesWeight;
        const tapeLevel = this.currentNoiseMix * TAPE_GAIN * tapeWeight;

        // Set gain levels with smooth transition
        wavesNoise.gain.gain.setTargetAtTime(wavesLevel, now, 0.3);
        tapeNoise.gain.gain.setTargetAtTime(tapeLevel, now, 0.3);

        // Modulate LFO depth based on noise mix (more texture = more modulation)
        const lfoDepth = this.currentNoiseMix * 0.5; // 0 to 0.5 modulation
        wavesNoise.lfoGain.gain.setTargetAtTime(wavesLevel * lfoDepth, now, 0.3);
        tapeNoise.lfoGain.gain.setTargetAtTime(tapeLevel * lfoDepth * 0.7, now, 0.3);
    }

    private updateNoiseLayersRelaxation(now: number): void {
        if (!this.nodes) return;

        const { wavesNoise, tapeNoise } = this.nodes;
        if (!wavesNoise || !tapeNoise) return;

        // In relaxation mode, depth controls how "distant" the texture is
        // More depth = more texture but also more filtered/distant
        const preset = ONEHEART_PRESETS[this.mood];
        const textureLevel = preset.textureLevel;

        // Waves are always on in relaxation, modulated by drift
        const driftOsc = Math.sin(this.noisePhase * (0.5 + this.currentDrift * 0.5)) * 0.5 + 0.5;

        // Base texture increases with depth (sinking deeper adds more ambient texture)
        const depthTextureBoost = this.currentDepth * 0.5;
        const baseLevel = textureLevel + depthTextureBoost;

        // Waves dominate at surface, tape becomes more prominent at depth
        const wavesWeight = 1 - this.currentDepth * 0.4; // 0.6 to 1.0
        const tapeWeight = 0.3 + this.currentDepth * 0.5; // 0.3 to 0.8

        const wavesLevel = baseLevel * WAVES_GAIN * wavesWeight * (0.7 + driftOsc * 0.3);
        const tapeLevel = baseLevel * TAPE_GAIN * tapeWeight * (0.8 + driftOsc * 0.2);

        // Set gain levels with slower transitions for relaxation
        wavesNoise.gain.gain.setTargetAtTime(wavesLevel, now, 0.5);
        tapeNoise.gain.gain.setTargetAtTime(tapeLevel, now, 0.5);

        // LFO modulation controlled by drift
        const lfoDepth = 0.2 + this.currentDrift * 0.5;
        wavesNoise.lfoGain.gain.setTargetAtTime(wavesLevel * lfoDepth, now, 0.5);
        tapeNoise.lfoGain.gain.setTargetAtTime(tapeLevel * lfoDepth * 0.6, now, 0.5);

        // Filter the noise darker at deeper levels
        const baseFilterFreq = WAVES_FILTER;
        const depthFilterMult = 1 - this.currentDepth * 0.5; // Gets darker with depth
        wavesNoise.filter.frequency.setTargetAtTime(baseFilterFreq * depthFilterMult, now, 0.5);
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

        if (this.mood === 'relaxation') {
            // Relaxation mode: X = depth, Y = drift
            // X: Left = surface/dry, Right = deep/wet
            this.targetDepth = x;

            // Y: Bottom = still, Top = flowing
            this.targetDrift = y;
        } else {
            // Focus mode: X = texture, Y = voicing
            // X: Left = clean, Right = textured
            this.targetNoiseMix = x;

            // Y: Bottom = tight voicing, Top = wide voicing
            this.targetVoicing = VOICING_TIGHT + y * (VOICING_WIDE - VOICING_TIGHT);
        }

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

            // Clean up noise layers
            if (this.nodes.wavesNoise) {
                this.cleanupNoiseLayer(this.nodes.wavesNoise);
            }
            if (this.nodes.tapeNoise) {
                this.cleanupNoiseLayer(this.nodes.tapeNoise);
            }

            // Clean up master gain
            this.cleanupGain(this.nodes.masterGain);

            this.nodes = null;
        }

        this.state = null;
        this.engineRef = null;

        // Reset noise state
        this.targetNoiseMix = 0;
        this.currentNoiseMix = 0;
        this.noisePhase = 0;
    }

    private cleanupNoiseLayer(layer: NoiseLayer): void {
        try {
            layer.source.stop();
            layer.source.disconnect();
        } catch { /* ignore */ }
        try {
            layer.lfo.stop();
            layer.lfo.disconnect();
        } catch { /* ignore */ }
        this.cleanupGain(layer.gain);
        this.cleanupGain(layer.lfoGain);
        try { layer.filter.disconnect(); } catch { /* ignore */ }
    }

    getVoiceCount(): number {
        return this.state?.isActive ? 1 : 0;
    }
}
