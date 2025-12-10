/**
 * Voice interfaces for wavetable synthesis mode
 */

export type TouchId = number | string;

// ============ WAVETABLE MODE ============

export interface WavetableVoice {
    osc: OscillatorNode;
    gain: GainNode;
    lfo: OscillatorNode;           // Vibrato (pitch modulation)
    lfoGain: GainNode;
    tremoloLfo: OscillatorNode;    // Tremolo (amplitude modulation)
    tremoloGain: GainNode;
    tremoloDepth: GainNode;        // Controls tremolo amount
    // ADSR envelope tracking
    startTime: number;             // When voice started (for attack/decay)
    targetGain: number;            // Target gain after attack (includes compensation)
    adsrPhase: 'attack' | 'decay' | 'sustain'; // Current envelope phase
    // Arpeggio state
    arpChordFreqs?: number[];       // Chord frequencies for arpeggio
    arpStep?: number;               // Current step in arpeggio
    arpIntervalId?: ReturnType<typeof setInterval> | null;
    arpLastScheduled?: number;      // Last scheduled time for smooth transitions
}

// ============ TEXTURE NODES ============

export interface TextureNodes {
    noiseBuffer: AudioBuffer;
    noiseSource: AudioBufferSourceNode | null;
    gain: GainNode;
    filter: BiquadFilterNode;
    filter2?: BiquadFilterNode;
    lfo?: OscillatorNode;
    lfoGain?: GainNode;
}
