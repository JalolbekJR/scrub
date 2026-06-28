import { createWorker } from 'tesseract.js';

interface WordResult {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

// Shape of the slice of tesseract's result we walk (its types don't expose blocks).
interface OcrWord { text?: string; bbox?: { x0: number; y0: number; x1: number; y1: number }; }
interface OcrLine { words?: OcrWord[]; }
interface OcrPara { lines?: OcrLine[]; }
interface OcrBlock { paragraphs?: OcrPara[]; }
interface OcrData { blocks?: OcrBlock[]; }

let ocrWorker: Awaited<ReturnType<typeof createWorker>> | null = null;

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await createWorker('eng', 1, {
      workerPath: new URL('tesseract.js/dist/worker.min.js', import.meta.url).href,
      langPath: '/vendor/tessdata',
      corePath: new URL('tesseract.js-core/tesseract-core-simd.wasm.js', import.meta.url).href,
      logger: (m: { status?: string; progress?: number }) => {
        self.postMessage({ type: 'progress', status: m.status, progress: m.progress });
      },
    });
  }
  return ocrWorker;
}

self.onmessage = async (e: MessageEvent<{ imageData: ImageData; width: number; height: number }>) => {
  const t0 = performance.now();
  try {
    const { imageData, width, height } = e.data;

    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);

    const blob = await offscreen.convertToBlob({ type: 'image/png' });

    const worker = await getOcrWorker();
    // tesseract.js v5+ no longer populates `data.words`; word-level boxes live
    // under blocks→paragraphs→lines→words, and only when `blocks` is requested.
    const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });

    const words: WordResult[] = [];
    const blocks = (data as unknown as OcrData).blocks ?? [];
    for (const block of blocks) {
      for (const para of (block.paragraphs ?? [])) {
        for (const line of (para.lines ?? [])) {
          for (const w of (line.words ?? [])) {
            if (w && w.text && w.bbox) {
              words.push({ text: w.text, bbox: w.bbox });
            }
          }
        }
      }
    }

    const ms = Math.round(performance.now() - t0);
    self.postMessage({ words, ms });
  } catch (err) {
    // Always post back — a thrown OCR must never hang the UI
    self.postMessage({ error: String(err), ms: Math.round(performance.now() - t0) });
  }
};
