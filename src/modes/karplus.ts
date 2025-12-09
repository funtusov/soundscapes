/**
 * Karplus-Strong Physical Modeling Mode
 *
 * Simulates plucked strings using a delay line with filtered feedback.
 * X-axis: Pitch (quantized to scale if enabled)
 * Y-axis: Decay time (short to long)
 * Duration: Short = single pluck, long = continuous re-plucking (bowing effect)
 */

import type { TouchId, KarplusVoice, PooledBuffer } from '../types';
import { BaseSynthMode, EngineContext, MAX_VOICES } from './base';
import {
    KARPLUS_MIN_PLUCK_INTERVAL,
    KARPLUS_REPLUCK_INTERVAL,
    KARPLUS_BUFFER_POOL_SIZE,
    KARPLUS_SYMPATHETIC_RATIOS,
    KARPLUS_SYMPATHETIC_GAIN,
    KARPLUS_DECAY_MIN,
    KARPLUS_DECAY_MAX,
} from '../constants';

export class KarplusMode extends BaseSynthMode {
    readonly name = 'karplus';
    readonly hudLabels: [string, string] = ['X: Note | β: Cutoff', 'Y: Decay | γ: Q'];

    private voices = new Map<TouchId, KarplusVoice>();
    private lastPluck = 0;
    private bufferPool: PooledBuffer[] = [];
    private engineRef: EngineContext | null = null;

    init(_engine: EngineContext): void {
        this.voices = new Map();
        this.lastPluck = 0;
        this.bufferPool = [];
    }

    start(_touchId: TouchId, _engine: EngineContext): void {
        // Voice creation happens in update()
    }

    private getPooledBuffer(size: number, ctx: AudioContext): AudioBuffer | null {
        // Look for an available buffer of the right size
        for (const pooled of this.bufferPool) {
            if (!pooled.inUse && pooled.size >= size && pooled.size <= size * 2) {
                pooled.inUse = true;
                return pooled.buffer;
            }
        }

        // Create a new buffer if pool isn't full
        if (this.bufferPool.length < KARPLUS_BUFFER_POOL_SIZE) {
            const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
            this.bufferPool.push({ buffer, size, inUse: true });
            return buffer;
        }

        // Pool is full and no suitable buffer found - create temporary one
        return ctx.createBuffer(1, size, ctx.sampleRate);
    }

    private releasePooledBuffer(buffer: AudioBuffer): void {
        for (const pooled of this.bufferPool) {
            if (pooled.buffer === buffer) {
                pooled.inUse = false;
                return;
            }
        }
    }

    private pluckString(freq: number, brightness: number, decay: number, gain: number = 0.4): void {
        if (!this.engineRef) return;
        const { ctx, filter } = this.engineRef;
        const now = ctx.currentTime;

        if (now - this.lastPluck < KARPLUS_MIN_PLUCK_INTERVAL) return;
        this.lastPluck = now;

        const bufferSize = Math.floor(ctx.sampleRate / freq);
        const buffer = this.getPooledBuffer(bufferSize, ctx);
        if (!buffer) return;

        const data = buffer.getChannelData(0);

        // Fill with noise and apply lowpass filter
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        for (let i = 1; i < bufferSize; i++) {
            data[i] = data[i] * brightness + data[i - 1] * (1 - brightness);
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const env = ctx.createGain();
        env.gain.setValueAtTime(gain, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + decay);

        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = freq * (1 + brightness * 3);

        source.connect(lpf);
        lpf.connect(env);
        env.connect(filter);
        source.start();
        source.stop(now + decay + 0.5);

        // Release buffer back to pool after sound finishes
        setTimeout(() => {
            try { source.disconnect(); env.disconnect(); lpf.disconnect(); } catch (e) { /* ignore */ }
            this.releasePooledBuffer(buffer);
        }, (decay + 1) * 1000);
    }

    private pluckSympathetic(baseFreq: number, brightness: number, decay: number): void {
        for (const ratio of KARPLUS_SYMPATHETIC_RATIOS) {
            const sympatheticFreq = baseFreq * ratio;
            if (sympatheticFreq < 4000) {
                setTimeout(() => {
                    this.pluckString(
                        sympatheticFreq,
                        brightness * 0.5,
                        decay * 0.6,
                        KARPLUS_SYMPATHETIC_GAIN
                    );
                }, 20 + Math.random() * 30);
            }
        }
    }

    update(x: number, y: number, touchId: TouchId, duration: number, engine: EngineContext): void {
        this.engineRef = engine;
        const now = Date.now() / 1000;

        if (!this.voices.has(touchId)) {
            if (this.voices.size >= MAX_VOICES) return;
            this.voices.set(touchId, { lastRepluck: 0 });
        }

        const voice = this.voices.get(touchId)!;
        const note = this.quantizeToScale(x, 3, 110, engine);

        // Y controls decay time instead of brightness
        const decay = KARPLUS_DECAY_MIN + y * (KARPLUS_DECAY_MAX - KARPLUS_DECAY_MIN);
        const brightness = 0.4 + (1 - y) * 0.4;

        if (duration < 0.2) {
            this.pluckString(note.freq, brightness, decay);
            this.pluckSympathetic(note.freq, brightness, decay);
            voice.lastRepluck = now;
        } else if (duration > 0.5 && now - voice.lastRepluck > KARPLUS_REPLUCK_INTERVAL) {
            this.pluckString(note.freq, brightness * 0.8, decay * 0.7);
            voice.lastRepluck = now;
        }

        const decayStr = y < 0.33 ? 'short' : y < 0.66 ? 'med' : 'long';
        const modeStr = duration > 0.5 ? 'bow' : 'pluck';
        engine.updateHUD(note.noteName + note.octave, modeStr + ' ' + decayStr);
    }

    stop(touchId: TouchId, _releaseTime: number, _engine: EngineContext): void {
        // Karplus just removes the voice tracking, sounds decay naturally
        this.voices.delete(touchId);
    }

    cleanup(): void {
        this.voices.clear();
        this.engineRef = null;
        // Note: buffer pool is kept for potential reuse
    }

    getVoiceCount(): number {
        return this.voices.size;
    }
}
