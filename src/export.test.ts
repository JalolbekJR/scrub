import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { verifyClean, verifyCleanPdf } from './forensics';

const jpegBytes = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
const jpegDataUrl = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;


const canvas = {
  toDataURL: () => jpegDataUrl,
  toBlob: (callback: BlobCallback) => callback(new Blob([jpegBytes], { type: 'image/jpeg' })),
} as unknown as HTMLCanvasElement;

const fakeDocument = {
  getElementById: () => canvas,
  createElement: () => canvas,
};
Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });

const { buildExport, resetExportContext, setPdfContext, storeRedactedPage, storeReviewedPage, getReviewedPage } = await import('./export');

function fakePdfDocument(pages: number) {
  return {
    getPage: async () => ({ getViewport: () => ({ width: 20, height: 30 }) }),
    numPages: pages,
  } as never;
}

function countPdfPages(bytes: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(bytes);
  return [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
}

describe('single-file exports', () => {
  afterAll(() => resetExportContext());

  it('snapshots reviewed page corrections and isolates them to one document', () => {
    const doc = fakePdfDocument(2);
    setPdfContext(doc, 2);
    const detections = [{ type: 'manual' as const, bbox: { x: 2, y: 3, width: 10, height: 10 } }];
    storeReviewedPage(1, detections, { width: 20, height: 30 } as HTMLCanvasElement);
    detections[0].bbox.x = 999;
    const review = getReviewedPage(doc, 1)!;
    expect(review.detections[0].bbox.x).toBe(2);
    review.detections.length = 0;
    expect(getReviewedPage(doc, 1)!.detections).toHaveLength(1);
    const other = fakePdfDocument(2);
    expect(getReviewedPage(other, 1)).toBeUndefined();
    setPdfContext(other, 2);
    expect(getReviewedPage(other, 1)).toBeUndefined();
  });

  it('reproduces the one-page PDF routing defect with a synthetic page', async () => {
    setPdfContext(fakePdfDocument(1), 1);
    storeRedactedPage(1, canvas);
    const result = await buildExport();

    // Before the fix this was scrubbed.jpg containing JPEG bytes.
    expect(result.filename).toBe('scrubbed.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(new TextDecoder().decode(new Uint8Array(await result.blob.slice(0, 5).arrayBuffer()))).toBe('%PDF-');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(countPdfPages(bytes)).toBe(1);
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/Subtype /Image');
    expect((await verifyCleanPdf(result.blob, 1)).clean).toBe(true);
  });

  it('preserves every page in a multi-page PDF export', async () => {
    setPdfContext(fakePdfDocument(2), 2);
    storeRedactedPage(1, canvas);
    storeRedactedPage(2, canvas);
    const result = await buildExport();
    expect(result.filename).toBe('scrubbed.pdf');
    expect(result.blob.type).toBe('application/pdf');
    expect(countPdfPages(new Uint8Array(await result.blob.arrayBuffer()))).toBe(2);
    expect((await verifyCleanPdf(result.blob, 2)).clean).toBe(true);
  });

  it('keeps a redacted page when the same PDF is revisited', async () => {
    const doc = fakePdfDocument(2);
    setPdfContext(doc, 2);
    storeRedactedPage(1, canvas);
    setPdfContext(doc, 2); // PDF navigation calls this again.
    storeRedactedPage(2, canvas);
    const result = await buildExport();
    expect(countPdfPages(new Uint8Array(await result.blob.arrayBuffer()))).toBe(2);
  });

  it('does not reuse a redacted page from a different PDF', async () => {
    setPdfContext(fakePdfDocument(1), 1);
    storeRedactedPage(1, canvas);
    setPdfContext(fakePdfDocument(1), 1);
    await expect(buildExport()).rejects.toThrow();
  });

  it('applies the bitmap size limit while exporting oversized PDF pages', async () => {
    const scales: number[] = [];
    const doc = {
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => {
          scales.push(scale);
          return { width: 20_000 * scale, height: 20_000 * scale };
        },
      }),
    } as never;
    setPdfContext(doc, 1);
    storeRedactedPage(1, canvas);
    await buildExport();
    expect(scales.some((scale) => scale < 1.5)).toBe(true);
  });

  it('keeps image exports as JPEG with matching extension, MIME, and signature', async () => {
    resetExportContext();
    const result = await buildExport();
    expect(result.filename).toBe('scrubbed.jpg');
    expect(result.blob.type).toBe('image/jpeg');
    expect([...new Uint8Array(await result.blob.slice(0, 3).arrayBuffer())]).toEqual([0xff, 0xd8, 0xff]);
    expect((await verifyClean(result.blob)).clean).toBe(true);
  });

  it('refuses an over-limit PDF rather than exporting a shortened document', async () => {
    resetExportContext();
    const context = setPdfContext(fakePdfDocument(51), 51);
    expect(context.truncated).toBe(true);
    expect(context.exportedPages).toBe(50);
    await expect(buildExport()).rejects.toThrow(/No pages were exported/);
  });

  it('discards an export cancelled as its final page finishes', async () => {
    resetExportContext(); setPdfContext(fakePdfDocument(1), 1); storeRedactedPage(1, canvas);
    const controller = new AbortController();
    await expect(buildExport({ signal: controller.signal, onProgress: done => { if (done === 1) controller.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
