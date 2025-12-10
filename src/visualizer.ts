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
    // Canvas is already sized to exclude control bar (via CSS calc)
    // so we use the full canvas height as playable area
    const playableHeight = height;

    // Draw gradient background (morphing from sine to square, left to right)
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, 'rgba(100, 150, 255, 0.04)');    // Sine (left/low X)
    gradient.addColorStop(0.33, 'rgba(100, 255, 200, 0.04)'); // Triangle
    gradient.addColorStop(0.67, 'rgba(255, 200, 100, 0.04)'); // Saw
    gradient.addColorStop(1, 'rgba(255, 100, 100, 0.04)');    // Square (right/high X)
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, playableHeight);

    // Vertical lines: evenly spaced grid (8 divisions)
    const numVerticalLines = 8;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);

    for (let i = 1; i < numVerticalLines; i++) {
        const x = (i / numVerticalLines) * width;
        // Brighter lines at waveform zone boundaries (1/3, 2/3)
        const isZoneBoundary = Math.abs(i - numVerticalLines / 3) < 0.5 ||
                               Math.abs(i - (numVerticalLines * 2) / 3) < 0.5;
        ctx.strokeStyle = isZoneBoundary
            ? 'rgba(0, 255, 204, 0.1)'   // Zone boundaries slightly brighter
            : 'rgba(0, 255, 204, 0.04)'; // Regular grid lines darker
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, playableHeight);
        ctx.stroke();
    }

    // Horizontal lines: pitch/octave grid
    const rangeInfo = audio.getRangeInfo();
    const octaves = rangeInfo.octaves;

    // If quantized, draw lines for each scale tone (darker)
    if (audio.isQuantized) {
        const scalePattern = audio.getScalePattern();
        const notesPerOctave = scalePattern.length;
        const totalNotes = Math.ceil(octaves * notesPerOctave);

        ctx.strokeStyle = 'rgba(0, 255, 204, 0.04)';
        ctx.lineWidth = 1;

        for (let i = 1; i < totalNotes; i++) {
            const y = playableHeight - (i / totalNotes) * playableHeight;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    // Octave lines (brighter)
    ctx.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    ctx.lineWidth = 1;
    const numOctaves = Math.ceil(octaves);

    for (let i = 1; i < numOctaves; i++) {
        const y = playableHeight - (i / octaves) * playableHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        // Octave label on left edge
        ctx.fillStyle = 'rgba(0, 255, 204, 0.2)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'left';
        const octaveNum = Math.floor(Math.log2(rangeInfo.baseFreq / 16.35)) + i + 1;
        ctx.fillText(`${octaveNum}`, 5, y + 12);
    }

    // Waveform markers at morph positions (horizontal, at bottom)
    const waveforms = [
        { name: 'SINE', x: 0, drawWave: drawSineWave, color: 'rgba(100, 150, 255, 0.3)' },
        { name: 'TRI', x: width / 3, drawWave: drawTriWave, color: 'rgba(100, 255, 200, 0.3)' },
        { name: 'SAW', x: (width * 2) / 3, drawWave: drawSawWave, color: 'rgba(255, 200, 100, 0.3)' },
        { name: 'SQUARE', x: width, drawWave: drawSquareWave, color: 'rgba(255, 100, 100, 0.3)' }
    ];

    waveforms.forEach((wf) => {
        // Draw waveform icon at the bottom edge (no text labels)
        const xPos = Math.min(width - 30, Math.max(30, wf.x));
        wf.drawWave(xPos, playableHeight - 18, 40, 15);
    });
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

export function animate(audio: AudioEngine) {
    ctx.fillStyle = 'rgb(5, 5, 10)';
    ctx.fillRect(0, 0, width, height);

    drawSpectrogram(audio);

    // Draw wavetable mode overlay
    drawWaveformZones(audio);

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
