import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { redactAll } from './redactor';
import { exportBlockedBy } from './failclosed';
import type { Detection, DetectionType, DetectorHealth } from './types';

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

// Run face + text detection on a single bitmap and report the health of each
// detector. Used to cover PDF pages the user never opened. The caller decides
// what to do when a *required* detector fails — `autoRedactCanvas` fails closed.
//
// `face` is required only when faces are selected. `ocr` is required when any
// text category (email / phone / card / name) is selected, since those all come
// from OCR. A detector that isn't needed is marked 'disabled' and never run.
export async function detectAll(imageData: ImageData): Promise<{ detections: Detection[]; health: DetectorHealth }> {
  const dets: Detection[] = [];
  const health: DetectorHealth = { face: 'disabled', ocr: 'disabled' };
  const sel = selectedTypes();

  const needFace = sel.face;
  const needOcr = sel.email || sel.phone || sel.card || sel.name;

  if (needFace) {
    try {
      const faces = await detectFaces(clone(imageData));
      dets.push(...faces.map((bb) => ({ type: 'face' as const, bbox: bb })));
      health.face = 'success';
    } catch (err) {
      health.face = 'failed';
      health.failureMessage = `Face detection failed: ${String(err)}`;
    }
  }

  if (needOcr) {
    try {
      const pii = await detectPii(clone(imageData));
      dets.push(...pii);
      health.ocr = 'success';
    } catch (err) {
      health.ocr = 'failed';
      health.failureMessage = `OCR failed: ${String(err)}`;
    }
  }

  return { detections: dets, health };
}

// Detect, then burn the selected categories into the canvas in place.
// Fails closed: if a required detector failed, throw instead of silently
// exporting a page whose cleanliness can't be vouched for.
export async function autoRedactCanvas(canvas: HTMLCanvasElement): Promise<number> {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { detections, health } = await detectAll(imageData);

  const blockedReason = exportBlockedBy(health);
  if (blockedReason) throw new Error(blockedReason);

  const sel = selectedTypes();
  const boxes = detections.filter((d) => sel[d.type]).map((d) => d.bbox);
  redactAll(canvas, boxes);
  return boxes.length;
}
