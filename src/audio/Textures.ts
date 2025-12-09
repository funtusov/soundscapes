/**
 * TEXTURE GENERATORS
 * Noise textures (waves, rain, wind, fire) and tape hiss effects
 */

import {
    NOISE_TEXTURE_SETTINGS,
    NOISE_TYPES,
    DEFAULT_TEXTURE_VOLUME,
    TAPE_HISS_SETTINGS,
    type NoiseType,
} from '../constants';
import type { TextureNodes } from '../types';

export class TextureEngine {
    private ctx: AudioContext | null = null;
    private destination: AudioNode | null = null;

    // Texture state
    noiseNodes: TextureNodes | null = null;
    tapeHissNodes: TextureNodes | null = null;
    noiseEnabled = false;
    tapeHissEnabled = false;
    noiseType: NoiseType = 'waves';
    textureVolume = DEFAULT_TEXTURE_VOLUME;

    init(ctx: AudioContext, destination: AudioNode): void {
        this.ctx = ctx;
        this.destination = destination;
    }

    private createNoiseBuffer(duration = 2): AudioBuffer {
        if (!this.ctx) throw new Error('AudioContext not initialized');

        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * duration;
        const buffer = this.ctx.createBuffer(2, length, sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }

        return buffer;
    }

    toggleNoise(): boolean {
        if (!this.ctx || !this.destination) return this.noiseEnabled;

        if (this.noiseEnabled) {
            this.stopNoise();
            this.noiseEnabled = false;
        } else {
            this.startNoise();
            this.noiseEnabled = true;
        }

        return this.noiseEnabled;
    }

    cycleNoiseType(): NoiseType {
        const currentIndex = NOISE_TYPES.indexOf(this.noiseType);
        const nextIndex = (currentIndex + 1) % NOISE_TYPES.length;
        this.noiseType = NOISE_TYPES[nextIndex];

        if (this.noiseEnabled) {
            this.stopNoise();
            this.startNoise();
        }

        return this.noiseType;
    }

    setNoiseType(type: NoiseType): void {
        if (this.noiseType === type) return;
        this.noiseType = type;

        if (this.noiseEnabled) {
            this.stopNoise();
            this.startNoise();
        }
    }

    getNoiseType(): NoiseType {
        return this.noiseType;
    }

    setTextureVolume(volume: number): void {
        this.textureVolume = Math.max(0, Math.min(1, volume));

        if (this.noiseNodes && this.ctx) {
            const settings = NOISE_TEXTURE_SETTINGS[this.noiseType];
            const baseGain = settings.baseGain * this.textureVolume;
            const now = this.ctx.currentTime;
            this.noiseNodes.gain.gain.setTargetAtTime(baseGain * (1 - settings.lfoDepth), now, 0.1);
            if (this.noiseNodes.lfoGain) {
                this.noiseNodes.lfoGain.gain.setTargetAtTime(baseGain * settings.lfoDepth, now, 0.1);
            }
        }

        if (this.tapeHissNodes && this.ctx) {
            const baseGain = TAPE_HISS_SETTINGS.baseGain * this.textureVolume;
            const now = this.ctx.currentTime;
            this.tapeHissNodes.gain.gain.setTargetAtTime(baseGain * (1 - TAPE_HISS_SETTINGS.lfoDepth), now, 0.1);
            if (this.tapeHissNodes.lfoGain) {
                this.tapeHissNodes.lfoGain.gain.setTargetAtTime(baseGain * TAPE_HISS_SETTINGS.lfoDepth, now, 0.1);
            }
        }
    }

    getTextureVolume(): number {
        return this.textureVolume;
    }

    private startNoise(): void {
        if (!this.ctx || !this.destination) return;

        const settings = NOISE_TEXTURE_SETTINGS[this.noiseType];
        const noiseBuffer = this.createNoiseBuffer(4);

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const noiseFilter = this.ctx.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = settings.filterFreq;
        noiseFilter.Q.value = 0.7;

        const baseGain = settings.baseGain * this.textureVolume;
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.value = baseGain * (1 - settings.lfoDepth);

        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = settings.lfoRate;

        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = baseGain * settings.lfoDepth;

        lfo.connect(lfoGain);
        lfoGain.connect(noiseGain.gain);

        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.destination);

        noiseSource.start();
        lfo.start();

        this.noiseNodes = {
            noiseBuffer,
            noiseSource,
            gain: noiseGain,
            filter: noiseFilter,
            lfo,
            lfoGain
        };
    }

    private stopNoise(): void {
        if (!this.noiseNodes || !this.ctx) return;

        const now = this.ctx.currentTime;
        this.noiseNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        const nodes = this.noiseNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfo) {
                try {
                    nodes.lfo.stop();
                    nodes.lfo.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfoGain) {
                try {
                    nodes.lfoGain.disconnect();
                } catch (e) { /* ignore */ }
            }
            try {
                nodes.gain.disconnect();
                nodes.filter.disconnect();
            } catch (e) { /* ignore */ }
        }, 500);

        this.noiseNodes = null;
    }

    toggleTapeHiss(): boolean {
        if (!this.ctx || !this.destination) return this.tapeHissEnabled;

        if (this.tapeHissEnabled) {
            this.stopTapeHiss();
            this.tapeHissEnabled = false;
        } else {
            this.startTapeHiss();
            this.tapeHissEnabled = true;
        }

        return this.tapeHissEnabled;
    }

    private startTapeHiss(): void {
        if (!this.ctx || !this.destination) return;

        const noiseBuffer = this.createNoiseBuffer(3);

        const noiseSource = this.ctx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;

        const highpass = this.ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = TAPE_HISS_SETTINGS.filterLow;
        highpass.Q.value = 0.3;

        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = TAPE_HISS_SETTINGS.filterHigh;
        lowpass.Q.value = 0.3;

        const tapeGain = this.ctx.createGain();
        tapeGain.gain.value = TAPE_HISS_SETTINGS.baseGain * (1 - TAPE_HISS_SETTINGS.lfoDepth);

        const lfo = this.ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = TAPE_HISS_SETTINGS.lfoRate;

        const lfoGain = this.ctx.createGain();
        lfoGain.gain.value = TAPE_HISS_SETTINGS.baseGain * TAPE_HISS_SETTINGS.lfoDepth;

        lfo.connect(lfoGain);
        lfoGain.connect(tapeGain.gain);

        noiseSource.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(tapeGain);
        tapeGain.connect(this.destination);

        noiseSource.start();
        lfo.start();

        this.tapeHissNodes = {
            noiseBuffer,
            noiseSource,
            gain: tapeGain,
            filter: highpass,
            filter2: lowpass,
            lfo,
            lfoGain
        };
    }

    private stopTapeHiss(): void {
        if (!this.tapeHissNodes || !this.ctx) return;

        const now = this.ctx.currentTime;
        this.tapeHissNodes.gain.gain.setTargetAtTime(0, now, 0.3);

        const nodes = this.tapeHissNodes;
        setTimeout(() => {
            if (nodes.noiseSource) {
                try {
                    nodes.noiseSource.stop();
                    nodes.noiseSource.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfo) {
                try {
                    nodes.lfo.stop();
                    nodes.lfo.disconnect();
                } catch (e) { /* ignore */ }
            }
            if (nodes.lfoGain) {
                try {
                    nodes.lfoGain.disconnect();
                } catch (e) { /* ignore */ }
            }
            try {
                nodes.gain.disconnect();
                nodes.filter.disconnect();
                if (nodes.filter2) nodes.filter2.disconnect();
            } catch (e) { /* ignore */ }
        }, 500);

        this.tapeHissNodes = null;
    }
}
