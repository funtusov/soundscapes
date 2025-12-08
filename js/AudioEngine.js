/**
 * AUDIO ENGINE - Multi-mode Synthesizer
 */
export class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.filter = null;
        this.panner = null;
        this.delayFeedback = null;
        this.analyser = null;
        this.isPlaying = false;
        this.dataArray = null;

        // Current synthesis mode
        this.mode = 'wavetable';

        // Mode-specific nodes
        this.nodes = {};

        // Multi-touch tracking
        this.touches = new Map();

        // Orientation parameters
        this.orientationParams = {
            pan: 0,
            filterMod: 0,
            lfoRate: 0,
            shake: 0
        };

        // Scale quantization
        this.tonic = 9; // A (0=C, 1=C#, ..., 9=A, ...)
        this.scaleType = 'minor';
        this.scalePatterns = {
            major: [0, 2, 4, 5, 7, 9, 11],
            minor: [0, 2, 3, 5, 7, 8, 10],
            pentatonic: [0, 2, 4, 7, 9],
            chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        };

        // Legacy scale for backwards compat
        this.scale = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

        // Silent audio for iOS
        this.silentAudio = new Audio("data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNAAAAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYNAAAAAAAAAAAAAAAAAAAA");
        this.silentAudio.loop = true;
    }

    init() {
        if (this.ctx) {
            try { this.ctx.close(); } catch(e) {}
        }

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        // Master chain
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0;

        // Analyser
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 4096;
        this.analyser.smoothingTimeConstant = 0.1;
        this.analyser.minDecibels = -100;
        this.analyser.maxDecibels = -10;
        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);

        // Filter
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.Q.value = 1;
        this.filter.frequency.value = 8000;

        // Panner
        this.panner = this.ctx.createStereoPanner();

        // Delay
        const delayL = this.ctx.createDelay();
        const delayR = this.ctx.createDelay();
        this.delayFeedback = this.ctx.createGain();
        delayL.delayTime.value = 0.25;
        delayR.delayTime.value = 0.35;
        this.delayFeedback.gain.value = 0.25;

        // Routing
        this.filter.connect(this.panner);
        this.panner.connect(this.masterGain);
        this.masterGain.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);

        this.masterGain.connect(delayL);
        this.masterGain.connect(delayR);
        delayL.connect(this.delayFeedback);
        delayR.connect(this.delayFeedback);
        this.delayFeedback.connect(delayL);
        this.delayFeedback.connect(delayR);
        delayL.connect(this.analyser);
        delayR.connect(this.analyser);

        this.initMode(this.mode);
    }

    initMode(mode) {
        this.cleanupMode();
        this.mode = mode;

        switch(mode) {
            case 'wavetable': this.initWavetable(); break;
            case 'theremin': this.initTheremin(); break;
            case 'fm': this.initFM(); break;
            case 'chords': this.initChords(); break;
            case 'karplus': this.initKarplus(); break;
            case 'granular': this.initGranular(); break;
            case 'ambient': this.initAmbient(); break;
        }

        this.updateHUDLabels();
    }

    cleanupMode() {
        if (this.ambientInterval) {
            clearInterval(this.ambientInterval);
            this.ambientInterval = null;
        }

        if (this.nodes.oscillators) {
            this.nodes.oscillators.forEach(o => {
                try { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); } catch(e) {}
            });
        }
        if (this.nodes.layers) {
            this.nodes.layers.forEach(l => {
                try { l.osc.stop(); l.osc.disconnect(); l.gain.disconnect(); } catch(e) {}
            });
        }
        if (this.nodes.voices) {
            this.nodes.voices.forEach(v => {
                try {
                    if (v.osc) { v.osc.stop(); v.osc.disconnect(); }
                    if (v.gain) v.gain.disconnect();
                    if (v.lfo) { v.lfo.stop(); v.lfo.disconnect(); }
                    if (v.vibrato) { v.vibrato.stop(); v.vibrato.disconnect(); }
                    if (v.carrier) { v.carrier.stop(); v.carrier.disconnect(); }
                    if (v.modulator) { v.modulator.stop(); v.modulator.disconnect(); }
                    if (v.oscs) {
                        v.oscs.forEach(o => { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); });
                    }
                } catch(e) {}
            });
        }
        if (this.nodes.noiseSource) {
            try { this.nodes.noiseSource.stop(); this.nodes.noiseSource.disconnect(); } catch(e) {}
        }
        if (this.nodes.lfo) {
            try { this.nodes.lfo.stop(); this.nodes.lfo.disconnect(); } catch(e) {}
        }
        if (this.nodes.lfo1) {
            try { this.nodes.lfo1.stop(); this.nodes.lfo1.disconnect(); } catch(e) {}
        }
        if (this.nodes.lfo2) {
            try { this.nodes.lfo2.stop(); this.nodes.lfo2.disconnect(); } catch(e) {}
        }
        this.nodes = {};
    }

    // ========== WAVETABLE MODE ==========
    initWavetable() {
        this.nodes = { voices: new Map() };
    }

    updateWavetable(x, y, duration = 0, touchId = 0) {
        const now = this.ctx.currentTime;

        if (!this.nodes.voices.has(touchId)) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.value = 220;
            gain.gain.value = 0;

            lfo.frequency.value = 2;
            lfoGain.gain.value = 0;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.detune);

            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            lfo.start();

            this.nodes.voices.set(touchId, { osc, gain, lfo, lfoGain });
        }

        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 3, 55);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.02);
        voice.gain.gain.setTargetAtTime(0.3, now, 0.02);

        if (y < 0.25) voice.osc.type = 'sine';
        else if (y < 0.5) voice.osc.type = 'triangle';
        else if (y < 0.75) voice.osc.type = 'sawtooth';
        else voice.osc.type = 'square';

        const durationFactor = Math.min(1, duration / 3);
        voice.lfoGain.gain.setTargetAtTime(durationFactor * 30, now, 0.1);
        voice.lfo.frequency.setTargetAtTime(2 + durationFactor * 4, now, 0.1);

        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = voice.osc.type + (duration > 0.5 ? ' ~' : '');
    }

    stopWavetableVoice(touchId, releaseTime = 0.1) {
        if (this.nodes.voices && this.nodes.voices.has(touchId)) {
            const voice = this.nodes.voices.get(touchId);
            const now = this.ctx.currentTime;
            voice.gain.gain.setTargetAtTime(0, now, releaseTime);
            setTimeout(() => {
                try {
                    voice.osc.stop(); voice.lfo.stop();
                    voice.osc.disconnect(); voice.lfo.disconnect();
                    voice.gain.disconnect(); voice.lfoGain.disconnect();
                } catch(e) {}
                this.nodes.voices.delete(touchId);
            }, releaseTime * 1000 + 200);
        }
    }

    // ========== THEREMIN MODE ==========
    initTheremin() {
        this.nodes = { voices: new Map() };
    }

    updateTheremin(x, y, duration = 0, touchId = 0) {
        const now = this.ctx.currentTime;

        if (!this.nodes.voices.has(touchId)) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const vibrato = this.ctx.createOscillator();
            const vibratoGain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.value = 440;
            gain.gain.value = 0;
            vibrato.frequency.value = 5;
            vibratoGain.gain.value = 0;

            vibrato.connect(vibratoGain);
            vibratoGain.connect(osc.frequency);
            osc.connect(gain);
            gain.connect(this.filter);

            osc.start();
            vibrato.start();

            this.nodes.voices.set(touchId, { osc, gain, vibrato, vibratoGain });
        }

        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 3, 110);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.05);
        voice.gain.gain.setTargetAtTime(0.3, now, 0.02);

        const durationFactor = Math.min(1, duration / 2);
        const vibratoDepth = y * 15 + durationFactor * 10;
        voice.vibratoGain.gain.setTargetAtTime(vibratoDepth, now, 0.05);
        voice.vibrato.frequency.setTargetAtTime(5 + durationFactor * 2, now, 0.1);

        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = this.nodes.voices.size + ' voice' + (duration > 0.5 ? ' ♪' : '');
    }

    stopThereminVoice(touchId, releaseTime = 0.1) {
        if (this.nodes.voices && this.nodes.voices.has(touchId)) {
            const voice = this.nodes.voices.get(touchId);
            const now = this.ctx.currentTime;
            voice.gain.gain.setTargetAtTime(0, now, releaseTime);
            setTimeout(() => {
                try {
                    voice.osc.stop(); voice.vibrato.stop();
                    voice.osc.disconnect(); voice.vibrato.disconnect();
                    voice.gain.disconnect(); voice.vibratoGain.disconnect();
                } catch(e) {}
                this.nodes.voices.delete(touchId);
            }, releaseTime * 1000 + 200);
        }
    }

    // ========== FM SYNTHESIS MODE ==========
    initFM() {
        this.nodes = { voices: new Map(), ratio: 1 };
    }

    updateFM(x, y, duration = 0, touchId = 0) {
        const now = this.ctx.currentTime;

        if (!this.nodes.voices.has(touchId)) {
            const carrier = this.ctx.createOscillator();
            const carrierGain = this.ctx.createGain();
            const modulator = this.ctx.createOscillator();
            const modulatorGain = this.ctx.createGain();

            carrier.type = 'sine';
            carrier.frequency.value = 220;
            modulator.type = 'sine';
            modulator.frequency.value = 220;
            carrierGain.gain.value = 0;
            modulatorGain.gain.value = 0;

            modulator.connect(modulatorGain);
            modulatorGain.connect(carrier.frequency);
            carrier.connect(carrierGain);
            carrierGain.connect(this.filter);

            carrier.start();
            modulator.start();

            this.nodes.voices.set(touchId, { carrier, carrierGain, modulator, modulatorGain });
        }

        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 3, 55);
        const carrierFreq = note.freq;

        const durationFactor = Math.min(1, duration / 3);
        const baseIndex = y * 4;
        const modIndex = baseIndex + durationFactor * 6;
        const modFreq = carrierFreq * this.nodes.ratio;

        voice.carrier.frequency.setTargetAtTime(carrierFreq, now, 0.02);
        voice.modulator.frequency.setTargetAtTime(modFreq, now, 0.02);
        voice.modulatorGain.gain.setTargetAtTime(modIndex * carrierFreq, now, 0.02);
        voice.carrierGain.gain.setTargetAtTime(0.3, now, 0.02);

        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = 'idx:' + modIndex.toFixed(1) + (durationFactor > 0.3 ? '⚡' : '');
    }

    stopFMVoice(touchId, releaseTime = 0.1) {
        if (this.nodes.voices && this.nodes.voices.has(touchId)) {
            const voice = this.nodes.voices.get(touchId);
            const now = this.ctx.currentTime;
            voice.carrierGain.gain.setTargetAtTime(0, now, releaseTime);
            setTimeout(() => {
                try {
                    voice.carrier.stop(); voice.modulator.stop();
                    voice.carrier.disconnect(); voice.modulator.disconnect();
                    voice.carrierGain.disconnect(); voice.modulatorGain.disconnect();
                } catch(e) {}
                this.nodes.voices.delete(touchId);
            }, releaseTime * 1000 + 200);
        }
    }

    // ========== CHORDS MODE ==========
    initChords() {
        this.nodes = { voices: new Map() };
    }

    updateChords(x, y, touchId = 0, duration = 0) {
        const now = this.ctx.currentTime;

        if (!this.nodes.voices.has(touchId)) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.connect(gain);
            gain.connect(this.filter);
            gain.gain.value = 0;
            osc.start();
            this.nodes.voices.set(touchId, { osc, gain });
        }

        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 3, 110);

        voice.osc.frequency.setTargetAtTime(note.freq, now, 0.02);
        voice.gain.gain.setTargetAtTime(0.3, now, 0.02);

        const durationFactor = Math.min(1, duration / 2);
        if (durationFactor < 0.33) voice.osc.type = 'sine';
        else if (durationFactor < 0.66) voice.osc.type = 'triangle';
        else voice.osc.type = 'sawtooth';

        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = this.nodes.voices.size + ' voice ' + voice.osc.type.substring(0,3);
    }

    stopChordVoice(touchId, releaseTime = 0.1) {
        if (this.nodes.voices && this.nodes.voices.has(touchId)) {
            const voice = this.nodes.voices.get(touchId);
            const now = this.ctx.currentTime;
            voice.gain.gain.setTargetAtTime(0, now, releaseTime);
            setTimeout(() => {
                try { voice.osc.stop(); voice.osc.disconnect(); voice.gain.disconnect(); } catch(e) {}
                this.nodes.voices.delete(touchId);
            }, releaseTime * 1000 + 200);
        }
    }

    // ========== KARPLUS-STRONG MODE ==========
    initKarplus() {
        this.nodes = { voices: new Map(), lastPluck: 0 };
    }

    pluckString(freq, brightness) {
        const now = this.ctx.currentTime;
        if (now - this.nodes.lastPluck < 0.03) return;
        this.nodes.lastPluck = now;

        const bufferSize = Math.floor(this.ctx.sampleRate / freq);
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        for (let i = 1; i < bufferSize; i++) {
            data[i] = data[i] * brightness + data[i-1] * (1 - brightness);
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;

        const env = this.ctx.createGain();
        env.gain.setValueAtTime(0.4, now);
        env.gain.exponentialRampToValueAtTime(0.001, now + 2);

        const lpf = this.ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = freq * (1 + brightness * 3);

        source.connect(lpf);
        lpf.connect(env);
        env.connect(this.filter);
        source.start();
        source.stop(now + 2.5);

        setTimeout(() => {
            try { source.disconnect(); env.disconnect(); lpf.disconnect(); } catch(e) {}
        }, 3000);
    }

    updateKarplus(x, y, duration = 0, touchId = 0) {
        const now = Date.now() / 1000;

        if (!this.nodes.voices.has(touchId)) {
            this.nodes.voices.set(touchId, { lastRepluck: 0 });
        }
        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 3, 110);

        if (duration < 0.2) {
            this.pluckString(note.freq, 0.3 + y * 0.6);
            voice.lastRepluck = now;
        } else if (duration > 0.5 && now - voice.lastRepluck > 0.25) {
            this.pluckString(note.freq, 0.2 + y * 0.4);
            voice.lastRepluck = now;
        }

        const mode = duration > 0.5 ? 'bow' : 'pluck';
        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = mode + ' ' + this.nodes.voices.size + 'str';
    }

    // ========== GRANULAR MODE ==========
    initGranular() {
        this.nodes = { voices: new Map() };
    }

    createGranularVoice() {
        const oscs = [];
        const baseFreq = 110;

        for (let i = 0; i < 4; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = ['sine', 'triangle', 'sine', 'triangle'][i];
            osc.frequency.value = baseFreq * (1 + i * 0.5);
            osc.detune.value = (Math.random() - 0.5) * 20;
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            oscs.push({ osc, gain });
        }

        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.frequency.value = 0.1;
        lfoGain.gain.value = 10;
        lfo.connect(lfoGain);
        lfo.start();
        oscs.forEach(o => lfoGain.connect(o.osc.frequency));

        return { oscs, lfo, lfoGain };
    }

    updateGranular(x, y, duration = 0, touchId = 0) {
        const now = this.ctx.currentTime;

        if (!this.nodes.voices.has(touchId)) {
            this.nodes.voices.set(touchId, this.createGranularVoice());
        }

        const voice = this.nodes.voices.get(touchId);
        const note = this.quantizeToScale(x, 2, 55);
        const baseFreq = note.freq;
        const durationFactor = Math.min(1, duration / 4);

        voice.oscs.forEach((o, i) => {
            const freq = baseFreq * (1 + i * 0.5 * (0.5 + y));
            o.osc.frequency.setTargetAtTime(freq, now, 0.1);
            const detune = (Math.random() - 0.5) * 20 + durationFactor * 30 * (i - 1.5);
            o.osc.detune.setTargetAtTime(detune, now, 0.3);
            const baseLevel = (i < 2) ? 0.25 : (y > i * 0.2 ? 0.15 : 0);
            const durationBoost = durationFactor * 0.08 * (i > 1 ? 1 : 0);
            o.gain.gain.setTargetAtTime(baseLevel + durationBoost, now, 0.1);
        });

        voice.lfo.frequency.setTargetAtTime(0.05 + y * 0.5 + durationFactor * 0.3, now, 0.1);
        voice.lfoGain.gain.setTargetAtTime(10 + durationFactor * 20, now, 0.1);

        document.getElementById('val-freq').innerText = note.noteName + note.octave;
        document.getElementById('val-harm').innerText = this.nodes.voices.size + 'g ' + Math.round(durationFactor * 100) + '%';
    }

    stopGranularVoice(touchId, releaseTime = 0.1) {
        if (this.nodes.voices && this.nodes.voices.has(touchId)) {
            const voice = this.nodes.voices.get(touchId);
            const now = this.ctx.currentTime;
            voice.oscs.forEach(o => o.gain.gain.setTargetAtTime(0, now, releaseTime));
            setTimeout(() => {
                try {
                    voice.oscs.forEach(o => { o.osc.stop(); o.osc.disconnect(); o.gain.disconnect(); });
                    voice.lfo.stop(); voice.lfo.disconnect(); voice.lfoGain.disconnect();
                } catch(e) {}
                this.nodes.voices.delete(touchId);
            }, releaseTime * 1000 + 200);
        }
    }

    // ========== AMBIENT MODE ==========
    initAmbient() {
        this.ambientState = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, driftPhase: 0, isActive: false };

        const layers = [];
        const baseFreq = 110;

        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'sine';
        sub.frequency.value = baseFreq / 2;
        subGain.gain.value = 0;
        sub.connect(subGain);
        subGain.connect(this.filter);
        sub.start();
        layers.push({ osc: sub, gain: subGain, ratio: 0.5, type: 'sub' });

        for (let i = 0; i < 2; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = baseFreq * (i === 0 ? 1 : 1.5);
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            layers.push({ osc, gain, ratio: i === 0 ? 1 : 1.5, type: 'main' });
        }

        for (let i = 0; i < 2; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = baseFreq * (i === 0 ? 2 : 3);
            gain.gain.value = 0;
            osc.connect(gain);
            gain.connect(this.filter);
            osc.start();
            layers.push({ osc, gain, ratio: i === 0 ? 2 : 3, type: 'shimmer' });
        }

        const lfo1 = this.ctx.createOscillator();
        const lfo1Gain = this.ctx.createGain();
        lfo1.frequency.value = 0.05;
        lfo1Gain.gain.value = 3;
        lfo1.connect(lfo1Gain);
        lfo1.start();

        const lfo2 = this.ctx.createOscillator();
        const lfo2Gain = this.ctx.createGain();
        lfo2.frequency.value = 0.08;
        lfo2Gain.gain.value = 5;
        lfo2.connect(lfo2Gain);
        lfo2.start();

        layers.forEach((l, i) => {
            if (i % 2 === 0) lfo1Gain.connect(l.osc.frequency);
            else lfo2Gain.connect(l.osc.frequency);
        });

        this.nodes = { layers, lfo1, lfo1Gain, lfo2, lfo2Gain };
        this.startAmbientLoop();
    }

    startAmbientLoop() {
        if (this.ambientInterval) clearInterval(this.ambientInterval);

        const now = this.ctx.currentTime;
        this.masterGain.gain.setTargetAtTime(0.5, now, 0.5);
        this.nodes.layers.forEach(l => {
            const level = l.type === 'sub' ? 0.15 : l.type === 'main' ? 0.12 : 0.05;
            l.gain.gain.setTargetAtTime(level, now, 0.5);
        });
        this.ambientState.isActive = true;
        this.isPlaying = true;

        this.ambientInterval = setInterval(() => {
            if (this.mode !== 'ambient' || !this.ctx) {
                clearInterval(this.ambientInterval);
                return;
            }
            this.evolveAmbient();
        }, 50);
    }

    evolveAmbient() {
        const now = this.ctx.currentTime;
        const state = this.ambientState;

        state.driftPhase += 0.01;
        const drift = Math.sin(state.driftPhase) * 0.002;
        const smoothing = 0.02;
        state.x += (state.targetX - state.x) * smoothing + drift;
        state.y += (state.targetY - state.y) * smoothing + Math.cos(state.driftPhase * 0.7) * 0.001;
        state.x = Math.max(0, Math.min(1, state.x));
        state.y = Math.max(0, Math.min(1, state.y));

        const baseFreq = 55 + state.x * 110;

        this.nodes.layers.forEach((l) => {
            const freq = baseFreq * l.ratio;
            l.osc.frequency.setTargetAtTime(freq, now, 0.3);

            let level;
            if (l.type === 'sub') level = 0.15 * (1 - state.y * 0.3);
            else if (l.type === 'main') level = 0.12;
            else level = 0.03 + state.y * 0.08;
            l.gain.gain.setTargetAtTime(level, now, 0.2);
        });

        this.nodes.lfo1.frequency.setTargetAtTime(0.03 + state.y * 0.05, now, 0.5);
        this.nodes.lfo2.frequency.setTargetAtTime(0.05 + state.y * 0.08, now, 0.5);

        document.getElementById('val-freq').innerText = Math.round(baseFreq) + 'Hz';
        document.getElementById('val-harm').innerText = 'drift ' + (state.x * 100).toFixed(0) + '%';
    }

    updateAmbient(x, y, duration = 0) {
        const influence = Math.min(1, 0.3 + duration * 0.3);
        this.ambientState.targetX = this.ambientState.targetX * (1 - influence) + x * influence;
        this.ambientState.targetY = this.ambientState.targetY * (1 - influence) + y * influence;
    }

    // ========== COMMON METHODS ==========
    updateHUDLabels() {
        const labels = {
            wavetable: ['X: Pitch | β: Cutoff', 'Y: Waveform | γ: Q'],
            theremin: ['X: Note | β: Cutoff', 'Y: Vibrato | γ: Q'],
            fm: ['X: Pitch | β: Cutoff', 'Y: Mod | γ: Q'],
            chords: ['X: Note | β: Cutoff', 'Multi-touch | γ: Q'],
            karplus: ['X: Note | β: Cutoff', 'Y: Bright | γ: Q'],
            granular: ['X: Base | β: Cutoff', 'Y: Density | γ: Q'],
            ambient: ['Touch to nudge', 'β: Cutoff | γ: Q']
        };

        const l = labels[this.mode] || labels.wavetable;
        document.getElementById('hud-bl').innerText = l[0];
        document.getElementById('hud-br').innerText = l[1];
    }

    quantizeToScale(x, octaves = 3, baseFreq = 55) {
        const pattern = this.scalePatterns[this.scaleType] || this.scalePatterns.minor;
        const notesPerOctave = pattern.length;
        const totalNotes = notesPerOctave * octaves;

        const noteIndex = Math.floor(x * totalNotes);
        const octave = Math.floor(noteIndex / notesPerOctave);
        const degree = noteIndex % notesPerOctave;
        const semitone = this.tonic + octave * 12 + pattern[degree];

        return {
            freq: baseFreq * Math.pow(2, (pattern[degree] + octave * 12) / 12),
            semitone: pattern[degree] + octave * 12,
            noteName: this.getNoteName(semitone),
            octave: octave + 2
        };
    }

    getNoteName(semitone) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return noteNames[semitone % 12];
    }

    setTonic(tonic) {
        this.tonic = parseInt(tonic);
    }

    setScaleType(scaleType) {
        this.scaleType = scaleType;
    }

    resume() {
        this.silentAudio.play().catch(() => {});
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    start(touchId = 0) {
        if (!this.ctx) this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();

        const now = this.ctx.currentTime;

        if (this.mode === 'ambient') {
            return;
        } else if (['wavetable', 'theremin', 'fm', 'chords', 'karplus', 'granular'].includes(this.mode)) {
            // Voices created on update
        } else {
            if (this.nodes.gain) this.nodes.gain.gain.setTargetAtTime(0.4, now, 0.05);
            if (this.nodes.carrierGain) this.nodes.carrierGain.gain.setTargetAtTime(0.4, now, 0.05);
            if (this.nodes.oscs) this.nodes.oscs.forEach(o => o.gain.gain.setTargetAtTime(0.2, now, 0.1));
        }

        this.masterGain.gain.setTargetAtTime(0.7, now, 0.05);
        this.isPlaying = true;
    }

    stop(touchId = 0, duration = 0) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (this.mode === 'ambient') return;

        const releaseTime = 0.1 + Math.min(1.4, duration * 0.3);

        if (this.mode === 'wavetable') {
            this.stopWavetableVoice(touchId, releaseTime);
        } else if (this.mode === 'theremin') {
            this.stopThereminVoice(touchId, releaseTime);
        } else if (this.mode === 'fm') {
            this.stopFMVoice(touchId, releaseTime);
        } else if (this.mode === 'chords') {
            this.stopChordVoice(touchId, releaseTime);
        } else if (this.mode === 'karplus') {
            if (this.nodes.voices) this.nodes.voices.delete(touchId);
        } else if (this.mode === 'granular') {
            this.stopGranularVoice(touchId, releaseTime);
        }

        if (this.nodes.voices && this.nodes.voices.size === 0) {
            this.masterGain.gain.setTargetAtTime(0, now, releaseTime);
            this.isPlaying = false;
        }
    }

    update(x, y, touchId = 0, duration = 0) {
        if (!this.ctx) return;

        switch(this.mode) {
            case 'wavetable': this.updateWavetable(x, y, duration, touchId); break;
            case 'theremin': this.updateTheremin(x, y, duration, touchId); break;
            case 'fm': this.updateFM(x, y, duration, touchId); break;
            case 'chords': this.updateChords(x, y, touchId, duration); break;
            case 'karplus': this.updateKarplus(x, y, duration, touchId); break;
            case 'granular': this.updateGranular(x, y, duration, touchId); break;
            case 'ambient': this.updateAmbient(x, y, duration); break;
        }
    }

    getAnalysis() {
        if (this.analyser && this.dataArray) {
            this.analyser.getFloatFrequencyData(this.dataArray);
            return this.dataArray;
        }
        return null;
    }

    updateOrientation(beta, gamma) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const clampedBeta = Math.max(0, Math.min(90, beta || 0));
        const filterMod = clampedBeta / 90;
        this.orientationParams.filterMod = filterMod;

        const tiltCutoff = 80 + ((1 - filterMod) * 7920);
        this.filter.frequency.setTargetAtTime(tiltCutoff, now, 0.1);

        const clampedGamma = Math.max(-45, Math.min(45, gamma || 0));
        const gammaNorm = Math.abs(clampedGamma) / 45;
        this.orientationParams.pan = gammaNorm;

        const targetQ = 0.5 + (gammaNorm * 14.5);
        this.filter.Q.setTargetAtTime(targetQ, now, 0.1);

        document.getElementById('val-tilt').innerText = `${Math.round(tiltCutoff)}Hz Q:${targetQ.toFixed(1)}`;
    }

    updateMotion(acceleration, rotationRate) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (rotationRate) {
            const rotMagnitude = Math.sqrt(
                (rotationRate.alpha || 0) ** 2 +
                (rotationRate.beta || 0) ** 2 +
                (rotationRate.gamma || 0) ** 2
            );
            this.orientationParams.lfoRate = rotMagnitude;

            if (this.mode === 'fm' && this.nodes.ratio !== undefined) {
                this.nodes.ratio = 1 + Math.floor(rotMagnitude / 30);
            }
        }

        if (acceleration) {
            const accMagnitude = Math.sqrt(
                (acceleration.x || 0) ** 2 +
                (acceleration.y || 0) ** 2 +
                (acceleration.z || 0) ** 2
            );
            this.orientationParams.shake = accMagnitude;

            if (accMagnitude > 5) {
                this.delayFeedback.gain.setTargetAtTime(0.6, now, 0.02);
                setTimeout(() => {
                    if (this.ctx) {
                        this.delayFeedback.gain.setTargetAtTime(0.25, this.ctx.currentTime, 0.3);
                    }
                }, 300);
            }

            const motionLabel = accMagnitude > 5 ? 'SHAKE!' : accMagnitude > 1.5 ? 'Active' : 'Steady';
            document.getElementById('val-motion').innerText = motionLabel;
        }
    }
}
