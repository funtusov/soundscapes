/**
 * BEAT ENGINE - Grids-style drum sequencer with synthesized kick
 *
 * X axis: pattern density/variation
 * Y axis: kick sound character (pitch/decay)
 */

// Grids-style pattern maps for kick drum
// 16 steps per bar (16th notes), sparse placement
// Values 0-255 represent probability threshold (255 = always, 0 = never)
// All patterns have 4-8 kicks per bar
const KICK_PATTERNS: number[][] = [
    // Basic four-on-floor (4 kicks: beats 1,2,3,4)
    [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0],
    // Four-on-floor with pickup (5 kicks)
    [255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0],
    // Syncopated (6 kicks)
    [255, 0, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 0, 255, 0],
    // Busy (7 kicks)
    [255, 0, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0],
    // Full offbeat (8 kicks)
    [255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0],
];

export class BeatEngine {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private isPlaying = false;
    private currentStep = 0;
    private tempo = 105; // BPM
    private nextStepTime = 0;
    private schedulerInterval: ReturnType<typeof setInterval> | null = null;

    // Pattern parameters (0-1)
    private patternX = 0.5; // Pattern density/variation
    private patternY = 0.5; // Sound character

    // Volume (0-1)
    private volume = 0.7;

    // Output destination (for routing to main mixer)
    private outputNode: GainNode | null = null;

    constructor() {}

    /**
     * Initialize the beat engine with an audio context
     */
    init(ctx: AudioContext, destination: AudioNode): void {
        this.ctx = ctx;

        // Create output gain for volume control
        this.outputNode = ctx.createGain();
        this.outputNode.gain.value = this.volume;
        this.outputNode.connect(destination);

        // Master gain for the beat engine
        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 1;
        this.masterGain.connect(this.outputNode);
    }

    /**
     * Start the sequencer
     */
    start(): void {
        if (!this.ctx || this.isPlaying) return;

        this.isPlaying = true;
        this.currentStep = 0;
        this.nextStepTime = this.ctx.currentTime;

        // Start scheduler loop (runs every 25ms to schedule ahead)
        this.schedulerInterval = setInterval(() => this.scheduler(), 25);
    }

    /**
     * Stop the sequencer
     */
    stop(): void {
        this.isPlaying = false;
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
        }
    }

    /**
     * Toggle play/stop
     */
    toggle(): boolean {
        if (this.isPlaying) {
            this.stop();
        } else {
            this.start();
        }
        return this.isPlaying;
    }

    /**
     * Main scheduler - looks ahead and schedules notes
     */
    private scheduler(): void {
        if (!this.ctx || !this.isPlaying) return;

        const scheduleAhead = 0.1; // Schedule 100ms ahead

        while (this.nextStepTime < this.ctx.currentTime + scheduleAhead) {
            this.scheduleStep(this.currentStep, this.nextStepTime);
            this.advanceStep();
        }
    }

    /**
     * Schedule a single step
     */
    private scheduleStep(step: number, time: number): void {
        // Get pattern probability for this step based on X position
        const probability = this.getStepProbability(step);

        // Random threshold check (Grids-style)
        const threshold = Math.random() * 255;

        if (probability > threshold) {
            this.playKick(time);
        }
    }

    /**
     * Get the probability for a step based on X position (discrete pattern selection)
     */
    private getStepProbability(step: number): number {
        const numPatterns = KICK_PATTERNS.length;
        const patternIndex = Math.round(this.patternX * (numPatterns - 1));
        return KICK_PATTERNS[patternIndex][step];
    }

    /**
     * Advance to next step
     */
    private advanceStep(): void {
        const secondsPerBeat = 60.0 / this.tempo;
        const secondsPerStep = secondsPerBeat / 4; // 16th notes

        this.nextStepTime += secondsPerStep;
        this.currentStep = (this.currentStep + 1) % 16;
    }

    /**
     * Synthesize and play a kick drum
     * Y position controls: pitch (low Y = deep, high Y = punchy/higher)
     */
    private playKick(time: number): void {
        if (!this.ctx || !this.masterGain) return;

        // Y controls kick character
        // Low Y (0): Deep sub kick (40Hz, long decay)
        // High Y (1): Punchy kick (80Hz, short decay, more click)

        const basePitch = 40 + this.patternY * 40; // 40-80 Hz
        const decay = 0.5 - this.patternY * 0.3;   // 0.5-0.2 seconds
        const clickAmount = this.patternY * 0.3;    // 0-0.3

        // Main kick oscillator (sine)
        const kickOsc = this.ctx.createOscillator();
        kickOsc.type = 'sine';

        // Pitch envelope (quick pitch drop for punch)
        const startPitch = basePitch * (2 + this.patternY * 2); // Higher start for more punch
        kickOsc.frequency.setValueAtTime(startPitch, time);
        kickOsc.frequency.exponentialRampToValueAtTime(basePitch, time + 0.04);

        // Kick gain envelope
        const kickGain = this.ctx.createGain();
        kickGain.gain.setValueAtTime(0.8, time);
        kickGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

        // Optional click layer (noise burst for attack)
        if (clickAmount > 0.05) {
            const clickDuration = 0.01 + clickAmount * 0.02;
            const noiseBuffer = this.createNoiseBuffer(clickDuration);
            const clickSource = this.ctx.createBufferSource();
            clickSource.buffer = noiseBuffer;

            const clickFilter = this.ctx.createBiquadFilter();
            clickFilter.type = 'highpass';
            clickFilter.frequency.value = 1000 + this.patternY * 2000;

            const clickGain = this.ctx.createGain();
            clickGain.gain.setValueAtTime(clickAmount * 0.5, time);
            clickGain.gain.exponentialRampToValueAtTime(0.001, time + clickDuration);

            clickSource.connect(clickFilter);
            clickFilter.connect(clickGain);
            clickGain.connect(this.masterGain);

            clickSource.start(time);
            clickSource.stop(time + clickDuration);
        }

        // Connect and play
        kickOsc.connect(kickGain);
        kickGain.connect(this.masterGain);

        kickOsc.start(time);
        kickOsc.stop(time + decay + 0.1);
    }

    /**
     * Create a short noise buffer for click transients
     */
    private createNoiseBuffer(duration: number): AudioBuffer {
        const sampleRate = this.ctx!.sampleRate;
        const length = Math.floor(sampleRate * duration);
        const buffer = this.ctx!.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        return buffer;
    }

    /**
     * Update pattern from X/Y position
     */
    setPattern(x: number, y: number): void {
        this.patternX = Math.max(0, Math.min(1, x));
        this.patternY = Math.max(0, Math.min(1, y));
    }

    /**
     * Set tempo in BPM
     */
    setTempo(bpm: number): void {
        this.tempo = Math.max(40, Math.min(200, bpm));
    }

    /**
     * Get current tempo
     */
    getTempo(): number {
        return this.tempo;
    }

    /**
     * Set volume (0-1)
     */
    setVolume(vol: number): void {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.outputNode && this.ctx) {
            this.outputNode.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
        }
    }

    /**
     * Get current volume
     */
    getVolume(): number {
        return this.volume;
    }

    /**
     * Check if playing
     */
    getIsPlaying(): boolean {
        return this.isPlaying;
    }

    /**
     * Get current step (0-15) for visualization
     */
    getCurrentStep(): number {
        return this.currentStep;
    }

    /**
     * Get pattern X value
     */
    getPatternX(): number {
        return this.patternX;
    }

    /**
     * Get pattern Y value
     */
    getPatternY(): number {
        return this.patternY;
    }

    /**
     * Cleanup
     */
    dispose(): void {
        this.stop();
        if (this.outputNode) {
            this.outputNode.disconnect();
            this.outputNode = null;
        }
        if (this.masterGain) {
            this.masterGain.disconnect();
            this.masterGain = null;
        }
        this.ctx = null;
    }
}
