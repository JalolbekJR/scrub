import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ocrRaster = readFileSync(new URL('../fixtures/ocr-quarter-turns.png', import.meta.url)).toString('base64');

for (const angle of [0, 90, 180, 270]) test(`OCR ${angle} degrees covers sensitive ink in downloaded JPEG`, async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/');
  const pending = page.waitForEvent('download');
  const result = await page.evaluate(async ({ angle, raster }) => {
    const { detectPii } = await import('/src/detectors/pii.ts');
    const c = document.createElement('canvas'); c.width = 1000; c.height = 360;
    const ctx = c.getContext('2d')!;
    // Fixed pixels: generic monospace resolves differently across engines and
    // can turn the @ glyph into an OCR "l" on WebKit. Keep identical input.
    const image = new Image(); image.src = `data:image/png;base64,${raster}`; await image.decode(); ctx.drawImage(image, 0, 0);
    const out = document.getElementById('mainCanvas') as HTMLCanvasElement;
    out.width = angle % 180 ? c.height : c.width; out.height = angle % 180 ? c.width : c.height;
    const oc = out.getContext('2d')!; oc.save();
    if (angle === 90) oc.translate(c.height, 0); if (angle === 180) oc.translate(c.width, c.height); if (angle === 270) oc.translate(0, c.width);
    oc.rotate(angle * Math.PI / 180); oc.drawImage(c, 0, 0); oc.restore();
    const original = oc.getImageData(0, 0, out.width, out.height);
    const start = performance.now(); const detections = await detectPii(original);
    const ms = performance.now() - start;
    const ink: number[] = [];
    const referencePixels = ctx.getImageData(0, 0, c.width, c.height).data;
    // Independent known annotation: first four lines only, excluding negative examples.
    for (let y = 20; y < 200; y++) for (let x = 28; x < 350; x++) {
      if (referencePixels[(y * c.width + x) * 4] >= 100) continue;
      const [rx, ry] = angle === 90 ? [c.height - 1 - y, x] : angle === 180 ? [c.width - 1 - x, c.height - 1 - y] : angle === 270 ? [y, c.width - 1 - x] : [x, y];
      ink.push((ry * out.width + rx) * 4);
    }
    const { renderRegions } = await import('/src/mask-renderer.ts'); renderRegions(out, detections);
    const { buildExport, resetExportContext, triggerDownload } = await import('/src/export.ts'); resetExportContext();
    const built = await buildExport();
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); };
    await triggerDownload(built.filename, built.blob);
    return { detections, ms, ink, width: out.width, height: out.height };
  }, { angle, raster: ocrRaster });
  const download = await pending;
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  expect(result.detections.map(d => d.type).sort()).toEqual(['card', 'email', 'name', 'phone']);
  console.warn('ROTATED_OCR', JSON.stringify({ angle, ms: result.ms, detections: result.detections }));
  const encoded = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const pixels = await page.evaluate(async ({ encoded, ink }) => {
    const image = new Image(); image.src = encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return ink.filter(i => data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8).length;
  }, { encoded, ink: result.ink });
  expect(pixels).toBe(0);
});

test('PDF Rotate entries preserve four-page OCR mask alignment in downloaded raster output', async ({ page }) => {
  test.setTimeout(180000); await page.goto('/');
  const pending = page.waitForEvent('download');
  const metrics = await page.evaluate(async () => {
    const { jsPDF, getDocument } = await import('/e2e/browser-harness.ts');
    const { buildExport, setPdfContext, triggerDownload } = await import('/src/export.ts');
    const pdf = new jsPDF({ unit: 'pt', format: [600, 240], orientation: 'landscape' });
    const c = document.createElement('canvas'); c.width = 600; c.height = 240;
    const ctx = c.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 240); ctx.fillStyle = '#202060'; ctx.font = '28px monospace';
    ['alice@example.com', '+44 (20) 7946 0958', '4111 1111 1111 1111', 'Dr. Alice Smith'].forEach((s, i) => ctx.fillText(s, 30, 45 + i * 50));
    for (let p = 0; p < 4; p++) { if (p) pdf.addPage(); pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 600, 240); }
    let n = 0; const bytes = pdf.output().replace(/\/Type \/Page\b/g, match => `${match}\n/Rotate ${n++ * 90}`);
    const task = getDocument({ data: Uint8Array.from(bytes, char => char.charCodeAt(0)), isEvalSupported: false });
    try {
      const doc = await task.promise; setPdfContext(doc, 4); const start = performance.now(); const built = await buildExport();
      (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture PDF'); };
      await triggerDownload(built.filename, built.blob); return { ms: performance.now() - start, pages: built.pageCount };
    } finally { await task.destroy(); }
  });
  const bytes = readFileSync(await (await pending).path()); expect(metrics.pages).toBe(4);
  const result = await page.evaluate(async encoded => {
    const { getDocument } = await import('/e2e/browser-harness.ts'); const { verifyCleanPdf } = await import('/src/forensics.ts');
    const data = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); const verified = await verifyCleanPdf(new Blob([data], { type: 'application/pdf' }), 4);
    const task = getDocument({ data: data.slice(), isEvalSupported: false }); const uncovered = [], sizes = [];
    try {
      const doc = await task.promise;
      for (let p = 1; p <= 4; p++) {
        const pdfPage = await doc.getPage(p), vp = pdfPage.getViewport({ scale: 1 });
        sizes.push([vp.width, vp.height]);
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext('2d')!;
        await pdfPage.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        let count = 0;
        // Known interior text-band coordinates in the original 600x240 page.
        for (let line = 0; line < 4; line++) for (let y = 30 + 50 * line; y < 43 + 50 * line; y++) for (let x = 36; x < 250; x++) {
          const angle = (p - 1) * 90;
          const [nx, ny] = angle === 90 ? [(240 - y) / 240, x / 600] : angle === 180 ? [(600 - x) / 600, (240 - y) / 240] : angle === 270 ? [y / 240, (600 - x) / 600] : [x / 600, y / 240];
          const rgba = ctx.getImageData(Math.floor(nx * c.width), Math.floor(ny * c.height), 1, 1).data;
          if (rgba[0] > 8 || rgba[1] > 8 || rgba[2] > 8) count++;
        }
        uncovered.push(count);
      }
      return { pages: doc.numPages, uncovered, sizes, clean: verified.clean };
    } finally { await task.destroy(); }
  }, bytes.toString('base64'));
  console.warn('ROTATED_PDF_GEOMETRY', JSON.stringify(result));
  expect(result.sizes).toEqual([[1200, 480], [480, 1200], [1200, 480], [480, 1200]]);
  expect(result.pages).toBe(4); expect(result.clean).toBe(true); expect(result.uncovered).toEqual([0, 0, 0, 0]);
  console.warn('ROTATED_PDF', JSON.stringify(metrics));
});
