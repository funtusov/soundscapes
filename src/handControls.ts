/**
 * HAND CONTROLS - Webcam hand tracking
 *
 * Implementation notes:
 * - Uses MediaPipe Tasks Vision HandLandmarker (loaded lazily on enable).
 * - Two-hand "theremin-ish" mapping:
 *   - Left hand: resonance (height) + filter cutoff (palm orientation)
 *   - Right hand: dual-zone control + reverb (pinch)
 *     - Pad zone (within 30cm): continuous pad/swell control
 *     - Pluck zone (35-50cm): fast jabs trigger single plucks
 *       - Speed determines attack sharpness
 *       - Only one pluck per jab gesture (re-arms when velocity drops)
 */

import type { AudioEngine } from './AudioEngine';
import { clamp } from './constants';
import { addRipple, getCanvasSize, removeCursor, setCursor } from './visualizer';

import type { HandLandmarker, HandLandmarkerResult, Landmark, NormalizedLandmark } from '@mediapipe/tasks-vision';

const HAND_TOUCH_ID = 'hand';

// Keep these pinned for reproducibility (matches package.json dependency).
const MEDIAPIPE_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';
const HAND_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const LOST_HAND_FRAMES_TO_RELEASE = 6;

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

// Detect mobile for platform-specific tuning.
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Platform-specific coefficients:
// - Mobile front cameras have wider FOV (~80°) vs laptops (~60°)
// - Mobile usage is typically closer, with more hand jitter
const CAMERA_FOV_DEG = IS_MOBILE ? 80 : 60;

// Zone thresholds (meters):
// - Pad zone: continuous pad/swell control
// - Pluck zone: single pluck gestures
// Mobile zones are closer due to phone being held nearer.
const PAD_ZONE_ENTER_M = IS_MOBILE ? 0.15 : 0.30;
const PAD_ZONE_EXIT_M = IS_MOBILE ? 0.17 : 0.31;
const PLUCK_ZONE_NEAR_M = IS_MOBILE ? 0.20 : 0.35;
const PLUCK_ZONE_FAR_M = IS_MOBILE ? 0.30 : 0.50;

// X-Y mapping scale: how much of the camera view maps to the full surface.
// >1.0 means less hand movement covers full range.
// Desktop: 70% of view (1/0.7 ≈ 1.43), Mobile: 50% of view (2.0).
const XY_SCALE = IS_MOBILE ? 2.0 : 1.43;
const XY_CENTER = 0.5;

// Pluck velocity thresholds (m/s) - determines attack sharpness.
// Mobile needs higher threshold due to hand jitter from holding phone.
const PLUCK_MIN_VELOCITY_MPS = IS_MOBILE ? 0.35 : 0.25;
const PLUCK_MAX_VELOCITY_MPS = IS_MOBILE ? 1.5 : 1.2;
const PLUCK_VELOCITY_CURVE = 0.4;
const PLUCK_ATTACK_SLOW_S = 0.02;
const PLUCK_ATTACK_FAST_S = 0.001;
// Pluck release is short since it's a transient.
const PLUCK_RELEASE_S = 0.08;
// Velocity must drop below this to re-arm the pluck.
// Higher on mobile to prevent accidental re-triggers.
const PLUCK_REARM_VELOCITY_MPS = IS_MOBILE ? 0.15 : 0.1;

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

function estimateDistanceMeters(video: HTMLVideoElement, a: NormalizedLandmark, b: NormalizedLandmark): number | null {
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (w <= 0 || h <= 0) return null;

    const px = Math.hypot((a.x - b.x) * w, (a.y - b.y) * h);
    if (px < 2) return null;

    const fovRad = CAMERA_FOV_DEG * Math.PI / 180;
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

    const canUseCamera = !!navigator.mediaDevices?.getUserMedia;
    if (!canUseCamera) {
        handBtn.disabled = true;
        handVal.textContent = 'n/a';
        return;
    }

    let enabled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let rafId: number | null = null;

    // Tracking state
    let soundActive = false;
    let soundInRange = false;  // In pad zone (continuous control)
    let soundStartMs = 0;
    let lostSoundFrames = 0;
    let smoothDistM: number | null = null;
    let soundPrevDistM: number | null = null;
    let soundPrevDistMs: number | null = null;
    let smoothApproachVelMps: number | null = null;

    // Pluck zone state (35-50cm range for single plucks).
    let pluckArmed = true;  // Ready to trigger next pluck

    // Smoothed point (0..1 in video coords, origin top-left)
    let smoothSoundX: number | null = null;
    let smoothSoundY: number | null = null;
    let smoothPalm: number | null = null;
    let smoothResonance: number | null = null;
    let smoothReverb: number | null = null;
    let reverbActive = false;

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

    const stopHandVoice = (releaseSeconds?: number) => {
        if (!soundActive) return;
        if (releaseSeconds !== undefined) {
            audio.setHandReleaseSeconds(releaseSeconds);
        }
        const duration = (Date.now() - soundStartMs) / 1000;
        audio.stop(HAND_TOUCH_ID, duration, { applyReleaseEnvelope: false });
        soundActive = false;
        soundInRange = false;
        removeCursor(HAND_TOUCH_ID);
    };

    const teardownCamera = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        stopHandVoice();

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

                // Mirror X to match selfie camera; apply X-Y scaling for mobile.
                const scaledX = XY_CENTER + (smoothSoundX - XY_CENTER) * XY_SCALE;
                const scaledY = XY_CENTER + (smoothSoundY - XY_CENTER) * XY_SCALE;
                const waveX = clamp(1 - scaledX, 0, 1);
                const pitchY = clamp(1 - scaledY, 0, 1);

                soundDistM = video ? estimateDistanceMeters(video, wrist2d, middleMcp) : null;
                if (soundDistM !== null) {
                    smoothDistM = ema(smoothDistM, soundDistM, DIST_EMA_ALPHA);
                }
                const gateDist = smoothDistM ?? soundDistM;

                // Determine which zone the hand is in.
                const inPadZone = gateDist === null
                    ? soundInRange
                    : (soundInRange ? gateDist <= PAD_ZONE_EXIT_M : gateDist <= PAD_ZONE_ENTER_M);
                const inPluckZone = gateDist !== null && gateDist >= PLUCK_ZONE_NEAR_M && gateDist <= PLUCK_ZONE_FAR_M;

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

                // Re-arm pluck when velocity drops low (hand slows down after a jab).
                const currentVel = Math.max(0, smoothApproachVelMps ?? 0);
                if (!pluckArmed && currentVel < PLUCK_REARM_VELOCITY_MPS) {
                    pluckArmed = true;
                }

                // Handle pluck zone: fast jabs trigger single plucks.
                if (inPluckZone && pluckArmed && !soundActive) {
                    const jabVel = Math.max(0, Math.max(smoothApproachVelMps ?? 0, approachVelNowMps));
                    if (jabVel >= PLUCK_MIN_VELOCITY_MPS) {
                        // Trigger a single pluck!
                        pluckArmed = false;

                        // Velocity-dependent attack shaping (faster jab = sharper attack).
                        const tLinear = clamp(
                            (jabVel - PLUCK_MIN_VELOCITY_MPS) / (PLUCK_MAX_VELOCITY_MPS - PLUCK_MIN_VELOCITY_MPS),
                            0,
                            1
                        );
                        const t = Math.pow(tLinear, PLUCK_VELOCITY_CURVE);
                        const attack = PLUCK_ATTACK_SLOW_S * (1 - t) + PLUCK_ATTACK_FAST_S * t;
                        audio.setHandAttackSeconds(attack);
                        audio.setHandReleaseSeconds(PLUCK_RELEASE_S);

                        // Play a short pluck note.
                        soundActive = true;
                        soundStartMs = Date.now();
                        audio.start(HAND_TOUCH_ID);
                        audio.update(waveX, pitchY, HAND_TOUCH_ID, 0);

                        const { width, height } = getCanvasSize();
                        addRipple(waveX * width, (1 - pitchY) * height);
                        setCursor(waveX * width, (1 - pitchY) * height, HAND_TOUCH_ID);

                        // Schedule a short release after the pluck.
                        setTimeout(() => {
                            if (soundActive && !soundInRange) {
                                stopHandVoice(PLUCK_RELEASE_S);
                            }
                        }, 80);
                    }
                }

                // Handle pad zone: continuous control.
                if (inPadZone) {
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

        const distSuffix = soundDistM !== null && isFinite(soundDistM) ? `d=${soundDistM.toFixed(2)}m` : undefined;
        if (!hasFilter && !hasSound) setStatus('show');
        else if (hasFilter && hasSound) setStatus('both', distSuffix);
        else if (hasFilter) setStatus('filter');
        else setStatus('sound', distSuffix);
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
            } else {
                updateFromResult(result);
            }
        } else {
            setStatus('loading');
        }

        rafId = requestAnimationFrame(() => { void loop(); });
    };

    const enable = async () => {
        enabled = true;
        handBtn.disabled = true;
        setStatus('loading');

        try {
            await startCamera();
            // Warm up model load in parallel with camera.
            void getHandLandmarker();
            handBtn.disabled = false;
            setStatus('show');
            rafId = requestAnimationFrame(() => { void loop(); });
        } catch (err) {
            enabled = false;
            teardownCamera();
            handBtn.disabled = false;
            const msg = err instanceof Error ? err.name : 'err';
            setStatus('error', msg);
        }
    };

    const disable = () => {
        enabled = false;
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
