import type { BoundingBox, Detection, DetectionType } from '../types';

export interface WordResult {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  line?: number;
  // Reading order in the normalized OCR raster, retained after box remapping.
  order?: number;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9-]+(?:\s*\.\s*[a-zA-Z0-9-]+)*\s*\.\s*[a-zA-Z]{2,}\b/g;
// Consume the entire numeric run before validating; never classify a substring
// of an invalid card or a long identifier as a phone.
const NUMBER_RE = /(?<![\p{L}\d])(?:\+\d|\(\d|\d)[\d ().-]*\d(?![\p{L}\d])/gu;

// Common name prefixes to help identify names
const NAME_PREFIX_RE = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sir|Lady|Lord)\.?\s+\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2}/gu;

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
  return /[1-9]/.test(digits) && sum % 10 === 0;
}

interface PlacedWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  start: number; // char offset in the joined line text
  end: number;
}

// Group words into lines by vertical overlap, ordered left-to-right.
function groupLines(words: WordResult[]): PlacedWord[][] {
  const sorted = words.map(w => ({ ...w, text: w.text.normalize('NFKC').replace(/[‐‑–−]/g, '-') }))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines: WordResult[][] = [];
  for (const w of sorted) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const line = lines.find((l) => {
      if (w.line !== undefined || l[0].line !== undefined) return w.line === l[0].line;
      const ref = l[0].bbox;
      return cy >= ref.y0 && cy <= ref.y1; // center falls within an existing line's band
    });
    if (line) line.push(w);
    else lines.push([w]);
  }
  return lines.map((l) => {
    const ordered = l.sort((a, b) => a.order !== undefined && b.order !== undefined ? a.order - b.order : a.bbox.x0 - b.bbox.x0);
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

export function matchPii(words: WordResult[]): Detection[] {
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
    for (const m of text.matchAll(NUMBER_RE)) {
      const digits = m[0].replace(/\D/g, '');
      const value = m[0].trim();
      if (digits.length >= 13 && digits.length <= 19 && /^[\d -]+$/.test(value)) {
        if (luhn(digits)) claim('card', 'CARD', m.index!, m.index! + m[0].length);
        continue;
      }
      const date = /^(?:\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4})$/.test(value);
      const decimal = /^\d+\.\d+$/.test(value);
      if (digits.length >= 7 && digits.length <= 15 && /[1-9]/.test(digits) && !date && !decimal) {
        claim('phone', 'PHONE', m.index!, m.index! + m[0].length);
      }
    }
    for (const m of text.matchAll(NAME_PREFIX_RE)) {
      claim('name', 'NAME', m.index!, m.index! + m[0].length);
    }
  }

  return detections;
}
