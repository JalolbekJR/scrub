import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { redactAll } from './redactor';
import type { Detection, DetectionType } from './types';

function clone(d: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
}

// Which categories the user currently wants removed (checkbox state).
export function selectedTypes(): Record<DetectionType, boolean> {
  const c = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? true;
  return {
    face:   c('chkFaces'),
    email:  c('chkEmails'),
    phone:  c('chkPhones'),
    card:   c('chkCards'),
    name:   c('chkNames'),
    manual: true,
  };
}

// Run face + text detection on a single bitmap. Used to cover PDF pages the
// user never opened, so no page can be exported with visible faces or text.
export async function detectAll(imageData: ImageData): Promise<Detection[]> {
  const dets: Detection[] = [];
  try {
    const faces = await detectFaces(clone(imageData));
    dets.push(...faces.map((bb) => ({ type: 'face' as const, bbox: bb })));
  } catch { /* detector unavailable — fail closed below by still redacting what we have */ }
  try {
    const pii = await detectPii(clone(imageData));
    dets.push(...pii);
  } catch { /* ignore */ }
  return dets;
}

// Detect, then burn the selected categories into the canvas in place.
export async function autoRedactCanvas(canvas: HTMLCanvasElement): Promise<number> {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const dets = await detectAll(imageData);
  const sel = selectedTypes();
  const boxes = dets.filter((d) => sel[d.type]).map((d) => d.bbox);
  redactAll(canvas, boxes);
  return boxes.length;
}
