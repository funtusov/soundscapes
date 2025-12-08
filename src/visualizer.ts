/**
 * VISUAL ENGINE - Canvas rendering and spectrogram
 */

import type { AudioEngine } from './AudioEngine';

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

const SPECTROGRAM_HISTORY = 120;
const MEL_BINS = 256;

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let width = 0;
let height = 0;
const cursors = new Map<TouchId, CursorPos>();
const ripples: Ripple[] = [];
let spectrogramBuffer: Float32Array[] = [];
let melFilterbank: Float32Array[] | null = null;

// Mel scale helpers
function hzToMel(hz: number): number {
    return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
    return 700 * (Math.pow(10, mel / 2595) - 1);
}

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
            20,
            8000
        );
    }
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
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

function drawSpectrogram(audio: AudioEngine) {
    const data = audio.getAnalysis();
    if (!data) return;

    if (!melFilterbank) {
        initMelFilterbank(audio);
    }

    const melSpectrum = fftToMel(data);
    if (!melSpectrum) return;

    spectrogramBuffer.push(melSpectrum);
    if (spectrogramBuffer.length > SPECTROGRAM_HISTORY) {
        spectrogramBuffer.shift();
    }

    const colWidth = Math.ceil(width / SPECTROGRAM_HISTORY);
    const rowHeight = Math.ceil(height / MEL_BINS);

    const minVal = -90;
    const maxVal = -20;

    for (let t = 0; t < spectrogramBuffer.length; t++) {
        const frame = spectrogramBuffer[t];
        const x = Math.floor(t * width / SPECTROGRAM_HISTORY);

        for (let f = 0; f < MEL_BINS; f++) {
            let intensity = (frame[f] - minVal) / (maxVal - minVal);
            intensity = Math.max(0, Math.min(1, intensity));
            intensity = Math.pow(intensity, 0.8);

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

            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            const y = height - Math.floor((f + 1) * height / MEL_BINS);
            ctx.fillRect(x, y, colWidth, rowHeight);
        }
    }
}

function drawCursor() {
    if (cursors.size === 0) return;

    for (const [, pos] of cursors) {
        const gradient = ctx.createRadialGradient(pos.x, pos.y, 5, pos.x, pos.y, 60);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(0, 255, 204, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 255, 204, 0)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 60, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
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
        rip.r += 2;
        rip.o -= 0.02;
        if (rip.o <= 0) ripples.splice(i, 1);
    }
}

export function addRipple(x: number, y: number) {
    ripples.push({ x, y, r: 10, o: 1.0 });
}

export function setCursor(x: number, y: number, touchId: TouchId = 'mouse') {
    cursors.set(touchId, { x, y });
}

export function removeCursor(touchId: TouchId = 'mouse') {
    cursors.delete(touchId);
}

function drawWaveformZones() {
    const controlHeight = 130;
    const playableHeight = height - controlHeight;
    const zoneHeight = playableHeight / 4;

    // Zone colors (very subtle)
    const zones = [
        { name: 'SQUARE', color: 'rgba(255, 100, 100, 0.06)', drawWave: drawSquareWave },
        { name: 'SAW', color: 'rgba(255, 200, 100, 0.06)', drawWave: drawSawWave },
        { name: 'TRI', color: 'rgba(100, 255, 200, 0.06)', drawWave: drawTriWave },
        { name: 'SINE', color: 'rgba(100, 150, 255, 0.06)', drawWave: drawSineWave }
    ];

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        // Background tint
        ctx.fillStyle = zone.color;
        ctx.fillRect(0, y, width, zoneHeight);

        // Subtle divider line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + zoneHeight);
        ctx.lineTo(width, y + zoneHeight);
        ctx.stroke();

        // Draw waveform icon on the right
        zone.drawWave(width - 60, y + zoneHeight / 2, 40, 15);

        // Zone label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
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

    // Draw mode-specific overlays (after spectrogram so they're visible)
    if (audio.mode === 'wavetable') {
        drawWaveformZones();
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
