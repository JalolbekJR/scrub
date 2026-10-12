import { createWorker } from 'tesseract.js';
import { recognitionScore, sourceWord, type QuarterTurn } from '../detectors/ocr-orientation';

interface WordResult {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  line: number;
  order: number;
}

// Shape of the slice of tesseract's result we walk (its types don't expose blocks).
interface OcrWord { text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number }; }
interface OcrLine { words?: OcrWord[]; }
interface OcrPara { lines?: OcrLine[]; }
interface OcrBlock { paragraphs?: OcrPara[]; }
interface OcrData { blocks?: OcrBlock[]; }

let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;
let pendingRaster: { turn: QuarterTurn; resolve: (blob: Blob) => void } | null = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    // Absolute URL — Tesseract's internal worker can't resolve a root-relative
    // path against its own (blob) base, so build the full origin-qualified URL.
    const langPath = new URL('/vendor/tessdata', self.location.origin).href;
    ocrWorker = await createWorker('eng', 1, {
      workerPath: new URL('tesseract.js/dist/worker.min.js', import.meta.url).href,
      langPath,
      corePath: new URL('tesseract.js-core/tesseract-core-simd.wasm.js', import.meta.url).href,
      logger: (m: { status?: string; progress?: number }) => {
        self.postMessage({ type: 'progress', status: m.status, progress: m.progress });
      },
    });
  }
  return ocrWorker;
}

self.onmessage = async (e: MessageEvent<{ imageData: ImageData; width: number; height: number; raster?: Blob; turn?: QuarterTurn }>) => {
  if (e.data.raster) {
    if (pendingRaster && e.data.turn === pendingRaster.turn) { const pending = pendingRaster; pendingRaster = null; pending.resolve(e.data.raster); }
    return;
  }
  const t0 = performance.now();
  try {
    const { imageData, width, height } = e.data;

    const offscreen = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : null;
    const ctx = offscreen?.getContext('2d');
    ctx?.putImageData(imageData, 0, 0);

    const worker = await getOcrWorker();
    // tesseract.js v5+ no longer populates `data.words`; word-level boxes live
    // under blocks→paragraphs→lines→words, and only when `blocks` is requested.
    let words: WordResult[] = [], bestScore = -1;
    for (const turn of [0, 1, 2, 3] as QuarterTurn[]) {
      let blob: Blob;
      if (offscreen && ctx) {
        const rotated = new OffscreenCanvas(turn % 2 ? height : width, turn % 2 ? width : height);
        const rc = rotated.getContext('2d')!;
        if (turn === 1) rc.translate(height, 0);
        if (turn === 2) rc.translate(width, height);
        if (turn === 3) rc.translate(0, width);
        rc.rotate(turn * Math.PI / 2); rc.drawImage(offscreen, 0, 0);
        blob = await rotated.convertToBlob({ type: 'image/png' });
        rotated.width = 0; rotated.height = 0;
      } else {
        // Older WebKit worker environments lack OffscreenCanvas. Request one
        // local main-thread raster at a time; recognition still stays here.
        blob = await new Promise<Blob>(resolve => {
          pendingRaster = { turn, resolve }; self.postMessage({ type: 'raster-needed', turn });
        });
      }
      const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });
      const candidate: WordResult[] = [], confidenceWords: OcrWord[] = [];
      const blocks = (data as unknown as OcrData).blocks ?? [];
      let lineId = 0;
      for (const block of blocks) {
        for (const para of (block.paragraphs ?? [])) {
          for (const line of (para.lines ?? [])) {
            for (const w of (line.words ?? [])) {
              if (w && w.text && w.bbox) {
                confidenceWords.push(w);
                candidate.push({ ...sourceWord({ text: w.text, bbox: w.bbox }, turn, width, height), line: lineId, order: candidate.length });
              }
            }
            lineId++;
          }
        }
      }
      const score = recognitionScore(confidenceWords);
      // Keep upright on ties; do not combine gibberish from competing orientations.
      if (score > bestScore) { bestScore = score; words = candidate; }
    }

    const ms = Math.round(performance.now() - t0);
    self.postMessage({ words, ms });
  } catch (err) {
    // Always post back — a thrown OCR must never hang the UI
    self.postMessage({ error: String(err), ms: Math.round(performance.now() - t0) });
  }
};
