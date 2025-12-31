/**
 * HAND CONTROLS - Webcam hand tracking
 *
 * Implementation notes:
 * - On iOS native app: Uses TrueDepth camera with Vision framework for accurate depth.
 * - On web: Uses MediaPipe Tasks Vision HandLandmarker (loaded lazily on enable).
 * - Two-hand "theremin-ish" mapping:
 *   - Left hand: resonance (height) + filter cutoff (palm orientation)
 *   - Right hand: pointer zone + pinch-pluck + reverb (pinch openness)
 *     - Pointer zone: hover shows target, pinch triggers pluck
 *     - Pinch-sustain: hold pinch to sustain note, release to stop
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

// Stale update timeout: force release if sound hasn't been updated in this long.
const STALE_UPDATE_TIMEOUT_MS = 200;

// EMA smoothing for position (0..1). Higher = snappier, lower = steadier.
const POS_EMA_ALPHA = 0.35;
const PALM_EMA_ALPHA = 0.25;
const RESONANCE_EMA_ALPHA = 0.25;
const REVERB_EMA_ALPHA = 0.25;

// Hand "shake" detection (for vibrato): based on high acceleration of the control point.
// Scale converts view-space accel (0..1 per s^2) to device-like "shake" magnitude.
const DEFAULT_HAND_SHAKE_SENSITIVITY = 6.0;
const MIN_HAND_SHAKE_SENSITIVITY = 0.5;
const MAX_HAND_SHAKE_SENSITIVITY = 12.0;
const HAND_SHAKE_EMA_ALPHA = 0.25;

// Hand vibrato rate detection (Hz): inferred from the periodicity of the control point.
const HAND_VIB_MIN_EXTREMUM_AMP = 0.008;
const HAND_VIB_MIN_HALF_PERIOD_MS = 40;   // ~12.5 Hz max
const HAND_VIB_MAX_HALF_PERIOD_MS = 500;  // ~1.0 Hz min
const HAND_VIB_HZ_EMA_ALPHA = 0.2;
const HAND_VIB_TIMEOUT_MS = 550;

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

// Zone threshold (meters): max distance where hover pointer is shown.
const DEFAULT_POINTER_ZONE_MAX_M = IS_MOBILE ? 0.50 : 0.60;

// View-to-pad mapping rectangle.
// - x is in mirrored "view" coordinates (0=left, 1=right).
// - y is in video coordinates (0=top, 1=bottom).
// The rectangle defines what part of the camera view maps to the full pad range.
type ViewMappingRect = { left: number; right: number; top: number; bottom: number };
const DEFAULT_VIEW_MAPPING_RECT: ViewMappingRect = { left: 0.30, right: 0.90, top: 0.30, bottom: 0.80 };

// Pluck gesture: quick pinch (thumb+index) while hovering in pointer zone.
const PLUCK_PINCH_CLOSED_RATIO = 0.15;
const PLUCK_PINCH_REARM_RATIO = 0.20;
const PLUCK_PINCH_CLOSE_MIN_PER_S = 0.5;
const PLUCK_PINCH_CLOSE_MAX_PER_S = 4.0;
const PLUCK_PINCH_VELOCITY_CURVE = 0.4;
const PLUCK_ATTACK_SLOW_S = 0.02;
const PLUCK_ATTACK_FAST_S = 0.001;
// Pluck release is short since it's a transient.
const PLUCK_RELEASE_S = 0.08;

// Distance smoothing for depth estimation.
const DIST_EMA_ALPHA = IS_MOBILE ? 0.25 : 0.4;

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
    const pointerZoneSlider = document.getElementById('pointerZoneSlider') as HTMLInputElement | null;
    const pointerZoneValue = document.getElementById('pointerZoneValue') as HTMLElement | null;
    const camFovSlider = document.getElementById('camFovSlider') as HTMLInputElement | null;
    const camFovValue = document.getElementById('camFovValue') as HTMLElement | null;
    const pinchCloseSlider = document.getElementById('pinchCloseSlider') as HTMLInputElement | null;
    const pinchCloseValue = document.getElementById('pinchCloseValue') as HTMLElement | null;
    const pinchRearmSlider = document.getElementById('pinchRearmSlider') as HTMLInputElement | null;
    const pinchRearmValue = document.getElementById('pinchRearmValue') as HTMLElement | null;
    const pinchVelSlider = document.getElementById('pinchVelSlider') as HTMLInputElement | null;
    const pinchVelValue = document.getElementById('pinchVelValue') as HTMLElement | null;
    const handVibSensSlider = document.getElementById('handVibSensSlider') as HTMLInputElement | null;
    const handVibSensValue = document.getElementById('handVibSensValue') as HTMLElement | null;

    const canUseCamera = !!navigator.mediaDevices?.getUserMedia;
    if (!canUseCamera) {
        handBtn.disabled = true;
        if (handVizBtn) handVizBtn.disabled = true;
        if (zonesSummary) zonesSummary.disabled = true;
        if (pointerZoneSlider) pointerZoneSlider.disabled = true;
        if (camFovSlider) camFovSlider.disabled = true;
        if (pinchCloseSlider) pinchCloseSlider.disabled = true;
        if (pinchRearmSlider) pinchRearmSlider.disabled = true;
        if (pinchVelSlider) pinchVelSlider.disabled = true;
        if (handVibSensSlider) handVibSensSlider.disabled = true;
        handVal.textContent = 'n/a';
        return;
    }

    let vizEnabled = false;
    let handVizCtx: CanvasRenderingContext2D | null = null;
    let viewMappingRect: ViewMappingRect = { ...DEFAULT_VIEW_MAPPING_RECT };

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

    // Configurable pointer zone (meters).
    let pointerZoneMaxM = DEFAULT_POINTER_ZONE_MAX_M;

    // Configurable camera FOV (degrees) for distance estimation.
    let cameraFovDeg = DEFAULT_CAMERA_FOV_DEG;

    // Configurable pluck/pinch sensitivity.
    let pluckPinchClosedRatio = PLUCK_PINCH_CLOSED_RATIO;
    let pluckPinchRearmRatio = PLUCK_PINCH_REARM_RATIO;
    let pluckPinchCloseMinPerS = PLUCK_PINCH_CLOSE_MIN_PER_S;
    let handShakeSensitivity = DEFAULT_HAND_SHAKE_SENSITIVITY;

    const MIN_VIEW_MAPPING_SPAN = 0.1;
    const clampViewMappingRect = (rect: ViewMappingRect): ViewMappingRect => {
        let left = clamp(rect.left, 0, 1);
        let right = clamp(rect.right, 0, 1);
        let top = clamp(rect.top, 0, 1);
        let bottom = clamp(rect.bottom, 0, 1);

        if (left > right) [left, right] = [right, left];
        if (top > bottom) [top, bottom] = [bottom, top];

        const spanX = Math.max(MIN_VIEW_MAPPING_SPAN, right - left);
        const spanY = Math.max(MIN_VIEW_MAPPING_SPAN, bottom - top);

        if (right - left < MIN_VIEW_MAPPING_SPAN) {
            const mid = (left + right) / 2;
            left = clamp(mid - spanX / 2, 0, 1 - spanX);
            right = left + spanX;
        }

        if (bottom - top < MIN_VIEW_MAPPING_SPAN) {
            const mid = (top + bottom) / 2;
            top = clamp(mid - spanY / 2, 0, 1 - spanY);
            bottom = top + spanY;
        }

        return { left, right, top, bottom };
    };

    const setViewMappingRect = (rect: ViewMappingRect) => {
        viewMappingRect = clampViewMappingRect(rect);
        if (vizEnabled) {
            drawHandViz();
        }
    };

    const mapViewToPad = (viewX: number, viewY: number): { waveX: number; pitchY: number } => {
        const spanX = Math.max(1e-6, viewMappingRect.right - viewMappingRect.left);
        const spanY = Math.max(1e-6, viewMappingRect.bottom - viewMappingRect.top);
        const xNorm = clamp((viewX - viewMappingRect.left) / spanX, 0, 1);
        const yNorm = clamp((viewY - viewMappingRect.top) / spanY, 0, 1);
        return { waveX: xNorm, pitchY: clamp(1 - yNorm, 0, 1) };
    };

    let enabled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let rafId: number | null = null;

    // Tracking state
    let soundActive = false;
    let soundStartMs = 0;
    let soundLastUpdateMs = 0;  // Last time audio.update was called
    let lostSoundFrames = 0;
    let smoothDistM: number | null = null;

    // Hand shake state (for vibrato on sustained notes).
    let shakePrevMs: number | null = null;
    let shakePrevViewX: number | null = null;
    let shakePrevViewY: number | null = null;
    let shakePrevVx: number | null = null;
    let shakePrevVy: number | null = null;
    let smoothHandShake: number | null = null;
    let vibLastExtremumMsX: number | null = null;
    let vibLastExtremumPosX: number | null = null;
    let vibPrevSignX: -1 | 1 | null = null;
    let vibLastExtremumMsY: number | null = null;
    let vibLastExtremumPosY: number | null = null;
    let vibPrevSignY: -1 | 1 | null = null;
    let vibLastAnyExtremumMs: number | null = null;
    let smoothHandVibratoHz: number | null = null;

    // Pluck gesture state.
    let pluckArmed = true;  // Ready to trigger next pluck (re-arms when pinch opens)
    let inPluckMode = false;  // Currently playing a pluck (not pad)
    let inPointerHover = false;  // Hovering pointer (no sound)
    let pinchPrevRatio: number | null = null;
    let pinchPrevMs: number | null = null;
    let pinchAttackFlashUntilMs = 0;

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

    const resetHandShake = () => {
        shakePrevMs = null;
        shakePrevViewX = null;
        shakePrevViewY = null;
        shakePrevVx = null;
        shakePrevVy = null;
        smoothHandShake = null;
        vibLastExtremumMsX = null;
        vibLastExtremumPosX = null;
        vibPrevSignX = null;
        vibLastExtremumMsY = null;
        vibLastExtremumPosY = null;
        vibPrevSignY = null;
        vibLastAnyExtremumMs = null;
        smoothHandVibratoHz = null;
        audio.setHandShake(0);
        audio.setHandVibratoHz(0);
    };

    const updateHandMotion = (viewX: number, viewY: number, nowMs: number): { shake: number; vibratoHz: number } => {
        if (shakePrevMs === null || shakePrevViewX === null || shakePrevViewY === null) {
            shakePrevMs = nowMs;
            shakePrevViewX = viewX;
            shakePrevViewY = viewY;
            shakePrevVx = null;
            shakePrevVy = null;
            vibPrevSignX = null;
            vibPrevSignY = null;
            smoothHandShake = null;
            smoothHandVibratoHz = null;
            return { shake: 0, vibratoHz: 0 };
        }

        const dt = (nowMs - shakePrevMs) / 1000;
        if (dt <= 0.001 || dt >= 0.25) {
            // Dropouts / tab switches: avoid huge spikes.
            shakePrevMs = nowMs;
            shakePrevViewX = viewX;
            shakePrevViewY = viewY;
            shakePrevVx = null;
            shakePrevVy = null;
            vibPrevSignX = null;
            vibPrevSignY = null;
            smoothHandShake = null;
            smoothHandVibratoHz = null;
            return { shake: 0, vibratoHz: 0 };
        }

        const vx = (viewX - shakePrevViewX) / dt;
        const vy = (viewY - shakePrevViewY) / dt;

        // Periodicity → vibrato rate: detect turning points (velocity sign changes).
        const signX: -1 | 1 = vx >= 0 ? 1 : -1;
        const signY: -1 | 1 = vy >= 0 ? 1 : -1;

        let candidateHz: number | null = null;
        let weightSum = 0;

        const maybeAddAxisCandidate = (
            axis: 'x' | 'y',
            signNow: -1 | 1,
            prevSign: -1 | 1 | null,
            posNow: number,
            lastMs: number | null,
            lastPos: number | null,
        ) => {
            if (prevSign !== null && prevSign !== signNow) {
                // Extremum detected.
                if (lastMs !== null && lastPos !== null) {
                    const halfPeriodMs = nowMs - lastMs;
                    const amp = Math.abs(posNow - lastPos);
                    if (
                        amp >= HAND_VIB_MIN_EXTREMUM_AMP
                        && halfPeriodMs >= HAND_VIB_MIN_HALF_PERIOD_MS
                        && halfPeriodMs <= HAND_VIB_MAX_HALF_PERIOD_MS
                    ) {
                        const hz = 1000 / (2 * halfPeriodMs);
                        vibLastAnyExtremumMs = nowMs;

                        const w = amp;
                        const prev = candidateHz ?? 0;
                        candidateHz = prev + hz * w;
                        weightSum += w;
                    }
                }

                // Update last extremum (even if we didn't emit a candidate yet, so we can lock on quickly).
                if (axis === 'x') {
                    vibLastExtremumMsX = nowMs;
                    vibLastExtremumPosX = posNow;
                } else {
                    vibLastExtremumMsY = nowMs;
                    vibLastExtremumPosY = posNow;
                }
            }
        };

        maybeAddAxisCandidate('x', signX, vibPrevSignX, viewX, vibLastExtremumMsX, vibLastExtremumPosX);
        maybeAddAxisCandidate('y', signY, vibPrevSignY, viewY, vibLastExtremumMsY, vibLastExtremumPosY);

        vibPrevSignX = signX;
        vibPrevSignY = signY;

        let vibHz = 0;
        if (candidateHz !== null && weightSum > 0) {
            const hz = clamp(candidateHz / weightSum, 1, 14);
            smoothHandVibratoHz = ema(smoothHandVibratoHz, hz, HAND_VIB_HZ_EMA_ALPHA);
            vibHz = smoothHandVibratoHz;
        } else if (vibLastAnyExtremumMs !== null && nowMs - vibLastAnyExtremumMs > HAND_VIB_TIMEOUT_MS) {
            smoothHandVibratoHz = null;
            vibHz = 0;
        } else {
            vibHz = smoothHandVibratoHz ?? 0;
        }

        // Acceleration magnitude → intensity.
        let acc = 0;
        if (shakePrevVx !== null && shakePrevVy !== null) {
            const ax = (vx - shakePrevVx) / dt;
            const ay = (vy - shakePrevVy) / dt;
            acc = Math.hypot(ax, ay);
        }

        shakePrevMs = nowMs;
        shakePrevViewX = viewX;
        shakePrevViewY = viewY;
        shakePrevVx = vx;
        shakePrevVy = vy;

        const shake = clamp(acc * handShakeSensitivity, 0, 30);
        smoothHandShake = ema(smoothHandShake, shake, HAND_SHAKE_EMA_ALPHA);

        return { shake: smoothHandShake ?? 0, vibratoHz: vibHz };
    };

    type VizLayout = { dpr: number; offsetX: number; offsetY: number; drawW: number; drawH: number };
    let vizLayout: VizLayout | null = null;

    type MappingDragMode = 'left' | 'right' | 'top' | 'bottom' | 'move';
    type MappingDragState = {
        pointerId: number;
        mode: MappingDragMode;
        startViewX: number;
        startViewY: number;
        startRect: ViewMappingRect;
    };
    let mappingDrag: MappingDragState | null = null;
    let mappingHoverMode: MappingDragMode | null = null;

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

        vizLayout = { dpr, offsetX, offsetY, drawW, drawH };

        // Draw the mapping region (what maps to the full pad range).
        const rx0 = offsetX + viewMappingRect.left * drawW;
        const rx1 = offsetX + viewMappingRect.right * drawW;
        const ry0 = offsetY + viewMappingRect.top * drawH;
        const ry1 = offsetY + viewMappingRect.bottom * drawH;
        const hoverMode = mappingDrag?.mode ?? mappingHoverMode;

        ctx.save();
        ctx.strokeStyle = 'rgba(0, 160, 255, 0.65)';
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([6 * dpr, 6 * dpr]);
        ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);

        // Hover/drag highlight: show active edge as solid.
        if (hoverMode) {
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(0, 160, 255, 0.95)';
            ctx.lineWidth = 3 * dpr;
            ctx.beginPath();
            if (hoverMode === 'move') {
                ctx.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
            } else if (hoverMode === 'left') {
                ctx.moveTo(rx0, ry0);
                ctx.lineTo(rx0, ry1);
            } else if (hoverMode === 'right') {
                ctx.moveTo(rx1, ry0);
                ctx.lineTo(rx1, ry1);
            } else if (hoverMode === 'top') {
                ctx.moveTo(rx0, ry0);
                ctx.lineTo(rx1, ry0);
            } else if (hoverMode === 'bottom') {
                ctx.moveTo(rx0, ry1);
                ctx.lineTo(rx1, ry1);
            }
            ctx.stroke();
        }

        // Drag handles (midpoints).
        const handleR = 4 * dpr;
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0, 160, 255, 0.9)';
        const midX = (rx0 + rx1) / 2;
        const midY = (ry0 + ry1) / 2;
        for (const [hx, hy] of [
            [rx0, midY],
            [rx1, midY],
            [midX, ry0],
            [midX, ry1],
        ] as const) {
            ctx.beginPath();
            ctx.arc(hx, hy, handleR, 0, Math.PI * 2);
            ctx.fill();
        }
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
                    const zoneColor = zone?.inPointerZone
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
                        const spanX = Math.max(1e-6, viewMappingRect.right - viewMappingRect.left);
                        const spanY = Math.max(1e-6, viewMappingRect.bottom - viewMappingRect.top);
                        const usedViewX = clamp(viewMappingRect.left + waveX * spanX, 0, 1);
                        const usedViewY = clamp(viewMappingRect.top + (1 - pitchY) * spanY, 0, 1);
                        ctx.save();
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
                        ctx.lineWidth = 2 * dpr;
                        const px = offsetX + usedViewX * drawW;
                        const py = offsetY + usedViewY * drawH;
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
                    const nowMs = performance.now();
                    const flash = nowMs <= pinchAttackFlashUntilMs;
                    const sustaining = inPluckMode && soundActive;

                    const pinchLineColor = flash
                        ? 'rgba(0, 255, 120, 0.95)'
                        : sustaining
                            ? 'rgba(0, 255, 120, 0.7)'
                            : 'rgba(255, 255, 255, 0.9)';

                    ctx.save();
                    ctx.strokeStyle = pinchLineColor;
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
            const zoneLabel = snapshot?.sound?.inPointerZone
                ? (snapshot.sound.isHovering ? 'PTR*' : 'PTR')
                : '--';
            const distText = snapshot?.sound?.distM !== null && snapshot?.sound?.distM !== undefined
                ? `${Math.round(snapshot.sound.distM * 100)}cm`
                : '--';
            const pinchText = snapshot?.sound?.pinchRatio !== null && snapshot?.sound?.pinchRatio !== undefined
                ? `pinch ${snapshot.sound.pinchRatio.toFixed(2)}`
                : 'pinch --';

            const ptrText = `ptr≤${Math.round(pointerZoneMaxM * 100)}cm`;
            const camFovText = `${Math.round(cameraFovDeg)}°`;
            const mapW = Math.round((viewMappingRect.right - viewMappingRect.left) * 100);
            const mapH = Math.round((viewMappingRect.bottom - viewMappingRect.top) * 100);
            const mapText = `map ${mapW}×${mapH}%`;
            const xyText = snapshot?.sound?.waveX !== null && snapshot?.sound?.waveX !== undefined
                && snapshot?.sound?.pitchY !== null && snapshot?.sound?.pitchY !== undefined
                ? `xy ${snapshot.sound.waveX.toFixed(2)},${snapshot.sound.pitchY.toFixed(2)}`
                : 'xy --';

            handVizLegend.innerHTML = `<span>${modeLabel} · hands ${handsCount} · F ${filterName} · S ${soundName} · ${palmText} · ${resText}</span><span>${soundActive ? 'on' : 'off'} · ${zoneLabel} · ${distText} · ${ptrText} · cam ${camFovText} · ${mapText} · ${xyText} · ${pinchText}</span>`;
        }
    };

    const setZoneSettings = (pointerCm: number) => {
        const pointerClamped = clamp(pointerCm, 40, 80);
        pointerZoneMaxM = pointerClamped / 100;

        if (pointerZoneSlider) pointerZoneSlider.value = String(Math.round(pointerClamped));
        if (pointerZoneValue) pointerZoneValue.textContent = `${Math.round(pointerClamped)}cm`;
        if (zonesSummary) zonesSummary.textContent = `Zone ${Math.round(pointerClamped)}cm`;

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

    const MIN_PLUCK_REARM_GAP = 0.05;

    const setPluckPinchClosedRatio = (ratio: number) => {
        const ratioClamped = clamp(ratio, 0.15, 0.60);
        pluckPinchClosedRatio = ratioClamped;

        // Keep rearm threshold above close threshold for stable plucks.
        if (pluckPinchRearmRatio < pluckPinchClosedRatio + MIN_PLUCK_REARM_GAP) {
            pluckPinchRearmRatio = clamp(pluckPinchClosedRatio + MIN_PLUCK_REARM_GAP, 0.20, 0.80);
        }

        if (pinchCloseSlider) pinchCloseSlider.value = String(Math.round(pluckPinchClosedRatio * 100));
        if (pinchCloseValue) pinchCloseValue.textContent = pluckPinchClosedRatio.toFixed(2);

        if (pinchRearmSlider) pinchRearmSlider.value = String(Math.round(pluckPinchRearmRatio * 100));
        if (pinchRearmValue) pinchRearmValue.textContent = pluckPinchRearmRatio.toFixed(2);

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const setPluckPinchRearmRatio = (ratio: number) => {
        const min = pluckPinchClosedRatio + MIN_PLUCK_REARM_GAP;
        const ratioClamped = clamp(ratio, min, 0.80);
        pluckPinchRearmRatio = ratioClamped;

        if (pinchRearmSlider) pinchRearmSlider.value = String(Math.round(pluckPinchRearmRatio * 100));
        if (pinchRearmValue) pinchRearmValue.textContent = pluckPinchRearmRatio.toFixed(2);

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const setPluckPinchCloseMinPerS = (velPerS: number) => {
        const max = Math.max(PLUCK_PINCH_CLOSE_MIN_PER_S + 0.01, PLUCK_PINCH_CLOSE_MAX_PER_S - 0.1);
        const velClamped = clamp(velPerS, 0.5, max);
        pluckPinchCloseMinPerS = velClamped;

        if (pinchVelSlider) pinchVelSlider.value = String(Math.round(pluckPinchCloseMinPerS * 100));
        if (pinchVelValue) pinchVelValue.textContent = `${pluckPinchCloseMinPerS.toFixed(1)}/s`;

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const setHandShakeSensitivity = (sens: number) => {
        const sensClamped = clamp(sens, MIN_HAND_SHAKE_SENSITIVITY, MAX_HAND_SHAKE_SENSITIVITY);
        handShakeSensitivity = sensClamped;

        if (handVibSensSlider) handVibSensSlider.value = String(Math.round(handShakeSensitivity * 100));
        if (handVibSensValue) handVibSensValue.textContent = `${handShakeSensitivity.toFixed(1)}×`;

        if (vizEnabled) {
            drawHandViz();
        }
    };

    const initMappingDrag = () => {
        if (!handVizCanvas) return;

        const getViewPos = (e: PointerEvent): { viewX: number; viewY: number; cx: number; cy: number } | null => {
            const layout = vizLayout;
            if (!layout) return null;

            const rect = handVizCanvas.getBoundingClientRect();
            const cx = (e.clientX - rect.left) * layout.dpr;
            const cy = (e.clientY - rect.top) * layout.dpr;

            const viewX = clamp((cx - layout.offsetX) / layout.drawW, 0, 1);
            const viewY = clamp((cy - layout.offsetY) / layout.drawH, 0, 1);
            return { viewX, viewY, cx, cy };
        };

        const hitTest = (e: PointerEvent): MappingDragMode | null => {
            const layout = vizLayout;
            const pos = getViewPos(e);
            if (!layout || !pos) return null;

            const x0 = layout.offsetX + viewMappingRect.left * layout.drawW;
            const x1 = layout.offsetX + viewMappingRect.right * layout.drawW;
            const y0 = layout.offsetY + viewMappingRect.top * layout.drawH;
            const y1 = layout.offsetY + viewMappingRect.bottom * layout.drawH;

            const withinX = pos.cx >= Math.min(x0, x1) && pos.cx <= Math.max(x0, x1);
            const withinY = pos.cy >= Math.min(y0, y1) && pos.cy <= Math.max(y0, y1);
            const inside = withinX && withinY;

            const hitPx = 10 * layout.dpr;
            const candidates: Array<{ mode: Exclude<MappingDragMode, 'move'>; dist: number }> = [];

            if (pos.cy >= y0 - hitPx && pos.cy <= y1 + hitPx) {
                candidates.push({ mode: 'left', dist: Math.abs(pos.cx - x0) });
                candidates.push({ mode: 'right', dist: Math.abs(pos.cx - x1) });
            }
            if (pos.cx >= x0 - hitPx && pos.cx <= x1 + hitPx) {
                candidates.push({ mode: 'top', dist: Math.abs(pos.cy - y0) });
                candidates.push({ mode: 'bottom', dist: Math.abs(pos.cy - y1) });
            }

            const best = candidates
                .filter(c => c.dist <= hitPx)
                .sort((a, b) => a.dist - b.dist)[0];

            if (best) return best.mode;
            if (inside) return 'move';
            return null;
        };

        const setCursorForMode = (mode: MappingDragMode | null) => {
            if (!handVizCanvas) return;
            if (!vizEnabled) {
                handVizCanvas.style.cursor = '';
                return;
            }
            const cursor = mappingDrag
                ? 'grabbing'
                : mode
                    ? 'pointer'
                    : '';
            handVizCanvas.style.cursor = cursor;
        };

        const onPointerDown = (e: PointerEvent) => {
            if (!vizEnabled) return;

            const mode = hitTest(e);
            const pos = getViewPos(e);
            if (!mode || !pos) return;

            e.stopPropagation();
            e.preventDefault();

            mappingDrag = {
                pointerId: e.pointerId,
                mode,
                startViewX: pos.viewX,
                startViewY: pos.viewY,
                startRect: viewMappingRect,
            };

            try { handVizCanvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            mappingHoverMode = mode;
            setCursorForMode(mode);
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!vizEnabled) return;

            if (!mappingDrag) {
                const mode = hitTest(e);
                if (mode !== mappingHoverMode) {
                    mappingHoverMode = mode;
                    drawHandViz();
                }
                setCursorForMode(mode);
                return;
            }
            if (e.pointerId !== mappingDrag.pointerId) return;

            const pos = getViewPos(e);
            if (!pos) return;

            e.stopPropagation();
            e.preventDefault();

            const minSpan = MIN_VIEW_MAPPING_SPAN;
            const start = mappingDrag.startRect;
            const dx = pos.viewX - mappingDrag.startViewX;
            const dy = pos.viewY - mappingDrag.startViewY;

            let next: ViewMappingRect = start;
            switch (mappingDrag.mode) {
                case 'left': {
                    const left = clamp(pos.viewX, 0, start.right - minSpan);
                    next = { ...start, left };
                    break;
                }
                case 'right': {
                    const right = clamp(pos.viewX, start.left + minSpan, 1);
                    next = { ...start, right };
                    break;
                }
                case 'top': {
                    const top = clamp(pos.viewY, 0, start.bottom - minSpan);
                    next = { ...start, top };
                    break;
                }
                case 'bottom': {
                    const bottom = clamp(pos.viewY, start.top + minSpan, 1);
                    next = { ...start, bottom };
                    break;
                }
                case 'move': {
                    const w = start.right - start.left;
                    const h = start.bottom - start.top;
                    let left = start.left + dx;
                    let top = start.top + dy;
                    left = clamp(left, 0, 1 - w);
                    top = clamp(top, 0, 1 - h);
                    next = { left, right: left + w, top, bottom: top + h };
                    break;
                }
            }

            setViewMappingRect(next);
        };

        const onPointerUp = (e: PointerEvent) => {
            if (!mappingDrag) return;
            if (e.pointerId !== mappingDrag.pointerId) return;
            e.stopPropagation();
            e.preventDefault();
            mappingDrag = null;
            const mode = hitTest(e);
            mappingHoverMode = mode;
            setCursorForMode(mode);
            drawHandViz();
        };

        handVizCanvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        handVizCanvas.addEventListener('pointermove', onPointerMove, { passive: false });
        handVizCanvas.addEventListener('pointerup', onPointerUp, { passive: false });
        handVizCanvas.addEventListener('pointercancel', onPointerUp, { passive: false });
        handVizCanvas.addEventListener('pointerleave', () => {
            if (!vizEnabled) return;
            if (mappingDrag) return;
            if (mappingHoverMode !== null) {
                mappingHoverMode = null;
                setCursorForMode(null);
                drawHandViz();
            }
        });

        handVizCanvas.addEventListener('dblclick', (e) => {
            if (!vizEnabled) return;
            e.stopPropagation();
            e.preventDefault();
            setViewMappingRect({ ...DEFAULT_VIEW_MAPPING_RECT });
        });
    };

    const initZoneControls = () => {
        if (!zonesSummary || !zonesOptions || !pointerZoneSlider) return;

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

        // Prevent clicks from propagating to canvas (which would trigger sound)
        const stopAll = (e: Event) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        const toggleHandler = createTouchSafeHandler(toggleZones);
        zonesSummary.addEventListener('click', (e) => { stopAll(e); toggleHandler(e); });
        zonesSummary.addEventListener('touchend', (e) => { stopAll(e); toggleHandler(e); });
        zonesSummary.addEventListener('pointerdown', stopAll);
        zonesSummary.addEventListener('mousedown', stopAll);

        zonesOptions.addEventListener('click', stopAll);
        zonesOptions.addEventListener('touchstart', stopAll);
        zonesOptions.addEventListener('touchend', stopAll);
        zonesOptions.addEventListener('pointerdown', stopAll);
        zonesOptions.addEventListener('pointerup', stopAll);
        zonesOptions.addEventListener('mousedown', stopAll);
        zonesOptions.addEventListener('mouseup', stopAll);

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

        pointerZoneSlider.addEventListener('input', () => {
            setZoneSettings(parseInt(pointerZoneSlider.value, 10));
        });

        if (camFovSlider) {
            camFovSlider.addEventListener('input', () => {
                setCameraFov(parseInt(camFovSlider.value, 10));
            });
        }

        if (pinchCloseSlider) {
            pinchCloseSlider.addEventListener('input', () => {
                setPluckPinchClosedRatio(parseInt(pinchCloseSlider.value, 10) / 100);
            });
        }

        if (pinchRearmSlider) {
            pinchRearmSlider.addEventListener('input', () => {
                setPluckPinchRearmRatio(parseInt(pinchRearmSlider.value, 10) / 100);
            });
        }

        if (pinchVelSlider) {
            pinchVelSlider.addEventListener('input', () => {
                setPluckPinchCloseMinPerS(parseInt(pinchVelSlider.value, 10) / 100);
            });
        }

        if (handVibSensSlider) {
            handVibSensSlider.addEventListener('input', () => {
                setHandShakeSensitivity(parseInt(handVibSensSlider.value, 10) / 100);
            });
        }

        // Initialize from defaults (clamped to slider min/max).
        setZoneSettings(Math.round(DEFAULT_POINTER_ZONE_MAX_M * 100));
        setCameraFov(DEFAULT_CAMERA_FOV_DEG);
        setPluckPinchClosedRatio(PLUCK_PINCH_CLOSED_RATIO);
        setPluckPinchRearmRatio(PLUCK_PINCH_REARM_RATIO);
        setPluckPinchCloseMinPerS(PLUCK_PINCH_CLOSE_MIN_PER_S);
        setHandShakeSensitivity(DEFAULT_HAND_SHAKE_SENSITIVITY);
    };

    initZoneControls();
    initMappingDrag();

    const stopHandVoice = (releaseSeconds?: number) => {
        if (!soundActive) return;
        if (releaseSeconds !== undefined) {
            audio.setHandReleaseSeconds(releaseSeconds);
        }
        const duration = (Date.now() - soundStartMs) / 1000;
        audio.stop(HAND_TOUCH_ID, duration, { applyReleaseEnvelope: false });
        soundActive = false;
        inPluckMode = false;
        inPointerHover = false;
        removeCursor(HAND_TOUCH_ID);
        resetHandShake();
    };

    /**
     * Process hand data from native TrueDepth plugin.
     * Maps native data to the same control logic as MediaPipe.
     */
    const processNativeUpdate = (data: NativeHandUpdate) => {
        const nowMs = performance.now();
        const hands = data.hands;

        // Debug snapshot scalars
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

        // Right hand: pointer zone + pinch pluck + reverb
        if (soundHand) {
            const middleMcpX = soundHand.middleMcpX;
            const middleMcpY = soundHand.middleMcpY;

            const viewXRaw = 1 - middleMcpX;
            const viewYRaw = middleMcpY;

            smoothSoundX = ema(smoothSoundX, middleMcpX, POS_EMA_ALPHA);
            smoothSoundY = ema(smoothSoundY, middleMcpY, POS_EMA_ALPHA);

            const viewX = 1 - (smoothSoundX ?? middleMcpX);
            const viewY = smoothSoundY ?? middleMcpY;
            const { waveX, pitchY } = mapViewToPad(viewX, viewY);
            soundWaveX = waveX;
            soundPitchY = pitchY;

            // Use native depth (already in meters) - much more accurate than MediaPipe estimate
            soundDistM = soundHand.distanceMeters > 0 ? soundHand.distanceMeters : null;
            if (soundDistM !== null) {
                smoothDistM = ema(smoothDistM, soundDistM, DIST_EMA_ALPHA);
            }
            const gateDist = smoothDistM ?? soundDistM;
            gateDistM = gateDist;

            // Determine pointer zone (depth in meters)
            inPointerZone = gateDist === null
                ? true
                : gateDist <= pointerZoneMaxM;

            // In View mode, always show the mapped cursor on the pad for calibration.
            if (vizEnabled && !soundActive) {
                const { width, height } = getCanvasSize();
                setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
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
            if (!pluckArmed && soundHand.pinchRatio >= pluckPinchRearmRatio) {
                pluckArmed = true;
            }

            const wantsHover = inPointerZone && !soundActive;
            if (wantsHover) {
                isHovering = true;
                if (!inPointerHover) {
                    inPointerHover = true;
                }

                const { width, height } = getCanvasSize();
                setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);

                const wantsPluck = pluckArmed
                    && soundHand.pinchRatio <= pluckPinchClosedRatio
                    && pinchCloseVelPerS >= pluckPinchCloseMinPerS;

                if (wantsPluck) {
                    pluckArmed = false;
                    inPluckMode = true;
                    inPointerHover = false;
                    isHovering = false;
                    pinchAttackFlashUntilMs = nowMs + 200;
                    resetHandShake();

                    const tLinear = clamp(
                        (pinchCloseVelPerS - pluckPinchCloseMinPerS) / (PLUCK_PINCH_CLOSE_MAX_PER_S - pluckPinchCloseMinPerS),
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
                if (!soundActive && !vizEnabled) {
                    removeCursor(HAND_TOUCH_ID);
                }
            }

            // Pinch-sustain pluck: sustain while pinched, release when open (or leaving pointer zone).
            if (inPluckMode && soundActive) {
                const pinchOpen = soundHand.pinchRatio >= pluckPinchRearmRatio;
                const stillInPointerZone = inPointerZone;

                if (pinchOpen || !stillInPointerZone) {
                    stopHandVoice(PLUCK_RELEASE_S);

                    if (stillInPointerZone) {
                        isHovering = true;
                        inPointerHover = true;
                        const { width, height } = getCanvasSize();
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
                    }
                } else {
                    const duration = (Date.now() - soundStartMs) / 1000;
                    const motion = updateHandMotion(viewXRaw, viewYRaw, nowMs);
                    audio.setHandShake(motion.shake);
                    audio.setHandVibratoHz(motion.vibratoHz);
                    audio.update(waveX, pitchY, HAND_TOUCH_ID, duration);
                    soundLastUpdateMs = Date.now();

                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
                }
            }

            lostSoundFrames = 0;
        } else {
            lostSoundFrames += 1;
        }

        if (lostSoundFrames >= LOST_HAND_FRAMES_TO_RELEASE) {
            stopHandVoice();
        }

        // Safety: force release if sound hasn't been updated recently (stale tracking).
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
        smoothDistM = null;
        lostSoundFrames = 0;
        pluckArmed = true;
        inPluckMode = false;
        inPointerHover = false;
        pinchPrevRatio = null;
        pinchPrevMs = null;
        pinchAttackFlashUntilMs = 0;
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

        // Right hand: pointer zone + pinch pluck + reverb.
        if (soundHand) {
            const thumbTip = soundHand.landmarks[4];
            const indexTip = soundHand.landmarks[8];
            const wrist2d = soundHand.landmarks[0];
            const middleMcp = soundHand.landmarks[9];

            if (thumbTip && indexTip && wrist2d && middleMcp) {
                const viewXRaw = 1 - middleMcp.x;
                const viewYRaw = middleMcp.y;

                // Use a stable palm point for position controls (so pinching doesn't shift pitch/shape too much).
                smoothSoundX = ema(smoothSoundX, middleMcp.x, POS_EMA_ALPHA);
                smoothSoundY = ema(smoothSoundY, middleMcp.y, POS_EMA_ALPHA);

                // Mirror X to match selfie camera; apply X-Y scaling and offset.
                const viewX = 1 - smoothSoundX;
                const viewY = smoothSoundY;
                const { waveX, pitchY } = mapViewToPad(viewX, viewY);
                vizWaveX = waveX;
                vizPitchY = pitchY;

                soundDistM = video ? estimateDistanceMeters(video, wrist2d, middleMcp, cameraFovDeg) : null;
                if (soundDistM !== null) {
                    smoothDistM = ema(smoothDistM, soundDistM, DIST_EMA_ALPHA);
                }
                const gateDist = smoothDistM ?? soundDistM;
                vizGateDistM = gateDist;

                // Determine pointer zone (depth in meters).
                const inPointerZone = gateDist === null
                    ? true
                    : gateDist <= pointerZoneMaxM;
                vizInPointerZone = inPointerZone;

                // In View mode, always show the mapped cursor on the pad for calibration.
                if (vizEnabled && !soundActive) {
                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
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
                if (!pluckArmed && pinchRatio >= pluckPinchRearmRatio) {
                    pluckArmed = true;
                }

                const wantsHover = inPointerZone && !soundActive;
                if (wantsHover) {
                    vizIsHovering = true;
                    if (!inPointerHover) {
                        inPointerHover = true;
                    }
                    const { width, height } = getCanvasSize();
                    setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);

                    const wantsPluck = pluckArmed
                        && pinchRatio <= pluckPinchClosedRatio
                        && pinchCloseVelPerS >= pluckPinchCloseMinPerS;

                    if (wantsPluck) {
                        pluckArmed = false;
                        inPluckMode = true;
                        inPointerHover = false;
                        vizIsHovering = false;
                        pinchAttackFlashUntilMs = nowMs + 200;
                        resetHandShake();

                        // Velocity-dependent attack shaping (faster pinch close = sharper attack).
                        const tLinear = clamp(
                            (pinchCloseVelPerS - pluckPinchCloseMinPerS) / (PLUCK_PINCH_CLOSE_MAX_PER_S - pluckPinchCloseMinPerS),
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
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
                    }
                } else if (inPointerHover && !wantsHover) {
                    // Exited pointer zone without plucking.
                    inPointerHover = false;
                    if (!soundActive && !vizEnabled) {
                        removeCursor(HAND_TOUCH_ID);
                    }
                }

                // Pinch-sustain pluck: sustain while pinched, release when open (or leaving pointer zone).
                if (inPluckMode && soundActive) {
                    const pinchOpen = pinchRatio >= pluckPinchRearmRatio;
                    const stillInPointerZone = inPointerZone;

                    if (pinchOpen || !stillInPointerZone) {
                        stopHandVoice(PLUCK_RELEASE_S);

                        if (stillInPointerZone) {
                            vizIsHovering = true;
                            inPointerHover = true;
                            const { width, height } = getCanvasSize();
                            setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID, true);
                        }
                    } else {
                        const duration = (Date.now() - soundStartMs) / 1000;
                        const motion = updateHandMotion(viewXRaw, viewYRaw, nowMs);
                        audio.setHandShake(motion.shake);
                        audio.setHandVibratoHz(motion.vibratoHz);
                        audio.update(waveX, pitchY, HAND_TOUCH_ID, duration);
                        soundLastUpdateMs = Date.now();

                        const { width, height } = getCanvasSize();
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);
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
