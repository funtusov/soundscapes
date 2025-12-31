import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

type InitMessage = {
    type: 'init';
    wasmBaseUrls: string[];
    modelAssetPaths: string[];
    numHands: number;
    minHandDetectionConfidence: number;
    minHandPresenceConfidence: number;
    minTrackingConfidence: number;
};

type DetectMessage = {
    type: 'detect';
    frame: ImageBitmap | VideoFrame;
    timestamp: number;
};

type InMessage = InitMessage | DetectMessage;

type ReadyMessage = { type: 'ready' };
type ResultMessage = { type: 'result'; result: unknown };
type ErrorMessage = { type: 'error'; error: string };
type OutMessage = ReadyMessage | ResultMessage | ErrorMessage;

const ctx = self as unknown as {
    postMessage: (message: OutMessage) => void;
    onmessage: ((ev: MessageEvent<InMessage>) => void) | null;
};

let landmarker: HandLandmarker | null = null;
let initPromise: Promise<void> | null = null;

function post(message: OutMessage) {
    ctx.postMessage(message);
}

async function init(msg: InitMessage) {
    const createLandmarker = async (wasmBaseUrl: string, modelAssetPath: string, delegate: 'GPU' | 'CPU') => {
        const vision = await FilesetResolver.forVisionTasks(wasmBaseUrl);
        return HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath,
                delegate,
            },
            runningMode: 'VIDEO',
            numHands: msg.numHands,
            minHandDetectionConfidence: msg.minHandDetectionConfidence,
            minHandPresenceConfidence: msg.minHandPresenceConfidence,
            minTrackingConfidence: msg.minTrackingConfidence,
        });
    };

    let lastErr: unknown = null;

    for (const delegate of ['GPU', 'CPU'] as const) {
        for (const wasmBaseUrl of msg.wasmBaseUrls) {
            for (const modelAssetPath of msg.modelAssetPaths) {
                try {
                    landmarker = await createLandmarker(wasmBaseUrl, modelAssetPath, delegate);
                    post({ type: 'ready' });
                    return;
                } catch (err) {
                    lastErr = err;
                    try {
                        landmarker?.close();
                    } catch {
                        // ignore
                    }
                    landmarker = null;
                }
            }
        }
    }

    const name = lastErr instanceof Error ? lastErr.name : 'err';
    const msgText = lastErr instanceof Error ? lastErr.message : '';
    const details = msgText ? `${name}: ${msgText}` : name;
    throw new Error(details);
}

async function detect(msg: DetectMessage) {
    if (initPromise) await initPromise;
    if (!landmarker) throw new Error('landmarker_not_ready');

    let result: unknown;
    try {
        result = landmarker.detectForVideo(msg.frame, msg.timestamp);
    } finally {
        try {
            (msg.frame as unknown as { close?: () => void }).close?.();
        } catch {
            // ignore
        }
    }

    post({ type: 'result', result });
}

ctx.onmessage = (ev: MessageEvent<InMessage>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;

    if (msg.type === 'init') {
        initPromise = init(msg).catch((err) => {
            const name = err instanceof Error ? err.name : 'err';
            const message = err instanceof Error ? err.message : String(err ?? '');
            const details = message ? `${name}: ${message}` : name;
            post({ type: 'error', error: details });
            throw err;
        });
        return;
    }

    if (msg.type === 'detect') {
        void detect(msg).catch((err) => {
            const name = err instanceof Error ? err.name : 'err';
            const message = err instanceof Error ? err.message : String(err ?? '');
            const details = message ? `${name}: ${message}` : name;
            post({ type: 'error', error: details });
        });
    }
};
