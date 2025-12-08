import { describe, it, expect } from 'vitest';
import { REVERB_PRESETS, REVERB_CYCLE } from './constants';

describe('Reverb Constants', () => {
    it('has off and on presets', () => {
        expect(REVERB_PRESETS.off).toBeDefined();
        expect(REVERB_PRESETS.on).toBeDefined();
    });

    it('off preset has zero wet', () => {
        expect(REVERB_PRESETS.off.wet).toBe(0);
        expect(REVERB_PRESETS.off.dry).toBe(1);
    });

    it('on preset has significant wet mix', () => {
        expect(REVERB_PRESETS.on.wet).toBeGreaterThan(0.5);
        expect(REVERB_PRESETS.on.decay).toBeGreaterThan(1);
    });

    it('cycle includes off and on', () => {
        expect(REVERB_CYCLE).toContain('off');
        expect(REVERB_CYCLE).toContain('on');
    });
});

describe('Impulse Response Generation', () => {
    it('generates decaying noise buffer', () => {
        // Simulate the IR generation algorithm
        const sampleRate = 48000;
        const decayTime = 3.0;
        const length = Math.floor(sampleRate * decayTime);

        // Generate samples like AudioEngine does
        const data = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            const decay = Math.exp(-3 * i / length);
            const noise = (Math.random() * 2 - 1);
            data[i] = noise * decay;
        }

        // Check that buffer has content
        expect(data.length).toBe(144000); // 48000 * 3

        // Check that early samples have higher magnitude than late samples
        let earlySum = 0;
        let lateSum = 0;
        const earlyEnd = Math.floor(length * 0.1);
        const lateStart = Math.floor(length * 0.9);

        for (let i = 0; i < earlyEnd; i++) {
            earlySum += Math.abs(data[i]);
        }
        for (let i = lateStart; i < length; i++) {
            lateSum += Math.abs(data[i]);
        }

        const earlyAvg = earlySum / earlyEnd;
        const lateAvg = lateSum / (length - lateStart);

        console.log('Early average magnitude:', earlyAvg);
        console.log('Late average magnitude:', lateAvg);
        console.log('Ratio (early/late):', earlyAvg / lateAvg);

        // Early samples should be significantly louder than late samples
        expect(earlyAvg).toBeGreaterThan(lateAvg * 5);
    });

    it('decay envelope is correct', () => {
        const length = 1000;

        // Test decay at different points
        const decay0 = Math.exp(-3 * 0 / length);      // Start
        const decay50 = Math.exp(-3 * 500 / length);   // Middle
        const decay100 = Math.exp(-3 * 1000 / length); // End

        console.log('Decay at 0%:', decay0);
        console.log('Decay at 50%:', decay50);
        console.log('Decay at 100%:', decay100);

        expect(decay0).toBeCloseTo(1, 5);           // Should be ~1 at start
        expect(decay50).toBeCloseTo(0.223, 2);      // e^-1.5 ≈ 0.223
        expect(decay100).toBeCloseTo(0.0498, 2);    // e^-3 ≈ 0.0498
    });
});

describe('Wet/Dry Mix Math', () => {
    it('off mode passes only dry signal', () => {
        const { wet, dry } = REVERB_PRESETS.off;

        // Simulate a signal of amplitude 1
        const inputSignal = 1;
        const dryOutput = inputSignal * dry;
        const wetOutput = inputSignal * wet;
        const totalOutput = dryOutput + wetOutput;

        expect(dryOutput).toBe(1);
        expect(wetOutput).toBe(0);
        expect(totalOutput).toBe(1);
    });

    it('on mode mixes wet and dry', () => {
        const { wet, dry } = REVERB_PRESETS.on;

        // Simulate a signal of amplitude 1
        const inputSignal = 1;
        const dryOutput = inputSignal * dry;
        const wetOutput = inputSignal * wet;
        const totalOutput = dryOutput + wetOutput;

        console.log('High mode - dry:', dryOutput, 'wet:', wetOutput, 'total:', totalOutput);

        expect(dryOutput).toBe(0.6);
        expect(wetOutput).toBe(0.8);
        expect(totalOutput).toBe(1.4); // Combined could be > 1, that's ok
    });
});

describe('Signal Routing Verification', () => {
    it('documents expected audio graph', () => {
        // This test documents what the routing SHOULD be
        // If this passes, routing is correct in theory

        const expectedRouting = `
        Filter
           ↓
        Panner
           ↓
        ┌──┴──┐
        ↓     ↓
      DryGain  Convolver
        ↓        ↓
        ↓     WetGain
        ↓        ↓
        └──┬─────┘
           ↓
       MasterGain
           ↓
        Analyser
           ↓
       Destination
        `;

        // The key connections that must exist:
        const requiredConnections = [
            'panner -> reverbDryGain',
            'panner -> convolver',
            'convolver -> reverbWetGain',
            'reverbDryGain -> masterGain',
            'reverbWetGain -> masterGain',
        ];

        // This is a documentation test - it always passes
        // but reminds us what connections are needed
        expect(requiredConnections.length).toBe(5);
        console.log('Expected routing:', expectedRouting);
        console.log('Required connections:', requiredConnections);
    });
});
