import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const ocrRaster = readFileSync(new URL('../fixtures/ocr-small-text.png', import.meta.url)).toString('base64');

const cases = [0, 90, 180, 270].map(angle => ({ angle, fallback: false })).concat({ angle: 90, fallback: true });
for (const { angle, fallback } of cases) test(`small-text OCR ${angle} degrees${fallback ? ' without OffscreenCanvas' : ''} covers sensitive ink in downloaded JPEG`, async ({ page }) => {
  test.setTimeout(120000);
  let routed = 0;
  if (fallback) await page.route('**/src/workers/ocr.worker.ts*', async route => {
    const response = await route.fetch(); routed++;
    await route.fulfill({ response, body: 'self.OffscreenCanvas = undefined;\n' + await response.text() });
  });
  const created = fallback ? page.waitForEvent('worker', worker => worker.url().includes('ocr.worker')) : null;
  await page.goto('/');
  const pending = page.waitForEvent('download');
  const result = await page.evaluate(async ({ angle, raster }) => {
    const { detectPii } = await import('/src/detectors/pii.ts');
    const c = document.createElement('canvas'); c.width = 500; c.height = 180;
    const ctx = c.getContext('2d')!;
    // Fixed small glyphs reproduce the DejaVu @-as-g recognition failure.
    // No platform font resolution or mocked OCR is involved in this test.
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
    for (let y = 10; y < 100; y++) for (let x = 14; x < 175; x++) {
      if (referencePixels[(y * c.width + x) * 4] >= 100) continue;
      const [rx, ry] = angle === 90 ? [c.height - 1 - y, x] : angle === 180 ? [c.width - 1 - x, c.height - 1 - y] : angle === 270 ? [y, c.width - 1 - x] : [x, y];
      ink.push((ry * out.width + rx) * 4);
    }
    const { renderRegions } = await import('/src/mask-renderer.ts'); renderRegions(out, detections);
    const { buildExport, resetExportContext, triggerDownload } = await import('/src/export.ts'); resetExportContext();
    const built = await buildExport();
    const { verifyClean } = await import('/src/forensics.ts');
    if (!(await verifyClean(built.blob)).clean) throw new Error('Synthetic output verification failed');
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); };
    await triggerDownload(built.filename, built.blob);
    return { detections, ms, ink, width: out.width, height: out.height };
  }, { angle, raster: ocrRaster });
  if (created) {
    expect(routed).toBe(1);
    expect(await (await created).evaluate(() => typeof OffscreenCanvas)).toBe('undefined');
  }
  const download = await pending;
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  expect(result.detections.map(d => d.type).sort()).toEqual(['card', 'email', 'name', 'phone']);
  console.warn('SMALL_OCR', JSON.stringify({ angle, ms: result.ms, detections: result.detections }));
  const encoded = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const pixels = await page.evaluate(async ({ encoded, ink }) => {
    const image = new Image(); image.src = encoded; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return ink.filter(i => data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8).length;
  }, { encoded, ink: result.ink });
  expect(pixels).toBe(0);
});
