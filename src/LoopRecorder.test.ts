import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoopRecorder, LoopState } from './LoopRecorder';
import { LOOP_TOUCH_ID_OFFSET, LOOP_ITERATION_OFFSET } from './constants';

// Mock AudioEngine
const createMockAudioEngine = () => ({
    ctx: { currentTime: 0 },
    start: vi.fn(),
    update: vi.fn(),
    stop: vi.fn()
});

describe('LoopRecorder', () => {
    let recorder: LoopRecorder;
    let mockAudio: ReturnType<typeof createMockAudioEngine>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockAudio = createMockAudioEngine();
        recorder = new LoopRecorder(mockAudio as any);
    });

    describe('initial state', () => {
        it('starts not recording', () => {
            expect(recorder.isRecording).toBe(false);
        });

        it('starts not playing', () => {
            expect(recorder.isPlaying).toBe(false);
        });

        it('has no events', () => {
            expect(recorder.events).toHaveLength(0);
        });

        it('has zero duration', () => {
            expect(recorder.loopDuration).toBe(0);
        });

        it('hasLoop returns false', () => {
            expect(recorder.hasLoop()).toBe(false);
        });
    });

    describe('startRecording', () => {
        it('sets isRecording to true', () => {
            recorder.startRecording();
            expect(recorder.isRecording).toBe(true);
        });

        it('clears previous events', () => {
            recorder.events = [{ type: 'start', x: 0.5, y: 0.5, touchId: 1, time: 0 }];
            recorder.startRecording();
            expect(recorder.events).toHaveLength(0);
        });

        it('resets loop duration', () => {
            recorder.loopDuration = 1000;
            recorder.startRecording();
            expect(recorder.loopDuration).toBe(0);
        });

        it('notifies state change', () => {
            const callback = vi.fn();
            recorder.onStateChange = callback;
            recorder.startRecording();
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                isRecording: true,
                isPlaying: false
            }));
        });
    });

    describe('recordEvent', () => {
        beforeEach(() => {
            recorder.startRecording();
        });

        it('records start events', () => {
            recorder.recordEvent('start', 0.5, 0.5, 1);
            expect(recorder.events).toHaveLength(1);
            expect(recorder.events[0].type).toBe('start');
        });

        it('records move events', () => {
            recorder.recordEvent('move', 0.6, 0.4, 1);
            expect(recorder.events).toHaveLength(1);
            expect(recorder.events[0].type).toBe('move');
        });

        it('records end events', () => {
            recorder.recordEvent('end', 0.5, 0.5, 1);
            expect(recorder.events).toHaveLength(1);
            expect(recorder.events[0].type).toBe('end');
        });

        it('stores correct x, y coordinates', () => {
            recorder.recordEvent('start', 0.3, 0.7, 1);
            expect(recorder.events[0].x).toBe(0.3);
            expect(recorder.events[0].y).toBe(0.7);
        });

        it('stores touchId', () => {
            recorder.recordEvent('start', 0.5, 0.5, 42);
            expect(recorder.events[0].touchId).toBe(42);
        });

        it('does not record when not recording', () => {
            recorder.stopRecording();
            recorder.recordEvent('start', 0.5, 0.5, 1);
            expect(recorder.events).toHaveLength(0);
        });
    });

    describe('stopRecording', () => {
        beforeEach(() => {
            recorder.startRecording();
            recorder.recordEvent('start', 0.5, 0.5, 1);
        });

        it('sets isRecording to false', () => {
            recorder.stopRecording();
            expect(recorder.isRecording).toBe(false);
        });

        it('calculates loop duration', () => {
            // Wait a bit to get non-zero duration
            recorder.stopRecording();
            expect(recorder.loopDuration).toBeGreaterThanOrEqual(0);
        });

        it('auto-closes unclosed touches', () => {
            recorder.recordEvent('start', 0.5, 0.5, 1);
            recorder.stopRecording();
            // Should have original start and auto-generated end
            const endEvents = recorder.events.filter(e => e.type === 'end');
            expect(endEvents.length).toBeGreaterThan(0);
        });

        it('notifies state change', () => {
            const callback = vi.fn();
            recorder.onStateChange = callback;
            recorder.stopRecording();
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                isRecording: false
            }));
        });

        it('does nothing if not recording', () => {
            recorder.stopRecording();
            const callback = vi.fn();
            recorder.onStateChange = callback;
            recorder.stopRecording();
            // Should not notify again
            expect(callback).not.toHaveBeenCalled();
        });
    });

    describe('hasLoop', () => {
        it('returns false with no events', () => {
            expect(recorder.hasLoop()).toBe(false);
        });

        it('returns false with events but zero duration', () => {
            recorder.events = [{ type: 'start', x: 0.5, y: 0.5, touchId: 1, time: 0 }];
            recorder.loopDuration = 0;
            expect(recorder.hasLoop()).toBe(false);
        });

        it('returns true with events and positive duration', () => {
            recorder.events = [{ type: 'start', x: 0.5, y: 0.5, touchId: 1, time: 0 }];
            recorder.loopDuration = 1000;
            expect(recorder.hasLoop()).toBe(true);
        });
    });

    describe('getLoopDuration', () => {
        it('returns duration in seconds', () => {
            recorder.loopDuration = 2500; // 2.5 seconds in ms
            expect(recorder.getLoopDuration()).toBe(2.5);
        });

        it('returns 0 for no loop', () => {
            expect(recorder.getLoopDuration()).toBe(0);
        });
    });

    describe('getEventCount', () => {
        it('returns 0 initially', () => {
            expect(recorder.getEventCount()).toBe(0);
        });

        it('returns correct count after recording', () => {
            recorder.startRecording();
            recorder.recordEvent('start', 0.5, 0.5, 1);
            recorder.recordEvent('move', 0.6, 0.5, 1);
            recorder.recordEvent('end', 0.6, 0.5, 1);
            expect(recorder.getEventCount()).toBe(3);
        });
    });

    describe('clearLoop', () => {
        beforeEach(() => {
            recorder.startRecording();
            recorder.recordEvent('start', 0.5, 0.5, 1);
            recorder.stopRecording();
        });

        it('clears events', () => {
            recorder.clearLoop();
            expect(recorder.events).toHaveLength(0);
        });

        it('resets duration', () => {
            recorder.clearLoop();
            expect(recorder.loopDuration).toBe(0);
        });

        it('stops playback if playing', () => {
            recorder.isPlaying = true;
            recorder.clearLoop();
            expect(recorder.isPlaying).toBe(false);
        });

        it('notifies state change', () => {
            const callback = vi.fn();
            recorder.onStateChange = callback;
            recorder.clearLoop();
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                hasLoop: false,
                duration: 0
            }));
        });
    });

    describe('playback touch ID generation', () => {
        it('uses correct offset for playback touch IDs', () => {
            expect(LOOP_TOUCH_ID_OFFSET).toBe(10000);
        });

        it('uses correct iteration offset', () => {
            expect(LOOP_ITERATION_OFFSET).toBe(1000);
        });
    });

    describe('notifyStateChange', () => {
        it('calls onStateChange callback with correct state', () => {
            const callback = vi.fn();
            recorder.onStateChange = callback;

            recorder.startRecording();

            expect(callback).toHaveBeenCalledWith<[LoopState]>({
                isRecording: true,
                isPlaying: false,
                hasLoop: false,
                duration: 0
            });
        });

        it('does nothing if no callback set', () => {
            recorder.onStateChange = null;
            // Should not throw
            expect(() => recorder.startRecording()).not.toThrow();
        });
    });
});
