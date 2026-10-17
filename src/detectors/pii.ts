import type { Detection } from '../types';
import { matchPii, type WordResult } from './pii-match';
import { ocrRasterScale, type QuarterTurn } from './ocr-orientation';

const telOcrMs = document.getElementById('telOcrMs') as HTMLSpanElement;

const OCR_TIMEOUT = 60000;

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
let cancelActive: (() => void) | undefined;
export function cancelPii(releaseIdleWorker = false) {
  generation++; cancelActive?.(); cancelActive = undefined;
  if (releaseIdleWorker) { worker?.terminate(); worker = null; }
  queue = Promise.resolve();
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export type OcrProgress = (status: string, progress: number) => void;

// `failed` distinguishes a genuine OCR failure (timeout / worker error / crash)
// from a successful run that simply found no text. Callers that must fail closed
// (e.g. auto-redacting an unopened PDF page) rely on this flag.
function runOcr(imageData: ImageData, onProgress?: OcrProgress): Promise<{ words: WordResult[]; ms: number; failed: boolean }> {
  const epoch = generation;
  const request = queue.then(() => epoch === generation ? performOcr(imageData, onProgress) : { words: [], ms: 0, failed: true });
  queue = request.catch(() => undefined);
  return request;
}

function performOcr(imageData: ImageData, onProgress?: OcrProgress): Promise<{ words: WordResult[]; ms: number; failed: boolean }> {
  return new Promise((resolve) => {
    const w = getWorker();
    let settled = false;
    let fallbackSource: HTMLCanvasElement | null = null;
    // Clone buffer so transfer doesn't break our reference
    const copy = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    const finish = (words: WordResult[], ms: number, failed = false) => {
      if (settled) return;
      settled = true;
      cancelActive = undefined;
      clearTimeout(timer);
      w.onmessage = null;
      w.onerror = null;
      if (fallbackSource) { fallbackSource.width = 0; fallbackSource.height = 0; fallbackSource = null; }
      if (failed) { w.terminate(); worker = null; }
      resolve({ words, ms, failed });
    };

    const timer = setTimeout(() => {
      console.warn('OCR timed out');
      finish([], 0, true);
    }, OCR_TIMEOUT);

    cancelActive = () => finish([], 0, true);
    w.onmessage = async (e: MessageEvent<{ type?: string; status?: string; progress?: number; words?: WordResult[]; ms?: number; error?: string; turn?: QuarterTurn; scale?: number }>) => {
      if (e.data.type === 'raster-needed') {
        const turn = e.data.turn;
        const scale = e.data.scale ?? 1;
        if (settled || turn === undefined || ![0, 1, 2, 3].includes(turn) || scale !== ocrRasterScale(imageData.width, imageData.height)) { finish([], 0, true); return; }
        const rotated = document.createElement('canvas');
        try {
          if (!fallbackSource) {
            fallbackSource = document.createElement('canvas'); fallbackSource.width = imageData.width; fallbackSource.height = imageData.height;
            fallbackSource.getContext('2d')!.putImageData(imageData, 0, 0);
          }
          const { width, height } = imageData; rotated.width = (turn % 2 ? height : width) * scale; rotated.height = (turn % 2 ? width : height) * scale;
          const rc = rotated.getContext('2d')!;
          rc.scale(scale, scale);
          if (turn === 1) rc.translate(height, 0);
          if (turn === 2) rc.translate(width, height);
          if (turn === 3) rc.translate(0, width);
          rc.rotate(turn * Math.PI / 2); rc.drawImage(fallbackSource, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) => rotated.toBlob(blob => blob ? resolve(blob) : reject(new Error('OCR raster encode failed')), 'image/png'));
          if (!settled) w.postMessage({ raster: blob, turn });
        } catch { finish([], 0, true); }
        finally { rotated.width = 0; rotated.height = 0; }
        return;
      }
      if (e.data.type === 'progress') {
        onProgress?.(e.data.status ?? '', e.data.progress ?? 0);
        return;
      }
      if (e.data.error) {
        console.error('OCR worker failed');
        finish([], 0, true);
        return;
      }
      const words = e.data.words;
      const valid = Array.isArray(words) && Number.isFinite(e.data.ms) && words.every(word => {
        const b = word?.bbox;
        return typeof word?.text === 'string' && b
          && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)
          && b.x0 >= 0 && b.y0 >= 0 && b.x1 > b.x0 && b.y1 > b.y0
          && b.x1 <= imageData.width && b.y1 <= imageData.height;
      });
      finish(valid ? words! : [], e.data.ms ?? 0, !valid);
    };

    w.onerror = () => {
      console.error('OCR worker crashed');
      finish([], 0, true);
    };

    try {
      w.postMessage({ imageData: copy, width: copy.width, height: copy.height }, [copy.data.buffer]);
    } catch {
      finish([], 0, true);
    }
  });
}

export async function detectPii(imageData: ImageData, onProgress?: OcrProgress, inspectWords?: (words: WordResult[]) => void): Promise<Detection[]> {
  const { words, ms, failed } = await runOcr(imageData, onProgress);
  if (failed) {
    // OCR could not run to completion. Throw so fail-closed callers block the
    // export rather than treating "no words" as "no private text".
    telOcrMs.textContent = 'error';
    throw new Error('OCR failed or timed out');
  }
  telOcrMs.textContent = `${ms}ms`;
  inspectWords?.(words);
  return matchPii(words);
}
