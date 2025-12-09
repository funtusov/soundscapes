/**
 * Ambient Mode
 *
 * Continuous evolving ambient soundscape with drones, noise bed, and shimmer.
 * X-axis: Base frequency / brightness
 * Y-axis: Texture density / shimmer amount
 * Touch triggers chord changes
 */

import type {
    TouchId,
    AmbientDroneVoice,
    AmbientDroneOsc,
    NoiseBed,
    ShimmerLayer,
    ShimmerPartial,
    AmbientState,
} from '../types';
import { BaseSynthMode, EngineContext } from './base';
import {
    AMBIENT_BASE_FREQ,
    AMBIENT_LFO_SLOW,
    AMBIENT_LFO_MEDIUM,
    AMBIENT_LOOP_INTERVAL,
    AMBIENT_TOUCH_TIMEOUT,
    AMBIENT_CHORDS,
    AMBIENT_MASTER_GAIN,
    clamp,
} from '../constants';

interface AmbientNodes {
    drones: AmbientDroneVoice[];
    noiseBed: NoiseBed | null;
    shimmer: ShimmerLayer | null;
    lfoSlow: OscillatorNode;
    lfoMedium: OscillatorNode;
    baseFreq: number;
    currentChordIndex: number;
    chordTransitionTime: number;
}

export class AmbientMode extends BaseSynthMode {
    readonly name = 'ambient';
    readonly hudLabels: [string, string] = ['X: Freq | β: Cutoff', 'Y: Texture | γ: Q'];
    readonly isContinuous = true;

    private nodes: AmbientNodes | null = null;
    private state: AmbientState | null = null;
    private loopInterval: ReturnType<typeof setInterval> | null = null;
    private touchTimeout: ReturnType<typeof setTimeout> | null = null;
    private engineRef: EngineContext | null = null;

    init(engine: EngineContext): void {
        const { ctx, filter } = engine;
        this.engineRef = engine;

        // Initialize ambient state
        this.state = {
            x: 0.5,
            y: 0.5,
            targetX: 0.5,
            targetY: 0.5,
            microPhase: 0,
            mesoPhase: 0,
            macroPhase: 0,
            walkX: 0.5,
            walkY: 0.5,
            walkVelX: 0,
            walkVelY: 0,
            isActive: false,
            touchActive: false,
        };

        const drones: AmbientDroneVoice[] = [];
        const droneCount = 4;
        const baseFreq = AMBIENT_BASE_FREQ;
        const voiceRatios = [1, 1.5, 2, 3];
        const panPositions = [-0.6, -0.2, 0.2, 0.6];

        for (let v = 0; v < droneCount; v++) {
            const drone = this.createDroneVoice(ctx, filter, baseFreq * voiceRatios[v], panPositions[v]);
            if (drone) drones.push(drone);
        }

        const noiseBed = this.createNoiseBed(ctx, filter);
        const shimmer = this.createShimmerLayer(ctx, filter, baseFreq);

        const lfoSlow = ctx.createOscillator();
        lfoSlow.type = 'sine';
        lfoSlow.frequency.value = AMBIENT_LFO_SLOW;
        lfoSlow.start();

        const lfoMedium = ctx.createOscillator();
        lfoMedium.type = 'sine';
        lfoMedium.frequency.value = AMBIENT_LFO_MEDIUM;
        lfoMedium.start();

        this.nodes = {
            drones,
            noiseBed,
            shimmer,
            lfoSlow,
            lfoMedium,
            baseFreq,
            currentChordIndex: 0,
            chordTransitionTime: 0,
        };

        this.startAmbientLoop(engine);
    }

    private createDroneVoice(
        ctx: AudioContext,
        filter: BiquadFilterNode,
        freq: number,
        panPosition: number
    ): AmbientDroneVoice | null {
        const oscs: AmbientDroneOsc[] = [];
        const detuneAmounts = [-3, 0, 3];

        const voiceGain = ctx.createGain();
        voiceGain.gain.value = 0;

        const panner = ctx.createStereoPanner();
        panner.pan.value = panPosition;

        voiceGain.connect(panner);
        panner.connect(filter);

        for (let i = 0; i < 3; i++) {
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.detune.value = detuneAmounts[i];
            oscGain.gain.value = 0.25;

            osc.connect(oscGain);
            oscGain.connect(voiceGain);
            osc.start();

            oscs.push({ osc, gain: oscGain, baseDetune: detuneAmounts[i] });
        }

        return {
            oscs,
            voiceGain,
            panner,
            baseFreq: freq,
            panBase: panPosition,
            detunePhase: Math.random() * Math.PI * 2,
            panPhase: Math.random() * Math.PI * 2,
        };
    }

    private createNoiseBed(ctx: AudioContext, filter: BiquadFilterNode): NoiseBed | null {
        const bufferSize = ctx.sampleRate * 2;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);

        // Generate pink noise
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99765 * b0 + white * 0.0990460;
            b1 = 0.96300 * b1 + white * 0.2965164;
            b2 = 0.57000 * b2 + white * 1.0526913;
            data[i] = (b0 + b1 + b2) * 0.08;
        }

        const noiseSource = ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 300;
        bandpass.Q.value = 0.5;

        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 800;

        const noiseGain = ctx.createGain();
        noiseGain.gain.value = 0;

        const noisePanner = ctx.createStereoPanner();
        noisePanner.pan.value = 0;

        noiseSource.connect(bandpass);
        bandpass.connect(lowpass);
        lowpass.connect(noiseGain);
        noiseGain.connect(noisePanner);
        noisePanner.connect(filter);
        noiseSource.start();

        return {
            source: noiseSource,
            bandpass,
            lowpass,
            gain: noiseGain,
            panner: noisePanner,
            filterPhase: Math.random() * Math.PI * 2,
        };
    }

    private createShimmerLayer(
        ctx: AudioContext,
        filter: BiquadFilterNode,
        baseFreq: number
    ): ShimmerLayer | null {
        const partials: ShimmerPartial[] = [];
        const partialRatios = [3, 4, 5];

        const shimmerGain = ctx.createGain();
        shimmerGain.gain.value = 0;
        shimmerGain.connect(filter);

        for (let i = 0; i < partialRatios.length; i++) {
            const osc = ctx.createOscillator();
            const oscGain = ctx.createGain();
            const tremolo = ctx.createOscillator();
            const tremoloGain = ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = baseFreq * partialRatios[i];
            oscGain.gain.value = 0.015 / (i + 1);

            tremolo.type = 'sine';
            tremolo.frequency.value = 0.3 + Math.random() * 0.5;
            tremoloGain.gain.value = oscGain.gain.value * 0.3;

            tremolo.connect(tremoloGain);
            tremoloGain.connect(oscGain.gain);

            osc.connect(oscGain);
            oscGain.connect(shimmerGain);

            osc.start();
            tremolo.start();

            partials.push({
                osc,
                gain: oscGain,
                tremolo,
                tremoloGain,
                ratio: partialRatios[i],
            });
        }

        return { partials, masterGain: shimmerGain };
    }

    private startAmbientLoop(engine: EngineContext): void {
        if (this.loopInterval) clearInterval(this.loopInterval);

        const now = engine.ctx.currentTime;

        engine.masterGain.gain.setTargetAtTime(AMBIENT_MASTER_GAIN, now, 1.5);

        if (this.nodes) {
            this.nodes.drones.forEach((drone, i) => {
                const level = i === 0 ? 0.10 : 0.06;
                drone.voiceGain.gain.setTargetAtTime(level, now + i * 0.5, 1.2);
            });

            if (this.nodes.noiseBed) {
                this.nodes.noiseBed.gain.gain.setTargetAtTime(0.025, now + 1.0, 2.0);
            }

            if (this.nodes.shimmer) {
                this.nodes.shimmer.masterGain.gain.setTargetAtTime(0.04, now + 1.5, 2.0);
            }
        }

        if (this.state) {
            this.state.isActive = true;
        }

        this.loopInterval = setInterval(() => {
            if (!this.engineRef) {
                if (this.loopInterval) clearInterval(this.loopInterval);
                return;
            }
            this.evolve(this.engineRef);
        }, AMBIENT_LOOP_INTERVAL);
    }

    private evolve(engine: EngineContext): void {
        if (!this.state || !this.nodes) return;

        const now = engine.ctx.currentTime;
        const state = this.state;
        const nodes = this.nodes;
        const dt = 0.016;

        // Advance evolution phases
        state.microPhase += dt * 0.8;
        state.mesoPhase += dt * 0.08;
        state.macroPhase += dt * 0.008;

        // Random walk for organic movement
        state.walkVelX += (Math.random() - 0.5) * 0.0008;
        state.walkVelY += (Math.random() - 0.5) * 0.0008;
        state.walkVelX *= 0.98;
        state.walkVelY *= 0.98;
        state.walkX += state.walkVelX;
        state.walkY += state.walkVelY;

        // Boundary constraints with soft bounce
        if (state.walkX < 0.1) state.walkVelX += 0.001;
        if (state.walkX > 0.9) state.walkVelX -= 0.001;
        if (state.walkY < 0.1) state.walkVelY += 0.001;
        if (state.walkY > 0.9) state.walkVelY -= 0.001;
        state.walkX = clamp(state.walkX, 0, 1);
        state.walkY = clamp(state.walkY, 0, 1);

        // Blend macro drift, random walk, and touch position
        const macroInfluence = 0.3;
        const walkInfluence = 0.4;
        const touchInfluence = state.touchActive ? 0.5 : 0.1;

        const macroDriftX = 0.5 + Math.sin(state.macroPhase) * 0.3;
        const macroDriftY = 0.5 + Math.cos(state.macroPhase * 0.7) * 0.3;

        const blendedX = macroDriftX * macroInfluence + state.walkX * walkInfluence + state.targetX * touchInfluence;
        const blendedY = macroDriftY * macroInfluence + state.walkY * walkInfluence + state.targetY * touchInfluence;

        state.x += (blendedX - state.x) * 0.02;
        state.y += (blendedY - state.y) * 0.02;

        const baseFreq = 55 + state.x * 110;

        // Update drones
        nodes.drones.forEach((drone, i) => {
            drone.detunePhase += dt * (0.1 + i * 0.03);
            drone.panPhase += dt * (0.05 + i * 0.02);

            const mesoMod = Math.sin(state.mesoPhase + i * 0.5) * 1;
            const freqRatio = drone.baseFreq / nodes.baseFreq;
            const newFreq = baseFreq * freqRatio;

            drone.oscs.forEach((o, j) => {
                o.osc.frequency.setTargetAtTime(newFreq, now, 0.5);
                const detuneWander = Math.sin(drone.detunePhase + j * 2) * 1.5;
                const targetDetune = o.baseDetune + detuneWander + mesoMod;
                o.osc.detune.setTargetAtTime(targetDetune, now, 0.4);
            });

            const panWander = Math.sin(drone.panPhase) * 0.08;
            const newPan = clamp(drone.panBase + panWander, -1, 1);
            drone.panner.pan.setTargetAtTime(newPan, now, 0.5);

            const breatheMod = 0.92 + Math.sin(state.mesoPhase + i * 0.7) * 0.08;
            const baseLevel = i === 0 ? 0.10 : 0.06;
            const yMod = i > 1 ? (1 - state.y * 0.2) : 1;
            drone.voiceGain.gain.setTargetAtTime(baseLevel * breatheMod * yMod, now, 0.3);
        });

        // Update noise bed
        if (nodes.noiseBed) {
            const noise = nodes.noiseBed;
            noise.filterPhase += dt * 0.03;

            const noiseCenter = 200 + state.y * 200 + Math.sin(noise.filterPhase) * 50;
            noise.bandpass.frequency.setTargetAtTime(noiseCenter, now, 0.8);
            noise.bandpass.Q.setTargetAtTime(0.5 + state.y * 0.5, now, 0.5);

            const noiseLevel = 0.015 + state.y * 0.025;
            noise.gain.gain.setTargetAtTime(noiseLevel, now, 0.4);

            const noisePan = Math.sin(noise.filterPhase * 0.2) * 0.2;
            noise.panner.pan.setTargetAtTime(noisePan, now, 0.5);
        }

        // Update shimmer
        if (nodes.shimmer) {
            const shimmer = nodes.shimmer;
            shimmer.partials.forEach((p, i) => {
                const shimmerFreq = baseFreq * p.ratio;
                p.osc.frequency.setTargetAtTime(shimmerFreq, now, 0.5);

                const shimmerLevel = (0.008 + state.y * 0.015) / (i + 1);
                p.gain.gain.setTargetAtTime(shimmerLevel, now, 0.5);

                const tremoloRate = 0.3 + Math.sin(state.mesoPhase + i) * 0.2;
                p.tremolo.frequency.setTargetAtTime(tremoloRate, now, 0.8);
            });

            const shimmerMaster = 0.02 + state.y * 0.04;
            shimmer.masterGain.gain.setTargetAtTime(shimmerMaster, now, 0.5);
        }

        const noteName = this.getNoteName(Math.round(12 * Math.log2(baseFreq / 55)) + 9);
        const moodWord = state.y < 0.33 ? 'deep' : state.y < 0.66 ? 'calm' : 'airy';
        engine.updateHUD(noteName + ' ' + Math.round(baseFreq) + 'Hz', moodWord + ' ' + (state.touchActive ? '◉' : '○'));
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Ambient is continuous, no per-touch voices
    }

    update(x: number, y: number, _touchId: TouchId, duration: number, engine: EngineContext): void {
        if (!this.state || !this.nodes) return;
        this.engineRef = engine;

        const state = this.state;
        const nodes = this.nodes;
        const now = engine.ctx.currentTime;
        const influence = Math.min(1, 0.4 + duration * 0.4);
        state.targetX = state.targetX * (1 - influence) + x * influence;
        state.targetY = state.targetY * (1 - influence) + y * influence;

        // Trigger chord change on new touch (when not already active)
        if (!state.touchActive) {
            // Cycle to next chord
            nodes.currentChordIndex = (nodes.currentChordIndex + 1) % AMBIENT_CHORDS.length;
            nodes.chordTransitionTime = now;

            // Apply new chord intervals to drones
            const chord = AMBIENT_CHORDS[nodes.currentChordIndex];
            const baseFreq = 55 + state.x * 110;

            nodes.drones.forEach((drone, i) => {
                if (i < chord.length) {
                    const chordInterval = chord[i];
                    const newFreq = baseFreq * Math.pow(2, chordInterval / 12);
                    drone.oscs.forEach((o) => {
                        o.osc.frequency.setTargetAtTime(newFreq, now, 0.3);
                    });
                    drone.baseFreq = newFreq;
                }
            });
        }

        state.touchActive = true;

        if (this.touchTimeout) clearTimeout(this.touchTimeout);
        this.touchTimeout = setTimeout(() => {
            if (this.state) this.state.touchActive = false;
        }, AMBIENT_TOUCH_TIMEOUT);
    }

    stop(_touchId: TouchId, _releaseTime: number, _engine: EngineContext): void {
        // Ambient is continuous, doesn't stop on touch end
    }

    cleanup(): void {
        if (this.loopInterval) {
            clearInterval(this.loopInterval);
            this.loopInterval = null;
        }

        if (this.touchTimeout) {
            clearTimeout(this.touchTimeout);
            this.touchTimeout = null;
        }

        if (this.nodes) {
            // Clean up drones
            for (const drone of this.nodes.drones) {
                for (const o of drone.oscs) {
                    this.cleanupOscillator(o.osc);
                    this.cleanupGain(o.gain);
                }
                this.cleanupGain(drone.voiceGain);
                try { drone.panner.disconnect(); } catch { /* ignore */ }
            }

            // Clean up noise bed
            if (this.nodes.noiseBed) {
                try { this.nodes.noiseBed.source.stop(); this.nodes.noiseBed.source.disconnect(); } catch { /* ignore */ }
                try { this.nodes.noiseBed.bandpass.disconnect(); } catch { /* ignore */ }
                try { this.nodes.noiseBed.lowpass.disconnect(); } catch { /* ignore */ }
                this.cleanupGain(this.nodes.noiseBed.gain);
                try { this.nodes.noiseBed.panner.disconnect(); } catch { /* ignore */ }
            }

            // Clean up shimmer
            if (this.nodes.shimmer) {
                for (const p of this.nodes.shimmer.partials) {
                    this.cleanupOscillator(p.osc);
                    this.cleanupGain(p.gain);
                    this.cleanupOscillator(p.tremolo);
                    this.cleanupGain(p.tremoloGain);
                }
                this.cleanupGain(this.nodes.shimmer.masterGain);
            }

            // Clean up LFOs
            this.cleanupOscillator(this.nodes.lfoSlow);
            this.cleanupOscillator(this.nodes.lfoMedium);

            this.nodes = null;
        }

        this.state = null;
        this.engineRef = null;
    }

    getVoiceCount(): number {
        return this.state?.isActive ? 1 : 0;
    }
}
