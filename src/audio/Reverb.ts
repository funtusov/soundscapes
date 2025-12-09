/**
 * CONVOLUTION REVERB
 * Procedural impulse response generation with wet/dry mixing
 */

import {
    REVERB_PRESETS,
    REVERB_CYCLE,
    clamp,
    type ReverbLevel,
} from '../constants';

export class ReverbEngine {
    private ctx: AudioContext | null = null;
    convolver: ConvolverNode | null = null;
    wetGain: GainNode | null = null;
    dryGain: GainNode | null = null;
    level: ReverbLevel = 'off';
    private impulseResponses: Map<ReverbLevel, AudioBuffer> = new Map();

    private generateImpulseResponse(decayTime: number): AudioBuffer {
        if (!this.ctx) throw new Error('No audio context');

        const sampleRate = this.ctx.sampleRate;
        const length = Math.floor(sampleRate * decayTime);
        const buffer = this.ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);

            let prevSample = 0;
            const filterCoeff = 0.85;

            for (let i = 0; i < length; i++) {
                const decay = Math.exp(-3 * i / length);
                const noise = Math.random() * 2 - 1;
                const filtered = prevSample * filterCoeff + noise * (1 - filterCoeff);
                prevSample = filtered;

                const stereoOffset = channel === 0 ? 1.0 : 0.93;
                data[i] = filtered * decay * stereoOffset;

                if (i < sampleRate * 0.1) {
                    const reflectionTimes = [0.01, 0.023, 0.037, 0.052, 0.071, 0.089];
                    for (const rt of reflectionTimes) {
                        const reflectionSample = Math.floor(rt * sampleRate);
                        if (i === reflectionSample) {
                            const reflectionGain = 0.7 * Math.exp(-rt * 10);
                            data[i] += (channel === 0 ? 1 : -1) * reflectionGain;
                        }
                    }
                }
            }

            let maxVal = 0;
            for (let i = 0; i < length; i++) {
                maxVal = Math.max(maxVal, Math.abs(data[i]));
            }
            if (maxVal > 0) {
                const normalize = 1.0 / maxVal;
                for (let i = 0; i < length; i++) {
                    data[i] *= normalize;
                }
            }
        }

        return buffer;
    }

    init(ctx: AudioContext): void {
        this.ctx = ctx;
        this.convolver = ctx.createConvolver();
        this.wetGain = ctx.createGain();
        this.dryGain = ctx.createGain();

        for (const level of REVERB_CYCLE) {
            if (level !== 'off') {
                const preset = REVERB_PRESETS[level];
                const ir = this.generateImpulseResponse(preset.decay);
                this.impulseResponses.set(level, ir);
            }
        }

        this.wetGain.gain.value = 0;
        this.dryGain.gain.value = 1;

        const defaultIR = this.impulseResponses.get('on');
        if (defaultIR) {
            this.convolver.buffer = defaultIR;
        }
    }

    setLevel(level: ReverbLevel): void {
        if (!this.ctx || !this.wetGain || !this.dryGain || !this.convolver) return;

        const now = this.ctx.currentTime;
        const preset = REVERB_PRESETS[level];

        this.wetGain.gain.setTargetAtTime(preset.wet, now, 0.1);
        this.dryGain.gain.setTargetAtTime(preset.dry, now, 0.1);

        if (level !== 'off') {
            const ir = this.impulseResponses.get(level);
            if (ir) {
                this.convolver.buffer = ir;
            }
        }

        this.level = level;
    }

    cycle(): ReverbLevel {
        const currentIndex = REVERB_CYCLE.indexOf(this.level);
        const nextIndex = (currentIndex + 1) % REVERB_CYCLE.length;
        const nextLevel = REVERB_CYCLE[nextIndex];
        this.setLevel(nextLevel);
        return nextLevel;
    }

    setWet(wet: number): void {
        if (!this.ctx || !this.wetGain) return;
        const now = this.ctx.currentTime;
        this.wetGain.gain.setTargetAtTime(clamp(wet, 0, 1), now, 0.3);
    }

    setParams(_decay: number, wet: number, dry: number): void {
        if (!this.ctx || !this.wetGain || !this.dryGain) return;
        const now = this.ctx.currentTime;
        this.wetGain.gain.setTargetAtTime(clamp(wet, 0, 1), now, 0.3);
        this.dryGain.gain.setTargetAtTime(clamp(dry, 0, 1), now, 0.3);
    }
}
