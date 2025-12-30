/**
 * HAND CONTROLS - Webcam hand tracking
 *
 * Implementation notes:
 * - On iOS native app: Uses TrueDepth camera with Vision framework for accurate depth.
 * - On web: Uses MediaPipe Tasks Vision HandLandmarker (loaded lazily on enable).
 * - Two-hand "theremin-ish" mapping:
 *   - Left hand: resonance (height) + filter cutoff (palm orientation)
 *   - Right hand: dual-zone control + reverb (pinch)
 *     - Pad zone (close): continuous pad/swell control
 *     - Pluck zone (mid-range): hover shows target, fast pullback triggers pluck
 *       - Pullback speed determines attack sharpness
 *       - Moving forward into pad zone = pad, not pluck
 */

import type { AudioEngine } from './AudioEngine';
import { clamp } from './constants';
import { addRipple, getCanvasSize, removeCursor, setCursor } from './visualizer';

import type { HandLandmarker, HandLandmarkerResult, Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';

// Capacitor types for native plugin
interface TrueDepthHandPlugin {
    isAvailable(): Promise<{ available: boolean }>;
    start(): Promise<{ success: boolean }>;
    stop(): Promise<{ success: boolean }>;
    addListener(event: 'handUpdate', callback: (data: NativeHandUpdate) => void): Promise<{ remove: () => void }>;
}

interface NativeHandData {
    handedness?: string;
    wristX: number;
    wristY: number;
    middleMcpX: number;
    middleMcpY: number;
    indexTipX: number;
    indexTipY: number;
    thumbTipX: number;
    thumbTipY: number;
    distanceMeters: number;
    pinchRatio: number;
    palmFacing: number;
    confidence: number;
}

interface NativeHandUpdate {
    hands: NativeHandData[];
}

// Check for Capacitor native plugin
function getTrueDepthPlugin(): TrueDepthHandPlugin | null {
    const win = window as unknown as { Capacitor?: { Plugins?: { TrueDepthHand?: TrueDepthHandPlugin } } };
    return win.Capacitor?.Plugins?.TrueDepthHand ?? null;
}

const HAND_TOUCH_ID = 'hand';

// MediaPipe Hands landmark connections (index pairs).
const HAND_EDGES: ReadonlyArray<readonly [number, number]> = [
    // Thumb
    [0, 1], [1, 2], [2, 3], [3, 4],
    // Index
    [0, 5], [5, 6], [6, 7], [7, 8],
    // Middle
    [0, 9], [9, 10], [10, 11], [11, 12],
    // Ring
    [0, 13], [13, 14], [14, 15], [15, 16],
    // Pinky
    [0, 17], [17, 18], [18, 19], [19, 20],
    // Palm connections
    [5, 9], [9, 13], [13, 17], [5, 17],
] as const;

// Detect mobile for platform-specific tuning.
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Keep these pinned for reproducibility (matches package.json dependency).
const MEDIAPIPE_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Fewer frames on mobile since tracking can be spottier.
const LOST_HAND_FRAMES_TO_RELEASE = IS_MOBILE ? 4 : 6;

// Maximum pluck duration (ms) before auto-release.
const PLUCK_MAX_DURATION_MS = 120;

// Safety timeout: force release if sound plays this long without being in pad zone.
const STUCK_SOUND_TIMEOUT_MS = 500;

// Stale update timeout: force release if sound hasn't been updated in this long.
const STALE_UPDATE_TIMEOUT_MS = 200;

// EMA smoothing for position (0..1). Higher = snappier, lower = steadier.
const POS_EMA_ALPHA = 0.35;
const PALM_EMA_ALPHA = 0.25;
const RESONANCE_EMA_ALPHA = 0.25;
const REVERB_EMA_ALPHA = 0.25;

// Right-hand pinch openness → reverb (0..1)
// 0 => pinched, 1 => open pinch.
const PINCH_RATIO_REVERB_MIN = 0.25;
const PINCH_RATIO_REVERB_MAX = 0.9;

// Right-hand proximity gating (estimated from hand size in image).
// The estimate is approximate (depends on camera FOV + hand size).
const RIGHT_HAND_REF_LEN_M = 0.07; // approx wrist → middle MCP

// Platform-specific coefficients:
// - Mobile front cameras have wider FOV (~80°) vs laptops (~60°)
// - Mobile usage is typically closer, with more hand jitter
const DEFAULT_CAMERA_FOV_DEG = IS_MOBILE ? 80 : 60;

// Zone thresholds (meters):
// - Pad zone: continuous "mouse-down" control (sound plays while in-zone)
// - Pointer zone: max distance where hover pointer is shown (no sound)
const PAD_ZONE_HYSTERESIS_M = 0.02;

const DEFAULT_PAD_ZONE_ENTER_M = IS_MOBILE ? 0.15 : 0.30;
const DEFAULT_POINTER_ZONE_MAX_M = IS_MOBILE ? 0.50 : 0.60;

// X-Y mapping scale: how much of the camera view maps to the full surface.
// >1.0 means less hand movement covers full range.
// Desktop: 70% of view (1/0.7 ≈ 1.43), Mobile: 50% of view (2.0).
const DEFAULT_XY_SCALE = IS_MOBILE ? 2.0 : 1.43;
const DEFAULT_ACTIVE_FOV_PCT = Math.round(100 / DEFAULT_XY_SCALE);
const XY_CENTER_X = 0.5;
// Desktop Y center shifted down so hands don't need to be raised as much.
const XY_CENTER_Y = IS_MOBILE ? 0.5 : 0.6;

// Pluck gesture: quick pinch (thumb+index) while hovering in pointer zone.
const PLUCK_PINCH_CLOSED_RATIO = 0.35;
const PLUCK_PINCH_REARM_RATIO = 0.55;
const PLUCK_PINCH_CLOSE_MIN_PER_S = 1.5;
const PLUCK_PINCH_CLOSE_MAX_PER_S = 4.0;
const PLUCK_PINCH_VELOCITY_CURVE = 0.4;
const PLUCK_ATTACK_SLOW_S = 0.02;
const PLUCK_ATTACK_FAST_S = 0.001;
// Pluck release is short since it's a transient.
const PLUCK_RELEASE_S = 0.08;

// Entry velocity → attack shaping for pad zone (m/s → seconds).
// Mobile uses heavier smoothing (lower alpha) to reduce jitter.
const DIST_EMA_ALPHA = IS_MOBILE ? 0.25 : 0.4;
const PAD_ENTRY_VELOCITY_MIN_MPS = 0.01;
const PAD_ENTRY_VELOCITY_MAX_MPS = IS_MOBILE ? 0.35 : 0.25;
const PAD_ENTRY_VELOCITY_CURVE = 0.25;
const PAD_ENTRY_ATTACK_SLOW_S = 0.04;
const PAD_ENTRY_ATTACK_FAST_S = 0.0015;
// Heavier smoothing on mobile to reduce jitter from holding phone.
const ENTRY_VELOCITY_EMA_ALPHA = IS_MOBILE ? 0.2 : 0.3;

// Exit velocity → release shaping (m/s → seconds).
const EXIT_VELOCITY_MIN_MPS = 0.01;
const EXIT_VELOCITY_MAX_MPS = 0.25;
const EXIT_VELOCITY_CURVE = 0.25;
const EXIT_RELEASE_SLOW_S = 0.12;
const EXIT_RELEASE_FAST_S = 0.02;

type Status = 'off' | 'loading' | 'show' | 'filter' | 'sound' | 'both' | 'error';

function dist2D(a: NormalizedLandmark, b: NormalizedLandmark): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function estimateDistanceMeters(video: HTMLVideoElement, a: NormalizedLandmark, b: NormalizedLandmark, fovDeg: number): number | null {
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (w <= 0 || h <= 0) return null;

    const px = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
    if (px < 2) return null;

    const safeFovDeg = clamp(fovDeg, 20, 140);
    const fovRad = safeFovDeg * Math.PI / 180;
    const focalPx = (w / 2) / Math.tan(fovRad / 2);

    return (RIGHT_HAND_REF_LEN_M * focalPx) / px;
}

function ema(prev: number | null, next: number, alpha: number): number {
    if (prev === null) return next;
    return prev + (next - prev) * alpha;
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function sub3(a: Landmark, b: Landmark) {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function getPalmFacingScore(hand3d: Landmark[] | undefined): number | null {
    // Use world landmarks for a stable 3D estimate of palm orientation.
    if (!hand3d) return null;

    // Indices per MediaPipe Hands: 0=wrist, 5=index_mcp, 17=pinky_mcp.
    const wrist = hand3d[0];
    const indexMcp = hand3d[5];
    const pinkyMcp = hand3d[17];
    if (!wrist || !indexMcp || !pinkyMcp) return null;

    const v1 = sub3(indexMcp, wrist);
    const v2 = sub3(pinkyMcp, wrist);
    const n = cross(v1, v2);
    const mag = Math.hypot(n.x, n.y, n.z);
    if (mag < 1e-6) return null;

    // Camera space: z is depth (smaller = closer to camera).
    // |n.z|≈1 when palm faces camera; |n.z|≈0 when palm is "horizontal"/edge-on.
    return clamp(Math.abs(n.z / mag), 0, 1);
}

function createTouchSafeHandler(handler: () => void): (e: Event) => void {
    let justTouched = false;
    return (e: Event) => {
        e.stopPropagation();
        e.preventDefault();

        if (e.type === 'touchend') {
            justTouched = true;
            setTimeout(() => { justTouched = false; }, 120);
        } else if (e.type === 'click' && justTouched) {
            return;
        }

        handler();
    };
}

let handLandmarkerPromise: Promise<HandLandmarker> | null = null;
async function getHandLandmarker(): Promise<HandLandmarker> {
    if (!handLandmarkerPromise) {
        handLandmarkerPromise = (async () => {
            const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
            const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);
            return HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: HAND_LANDMARKER_MODEL_URL,
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                numHands: 2,
                minHandDetectionConfidence: 0.5,
                minHandPresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
            });
        })();
    }
    return handLandmarkerPromise;
}

export function initHandControls(audio: AudioEngine): void {
    const handBtn = document.getElementById('handBtn') as HTMLButtonElement | null;
    const handVal = document.getElementById('val-hand') as HTMLElement | null;
    if (!handBtn || !handVal) return;

    const handVizBtn = document.getElementById('handVizBtn') as HTMLButtonElement | null;
    const handVizEl = document.getElementById('handViz') as HTMLElement | null;
    const handVizCanvas = document.getElementById('handVizCanvas') as HTMLCanvasElement | null;
    const handVizLegend = document.getElementById('handVizLegend') as HTMLElement | null;

    const zonesSummary = document.getElementById('zonesSummary') as HTMLButtonElement | null;
    const zonesOptions = document.getElementById('zonesOptions') as HTMLElement | null;
    const padZoneSlider = document.getElementById('padZoneSlider') as HTMLInputElement | null;
    const padZoneValue = document.getElementById('padZoneValue') as HTMLElement | null;
    const pointerZoneSlider = document.getElementById('pointerZoneSlider') as HTMLInputElement | null;
    const pointerZoneValue = document.getElementById('pointerZoneValue') as HTMLElement | null;
    const camFovSlider = document.getElementById('camFovSlider') as HTMLInputElement | null;
    const camFovValue = document.getElementById('camFovValue') as HTMLElement | null;
    const activeFovSlider = document.getElementById('activeFovSlider') as HTMLInputElement | null;
    const activeFovValue = document.getElementById('activeFovValue') as HTMLElement | null;

    const canUseCamera = !!navigator.mediaDevices?.getUserMedia;
    if (!canUseCamera) {
        handBtn.disabled = true;
        if (handVizBtn) handVizBtn.disabled = true;
        if (zonesSummary) zonesSummary.disabled = true;
        if (padZoneSlider) padZoneSlider.disabled = true;
        if (pointerZoneSlider) pointerZoneSlider.disabled = true;
        if (camFovSlider) camFovSlider.disabled = true;
        if (activeFovSlider) activeFovSlider.disabled = true;
        handVal.textContent = 'n/a';
        return;
    }

    let vizEnabled = false;
    let handVizCtx: CanvasRenderingContext2D | null = null;

    type HandVizHand = {
        handedness?: string;
        landmarks?: NormalizedLandmark[]; // MediaPipe
        // Minimal points for native mode
        wrist?: { x: number; y: number };
        middleMcp?: { x: number; y: number };
        indexTip?: { x: number; y: number };
        thumbTip?: { x: number; y: number };
    };

    type HandVizSnapshot = {
        source: 'mediapipe' | 'native';
        hands: HandVizHand[];
        filterIndex: number | null;
        soundIndex: number | null;
        sound?: {
            inPadZone: boolean;
            inPointerZone: boolean;
            isHovering: boolean;
            distM: number | null;
            pinchRatio: number | null;
            waveX: number | null;
            pitchY: number | null;
        };
        filter?: {
            palmFacing: number | null;
            resonance: number | null;
        };
    };

    let vizSnapshot: HandVizSnapshot | null = null;

    // Configurable depth zones (meters).
    let padZoneEnterM = DEFAULT_PAD_ZONE_ENTER_M;
    let padZoneExitM = DEFAULT_PAD_ZONE_ENTER_M + PAD_ZONE_HYSTERESIS_M;
    let pointerZoneMaxM = DEFAULT_POINTER_ZONE_MAX_M;

    // Configurable camera FOV (degrees) for distance estimation.
    let cameraFovDeg = DEFAULT_CAMERA_FOV_DEG;

    // Configurable "active FOV" (how much of camera view maps to full X/Y range).
    let activeFovPct = DEFAULT_ACTIVE_FOV_PCT;
    let xyScale = DEFAULT_XY_SCALE;

    let enabled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let rafId: number | null = null;

    // Tracking state
    let soundActive = false;
    let soundInRange = false;  // In pad zone (continuous control)
    let soundStartMs = 0;
    let soundLastUpdateMs = 0;  // Last time audio.update was called
    let lostSoundFrames = 0;
    let smoothDistM: number | null = null;
    let soundPrevDistM: number | null = null;
    let soundPrevDistMs: number | null = null;
    let smoothApproachVelMps: number | null = null;

    // Pluck gesture state.
    let pluckArmed = true;  // Ready to trigger next pluck (re-arms when pinch opens)
    let inPluckMode = false;  // Currently playing a pluck (not pad)
    let inPointerHover = false;  // Hovering pointer (no sound)
    let pinchPrevRatio: number | null = null;
    let pinchPrevMs: number | null = null;

    // Smoothed point (0..1 in video coords, origin top-left)
    let smoothSoundX: number | null = null;
    let smoothSoundY: number | null = null;
    let smoothPalm: number | null = null;
    let smoothResonance: number | null = null;
    let smoothReverb: number | null = null;
    let reverbActive = false;

    // Native TrueDepth tracking state
    let usingNative = false;
    let nativeListenerRemove: (() => void) | null = null;

    const setVizEnabled = (on: boolean) => {
        vizEnabled = on;
        if (handVizBtn) handVizBtn.classList.toggle('active', on);
        if (handVizEl) {
            handVizEl.classList.toggle('hidden', !on);
            handVizEl.setAttribute('aria-hidden', String(!on));
        }
        if (!on && handVizLegend) {
            handVizLegend.textContent = '';
        }
        if (!on && handVizCanvas && handVizCtx) {
            handVizCtx.setTransform(1, 0, 0, 1, 0, 0);
            handVizCtx.clearRect(0, 0, handVizCanvas.width, handVizCanvas.height);
        }
    };

    const setStatus = (status: Status, detail?: string) => {
        const text = detail ? `${status}:${detail}` : status;
        handVal.textContent = text;
        handBtn.classList.toggle('active', enabled);
    };

    const ensureVideoElement = (): HTMLVideoElement => {
        if (video) return video;
        const el = document.createElement('video');
        el.autoplay = true;
        el.muted = true;
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        // Keep it effectively invisible but "present" (some browsers pause display:none).
        el.style.position = 'absolute';
        el.style.top = '0';
        el.style.left = '0';
        el.style.width = '1px';
        el.style.height = '1px';
        el.style.opacity = '0.0001';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '0';
        document.body.appendChild(el);
        video = el;
        return el;
    };

    const drawHandViz = () => {
        if (!vizEnabled) return;
        if (!handVizCanvas) return;

        handVizCtx = handVizCtx ?? handVizCanvas.getContext('2d');
        if (!handVizCtx) return;

        const rect = handVizCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.floor(rect.width * dpr));
        const height = Math.max(1, Math.floor(rect.height * dpr));
        if (handVizCanvas.width !== width || handVizCanvas.height !== height) {
            handVizCanvas.width = width;
            handVizCanvas.height = height;
        }

        const ctx = handVizCtx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const snapshot = vizSnapshot;

        const hasVideoFrame = !!video && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
        let offsetX = 0;
        let offsetY = 0;
        let drawW = width;
        let drawH = height;

        if (hasVideoFrame && video) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const scale = Math.min(width / vw, height / vh);
            drawW = vw * scale;
            drawH = vh * scale;
            offsetX = (width - drawW) / 2;
            offsetY = (height - drawH) / 2;

            // Draw mirrored selfie view.
            ctx.save();
            ctx.translate(offsetX + drawW, offsetY);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, drawW, drawH);
            ctx.restore();
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
            ctx.fillRect(0, 0, width, height);
        }

        const mapX = (x: number) => offsetX + (1 - x) * drawW;
        const mapY = (y: number) => offsetY + y * drawH;

        // Draw the "active" mapping region (where XY scaling won't clamp).
        const activeX0 = XY_CENTER_X * (1 - 1 / xyScale);
        const activeX1 = XY_CENTER_X + (1 - XY_CENTER_X) / xyScale;
        const activeY0 = XY_CENTER_Y * (1 - 1 / xyScale);
        const activeY1 = XY_CENTER_Y + (1 - XY_CENTER_Y) / xyScale;
        const rx0 = Math.min(mapX(activeX0), mapX(activeX1));
        const rx1 = Math.max(mapX(activeX0), mapX(activeX1));
        const ry0 = Math.min(mapY(activeY0), mapY(activeY1));
        const ry1 = Math.max(mapY(activeY0), mapY(activeY1));

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 160, 255, 0.65)';
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
        ctx.restore();

        // Draw hands (all detected + highlight controlling hands).
        if (snapshot) {
            for (let i = 0; i < snapshot.hands.length; i++) {
                const hand = snapshot.hands[i];
                const isFilter = snapshot.filterIndex === i;
                const isSound = snapshot.soundIndex === i;

                const color = isSound
                    ? { r: 255, g: 80, b: 120 }
                    : isFilter
                        ? { r: 0, g: 160, b: 255 }
                        : { r: 0, g: 255, b: 204 };

                const alpha = isFilter || isSound ? 0.95 : 0.45;
                ctx.strokeStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
                ctx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
                ctx.lineWidth = (isFilter || isSound ? 2.5 : 1.25) * dpr;

                if (hand.landmarks && hand.landmarks.length >= 21) {
                    ctx.beginPath();
                    for (const [a, b] of HAND_EDGES) {
                        const la = hand.landmarks[a];
                        const lb = hand.landmarks[b];
                        if (!la || !lb) continue;
                        ctx.moveTo(mapX(la.x), mapY(la.y));
                        ctx.lineTo(mapX(lb.x), mapY(lb.y));
                    }
                    ctx.stroke();

                    const jointRadius = (isFilter || isSound ? 3 : 2) * dpr;
                    for (const lm of hand.landmarks) {
                        ctx.beginPath();
                        ctx.arc(mapX(lm.x), mapY(lm.y), jointRadius, 0, Math.PI * 2);
                        ctx.fill();
                    }
                } else {
                    // Native (minimal points)
                    const points = [hand.wrist, hand.middleMcp, hand.indexTip, hand.thumbTip].filter(Boolean) as Array<{ x: number; y: number }>;
                    const r = (isFilter || isSound ? 4 : 3) * dpr;
                    for (const p of points) {
                        ctx.beginPath();
                        ctx.arc(mapX(p.x), mapY(p.y), r, 0, Math.PI * 2);
                        ctx.fill();
                    }

                    // Emphasize pinch line if available.
                    if (hand.thumbTip && hand.indexTip) {
                        ctx.save();
                        ctx.strokeStyle = `rgba(255, 255, 255, ${isSound ? 0.8 : 0.4})`;
                        ctx.lineWidth = 2 * dpr;
                        ctx.beginPath();
                        ctx.moveTo(mapX(hand.thumbTip.x), mapY(hand.thumbTip.y));
                        ctx.lineTo(mapX(hand.indexTip.x), mapY(hand.indexTip.y));
                        ctx.stroke();
                        ctx.restore();
                    }
                }
            }

            // Overlay: highlight the sound hand control point + current zone.
            if (snapshot.soundIndex !== null && snapshot.soundIndex >= 0 && snapshot.soundIndex < snapshot.hands.length) {
                const soundHand = snapshot.hands[snapshot.soundIndex];
                let controlPoint: { x: number; y: number } | null = null;
                let thumb: { x: number; y: number } | null = null;
                let index: { x: number; y: number } | null = null;

                if (soundHand.landmarks && soundHand.landmarks.length >= 21) {
                    const mcp = soundHand.landmarks[9];
                    if (mcp) controlPoint = { x: mcp.x, y: mcp.y };
                    const t = soundHand.landmarks[4];
                    const i = soundHand.landmarks[8];
                    if (t) thumb = { x: t.x, y: t.y };
                    if (i) index = { x: i.x, y: i.y };
                } else if (soundHand.middleMcp) {
                    controlPoint = soundHand.middleMcp;
                    thumb = soundHand.thumbTip ?? null;
                    index = soundHand.indexTip ?? null;
                }

                if (controlPoint) {
                    const zone = snapshot.sound;
                    const zoneColor = zone?.inPadZone
                        ? 'rgba(0, 255, 120, 0.95)'
                        : zone?.inPointerZone
                            ? 'rgba(255, 220, 0, 0.95)'
                            : 'rgba(255, 255, 255, 0.5)';

                    ctx.save();
                    ctx.strokeStyle = zoneColor;
                    ctx.lineWidth = 3 * dpr;
                    ctx.setLineDash(zone?.inPointerZone && zone?.isHovering ? [6 * dpr, 6 * dpr] : []);
                    ctx.beginPath();
                    ctx.arc(mapX(controlPoint.x), mapY(controlPoint.y), 12 * dpr, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();

                    // Show the clamped/scaled position actually used for synthesis.
                    const waveX = zone?.waveX;
                    const pitchY = zone?.pitchY;
                    if (waveX !== null && waveX !== undefined && pitchY !== null && pitchY !== undefined) {
                        const usedX = clamp(1 - waveX, 0, 1);
                        const usedY = clamp(1 - pitchY, 0, 1);
                        ctx.save();
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                        ctx.lineWidth = 2 * dpr;
                        const px = mapX(usedX);
                        const py = mapY(usedY);
                        const s = 8 * dpr;
                        ctx.beginPath();
                        ctx.moveTo(px - s, py);
                        ctx.lineTo(px + s, py);
                        ctx.moveTo(px, py - s);
                        ctx.lineTo(px, py + s);
                        ctx.stroke();
                        ctx.restore();
                    }
                }

                // Pinch line emphasis (gesture).
                if (thumb && index) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                    ctx.lineWidth = 2.5 * dpr;
                    ctx.beginPath();
                    ctx.moveTo(mapX(thumb.x), mapY(thumb.y));
                    ctx.lineTo(mapX(index.x), mapY(index.y));
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // Overlay: highlight the filter hand (wrist point).
            if (snapshot.filterIndex !== null && snapshot.filterIndex >= 0 && snapshot.filterIndex < snapshot.hands.length) {
                const filterHand = snapshot.hands[snapshot.filterIndex];
                let wrist: { x: number; y: number } | null = null;

                if (filterHand.landmarks && filterHand.landmarks.length >= 1) {
                    const w = filterHand.landmarks[0];
                    if (w) wrist = { x: w.x, y: w.y };
                } else if (filterHand.wrist) {
                    wrist = filterHand.wrist;
                }

                if (wrist) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(0, 160, 255, 0.95)';
                    ctx.lineWidth = 3 * dpr;
                    ctx.beginPath();
                    ctx.arc(mapX(wrist.x), mapY(wrist.y), 10 * dpr, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
            }
        }

        if (handVizLegend) {
            const handsCount = snapshot?.hands.length ?? 0;
            const filterIndex = snapshot?.filterIndex ?? null;
            const soundIndex = snapshot?.soundIndex ?? null;
            const filterName = filterIndex !== null && filterIndex >= 0 && filterIndex < handsCount
                ? (snapshot?.hands[filterIndex]?.handedness ?? 'hand')
                : '--';
            const soundName = soundIndex !== null && soundIndex >= 0 && soundIndex < handsCount
                ? (snapshot?.hands[soundIndex]?.handedness ?? 'hand')
                : '--';
            const palmText = snapshot?.filter?.palmFacing !== null && snapshot?.filter?.palmFacing !== undefined
                ? `palm ${snapshot.filter.palmFacing.toFixed(2)}`
                : 'palm --';
            const resText = snapshot?.filter?.resonance !== null && snapshot?.filter?.resonance !== undefined
                ? `res ${snapshot.filter.resonance.toFixed(2)}`
                : 'res --';

            const modeLabel = usingNative ? 'native' : 'web';
            const zoneLabel = snapshot?.sound?.inPadZone
                ? 'PAD'
                : snapshot?.sound?.inPointerZone
                    ? (snapshot.sound.isHovering ? 'PTR*' : 'PTR')
                    : '--';
            const distText = snapshot?.sound?.distM !== null && snapshot?.sound?.distM !== undefined
                ? `${Math.round(snapshot.sound.distM * 100)}cm`
                : '--';
            const pinchText = snapshot?.sound?.pinchRatio !== null && snapshot?.sound?.pinchRatio !== undefined
                ? `pinch ${snapshot.sound.pinchRatio.toFixed(2)}`
                : 'pinch --';

            const padText = `pad≤${Math.round(padZoneEnterM * 100)}cm`;
            const ptrText = `ptr≤${Math.round(pointerZoneMaxM * 100)}cm`;
            const camFovText = `${Math.round(cameraFovDeg)}°`;
            const activeFovText = `${Math.round(activeFovPct)}%`;

            handVizLegend.innerHTML = `<span>${modeLabel} · hands ${handsCount} · F ${filterName} · S ${soundName} · ${palmText} · ${resText}</span><span>${soundActive ? 'on' : 'off'} · ${zoneLabel} · ${distText} · ${padText} · ${ptrText} · cam ${camFovText} · active ${activeFovText} · ${pinchText}</span>`;
        }
    };

    const setZoneSettings = (padCm: number, pointerCm: number) => {
        const padClamped = clamp(padCm, 20, 60);
        const pointerClamped = clamp(pointerCm, 40, 80);

        padZoneEnterM = padClamped / 100;
        padZoneExitM = padZoneEnterM + PAD_ZONE_HYSTERESIS_M;
        pointerZoneMaxM = pointerClamped / 100;

        if (padZoneSlider) padZoneSlider.value = String(Math.round(padClamped));
        if (pointerZoneSlider) pointerZoneSlider.value = String(Math.round(pointerClamped));
        if (padZoneValue) padZoneValue.textContent = `${Math.round(padClamped)}cm`;
        if (pointerZoneValue) pointerZoneValue.textContent = `${Math.round(pointerClamped)}cm`;
        if (zonesSummary) zonesSummary.textContent = `Zones ${Math.round(padClamped)}/${Math.round(pointerClamped)}`;

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const setCameraFov = (deg: number) => {
        const fovClamped = clamp(deg, 40, 100);
        cameraFovDeg = fovClamped;

        if (camFovSlider) camFovSlider.value = String(Math.round(fovClamped));
        if (camFovValue) camFovValue.textContent = `${Math.round(fovClamped)}°`;

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const setActiveFov = (pct: number) => {
        const pctClamped = clamp(pct, 30, 100);
        activeFovPct = pctClamped;
        xyScale = 100 / pctClamped;

        if (activeFovSlider) activeFovSlider.value = String(Math.round(pctClamped));
        if (activeFovValue) activeFovValue.textContent = `${Math.round(pctClamped)}%`;

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const initZoneControls = () => {
        if (!zonesSummary || !zonesOptions || !padZoneSlider || !pointerZoneSlider) return;

        const positionZones = () => {
            const rect = zonesSummary.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const bottomPx = window.innerHeight - rect.top + 8;
            zonesOptions.style.left = `${centerX}px`;
            zonesOptions.style.bottom = `${bottomPx}px`;
        };

        const closeZones = () => {
            zonesOptions.classList.remove('expanded');
            zonesSummary.classList.remove('active');
        };

        const toggleZones = () => {
            const isOpen = zonesOptions.classList.contains('expanded');
            if (isOpen) {
                closeZones();
                return;
            }

            positionZones();
            zonesOptions.classList.add('expanded');
            zonesSummary.classList.add('active');
        };

        const toggleHandler = createTouchSafeHandler(toggleZones);
        zonesSummary.addEventListener('click', toggleHandler);
        zonesSummary.addEventListener('touchend', toggleHandler);

        // Prevent clicks on options panel from propagating to canvas
        zonesOptions.addEventListener('click', (e) => e.stopPropagation());
        zonesOptions.addEventListener('touchstart', (e) => e.stopPropagation());
        zonesOptions.addEventListener('touchend', (e) => e.stopPropagation());

        // Close options when clicking elsewhere
        document.addEventListener('click', (e) => {
            const target = e.target as Node;
            if (!zonesOptions.contains(target) && !zonesSummary.contains(target)) {
                closeZones();
            }
        });

        window.addEventListener('resize', () => {
            if (zonesOptions.classList.contains('expanded')) {
                positionZones();
            }
        });

        padZoneSlider.addEventListener('input', () => {
            setZoneSettings(parseInt(padZoneSlider.value, 10), parseInt(pointerZoneSlider.value, 10));
        });

        pointerZoneSlider.addEventListener('input', () => {
            setZoneSettings(parseInt(padZoneSlider.value, 10), parseInt(pointerZoneSlider.value, 10));
        });

        if (camFovSlider) {
            camFovSlider.addEventListener('input', () => {
                setCameraFov(parseInt(camFovSlider.value, 10));
            });
        }

        if (activeFovSlider) {
            activeFovSlider.addEventListener('input', () => {
                setActiveFov(parseInt(activeFovSlider.value, 10));
            });
        }

        // Initialize from defaults (clamped to slider min/max).
        setZoneSettings(Math.round(DEFAULT_PAD_ZONE_ENTER_M * 100), Math.round(DEFAULT_POINTER_ZONE_MAX_M * 100));
        setCameraFov(DEFAULT_CAMERA_FOV_DEG);
        setActiveFov(DEFAULT_ACTIVE_FOV_PCT);
    };

    initZoneControls();

    const stopHandVoice = (releaseSeconds?: number) => {
        if (!soundActive) return;
        if (releaseSeconds !== undefined) {
            audio.setHandReleaseSeconds(releaseSeconds);
        }
        const duration = (Date.now() - soundStartMs) / 1000;
        audio.stop(HAND_TOUCH_ID, duration, { applyReleaseEnvelope: false });
        soundActive = false;
        soundInRange = false;
        inPluckMode = false;
        inPointerHover = false;
        removeCursor(HAND_TOUCH_ID);
    };

    /**
     * Process hand data from native TrueDepth plugin.
     * Maps native data to the same control logic as MediaPipe.
     */
    const processNativeUpdate = (data: NativeHandUpdate) => {
        const nowMs = performance.now();
        const hands = data.hands;

        // Debug snapshot scalars
        let inPadZone = false;
        let inPointerZone = false;
        let isHovering = false;
        let gateDistM: number | null = null;
        let soundWaveX: number | null = null;
        let soundPitchY: number | null = null;
        let soundPinchRatio: number | null = null;

        // Find left and right hands
        const left = hands.find(h => h.handedness === 'Left') ?? null;
        const right = hands.find(h => h.handedness === 'Right') ?? null;

        let filterHand = left;
        let soundHand = right;

        // Fallback if handedness not detected
        if (!filterHand && !soundHand && hands.length > 0) {
            if (hands.length === 1) {
                soundHand = hands[0];
            } else {
                const sorted = [...hands].sort((a, b) => a.wristX - b.wristX);
                filterHand = sorted[0];
                soundHand = sorted[sorted.length - 1];
            }
        }

        const hasFilter = !!filterHand;
        const hasSound = !!soundHand;
        let soundDistM: number | null = null;

        // Left hand: resonance (height) + palm orientation → filter cutoff
        if (filterHand) {
            const rawRes = clamp(1 - filterHand.wristY, 0, 1);
            smoothResonance = ema(smoothResonance, rawRes, RESONANCE_EMA_ALPHA);
            audio.setHandFilterQ(smoothResonance);

            if (filterHand.palmFacing >= 0) {
                smoothPalm = ema(smoothPalm, filterHand.palmFacing, PALM_EMA_ALPHA);
                audio.setHandFilterMod(smoothPalm);
            }
        }

        // Right hand: zone control + reverb
        if (soundHand) {
            const middleMcpX = soundHand.middleMcpX;
            const middleMcpY = soundHand.middleMcpY;

            smoothSoundX = ema(smoothSoundX, middleMcpX, POS_EMA_ALPHA);
            smoothSoundY = ema(smoothSoundY, middleMcpY, POS_EMA_ALPHA);

            // Apply X-Y scaling and offset (mirror X for selfie view)
            const scaledX = XY_CENTER_X + ((smoothSoundX ?? middleMcpX) - XY_CENTER_X) * xyScale;
            const scaledY = XY_CENTER_Y + ((smoothSoundY ?? middleMcpY) - XY_CENTER_Y) * xyScale;
            const waveX = clamp(1 - scaledX, 0, 1);
            const pitchY = clamp(1 - scaledY, 0, 1);
            soundWaveX = waveX;
            soundPitchY = pitchY;

            // Use native depth (already in meters) - much more accurate than MediaPipe estimate
            soundDistM = soundHand.distanceMeters > 0 ? soundHand.distanceMeters : null;
            if (soundDistM !== null) {
                smoothDistM = ema(smoothDistM, soundDistM, DIST_EMA_ALPHA);
            }
            const gateDist = smoothDistM ?? soundDistM;
            gateDistM = gateDist;

            // Determine zones (depth in meters)
            inPadZone = gateDist === null
                ? soundInRange
                : (soundInRange ? gateDist <= padZoneExitM : gateDist <= padZoneEnterM);
            inPointerZone = gateDist === null
                ? soundInRange
                : gateDist <= pointerZoneMaxM;

            // Estimate approach speed from depth delta
            let approachVelNowMps = smoothApproachVelMps ?? 0;
            if (soundDistM !== null) {
                if (soundPrevDistM !== null && soundPrevDistMs !== null) {
                    const dt = (nowMs - soundPrevDistMs) / 1000;
                    if (dt > 0.001) {
                        const approachVel = (soundPrevDistM - soundDistM) / dt;
                        approachVelNowMps = approachVel;
                        smoothApproachVelMps = ema(smoothApproachVelMps, approachVel, ENTRY_VELOCITY_EMA_ALPHA);
                    }
                }
                soundPrevDistM = soundDistM;
                soundPrevDistMs = nowMs;
            }

            // Pinch controls reverb (native provides pinchRatio directly)
            soundPinchRatio = soundHand.pinchRatio;
            const reverbRaw = clamp(
                (soundHand.pinchRatio - PINCH_RATIO_REVERB_MIN) / (PINCH_RATIO_REVERB_MAX - PINCH_RATIO_REVERB_MIN),
                0,
                1
            );
            smoothReverb = ema(smoothReverb, reverbRaw, REVERB_EMA_ALPHA);

            const wetT = smoothReverb ?? 0;
            const wet = clamp(wetT * wetT * 0.85, 0, 0.85);
            const wantsReverb = wet > 0.01;

            if (wantsReverb && !reverbActive) {
                audio.setReverbLevel('on');
                reverbActive = true;
            } else if (!wantsReverb && reverbActive) {
                audio.setReverbLevel('off');
                reverbActive = false;
            }

            if (reverbActive) {
                const dry = 1 - wet * 0.4;
                audio.setReverbParams(0, wet, dry);
            }

            // Pinch velocity (ratio units per second). Positive = closing.
            let pinchCloseVelPerS = 0;
            if (pinchPrevRatio !== null && pinchPrevMs !== null) {
                const dt = (nowMs - pinchPrevMs) / 1000;
                if (dt > 0.001) {
                    pinchCloseVelPerS = (pinchPrevRatio - soundHand.pinchRatio) / dt;
                }
            }
            pinchPrevRatio = soundHand.pinchRatio;
            pinchPrevMs = nowMs;

            // Re-arm pluck when pinch opens.
            if (!pluckArmed && soundHand.pinchRatio >= PLUCK_PINCH_REARM_RATIO) {
                pluckArmed = true;
            }

            const wantsHover = inPointerZone && !inPadZone && !soundActive;
            if (wantsHover) {
                isHovering = true;
                if (!inPointerHover) {
                    inPointerHover = true;
                }

                const { width, height } = getCanvasSize();
                setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);

                const wantsPluck = pluckArmed
                    && soundHand.pinchRatio <= PLUCK_PINCH_CLOSED_RATIO
                    && pinchCloseVelPerS >= PLUCK_PINCH_CLOSE_MIN_PER_S;

                if (wantsPluck) {
                    pluckArmed = false;
                    inPluckMode = true;
                    inPointerHover = false;
                    isHovering = false;

                    const tLinear = clamp(
                        (pinchCloseVelPerS - PLUCK_PINCH_CLOSE_MIN_PER_S) / (PLUCK_PINCH_CLOSE_MAX_PER_S - PLUCK_PINCH_CLOSE_MIN_PER_S),
                        0,
                        1
                    );
                    const t = Math.pow(tLinear, PLUCK_PINCH_VELOCITY_CURVE);
                    const attack = PLUCK_ATTACK_SLOW_S * (1 - t) + PLUCK_ATTACK_FAST_S * t;
                    audio.setHandAttackSeconds(attack);
                    audio.setHandReleaseSeconds(PLUCK_RELEASE_S);

                    soundActive = true;
                    soundStartMs = Date.now();
                    soundLastUpdateMs = Date.now();
                    audio.start(HAND_TOUCH_ID);
                    audio.update(waveX, pitchY, HAND_TOUCH_ID, 0);

                    addRipple(waveX * width, (1 - pitchY) * height);
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
                }
            } else if (inPointerHover && !wantsHover) {
                inPointerHover = false;
                if (!soundActive) {
                    removeCursor(HAND_TOUCH_ID);
                }
            }

            // Auto-release pluck after max duration
            if (inPluckMode && soundActive) {
                const pluckDuration = Date.now() - soundStartMs;
                if (pluckDuration >= PLUCK_MAX_DURATION_MS) {
                    stopHandVoice(PLUCK_RELEASE_S);
                }
            }

            // Handle pad zone: continuous control
            if (inPadZone) {
                inPluckMode = false;
                inPointerHover = false;

                if (!soundInRange) {
                    soundInRange = true;
                    const v = Math.max(0, Math.max(smoothApproachVelMps ?? 0, approachVelNowMps));
                    const tLinear = clamp(
                        (v - PAD_ENTRY_VELOCITY_MIN_MPS) / (PAD_ENTRY_VELOCITY_MAX_MPS - PAD_ENTRY_VELOCITY_MIN_MPS),
                        0,
                        1
                    );
                    const t = Math.pow(tLinear, PAD_ENTRY_VELOCITY_CURVE);
                    const attack = PAD_ENTRY_ATTACK_SLOW_S * (1 - t) + PAD_ENTRY_ATTACK_FAST_S * t;
                    audio.setHandAttackSeconds(attack);
                    const { width, height } = getCanvasSize();
                    addRipple(waveX * width, (1 - pitchY) * height);
                }

                if (!soundActive) {
                    soundActive = true;
                    soundStartMs = Date.now();
                    audio.start(HAND_TOUCH_ID);
                }

                const duration = (Date.now() - soundStartMs) / 1000;
                audio.update(waveX, pitchY, HAND_TOUCH_ID, duration);
                soundLastUpdateMs = Date.now();

                const { width, height } = getCanvasSize();
                setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
            } else if (!inPadZone && soundInRange) {
                const vOut = Math.max(0, Math.max(-(smoothApproachVelMps ?? 0), -approachVelNowMps));
                const tLinear = clamp(
                    (vOut - EXIT_VELOCITY_MIN_MPS) / (EXIT_VELOCITY_MAX_MPS - EXIT_VELOCITY_MIN_MPS),
                    0,
                    1
                );
                const t = Math.pow(tLinear, EXIT_VELOCITY_CURVE);
                const release = EXIT_RELEASE_SLOW_S * (1 - t) + EXIT_RELEASE_FAST_S * t;
                soundInRange = false;
                if (soundActive) {
                    stopHandVoice(release);
                }

                // If we're still within pointer zone, fall back to hover pointer.
                if (inPointerZone && !soundActive) {
                    isHovering = true;
                    inPointerHover = true;
                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
                }
            }

            lostSoundFrames = 0;
        } else {
            lostSoundFrames += 1;
        }

        if (lostSoundFrames >= LOST_HAND_FRAMES_TO_RELEASE) {
            stopHandVoice();
        }

        // Safety: force release if sound is stuck
        if (soundActive && !soundInRange) {
            const stuckDuration = Date.now() - soundStartMs;
            if (stuckDuration >= STUCK_SOUND_TIMEOUT_MS) {
                stopHandVoice(PLUCK_RELEASE_S);
            }
        }

        if (soundActive && soundLastUpdateMs > 0) {
            const staleDuration = Date.now() - soundLastUpdateMs;
            if (staleDuration >= STALE_UPDATE_TIMEOUT_MS) {
                stopHandVoice(PLUCK_RELEASE_S);
            }
        }

        // Update status display
        const distSuffix = soundDistM !== null && isFinite(soundDistM)
            ? `d=${(soundDistM * 100).toFixed(0)}cm`
            : undefined;
        if (!hasFilter && !hasSound) setStatus('show');
        else if (hasFilter && hasSound) setStatus('both', distSuffix);
        else if (hasFilter) setStatus('filter');
        else setStatus('sound', distSuffix);

        if (vizEnabled) {
            const filterIndex = filterHand ? hands.indexOf(filterHand) : null;
            const soundIndex = soundHand ? hands.indexOf(soundHand) : null;
            const vizHands: HandVizHand[] = hands.map(h => ({
                handedness: h.handedness,
                wrist: { x: h.wristX, y: h.wristY },
                middleMcp: { x: h.middleMcpX, y: h.middleMcpY },
                indexTip: { x: h.indexTipX, y: h.indexTipY },
                thumbTip: { x: h.thumbTipX, y: h.thumbTipY },
            }));

            vizSnapshot = {
                source: 'native',
                hands: vizHands,
                filterIndex,
                soundIndex,
                sound: {
                    inPadZone,
                    inPointerZone,
                    isHovering,
                    distM: gateDistM,
                    pinchRatio: soundPinchRatio,
                    waveX: soundWaveX,
                    pitchY: soundPitchY,
                },
                filter: {
                    palmFacing: smoothPalm,
                    resonance: smoothResonance,
                }
            };
        }

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const teardownCamera = () => {
        setVizEnabled(false);
        vizSnapshot = null;
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        stopHandVoice();

        // Clean up native listener
        if (nativeListenerRemove) {
            nativeListenerRemove();
            nativeListenerRemove = null;
        }

        if (video) {
            try { video.pause(); } catch { /* ignore */ }
            // Keep element around (reused) but detach stream.
            video.srcObject = null;
        }

        if (stream) {
            for (const track of stream.getTracks()) {
                try { track.stop(); } catch { /* ignore */ }
            }
            stream = null;
        }

        smoothSoundX = null;
        smoothSoundY = null;
        smoothPalm = null;
        smoothResonance = null;
        smoothReverb = null;
        reverbActive = false;
        soundInRange = false;
        smoothDistM = null;
        soundPrevDistM = null;
        soundPrevDistMs = null;
        smoothApproachVelMps = null;
        lostSoundFrames = 0;
        pluckArmed = true;
        inPluckMode = false;
        inPointerHover = false;
        pinchPrevRatio = null;
        pinchPrevMs = null;
        soundLastUpdateMs = 0;
        usingNative = false;
    };

    const startCamera = async () => {
        // Prefer selfie camera for "instrument" feel.
        stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: 'user',
                width: { ideal: 640 },
                height: { ideal: 480 },
            }
        });

        const el = ensureVideoElement();
        el.srcObject = stream;
        await el.play();
    };

    const updateFromResult = (result: HandLandmarkerResult) => {
        type Hand = {
            handedness?: string;
            landmarks: NormalizedLandmark[];
            worldLandmarks?: Landmark[];
            wristX: number;
        };

        const nowMs = performance.now();

        const hands: Hand[] = [];
        for (let i = 0; i < result.landmarks.length; i++) {
            const lm = result.landmarks[i];
            if (!lm || lm.length === 0) continue;
            hands.push({
                handedness: result.handedness?.[i]?.[0]?.categoryName,
                landmarks: lm,
                worldLandmarks: result.worldLandmarks?.[i],
                wristX: lm[0]?.x ?? 0.5,
            });
        }

        const left = hands.find(h => h.handedness === 'Left') ?? null;
        const right = hands.find(h => h.handedness === 'Right') ?? null;

        let filterHand: Hand | null = left;
        let soundHand: Hand | null = right;

        // Fallback assignment:
        // - If handedness is missing, use a stable left-to-right ordering.
        if (!filterHand && !soundHand) {
            if (hands.length === 1) {
                soundHand = hands[0];
            } else if (hands.length >= 2) {
                const sorted = [...hands].sort((a, b) => a.wristX - b.wristX);
                filterHand = sorted[0];
                soundHand = sorted[sorted.length - 1];
            }
        } else {
            const unassigned = hands
                .filter(h => h !== filterHand && h !== soundHand)
                .sort((a, b) => a.wristX - b.wristX);

            if (!filterHand && unassigned.length > 0) {
                filterHand = unassigned[0];
            }
            if (!soundHand && unassigned.length > 0) {
                soundHand = unassigned[unassigned.length - 1];
            }
        }

        const hasFilter = !!filterHand;
        const hasSound = !!soundHand;
        let soundDistM: number | null = null;
        // Debug snapshot scalars
        let vizGateDistM: number | null = null;
        let vizInPadZone = false;
        let vizInPointerZone = false;
        let vizIsHovering = false;
        let vizPinchRatio: number | null = null;
        let vizWaveX: number | null = null;
        let vizPitchY: number | null = null;

        // Left hand: resonance (height) + palm orientation → filter cutoff.
        if (filterHand) {
            const wrist2d = filterHand.landmarks[0];
            if (wrist2d) {
                // Higher hand => higher resonance.
                const rawRes = clamp(1 - wrist2d.y, 0, 1);
                smoothResonance = ema(smoothResonance, rawRes, RESONANCE_EMA_ALPHA);
                audio.setHandFilterQ(smoothResonance);
            }

            const palmFacing = getPalmFacingScore(filterHand.worldLandmarks);
            if (palmFacing !== null) {
                smoothPalm = ema(smoothPalm, palmFacing, PALM_EMA_ALPHA);
                audio.setHandFilterMod(smoothPalm);
            }
        }

        // Right hand control zones:
        // - Pad zone (within 30cm): continuous pad/swell control
        // - Pluck zone (35-50cm): fast jabs trigger single plucks
        // Also: pinch openness controls reverb.
        if (soundHand) {
            const thumbTip = soundHand.landmarks[4];
            const indexTip = soundHand.landmarks[8];
            const wrist2d = soundHand.landmarks[0];
            const middleMcp = soundHand.landmarks[9];

            if (thumbTip && indexTip && wrist2d && middleMcp) {
                // Use a stable palm point for position controls (so pinching doesn't shift pitch/shape too much).
                smoothSoundX = ema(smoothSoundX, middleMcp.x, POS_EMA_ALPHA);
                smoothSoundY = ema(smoothSoundY, middleMcp.y, POS_EMA_ALPHA);

                // Mirror X to match selfie camera; apply X-Y scaling and offset.
                const scaledX = XY_CENTER_X + (smoothSoundX - XY_CENTER_X) * xyScale;
                const scaledY = XY_CENTER_Y + (smoothSoundY - XY_CENTER_Y) * xyScale;
                const waveX = clamp(1 - scaledX, 0, 1);
                const pitchY = clamp(1 - scaledY, 0, 1);
                vizWaveX = waveX;
                vizPitchY = pitchY;

                soundDistM = video ? estimateDistanceMeters(video, wrist2d, middleMcp, cameraFovDeg) : null;
                if (soundDistM !== null) {
                    smoothDistM = ema(smoothDistM, soundDistM, DIST_EMA_ALPHA);
                }
                const gateDist = smoothDistM ?? soundDistM;
                vizGateDistM = gateDist;

                // Determine which zone the hand is in.
                const inPadZone = gateDist === null
                    ? soundInRange
                    : (soundInRange ? gateDist <= padZoneExitM : gateDist <= padZoneEnterM);
                const inPointerZone = gateDist === null
                    ? soundInRange
                    : gateDist <= pointerZoneMaxM;
                vizInPadZone = inPadZone;
                vizInPointerZone = inPointerZone;

                // Estimate approach speed (m/s) from distance delta; positive means moving closer.
                let approachVelNowMps = smoothApproachVelMps ?? 0;
                if (soundDistM !== null) {
                    if (soundPrevDistM !== null && soundPrevDistMs !== null) {
                        const dt = (nowMs - soundPrevDistMs) / 1000;
                        if (dt > 0.001) {
                            const approachVel = (soundPrevDistM - soundDistM) / dt;
                            approachVelNowMps = approachVel;
                            smoothApproachVelMps = ema(smoothApproachVelMps, approachVel, ENTRY_VELOCITY_EMA_ALPHA);
                        }
                    }
                    soundPrevDistM = soundDistM;
                    soundPrevDistMs = nowMs;
                }

                const handScale = Math.max(0.0001, dist2D(wrist2d, middleMcp));
                const pinchRatio = dist2D(thumbTip, indexTip) / handScale;
                vizPinchRatio = pinchRatio;
                const reverbRaw = clamp(
                    (pinchRatio - PINCH_RATIO_REVERB_MIN) / (PINCH_RATIO_REVERB_MAX - PINCH_RATIO_REVERB_MIN),
                    0,
                    1
                );
                smoothReverb = ema(smoothReverb, reverbRaw, REVERB_EMA_ALPHA);

                // Pinch controls reverb amount (wetness). Curve gives more precision at low values.
                const wetT = smoothReverb ?? 0;
                const wet = clamp(wetT * wetT * 0.85, 0, 0.85);
                const wantsReverb = wet > 0.01;

                if (wantsReverb && !reverbActive) {
                    audio.setReverbLevel('on');
                    reverbActive = true;
                } else if (!wantsReverb && reverbActive) {
                    audio.setReverbLevel('off');
                    reverbActive = false;
                }

                if (reverbActive) {
                    const dry = 1 - wet * 0.4;
                    audio.setReverbParams(0, wet, dry);
                }

                // Pinch velocity (ratio units per second). Positive = closing.
                let pinchCloseVelPerS = 0;
                if (pinchPrevRatio !== null && pinchPrevMs !== null) {
                    const dt = (nowMs - pinchPrevMs) / 1000;
                    if (dt > 0.001) {
                        pinchCloseVelPerS = (pinchPrevRatio - pinchRatio) / dt;
                    }
                }
                pinchPrevRatio = pinchRatio;
                pinchPrevMs = nowMs;

                // Re-arm pluck when pinch opens.
                if (!pluckArmed && pinchRatio >= PLUCK_PINCH_REARM_RATIO) {
                    pluckArmed = true;
                }

                const wantsHover = inPointerZone && !soundActive && !inPadZone;
                if (wantsHover) {
                    vizIsHovering = true;
                    if (!inPointerHover) {
                        inPointerHover = true;
                    }
                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);  // hover = true

                    const wantsPluck = pluckArmed
                        && pinchRatio <= PLUCK_PINCH_CLOSED_RATIO
                        && pinchCloseVelPerS >= PLUCK_PINCH_CLOSE_MIN_PER_S;

                    if (wantsPluck) {
                        pluckArmed = false;
                        inPluckMode = true;
                        inPointerHover = false;
                        vizIsHovering = false;

                        // Velocity-dependent attack shaping (faster pinch close = sharper attack).
                        const tLinear = clamp(
                            (pinchCloseVelPerS - PLUCK_PINCH_CLOSE_MIN_PER_S) / (PLUCK_PINCH_CLOSE_MAX_PER_S - PLUCK_PINCH_CLOSE_MIN_PER_S),
                            0,
                            1
                        );
                        const t = Math.pow(tLinear, PLUCK_PINCH_VELOCITY_CURVE);
                        const attack = PLUCK_ATTACK_SLOW_S * (1 - t) + PLUCK_ATTACK_FAST_S * t;
                        audio.setHandAttackSeconds(attack);
                        audio.setHandReleaseSeconds(PLUCK_RELEASE_S);

                        // Play pluck note.
                        soundActive = true;
                        soundStartMs = Date.now();
                        soundLastUpdateMs = Date.now();
                        audio.start(HAND_TOUCH_ID);
                        audio.update(waveX, pitchY, HAND_TOUCH_ID, 0);

                        addRipple(waveX * width, (1 - pitchY) * height);
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);  // Switch to active cursor
                    }
                } else if (inPointerHover && !wantsHover) {
                    // Exited pointer zone without plucking.
                    inPointerHover = false;
                    if (!soundActive) {
                        removeCursor(HAND_TOUCH_ID);
                    }
                }

                // Auto-release pluck after max duration.
                if (inPluckMode && soundActive) {
                    const pluckDuration = Date.now() - soundStartMs;
                    if (pluckDuration >= PLUCK_MAX_DURATION_MS) {
                        stopHandVoice(PLUCK_RELEASE_S);
                    }
                }

                // Handle pad zone: continuous control.
                if (inPadZone) {
                    // Clear pluck mode and hover when entering pad zone.
                    inPluckMode = false;
                    inPointerHover = false;

                    // Entering pad zone from outside.
                    if (!soundInRange) {
                        soundInRange = true;
                        // Velocity-dependent attack shaping for smooth entry.
                        const v = Math.max(0, Math.max(smoothApproachVelMps ?? 0, approachVelNowMps));
                        const tLinear = clamp(
                            (v - PAD_ENTRY_VELOCITY_MIN_MPS) / (PAD_ENTRY_VELOCITY_MAX_MPS - PAD_ENTRY_VELOCITY_MIN_MPS),
                            0,
                            1
                        );
                        const t = Math.pow(tLinear, PAD_ENTRY_VELOCITY_CURVE);
                        const attack = PAD_ENTRY_ATTACK_SLOW_S * (1 - t) + PAD_ENTRY_ATTACK_FAST_S * t;
                        audio.setHandAttackSeconds(attack);
                        const { width, height } = getCanvasSize();
                        addRipple(waveX * width, (1 - pitchY) * height);
                    }

                    if (!soundActive) {
                        soundActive = true;
                        soundStartMs = Date.now();
                        audio.start(HAND_TOUCH_ID);
                    }

                    const duration = (Date.now() - soundStartMs) / 1000;
                    audio.update(waveX, pitchY, HAND_TOUCH_ID, duration);
                    soundLastUpdateMs = Date.now();

                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
                } else if (!inPadZone && soundInRange) {
                    // Exiting pad zone.
                    const vOut = Math.max(0, Math.max(-(smoothApproachVelMps ?? 0), -approachVelNowMps));
                    const tLinear = clamp(
                        (vOut - EXIT_VELOCITY_MIN_MPS) / (EXIT_VELOCITY_MAX_MPS - EXIT_VELOCITY_MIN_MPS),
                        0,
                        1
                    );
                    const t = Math.pow(tLinear, EXIT_VELOCITY_CURVE);
                    const release = EXIT_RELEASE_SLOW_S * (1 - t) + EXIT_RELEASE_FAST_S * t;
                    soundInRange = false;
                    if (soundActive) {
                        stopHandVoice(release);
                    }

                    // If we're still within pointer zone, fall back to hover pointer.
                    if (inPointerZone && !soundActive) {
                        vizIsHovering = true;
                        inPointerHover = true;
                        const { width, height } = getCanvasSize();
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
                    }
                }

                lostSoundFrames = 0;
            } else {
                lostSoundFrames += 1;
            }
        } else {
            lostSoundFrames += 1;
        }

        if (lostSoundFrames >= LOST_HAND_FRAMES_TO_RELEASE) {
            stopHandVoice();
        }

        // Safety: force release if sound is stuck (playing but not in pad zone for too long).
        if (soundActive && !soundInRange) {
            const stuckDuration = Date.now() - soundStartMs;
            if (stuckDuration >= STUCK_SOUND_TIMEOUT_MS) {
                stopHandVoice(PLUCK_RELEASE_S);
            }
        }

        // Safety: force release if sound hasn't been updated recently (stale tracking).
        if (soundActive && soundLastUpdateMs > 0) {
            const staleDuration = Date.now() - soundLastUpdateMs;
            if (staleDuration >= STALE_UPDATE_TIMEOUT_MS) {
                stopHandVoice(PLUCK_RELEASE_S);
            }
        }

        const distSuffix = soundDistM !== null && isFinite(soundDistM) ? `d=${soundDistM.toFixed(2)}m` : undefined;
        if (!hasFilter && !hasSound) setStatus('show');
        else if (hasFilter && hasSound) setStatus('both', distSuffix);
        else if (hasFilter) setStatus('filter');
        else setStatus('sound', distSuffix);

        if (vizEnabled) {
            const filterIndex = filterHand ? hands.indexOf(filterHand) : null;
            const soundIndex = soundHand ? hands.indexOf(soundHand) : null;
            const vizHands: HandVizHand[] = hands.map(h => ({
                handedness: h.handedness,
                landmarks: h.landmarks,
            }));
            vizSnapshot = {
                source: 'mediapipe',
                hands: vizHands,
                filterIndex,
                soundIndex,
                sound: {
                    inPadZone: vizInPadZone,
                    inPointerZone: vizInPointerZone,
                    isHovering: vizIsHovering,
                    distM: vizGateDistM,
                    pinchRatio: vizPinchRatio,
                    waveX: vizWaveX,
                    pitchY: vizPitchY,
                },
                filter: {
                    palmFacing: smoothPalm,
                    resonance: smoothResonance,
                }
            };
        }
    };

    const loop = async () => {
        if (!enabled) return;
        if (!video) return;

        // Detect at most once per video frame.
        if (video.readyState >= 2) {
            const landmarker = await getHandLandmarker();
            const result = landmarker.detectForVideo(video, performance.now());

            if (result.landmarks.length === 0) {
                lostSoundFrames += 1;
                if (lostSoundFrames >= LOST_HAND_FRAMES_TO_RELEASE) stopHandVoice();
                setStatus('show');
                if (vizEnabled) {
                    vizSnapshot = {
                        source: 'mediapipe',
                        hands: [],
                        filterIndex: null,
                        soundIndex: null,
                    };
                }
            } else {
                updateFromResult(result);
            }
        } else {
            setStatus('loading');
            if (vizEnabled) {
                vizSnapshot = null;
            }
        }

        if (vizEnabled) {
            drawHandViz();
        }

        rafId = requestAnimationFrame(() => { void loop(); });
    };

    const enableNative = async (): Promise<boolean> => {
        const plugin = getTrueDepthPlugin();
        if (!plugin) return false;

        try {
            const { available } = await plugin.isAvailable();
            if (!available) return false;

            // Start native tracking
            await plugin.start();

            // Listen for hand updates
            const listener = await plugin.addListener('handUpdate', processNativeUpdate);
            nativeListenerRemove = listener.remove;

            usingNative = true;
            return true;
        } catch {
            return false;
        }
    };

    const enable = async () => {
        enabled = true;
        handBtn.disabled = true;
        if (handVizBtn) handVizBtn.disabled = true;
        setStatus('loading');

        try {
            // Try native TrueDepth first (iOS only)
            const nativeStarted = await enableNative();
            if (nativeStarted) {
                handBtn.disabled = false;
                if (handVizBtn) handVizBtn.disabled = false;
                setStatus('show');
                return;
            }

            // Fall back to MediaPipe for web
            await startCamera();
            // Warm up model load in parallel with camera.
            void getHandLandmarker();
            handBtn.disabled = false;
            if (handVizBtn) handVizBtn.disabled = false;
            setStatus('show');
            rafId = requestAnimationFrame(() => { void loop(); });
        } catch (err) {
            enabled = false;
            teardownCamera();
            handBtn.disabled = false;
            if (handVizBtn) handVizBtn.disabled = false;
            const msg = err instanceof Error ? err.name : 'err';
            setStatus('error', msg);
        }
    };

    const disable = () => {
        enabled = false;

        // Stop native plugin if in use
        if (usingNative) {
            const plugin = getTrueDepthPlugin();
            if (plugin) {
                void plugin.stop();
            }
        }

        teardownCamera();
        setStatus('off');
    };

    const toggle = () => {
        if (enabled) disable();
        else void enable();
    };

    const handler = createTouchSafeHandler(toggle);
    handBtn.addEventListener('click', handler);
    handBtn.addEventListener('touchend', handler);

    const toggleViz = () => {
        if (!handVizBtn || !handVizEl || !handVizCanvas) return;

        if (vizEnabled) {
            setVizEnabled(false);
            return;
        }

        if (!handVizCtx) {
            handVizCtx = handVizCanvas.getContext('2d');
        }

        // If Hand control isn't on yet, enable it first (user gesture already happened).
        if (!enabled) {
            void (async () => {
                await enable();
                if (!enabled) return;
                setVizEnabled(true);
                drawHandViz();
            })();
            return;
        }

        setVizEnabled(true);
        drawHandViz();
    };

    if (handVizBtn) {
        const vizHandler = createTouchSafeHandler(toggleViz);
        handVizBtn.addEventListener('click', vizHandler);
        handVizBtn.addEventListener('touchend', vizHandler);
    }

    // Make sure we stop camera/audio if the page is hidden.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && enabled) disable();
    });

    // If something else stops the tracks, reflect it in UI.
    window.addEventListener('pagehide', () => {
        if (enabled) disable();
    });

    // Initial state
    setStatus('off');
}
