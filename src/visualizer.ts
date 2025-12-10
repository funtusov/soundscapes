/**
 * VISUAL ENGINE - Canvas rendering and spectrogram
 */

import type { AudioEngine } from './AudioEngine';
import {
    SPECTROGRAM_HISTORY,
    MEL_BINS,
    MEL_MIN_FREQ,
    MEL_MAX_FREQ,
    SPECTROGRAM_MIN_VAL,
    SPECTROGRAM_MAX_VAL,
    CONTROL_BAR_HEIGHT,
    CURSOR_GLOW_RADIUS,
    CURSOR_DOT_RADIUS,
    RIPPLE_INITIAL_RADIUS,
    RIPPLE_EXPANSION_RATE,
    RIPPLE_DECAY_RATE,
    hzToMel,
    melToHz
} from './constants';

type TouchId = number | string;

interface CursorPos {
    x: number;
    y: number;
}

interface Ripple {
    x: number;
    y: number;
    r: number;
    o: number;
}

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let width = 0;
let height = 0;
const cursors = new Map<TouchId, CursorPos>();
const ripples: Ripple[] = [];
let spectrogramBuffer: Float32Array[] = [];
let melFilterbank: Float32Array[] | null = null;

// Offscreen canvas for spectrogram optimization
let spectrogramCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let spectrogramCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
let spectrogramReady = false;

function createMelFilterbank(fftSize: number, sampleRate: number, numMelBins: number, minFreq: number, maxFreq: number): Float32Array[] {
    const numFftBins = fftSize / 2;
    const melMin = hzToMel(minFreq);
    const melMax = hzToMel(maxFreq);
    const melPoints: number[] = [];

    for (let i = 0; i <= numMelBins + 1; i++) {
        melPoints.push(melToHz(melMin + (melMax - melMin) * i / (numMelBins + 1)));
    }

    const binPoints = melPoints.map(freq => Math.floor((fftSize + 1) * freq / sampleRate));

    const filterbank: Float32Array[] = [];
    for (let i = 0; i < numMelBins; i++) {
        const filter = new Float32Array(numFftBins);
        const startBin = binPoints[i];
        const centerBin = binPoints[i + 1];
        const endBin = binPoints[i + 2];

        for (let j = startBin; j < centerBin && j < numFftBins; j++) {
            filter[j] = (j - startBin) / (centerBin - startBin);
        }
        for (let j = centerBin; j < endBin && j < numFftBins; j++) {
            filter[j] = (endBin - j) / (endBin - centerBin);
        }
        filterbank.push(filter);
    }
    return filterbank;
}

function fftToMel(fftData: Float32Array): Float32Array | null {
    if (!melFilterbank) return null;
    const melSpectrum = new Float32Array(MEL_BINS);

    for (let i = 0; i < MEL_BINS; i++) {
        let linearSum = 0;
        let filterSum = 0;
        for (let j = 0; j < fftData.length; j++) {
            const linearPower = Math.pow(10, fftData[j] / 10);
            linearSum += linearPower * melFilterbank[i][j];
            filterSum += melFilterbank[i][j];
        }
        if (filterSum > 0) linearSum = linearSum / filterSum;
        melSpectrum[i] = 10 * Math.log10(linearSum + 1e-10);
    }
    return melSpectrum;
}

export function initVisualizer(canvasElement: HTMLCanvasElement) {
    canvas = canvasElement;
    ctx = canvas.getContext('2d')!;
    resize();
    window.addEventListener('resize', resize);
}

export function initMelFilterbank(audio: AudioEngine) {
    if (audio.ctx) {
        melFilterbank = createMelFilterbank(
            audio.analyser!.fftSize,
            audio.ctx.sampleRate,
            MEL_BINS,
            MEL_MIN_FREQ,
            MEL_MAX_FREQ
        );
    }
}

function resize() {
    // Use the actual canvas element size (respects CSS sizing)
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width;
    canvas.height = height;

    // Recreate offscreen spectrogram canvas
    initSpectrogramCanvas();
}

function initSpectrogramCanvas() {
    // Use OffscreenCanvas if available, otherwise fallback to HTMLCanvasElement
    if (typeof OffscreenCanvas !== 'undefined') {
        spectrogramCanvas = new OffscreenCanvas(width, height);
    } else {
        spectrogramCanvas = document.createElement('canvas');
        spectrogramCanvas.width = width;
        spectrogramCanvas.height = height;
    }
    spectrogramCtx = spectrogramCanvas.getContext('2d');
    spectrogramReady = false;

    // Clear the spectrogram buffer on resize
    spectrogramBuffer = [];
}

function drawGrid() {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';

    const stepX = width / 8;
    for (let i = 0; i <= width; i += stepX) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
    }
    const stepY = height / 8;
    for (let i = 0; i <= height; i += stepY) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
        ctx.stroke();
    }
}

function intensityToColor(intensity: number): [number, number, number] {
    let r: number, g: number, b: number;
    if (intensity < 0.15) {
        const t = intensity / 0.15;
        r = 0; g = 0; b = Math.floor(80 * t);
    } else if (intensity < 0.3) {
        const t = (intensity - 0.15) / 0.15;
        r = 0; g = Math.floor(30 * t); b = Math.floor(80 + 120 * t);
    } else if (intensity < 0.45) {
        const t = (intensity - 0.3) / 0.15;
        r = Math.floor(180 * t); g = Math.floor(30 * (1 - t)); b = Math.floor(200 - 40 * t);
    } else if (intensity < 0.6) {
        const t = (intensity - 0.45) / 0.15;
        r = Math.floor(180 + 75 * t); g = 0; b = Math.floor(160 - 160 * t);
    } else if (intensity < 0.75) {
        const t = (intensity - 0.6) / 0.15;
        r = 255; g = Math.floor(120 * t); b = 0;
    } else if (intensity < 0.9) {
        const t = (intensity - 0.75) / 0.15;
        r = 255; g = Math.floor(120 + 135 * t); b = 0;
    } else {
        const t = (intensity - 0.9) / 0.1;
        r = 255; g = 255; b = Math.floor(255 * t);
    }
    return [r, g, b];
}

function drawSpectrogram(audio: AudioEngine) {
    const data = audio.getAnalysis();
    if (!data || !melFilterbank || !spectrogramCtx || !spectrogramCanvas) return;

    const melSpectrum = fftToMel(data);
    if (!melSpectrum) return;

    const colWidth = Math.ceil(width / SPECTROGRAM_HISTORY);
    const rowHeight = Math.ceil(height / MEL_BINS);

    const minVal = SPECTROGRAM_MIN_VAL;
    const maxVal = SPECTROGRAM_MAX_VAL;

    // Optimized approach: scroll existing content left and draw only new column
    if (spectrogramReady) {
        // Scroll existing content left by one column width
        spectrogramCtx.drawImage(
            spectrogramCanvas,
            colWidth, 0, width - colWidth, height,
            0, 0, width - colWidth, height
        );

        // Clear the rightmost column
        spectrogramCtx.fillStyle = 'rgb(5, 5, 10)';
        spectrogramCtx.fillRect(width - colWidth, 0, colWidth, height);

        // Draw only the new column on the right edge
        const x = width - colWidth;
        for (let f = 0; f < MEL_BINS; f++) {
            let intensity = (melSpectrum[f] - minVal) / (maxVal - minVal);
            intensity = Math.max(0, Math.min(1, intensity));
            intensity = Math.pow(intensity, 0.8);

            const [r, g, b] = intensityToColor(intensity);
            spectrogramCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            const y = height - Math.floor((f + 1) * height / MEL_BINS);
            spectrogramCtx.fillRect(x, y, colWidth, rowHeight);
        }
    } else {
        // First frame - need to build up buffer and draw fully
        spectrogramBuffer.push(melSpectrum);
        if (spectrogramBuffer.length > SPECTROGRAM_HISTORY) {
            spectrogramBuffer.shift();
        }

        // Fill background
        spectrogramCtx.fillStyle = 'rgb(5, 5, 10)';
        spectrogramCtx.fillRect(0, 0, width, height);

        // Draw all columns
        for (let t = 0; t < spectrogramBuffer.length; t++) {
            const frame = spectrogramBuffer[t];
            const x = Math.floor(t * width / SPECTROGRAM_HISTORY);

            for (let f = 0; f < MEL_BINS; f++) {
                let intensity = (frame[f] - minVal) / (maxVal - minVal);
                intensity = Math.max(0, Math.min(1, intensity));
                intensity = Math.pow(intensity, 0.8);

                const [r, g, b] = intensityToColor(intensity);
                spectrogramCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
                const y = height - Math.floor((f + 1) * height / MEL_BINS);
                spectrogramCtx.fillRect(x, y, colWidth, rowHeight);
            }
        }

        // Mark as ready once buffer is full
        if (spectrogramBuffer.length >= SPECTROGRAM_HISTORY) {
            spectrogramReady = true;
            spectrogramBuffer = []; // Free memory - no longer needed
        }
    }

    // Copy spectrogram to main canvas
    ctx.drawImage(spectrogramCanvas as CanvasImageSource, 0, 0);
}

function drawCursor() {
    if (cursors.size === 0) return;

    for (const [, pos] of cursors) {
        const gradient = ctx.createRadialGradient(pos.x, pos.y, CURSOR_DOT_RADIUS, pos.x, pos.y, CURSOR_GLOW_RADIUS);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(0, 255, 204, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 255, 204, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, CURSOR_GLOW_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, CURSOR_DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawRipples() {
    ctx.lineWidth = 2;
    for (let i = ripples.length - 1; i >= 0; i--) {
        const rip = ripples[i];
        ctx.strokeStyle = `rgba(0, 255, 204, ${rip.o})`;
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.stroke();
        rip.r += RIPPLE_EXPANSION_RATE;
        rip.o -= RIPPLE_DECAY_RATE;
        if (rip.o <= 0) ripples.splice(i, 1);
    }
}

export function addRipple(x: number, y: number) {
    ripples.push({ x, y, r: RIPPLE_INITIAL_RADIUS, o: 1.0 });
}

export function setCursor(x: number, y: number, touchId: TouchId = 'mouse') {
    cursors.set(touchId, { x, y });
}

export function removeCursor(touchId: TouchId = 'mouse') {
    cursors.delete(touchId);
}

function drawWaveformZones(audio: AudioEngine) {
    const playableHeight = height - CONTROL_BAR_HEIGHT;

    // Draw gradient background (morphing from sine to square)
    const gradient = ctx.createLinearGradient(0, 0, 0, playableHeight);
    gradient.addColorStop(0, 'rgba(255, 100, 100, 0.04)');    // Square (top/high Y)
    gradient.addColorStop(0.33, 'rgba(255, 200, 100, 0.04)'); // Saw
    gradient.addColorStop(0.67, 'rgba(100, 255, 200, 0.04)'); // Triangle
    gradient.addColorStop(1, 'rgba(100, 150, 255, 0.04)');    // Sine (bottom/low Y)
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, playableHeight);

    // Draw octave lines (vertical)
    const rangeInfo = audio.getRangeInfo();
    const octaves = Math.ceil(rangeInfo.octaves);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);

    for (let i = 1; i < octaves; i++) {
        const x = (i / rangeInfo.octaves) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, playableHeight);
        ctx.stroke();

        // Octave label at bottom
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'center';
        const octaveNum = Math.floor(Math.log2(rangeInfo.baseFreq / 16.35)) + i + 1; // Calculate actual octave number
        ctx.fillText(`${octaveNum}`, x, playableHeight - 5);
    }
    ctx.setLineDash([]);

    // Waveform markers at morph positions (not zones, just reference points)
    const waveforms = [
        { name: 'SQUARE', y: 0, drawWave: drawSquareWave, color: 'rgba(255, 100, 100, 0.3)' },
        { name: 'SAW', y: playableHeight / 3, drawWave: drawSawWave, color: 'rgba(255, 200, 100, 0.3)' },
        { name: 'TRI', y: (playableHeight * 2) / 3, drawWave: drawTriWave, color: 'rgba(100, 255, 200, 0.3)' },
        { name: 'SINE', y: playableHeight, drawWave: drawSineWave, color: 'rgba(100, 150, 255, 0.3)' }
    ];

    waveforms.forEach((wf) => {
        // Draw waveform icon on the right edge
        const yPos = Math.min(playableHeight - 20, Math.max(20, wf.y));
        wf.drawWave(width - 60, yPos, 40, 15);

        // Small label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(wf.name, width - 15, yPos + 4);
    });

    // Draw morph arrows between waveforms
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (let i = 0; i < waveforms.length - 1; i++) {
        const y1 = waveforms[i].y;
        const y2 = waveforms[i + 1].y;
        ctx.beginPath();
        ctx.moveTo(width - 40, Math.max(25, y1 + 15));
        ctx.lineTo(width - 40, Math.min(playableHeight - 25, y2 - 15));
        ctx.stroke();
    }
    ctx.setLineDash([]);
}

function drawSineWave(cx: number, cy: number, w: number, h: number) {
    ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const y = cy + Math.sin((i / w) * Math.PI * 2) * h/2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawTriWave(cx: number, cy: number, w: number, h: number) {
    ctx.strokeStyle = 'rgba(100, 255, 200, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy);
    ctx.lineTo(cx - w/4, cy - h/2);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + w/4, cy + h/2);
    ctx.lineTo(cx + w/2, cy);
    ctx.stroke();
}

function drawSawWave(cx: number, cy: number, w: number, h: number) {
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy + h/2);
    ctx.lineTo(cx - w/2, cy - h/2);
    ctx.lineTo(cx, cy + h/2);
    ctx.lineTo(cx, cy - h/2);
    ctx.lineTo(cx + w/2, cy + h/2);
    ctx.stroke();
}

function drawSquareWave(cx: number, cy: number, w: number, h: number) {
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy + h/2);
    ctx.lineTo(cx - w/2, cy - h/2);
    ctx.lineTo(cx - w/4, cy - h/2);
    ctx.lineTo(cx - w/4, cy + h/2);
    ctx.lineTo(cx + w/4, cy + h/2);
    ctx.lineTo(cx + w/4, cy - h/2);
    ctx.lineTo(cx + w/2, cy - h/2);
    ctx.lineTo(cx + w/2, cy + h/2);
    ctx.stroke();
}

// ============ THEREMIN ZONES (Y = Vibrato Depth) ============
function drawDroneZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 6;

    const zones = [
        { name: 'POWER', color: 'rgba(100, 200, 255, 0.06)', intervals: [0, 7] },
        { name: 'MIN7', color: 'rgba(150, 100, 255, 0.06)', intervals: [0, 3, 7] },
        { name: '7TH', color: 'rgba(200, 150, 100, 0.06)', intervals: [0, 4, 7, 10] },
        { name: 'SUS4', color: 'rgba(150, 200, 150, 0.06)', intervals: [0, 5, 7] },
        { name: 'MINOR', color: 'rgba(100, 150, 255, 0.06)', intervals: [0, 3, 7] },
        { name: 'MAJOR', color: 'rgba(255, 200, 100, 0.06)', intervals: [0, 4, 7] }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw chord visualization
        drawChordViz(width - 60, y + zoneHeight / 2, 40, 15, zone.intervals);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 15);
    });
}

function drawChordViz(cx: number, cy: number, w: number, h: number, intervals: number[]) {
    const noteCount = intervals.length;
    const spacing = w / (noteCount + 1);

    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy);
    ctx.lineTo(cx + w/2, cy);
    ctx.stroke();

    ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
    intervals.forEach((interval, i) => {
        const x = cx - w/2 + spacing * (i + 1);
        const noteY = cy - (interval / 12) * h;
        ctx.beginPath();
        ctx.arc(x, noteY, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

// ============ FM ZONES (Y = FM Ratio) ============
function drawFMZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 8;

    const zones = [
        { name: '8:1', color: 'rgba(255, 50, 150, 0.06)', ratio: 8, desc: '3oct' },
        { name: '7:1', color: 'rgba(255, 80, 130, 0.06)', ratio: 7, desc: 'min7+' },
        { name: '6:1', color: 'rgba(255, 100, 100, 0.06)', ratio: 6, desc: '5th++' },
        { name: '5:1', color: 'rgba(255, 130, 80, 0.06)', ratio: 5, desc: 'maj3+' },
        { name: '4:1', color: 'rgba(255, 150, 50, 0.06)', ratio: 4, desc: '2oct' },
        { name: '3:1', color: 'rgba(200, 180, 50, 0.06)', ratio: 3, desc: '5th+' },
        { name: '2:1', color: 'rgba(150, 200, 100, 0.06)', ratio: 2, desc: 'oct' },
        { name: '1:1', color: 'rgba(100, 200, 150, 0.06)', ratio: 1, desc: 'uni' }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw FM ratio visualization
        drawFMRatio(width - 60, y + zoneHeight / 2, 40, 12, zone.ratio);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name + ' ' + zone.desc, width - 15, y + zoneHeight / 2 + 12);
    });
}

function drawFMRatio(cx: number, cy: number, w: number, h: number, ratio: number) {
    const color = `rgba(255, ${200 - ratio * 20}, ${50 + ratio * 10}, 0.4)`;

    // Draw carrier wave
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const y = cy + Math.sin((i / w) * Math.PI * 2) * h/3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw modulated wave
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const mod = Math.sin((i / w) * Math.PI * 2 * ratio) * (ratio / 3);
        const y = cy + Math.sin((i / w) * Math.PI * 2 + mod) * h/2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// ============ ARPEGGIATOR ZONES (Y = Pattern) ============
function drawArpZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 4;

    const zones = [
        { name: 'ALT', color: 'rgba(255, 150, 200, 0.06)', pattern: [0, 7, 4, 12] },
        { name: 'UP/DN', color: 'rgba(200, 150, 255, 0.06)', pattern: [0, 4, 7, 12, 7, 4] },
        { name: 'DOWN', color: 'rgba(150, 200, 255, 0.06)', pattern: [12, 7, 4, 0] },
        { name: 'UP', color: 'rgba(100, 255, 200, 0.06)', pattern: [0, 4, 7, 12] }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw arp pattern visualization
        drawArpPattern(width - 60, y + zoneHeight / 2, 40, 20, zone.pattern);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });

    // Duration indicator on left edge
    const indicatorWidth = 40;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('HOLD', indicatorWidth / 2, 15);
    ctx.fillText('=', indicatorWidth / 2, 25);
    ctx.fillText('FAST', indicatorWidth / 2, 35);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(indicatorWidth / 2, 45);
    ctx.lineTo(indicatorWidth / 2, playableHeight - 20);
    ctx.stroke();
}

function drawArpPattern(cx: number, cy: number, w: number, h: number, pattern: number[]) {
    const stepWidth = w / pattern.length;

    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    pattern.forEach((note, i) => {
        const x = cx - w/2 + i * stepWidth + stepWidth/2;
        const noteY = cy - (note / 12) * h/2 + h/4;

        if (i === 0) ctx.moveTo(x, noteY);
        else ctx.lineTo(x, noteY);
    });
    ctx.stroke();

    // Draw note dots
    ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
    pattern.forEach((note, i) => {
        const x = cx - w/2 + i * stepWidth + stepWidth/2;
        const noteY = cy - (note / 12) * h/2 + h/4;
        ctx.beginPath();
        ctx.arc(x, noteY, 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

// ============ KARPLUS-STRONG ZONES (Y = Decay Time) ============
function drawKarplusZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'LONG', color: 'rgba(150, 100, 180, 0.06)', decay: 'long' },
        { name: 'MEDIUM', color: 'rgba(200, 150, 150, 0.06)', decay: 'medium' },
        { name: 'SHORT', color: 'rgba(255, 230, 100, 0.06)', decay: 'short' }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw decay envelope visualization
        drawDecayEnvelope(width - 60, y + zoneHeight / 2, 40, 15, zone.decay);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawDecayEnvelope(cx: number, cy: number, w: number, h: number, decay: string) {
    const decayRate = decay === 'short' ? 4 : decay === 'medium' ? 2 : 0.8;
    const color = decay === 'short' ? 'rgba(255, 230, 100, 0.4)' :
                  decay === 'medium' ? 'rgba(200, 150, 150, 0.35)' : 'rgba(150, 100, 180, 0.3)';

    // Draw decay envelope
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const envelope = Math.exp(-i / w * decayRate);
        const y = cy + Math.sin((i / w) * Math.PI * 6) * h/2 * envelope;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw sympathetic string hints
    ctx.strokeStyle = color.replace('0.4', '0.2').replace('0.35', '0.15').replace('0.3', '0.1');
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const envelope = Math.exp(-i / w * decayRate * 1.5);
        const y = cy - h/3 + Math.sin((i / w) * Math.PI * 9) * h/4 * envelope;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// ============ FORMANT/VOICE ZONES (Y = Vowel) ============
function drawFormantZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 5;

    const zones = [
        { name: 'U (oo)', color: 'rgba(100, 100, 200, 0.06)', vowel: 'u', formants: [325, 700, 2500] },
        { name: 'O (oh)', color: 'rgba(150, 100, 180, 0.06)', vowel: 'o', formants: [450, 800, 2500] },
        { name: 'I (ee)', color: 'rgba(200, 200, 100, 0.06)', vowel: 'i', formants: [280, 2300, 3000] },
        { name: 'E (eh)', color: 'rgba(255, 180, 100, 0.06)', vowel: 'e', formants: [400, 2200, 2800] },
        { name: 'A (ah)', color: 'rgba(255, 100, 150, 0.06)', vowel: 'a', formants: [800, 1200, 2500] }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw formant spectrum visualization
        drawFormantSpectrum(width - 60, y + zoneHeight / 2, 40, 15, zone.formants, zone.color);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '9px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 15);
    });
}

function drawFormantSpectrum(cx: number, cy: number, w: number, h: number, formants: number[], color: string) {
    const maxFreq = 3500;

    // Draw frequency axis
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - w/2, cy + h/2);
    ctx.lineTo(cx + w/2, cy + h/2);
    ctx.stroke();

    // Draw formant peaks
    const peakColor = color.replace('0.06', '0.5');
    ctx.fillStyle = peakColor;

    formants.forEach((freq, i) => {
        const x = cx - w/2 + (freq / maxFreq) * w;
        const peakHeight = h * (1 - i * 0.2); // F1 tallest, F3 shortest
        const peakWidth = 4 - i;

        // Draw peak as triangle
        ctx.beginPath();
        ctx.moveTo(x - peakWidth, cy + h/2);
        ctx.lineTo(x, cy + h/2 - peakHeight);
        ctx.lineTo(x + peakWidth, cy + h/2);
        ctx.closePath();
        ctx.fill();
    });
}

// ============ AMBIENT ZONES (Y = Mood/Brightness) ============
function drawAmbientZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'AIRY', color: 'rgba(200, 230, 255, 0.06)', mood: 'bright' },
        { name: 'CALM', color: 'rgba(150, 180, 200, 0.06)', mood: 'neutral' },
        { name: 'DEEP', color: 'rgba(80, 100, 150, 0.06)', mood: 'dark' }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw mood visualization
        drawMoodWave(width - 60, y + zoneHeight / 2, 40, 15, zone.mood);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawMoodWave(cx: number, cy: number, w: number, h: number, mood: string) {
    const freq = mood === 'bright' ? 3 : mood === 'neutral' ? 2 : 1;
    const layers = mood === 'bright' ? 3 : mood === 'neutral' ? 2 : 1;
    const baseColor = mood === 'bright' ? [200, 230, 255] :
                      mood === 'neutral' ? [150, 180, 200] : [80, 100, 150];

    for (let l = layers - 1; l >= 0; l--) {
        ctx.strokeStyle = `rgba(${baseColor[0]}, ${baseColor[1]}, ${baseColor[2]}, ${0.2 + l * 0.1})`;
        ctx.lineWidth = 1.5 - l * 0.3;
        ctx.beginPath();
        for (let i = 0; i <= w; i++) {
            const x = cx - w/2 + i;
            const offset = l * 0.5;
            const y = cy + Math.sin((i / w) * Math.PI * freq + offset) * h/2 * (1 - l * 0.2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}

// ============ ONEHEART/FOCUS MODE OVERLAY ============

let oneheartPhase = 0;

function drawOneheartOverlay() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;

    // Update phase for animations
    oneheartPhase += 0.005;

    // Gentle gradient background overlay
    const gradient = ctx.createLinearGradient(0, 0, 0, playableHeight);
    const breathe = 0.02 + Math.sin(oneheartPhase * 0.5) * 0.01;
    gradient.addColorStop(0, `rgba(30, 40, 60, ${breathe})`);
    gradient.addColorStop(0.5, `rgba(40, 50, 80, ${breathe * 0.5})`);
    gradient.addColorStop(1, `rgba(20, 30, 50, ${breathe})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, playableHeight);

    // Draw gentle floating orbs
    drawFloatingOrbs(playableHeight);

    // Draw breathing circle in center
    drawBreathingCircle(playableHeight);

    // Simple "Focus" label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.font = '14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Focus Mode', width / 2, playableHeight - 30);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.fillText('Tap anywhere to change chord', width / 2, playableHeight - 12);
}

function drawFloatingOrbs(playableHeight: number) {
    const orbCount = 5;

    for (let i = 0; i < orbCount; i++) {
        const phase = oneheartPhase * 0.3 + i * 1.2;
        const x = width * 0.2 + Math.sin(phase * 0.7 + i) * width * 0.3;
        const y = playableHeight * 0.3 + Math.cos(phase * 0.5 + i * 0.5) * playableHeight * 0.2;
        const radius = 30 + Math.sin(phase + i * 0.8) * 15;
        const alpha = 0.03 + Math.sin(phase * 0.8) * 0.02;

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(100, 150, 255, ${alpha * 2})`);
        gradient.addColorStop(0.5, `rgba(80, 120, 200, ${alpha})`);
        gradient.addColorStop(1, 'rgba(60, 100, 180, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawBreathingCircle(playableHeight: number) {
    const centerX = width / 2;
    const centerY = playableHeight / 2;

    // Breathing animation - slow expansion and contraction
    const breathCycle = Math.sin(oneheartPhase * 0.3);
    const baseRadius = 60;
    const radius = baseRadius + breathCycle * 20;
    const alpha = 0.05 + breathCycle * 0.02;

    // Outer glow
    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 1.5);
    gradient.addColorStop(0, `rgba(150, 180, 255, ${alpha})`);
    gradient.addColorStop(0.6, `rgba(100, 140, 220, ${alpha * 0.5})`);
    gradient.addColorStop(1, 'rgba(60, 100, 180, 0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Inner circle
    ctx.strokeStyle = `rgba(180, 200, 255, ${alpha * 2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
}

export function animate(audio: AudioEngine) {
    ctx.fillStyle = 'rgb(5, 5, 10)';
    ctx.fillRect(0, 0, width, height);

    drawSpectrogram(audio);

    // Draw mode-specific overlays (after spectrogram so they're visible)
    switch (audio.mode) {
        case 'wavetable': drawWaveformZones(audio); break;
        case 'drone': drawDroneZones(); break;
        case 'fm': drawFMZones(); break;
        case 'arpeggiator': drawArpZones(); break;
        case 'karplus': drawKarplusZones(); break;
        case 'formant': drawFormantZones(); break;
        case 'ambient': drawAmbientZones(); break;
        case 'focus':
        case 'relaxation': drawOneheartOverlay(); break;
    }

    drawGrid();
    drawRipples();
    drawCursor();

    if (cursors.size === 0 && Math.random() > 0.95) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        ctx.arc(Math.random() * width, Math.random() * height, Math.random() * 2, 0, Math.PI * 2);
        ctx.fill();
    }

    requestAnimationFrame(() => animate(audio));
}

export function getCanvasSize() {
    return { width, height };
}
