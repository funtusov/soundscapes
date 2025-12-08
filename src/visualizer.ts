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

    const minVal = SPECTROGRAM_MIN_VAL;
    const maxVal = SPECTROGRAM_MAX_VAL;

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

function drawWaveformZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
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

// ============ THEREMIN ZONES (Y = Vibrato Depth) ============
function drawThereminZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'INTENSE', color: 'rgba(255, 100, 200, 0.06)', vibrato: 'high' },
        { name: 'MODERATE', color: 'rgba(200, 150, 255, 0.06)', vibrato: 'mid' },
        { name: 'SUBTLE', color: 'rgba(150, 200, 255, 0.06)', vibrato: 'low' }
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

        // Draw vibrato wave visualization
        drawVibratoWave(width - 60, y + zoneHeight / 2, 40, 15, zone.vibrato);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawVibratoWave(cx: number, cy: number, w: number, h: number, intensity: string) {
    const freq = intensity === 'high' ? 4 : intensity === 'mid' ? 2.5 : 1.5;
    const amp = intensity === 'high' ? 1 : intensity === 'mid' ? 0.6 : 0.3;
    const color = intensity === 'high' ? 'rgba(255, 100, 200, 0.4)' :
                  intensity === 'mid' ? 'rgba(200, 150, 255, 0.35)' : 'rgba(150, 200, 255, 0.3)';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const y = cy + Math.sin((i / w) * Math.PI * freq) * h/2 * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// ============ FM ZONES (Y = Modulation Index) ============
function drawFMZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'CHAOTIC', color: 'rgba(255, 50, 150, 0.06)', complexity: 'high' },
        { name: 'RICH', color: 'rgba(255, 150, 50, 0.06)', complexity: 'mid' },
        { name: 'CLEAN', color: 'rgba(100, 200, 150, 0.06)', complexity: 'low' }
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

        // Draw FM spectrum visualization
        drawFMSpectrum(width - 60, y + zoneHeight / 2, 40, 20, zone.complexity);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawFMSpectrum(cx: number, cy: number, w: number, h: number, complexity: string) {
    const bars = complexity === 'high' ? 7 : complexity === 'mid' ? 5 : 3;
    const color = complexity === 'high' ? 'rgba(255, 50, 150, 0.4)' :
                  complexity === 'mid' ? 'rgba(255, 150, 50, 0.35)' : 'rgba(100, 200, 150, 0.3)';

    ctx.fillStyle = color;
    const barWidth = w / (bars * 2);
    const centerBar = Math.floor(bars / 2);

    for (let i = 0; i < bars; i++) {
        const dist = Math.abs(i - centerBar);
        const barH = h * (1 - dist * 0.2);
        const x = cx - w/2 + i * barWidth * 2 + barWidth/2;
        ctx.fillRect(x, cy - barH/2, barWidth, barH);
    }
}

// ============ CHORDS ZONES (Duration = Waveform Morph) ============
function drawChordsZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;

    // Light background hint for multi-touch
    ctx.fillStyle = 'rgba(100, 150, 255, 0.03)';
    ctx.fillRect(0, 0, width, playableHeight);

    // Duration indicator on left edge
    const indicatorWidth = 40;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'SAW', color: 'rgba(255, 200, 100, 0.15)', time: '>2s', drawWave: drawSawWave },
        { name: 'TRI', color: 'rgba(100, 255, 200, 0.15)', time: '0.7-2s', drawWave: drawTriWave },
        { name: 'SINE', color: 'rgba(100, 150, 255, 0.15)', time: '<0.7s', drawWave: drawSineWave }
    ];

    // Draw "HOLD" label at top
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.font = '9px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('HOLD', indicatorWidth / 2, 15);

    // Draw arrow pointing down
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(indicatorWidth / 2, 22);
    ctx.lineTo(indicatorWidth / 2, playableHeight - 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(indicatorWidth / 2 - 5, playableHeight - 30);
    ctx.lineTo(indicatorWidth / 2, playableHeight - 20);
    ctx.lineTo(indicatorWidth / 2 + 5, playableHeight - 30);
    ctx.stroke();

    zones.forEach((zone, i) => {
        const y = i * zoneHeight;

        // Small zone indicator on left
        ctx.fillStyle = zone.color;
        ctx.fillRect(5, y + 10, indicatorWidth - 10, zoneHeight - 20);

        // Waveform icon
        const waveColor = zone.name === 'SAW' ? 'rgba(255, 200, 100, 0.4)' :
                         zone.name === 'TRI' ? 'rgba(100, 255, 200, 0.4)' : 'rgba(100, 150, 255, 0.4)';
        ctx.strokeStyle = waveColor;
        zone.drawWave(indicatorWidth / 2, y + zoneHeight / 2, 20, 10);

        // Time label
        ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.font = '8px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText(zone.time, indicatorWidth / 2, y + zoneHeight / 2 + 20);
    });
}

// ============ KARPLUS-STRONG ZONES (Y = Brightness) ============
function drawKarplusZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'BRIGHT', color: 'rgba(255, 230, 100, 0.06)', material: 'steel' },
        { name: 'WARM', color: 'rgba(255, 180, 100, 0.06)', material: 'nylon' },
        { name: 'MUTED', color: 'rgba(150, 100, 180, 0.06)', material: 'gut' }
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

        // Draw string visualization
        drawStringViz(width - 60, y + zoneHeight / 2, 40, 15, zone.material);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawStringViz(cx: number, cy: number, w: number, h: number, material: string) {
    const decay = material === 'steel' ? 0.3 : material === 'nylon' ? 0.5 : 0.8;
    const color = material === 'steel' ? 'rgba(255, 230, 100, 0.4)' :
                  material === 'nylon' ? 'rgba(255, 180, 100, 0.35)' : 'rgba(150, 100, 180, 0.3)';

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= w; i++) {
        const x = cx - w/2 + i;
        const envelope = Math.exp(-i / w * 3 * decay);
        const y = cy + Math.sin((i / w) * Math.PI * 4) * h/2 * envelope;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// ============ GRANULAR ZONES (Y = Density) ============
function drawGranularZones() {
    const playableHeight = height - CONTROL_BAR_HEIGHT;
    const zoneHeight = playableHeight / 3;

    const zones = [
        { name: 'DENSE', color: 'rgba(255, 100, 255, 0.06)', density: 'high' },
        { name: 'MEDIUM', color: 'rgba(200, 150, 200, 0.06)', density: 'mid' },
        { name: 'SPARSE', color: 'rgba(150, 180, 220, 0.06)', density: 'low' }
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

        // Draw grain cloud visualization
        drawGrainCloud(width - 60, y + zoneHeight / 2, 40, 20, zone.density);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.font = '10px Courier New';
        ctx.textAlign = 'right';
        ctx.fillText(zone.name, width - 15, y + zoneHeight / 2 + 25);
    });
}

function drawGrainCloud(cx: number, cy: number, w: number, h: number, density: string) {
    const count = density === 'high' ? 12 : density === 'mid' ? 7 : 4;
    const size = density === 'high' ? 2 : density === 'mid' ? 2.5 : 3;
    const color = density === 'high' ? 'rgba(255, 100, 255, 0.5)' :
                  density === 'mid' ? 'rgba(200, 150, 200, 0.4)' : 'rgba(150, 180, 220, 0.35)';

    ctx.fillStyle = color;
    // Use deterministic positions based on density
    const seed = density === 'high' ? 1 : density === 'mid' ? 2 : 3;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + seed;
        const dist = (0.3 + (i % 3) * 0.25) * Math.min(w, h) / 2;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist * 0.6;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
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

export function animate(audio: AudioEngine) {
    ctx.fillStyle = 'rgb(5, 5, 10)';
    ctx.fillRect(0, 0, width, height);

    drawSpectrogram(audio);

    // Draw mode-specific overlays (after spectrogram so they're visible)
    switch (audio.mode) {
        case 'wavetable': drawWaveformZones(); break;
        case 'theremin': drawThereminZones(); break;
        case 'fm': drawFMZones(); break;
        case 'chords': drawChordsZones(); break;
        case 'karplus': drawKarplusZones(); break;
        case 'granular': drawGranularZones(); break;
        case 'ambient': drawAmbientZones(); break;
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
