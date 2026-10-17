import type { WordResult } from './pii-match';

export type QuarterTurn = 0 | 1 | 2 | 3;

// Small text strips benefit from larger glyphs. Bound the raster cost; ordinary
// photographs and rendered PDF pages keep their original OCR resolution.
export function ocrRasterScale(width: number, height: number): 1 | 2 {
  const long = Math.max(width, height), short = Math.min(width, height);
  return long >= 256 && long <= 640 && short >= 32 && short <= 256 ? 2 : 1;
}

// Inverse of a clockwise raster quarter-turn. Bounds are pixel edges, not centers.
export function sourceWord(word: WordResult, turn: QuarterTurn, width: number, height: number, scale: 1 | 2 = 1): WordResult {
  const b = { x0: word.bbox.x0 / scale, y0: word.bbox.y0 / scale, x1: word.bbox.x1 / scale, y1: word.bbox.y1 / scale };
  const bbox = turn === 1 ? { x0: b.y0, y0: height - b.x1, x1: b.y1, y1: height - b.x0 }
    : turn === 2 ? { x0: width - b.x1, y0: height - b.y1, x1: width - b.x0, y1: height - b.y0 }
    : turn === 3 ? { x0: width - b.y1, y0: b.x0, x1: width - b.y0, y1: b.x1 }
    : { ...b };
  return { ...word, bbox };
}

export function recognitionScore(words: Array<{ text?: string; confidence?: number }>): number {
  let weighted = 0, length = 0;
  for (const word of words) {
    const n = word.text?.trim().length ?? 0;
    if (!Number.isFinite(word.confidence) || !n) continue;
    length += n; weighted += n * Math.max(0, word.confidence!);
  }
  return length ? weighted / length : 0;
}
