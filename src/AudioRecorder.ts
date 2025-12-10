/**
 * AUDIO RECORDER - Record and export audio from the synthesizer
 */

import type { AudioEngine } from './AudioEngine';

export type RecordingState = 'idle' | 'recording';

export class AudioRecorder {
    private mediaRecorder: MediaRecorder | null = null;
    private chunks: Blob[] = [];
    private state: RecordingState = 'idle';
    private startTime = 0;
    private onStateChange: ((state: RecordingState, duration?: number) => void) | null = null;
    private timerInterval: number | null = null;

    constructor(private audio: AudioEngine) {}

    /** Set callback for state changes */
    setOnStateChange(callback: (state: RecordingState, duration?: number) => void): void {
        this.onStateChange = callback;
    }

    /** Start recording */
    start(): boolean {
        if (this.state === 'recording') return false;

        const stream = this.audio.getRecordingStream();
        if (!stream) {
            console.error('Could not get recording stream');
            return false;
        }

        this.chunks = [];

        // Use webm/opus for best browser support
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : 'audio/webm';

        try {
            this.mediaRecorder = new MediaRecorder(stream, { mimeType });
        } catch (e) {
            console.error('MediaRecorder not supported:', e);
            return false;
        }

        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.exportRecording();
        };

        this.mediaRecorder.start(100); // Collect data every 100ms
        this.state = 'recording';
        this.startTime = Date.now();

        // Start timer for UI updates
        this.timerInterval = window.setInterval(() => {
            const duration = (Date.now() - this.startTime) / 1000;
            this.onStateChange?.('recording', duration);
        }, 100);

        this.onStateChange?.('recording', 0);
        return true;
    }

    /** Stop recording and trigger export */
    stop(): void {
        if (this.state !== 'recording' || !this.mediaRecorder) return;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        this.mediaRecorder.stop();
        this.state = 'idle';
        this.onStateChange?.('idle');
    }

    /** Get current state */
    getState(): RecordingState {
        return this.state;
    }

    /** Export the recording as a downloadable file */
    private exportRecording(): void {
        if (this.chunks.length === 0) return;

        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);

        // Generate filename with timestamp
        const now = new Date();
        const timestamp = now.toISOString()
            .replace(/[:.]/g, '-')
            .slice(0, 19);
        const filename = `soundscape-${timestamp}.webm`;

        // Create download link and trigger it
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Cleanup
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.chunks = [];
    }

    /** Format duration as MM:SS */
    static formatDuration(seconds: number): string {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}
