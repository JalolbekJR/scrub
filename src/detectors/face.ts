import type { BoundingBox } from '../types';

// MediaPipe WASM can't init inside a Vite worker (importScripts unavailable in
// module workers, ESM breaks classic workers). Runs on main thread instead —
// BlazeFace is fast enough (~1-2s) and OCR stays in its own worker.

const telFaceBackend = document.getElementById('telFaceBackend') as HTMLSpanElement;
const telFaceMs = document.getElementById('telFaceMs') as HTMLSpanElement;

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_PATH = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

type Vision = Awaited<ReturnType<typeof import('@mediapipe/tasks-vision')['FilesetResolver']['forVisionTasks']>>;
type Detector = Awaited<ReturnType<typeof import('@mediapipe/tasks-vision')['FaceDetector']['createFromOptions']>>;

let ready: Promise<{ detector: Detector; backend: string } | null> | null = null;

async function makeDetector(vision: Vision, delegate: 'GPU' | 'CPU'): Promise<Detector> {
  const { FaceDetector } = await import('@mediapipe/tasks-vision');
  return FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.5,
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
  } catch (err) {
    console.error('Face model failed to load'); // no file data ever logged
    return null;
  }
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

    const res = r.detector.detect(canvas);
    const faces: BoundingBox[] = (res.detections ?? [])
      .map((d) => d.boundingBox)
      .filter((bb): bb is NonNullable<typeof bb> => !!bb)
      .map((bb) => ({ x: bb.originX, y: bb.originY, width: bb.width, height: bb.height }));

    telFaceBackend.textContent = r.backend;
    telFaceMs.textContent = `${Math.round(performance.now() - t0)}ms`;
    return faces;
  } catch (err) {
    console.error('Face detection failed');
    telFaceBackend.textContent = 'error';
    telFaceMs.textContent = '—';
    return [];
  }
}
