import type { BoundingBox, Detection, DetectionType } from '../types';

const telOcrMs = document.getElementById('telOcrMs') as HTMLSpanElement;

const OCR_TIMEOUT = 60000;

interface WordResult {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(\+?[\d\s()\\.-]{7,15}\d)/g;
const CARD_RE  = /\b(?:\d[ -]?){13,16}\b/g;

// Common name prefixes to help identify names
const NAME_PREFIX_RE = /\b(Mr|Mrs|Ms|Dr|Prof|Sir|Lady|Lord)\.?\s+[A-Z][a-z]+/g;

function luhn(num: string): boolean {
  const digits = num.replace(/\D/g, '');
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface PlacedWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  start: number; // char offset in the joined line text
  end: number;
}

// Group words into lines by vertical overlap, ordered left-to-right.
function groupLines(words: WordResult[]): PlacedWord[][] {
  const sorted = [...words].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines: WordResult[][] = [];
  for (const w of sorted) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const line = lines.find((l) => {
      const ref = l[0].bbox;
      return cy >= ref.y0 && cy <= ref.y1; // center falls within an existing line's band
    });
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => {
    const ordered = l.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let cursor = 0;
    return ordered.map((w) => {
      const start = cursor;
      const end = start + w.text.length;
      cursor = end + 1; // +1 for the joining space
      return { text: w.text, bbox: w.bbox, start, end };
    });
  });
}

// Union bbox of all words overlapping the [mStart, mEnd) char span.
function spanBbox(line: PlacedWord[], mStart: number, mEnd: number): BoundingBox | null {
  const hit = line.filter((w) => w.start < mEnd && w.end > mStart);
  if (hit.length === 0) return null;
  const x0 = Math.min(...hit.map((w) => w.bbox.x0));
  const y0 = Math.min(...hit.map((w) => w.bbox.y0));
  const x1 = Math.max(...hit.map((w) => w.bbox.x1));
  const y1 = Math.max(...hit.map((w) => w.bbox.y1));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export type OcrProgress = (status: string, progress: number) => void;

function runOcr(imageData: ImageData, onProgress?: OcrProgress): Promise<{ words: WordResult[]; ms: number }> {
  return new Promise((resolve) => {
    const w = getWorker();
    let settled = false;
    // Clone buffer so transfer doesn't break our reference
    const copy = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    const finish = (words: WordResult[], ms: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.onmessage = null;
      w.onerror = null;
      resolve({ words, ms });
    };

    const timer = setTimeout(() => {
      console.warn('OCR timed out');
      finish([], 0);
    }, OCR_TIMEOUT);

    w.onmessage = (e: MessageEvent<{ type?: string; status?: string; progress?: number; words?: WordResult[]; ms?: number; error?: string }>) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.status ?? '', e.data.progress ?? 0);
        return;
      }
      if (e.data.error) {
        console.error('OCR worker error:', e.data.error);
        finish([], 0);
        return;
      }
      finish(e.data.words ?? [], e.data.ms ?? 0);
    };

    w.onerror = (err) => {
      console.error('OCR worker crashed:', err.message);
      finish([], 0);
    };

    w.postMessage({ imageData: copy, width: copy.width, height: copy.height }, [copy.data.buffer]);
  });
}

export async function detectPii(imageData: ImageData, onProgress?: OcrProgress): Promise<Detection[]> {
  const { words, ms } = await runOcr(imageData, onProgress);
  telOcrMs.textContent = `${ms}ms`;

  const detections: Detection[] = [];
  const lines = groupLines(words);

  for (const line of lines) {
    const text = line.map((w) => w.text).join(' ');
    // Track claimed char spans so a card isn't also flagged as a phone, etc.
    const claimed: Array<[number, number]> = [];
    const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && e > cs);

    const claim = (type: DetectionType, label: string, mStart: number, mEnd: number) => {
      if (overlaps(mStart, mEnd)) return;
      const bbox = spanBbox(line, mStart, mEnd);
      if (!bbox) return;
      claimed.push([mStart, mEnd]);
      detections.push({ type, bbox, label });
    };

    // Order matters: most specific first so loose patterns don't steal spans.
    for (const m of text.matchAll(EMAIL_RE)) {
      claim('email', 'EMAIL', m.index!, m.index! + m[0].length);
    }
    for (const m of text.matchAll(CARD_RE)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 16 && luhn(digits)) {
        claim('card', 'CARD', m.index!, m.index! + m[0].length);
      }
    }
    for (const m of text.matchAll(PHONE_RE)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) {
        claim('phone', 'PHONE', m.index!, m.index! + m[0].length);
      }
    }
    for (const m of text.matchAll(NAME_PREFIX_RE)) {
      claim('name', 'NAME', m.index!, m.index! + m[0].length);
    }
  }

  return detections;
}
