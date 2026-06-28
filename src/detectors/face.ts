import type { BoundingBox } from '../types';

// MediaPipe WASM can't init inside a Vite worker (importScripts unavailable in
// module workers, ESM breaks classic workers). Runs on main thread instead —
// BlazeFace is fast enough and OCR stays in its own worker.

const telFaceBackend = document.getElementById('telFaceBackend') as HTMLSpanElement;
const telFaceMs = document.getElementById('telFaceMs') as HTMLSpanElement;

// Self-hosted: the WASM fileset and the .tflite model live in public/vendor and
// are served from our own origin. Nothing is fetched from a third-party CDN.
const WASM_BASE = '/vendor/mediapipe/wasm';
const MODEL_PATH = '/vendor/mediapipe/blaze_face_short_range.tflite';

type Vision = Awaited<ReturnType<typeof import('@mediapipe/tasks-vision')['FilesetResolver']['forVisionTasks']>>;
type Detector = Awaited<ReturnType<typeof import('@mediapipe/tasks-vision')['FaceDetector']['createFromOptions']>>;

let ready: Promise<{ detector: Detector; backend: string } | null> | null = null;

async function makeDetector(vision: Vision, delegate: 'GPU' | 'CPU'): Promise<Detector> {
  const { FaceDetector } = await import('@mediapipe/tasks-vision');
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.4,
  });
}

async function init(): Promise<{ detector: Detector; backend: string } | null> {
  try {
    const { FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    try {
      const detector = await makeDetector(vision, 'GPU');
      return { detector, backend: 'WebGPU' };
    } catch {
      const freshVision = await FilesetResolver.forVisionTasks(WASM_BASE);
      const detector = await makeDetector(freshVision, 'CPU');
      return { detector, backend: 'WASM' };
    }
  } catch {
    console.error('Face model failed to load');
    return null;
  }
}

// BlazeFace resizes its whole input to ~128px, so faces that are small relative
// to the frame disappear. We slice the image into overlapping tiles (~640px)
// and detect inside each one, keeping every face large in its own tile.
const TILE = 640;
const OVERLAP = 128;

function detectInRegion(
  detector: Detector,
  source: HTMLCanvasElement,
  sx: number, sy: number, sw: number, sh: number,
): BoundingBox[] {
  const tile = document.createElement('canvas');
  tile.width = sw;
  tile.height = sh;
  tile.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  const res = detector.detect(tile);
  return (res.detections ?? [])
    .map((d) => d.boundingBox)
    .filter((bb): bb is NonNullable<typeof bb> => !!bb)
    .map((bb) => ({ x: bb.originX + sx, y: bb.originY + sy, width: bb.width, height: bb.height }));
}

function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return inter / union;
}

// Drop duplicates that the tile overlaps produce.
function dedupe(boxes: BoundingBox[]): BoundingBox[] {
  const kept: BoundingBox[] = [];
  for (const box of boxes.sort((a, b) => b.width * b.height - a.width * a.height)) {
    if (!kept.some((k) => iou(k, box) > 0.3)) kept.push(box);
  }
  return kept;
}

export async function detectFaces(imageData: ImageData): Promise<BoundingBox[]> {
  const t0 = performance.now();
  try {
    if (!ready) ready = init();
    const r = await ready;
    if (!r) { telFaceBackend.textContent = 'error'; telFaceMs.textContent = '—'; return []; }

    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);

    const W = canvas.width, H = canvas.height;
    const all: BoundingBox[] = [];

    // Full-frame pass catches large/close faces.
    all.push(...detectInRegion(r.detector, canvas, 0, 0, W, H));

    // Tiled passes catch small faces that the full-frame resize would lose.
    if (W > TILE || H > TILE) {
      const step = TILE - OVERLAP;
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          const sw = Math.min(TILE, W - x);
          const sh = Math.min(TILE, H - y);
          if (sw < 64 || sh < 64) continue;
          all.push(...detectInRegion(r.detector, canvas, x, y, sw, sh));
        }
      }
    }

    const faces = dedupe(all);
    telFaceBackend.textContent = r.backend;
    telFaceMs.textContent = `${Math.round(performance.now() - t0)}ms`;
    return faces;
  } catch {
    console.error('Face detection failed');
    telFaceBackend.textContent = 'error';
    telFaceMs.textContent = '—';
    return [];
  }
}
