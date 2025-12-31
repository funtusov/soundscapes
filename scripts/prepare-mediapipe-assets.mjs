import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRC_WASM_DIR = path.join(rootDir, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const DST_WASM_DIR = path.join(rootDir, 'public', 'mediapipe', 'wasm');
const DST_MODEL_DIR = path.join(rootDir, 'public', 'mediapipe', 'models');

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const MODEL_PATH = path.join(DST_MODEL_DIR, 'hand_landmarker.task');

const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const hasNodeModules = await fileExists(path.join(rootDir, 'node_modules'));
  if (!hasNodeModules) {
    throw new Error('node_modules not found; run `npm install` first');
  }

  await fs.mkdir(DST_WASM_DIR, { recursive: true });
  await fs.mkdir(DST_MODEL_DIR, { recursive: true });

  for (const filename of WASM_FILES) {
    const src = path.join(SRC_WASM_DIR, filename);
    const dst = path.join(DST_WASM_DIR, filename);
    try {
      await fs.copyFile(src, dst);
    } catch (err) {
      console.warn(`Warning: failed to copy ${filename} (will use CDN fallback)`);
      console.warn(err instanceof Error ? err.message : String(err));
    }
  }

  if (!(await fileExists(MODEL_PATH))) {
    try {
      const res = await fetch(MODEL_URL);
      if (!res.ok) {
        throw new Error(`Failed to download model (${res.status})`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      await fs.writeFile(MODEL_PATH, buf);
    } catch (err) {
      console.warn(`Warning: failed to download model (will use CDN fallback): ${MODEL_URL}`);
      console.warn(err instanceof Error ? err.message : String(err));
    }
  }

  console.log('MediaPipe assets ready in public/mediapipe');
}

await main();
