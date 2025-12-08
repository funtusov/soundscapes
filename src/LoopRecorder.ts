/**
 * LOOP RECORDER - Records and plays back touch/mouse interactions
 */

import type { AudioEngine } from './AudioEngine';

type TouchId = number | string;

interface LoopEvent {
    type: 'start' | 'move' | 'end';
    x: number;
    y: number;
    touchId: TouchId;
    time: number;
}

interface PlaybackTouchData {
    originalTouchId: TouchId;
    startTime: number;
}

export interface LoopState {
    isRecording: boolean;
    isPlaying: boolean;
    hasLoop: boolean;
    duration: number;
}

export class LoopRecorder {
    audio: AudioEngine;
    events: LoopEvent[] = [];
    isRecording = false;
    isPlaying = false;
    recordingStartTime = 0;
    loopDuration = 0;
    playbackStartTime = 0;
    activePlaybackTouches = new Map<number, PlaybackTouchData>();
    touchIdOffset = 10000;
    playbackAnimationFrame: number | null = null;
    lastLoopTime = 0;
    lastLoopCount = 0;
    onStateChange: ((state: LoopState) => void) | null = null;

    constructor(audio: AudioEngine) {
        this.audio = audio;
    }

    startRecording() {
        this.events = [];
        this.isRecording = true;
        this.recordingStartTime = performance.now();
        this.loopDuration = 0;
        this.notifyStateChange();
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.loopDuration = performance.now() - this.recordingStartTime;

        // Close any still-active recorded touches with end events
        const activeTouchIds = new Set<TouchId>();
        this.events.forEach(e => {
            if (e.type === 'start') activeTouchIds.add(e.touchId);
            if (e.type === 'end') activeTouchIds.delete(e.touchId);
        });

        // Add end events for any unclosed touches
        activeTouchIds.forEach(touchId => {
            const lastEvent = [...this.events].reverse().find(e => e.touchId === touchId);
            if (lastEvent) {
                this.events.push({
                    type: 'end',
                    touchId,
                    x: lastEvent.x,
                    y: lastEvent.y,
                    time: this.loopDuration
                });
            }
        });

        this.notifyStateChange();
    }

    recordEvent(type: 'start' | 'move' | 'end', x: number, y: number, touchId: TouchId) {
        if (!this.isRecording) return;

        const time = performance.now() - this.recordingStartTime;
        this.events.push({ type, x, y, touchId, time });
    }

    startPlayback() {
        if (this.events.length === 0 || this.loopDuration === 0) return;

        this.isPlaying = true;
        this.playbackStartTime = performance.now();
        this.activePlaybackTouches.clear();

        // Use requestAnimationFrame for smooth playback
        this.schedulePlayback();
        this.notifyStateChange();
    }

    schedulePlayback() {
        if (!this.isPlaying) return;

        const elapsed = performance.now() - this.playbackStartTime;
        const loopTime = elapsed % this.loopDuration;
        const loopCount = Math.floor(elapsed / this.loopDuration);

        // Check if we wrapped to a new loop
        const prevLoopTime = this.lastLoopTime || 0;
        const prevLoopCount = this.lastLoopCount || 0;

        if (loopCount > prevLoopCount) {
            // New loop started - end all active playback touches from previous loop
            this.endAllPlaybackTouches();
        }

        this.lastLoopTime = loopTime;
        this.lastLoopCount = loopCount;

        // Find events that should fire this frame
        // Look for events between prevLoopTime and loopTime (or from 0 if new loop)
        const startTime = loopCount > prevLoopCount ? 0 : prevLoopTime;

        this.events.forEach((event) => {
            if (event.time > startTime && event.time <= loopTime) {
                this.executeEvent(event, loopCount);
            }
        });

        // Schedule next frame
        this.playbackAnimationFrame = requestAnimationFrame(() => this.schedulePlayback());
    }

    executeEvent(event: LoopEvent, loopCount: number) {
        // Create unique touch ID for this playback instance
        const playbackTouchId = this.touchIdOffset + Number(event.touchId) + (loopCount * 1000);

        switch (event.type) {
            case 'start':
                this.audio.start(playbackTouchId);
                this.audio.update(event.x, event.y, playbackTouchId, 0);
                this.activePlaybackTouches.set(playbackTouchId, {
                    originalTouchId: event.touchId,
                    startTime: performance.now()
                });
                break;

            case 'move':
                // Find the matching active playback touch
                for (const [pbTouchId, data] of this.activePlaybackTouches) {
                    if (data.originalTouchId === event.touchId) {
                        const duration = (performance.now() - data.startTime) / 1000;
                        this.audio.update(event.x, event.y, pbTouchId, duration);
                        break;
                    }
                }
                break;

            case 'end':
                // Find and end the matching active playback touch
                for (const [pbTouchId, data] of this.activePlaybackTouches) {
                    if (data.originalTouchId === event.touchId) {
                        const duration = (performance.now() - data.startTime) / 1000;
                        this.audio.stop(pbTouchId, duration);
                        this.activePlaybackTouches.delete(pbTouchId);
                        break;
                    }
                }
                break;
        }
    }

    endAllPlaybackTouches() {
        for (const [pbTouchId, data] of this.activePlaybackTouches) {
            const duration = (performance.now() - data.startTime) / 1000;
            this.audio.stop(pbTouchId, duration);
        }
        this.activePlaybackTouches.clear();
    }

    stopPlayback() {
        this.isPlaying = false;

        if (this.playbackAnimationFrame) {
            cancelAnimationFrame(this.playbackAnimationFrame);
            this.playbackAnimationFrame = null;
        }

        // End all active playback touches
        this.endAllPlaybackTouches();

        this.lastLoopTime = 0;
        this.lastLoopCount = 0;
        this.notifyStateChange();
    }

    clearLoop() {
        this.stopPlayback();
        this.events = [];
        this.loopDuration = 0;
        this.notifyStateChange();
    }

    hasLoop() {
        return this.events.length > 0 && this.loopDuration > 0;
    }

    getLoopDuration() {
        return this.loopDuration / 1000; // Return in seconds
    }

    getEventCount() {
        return this.events.length;
    }

    notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange({
                isRecording: this.isRecording,
                isPlaying: this.isPlaying,
                hasLoop: this.hasLoop(),
                duration: this.getLoopDuration()
            });
        }
    }
}
