import { openEditing } from './editor-controls';
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';


async function waitScan(page: Page) {
  await expect(page.locator('#controlsResult')).toBeVisible();
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
}
async function draw(page: Page, start: number[], end: number[]) {
  await openEditing(page);
  if (await page.locator('#btnDraw').getAttribute('aria-pressed') !== 'true') await page.locator('#btnDraw').click();
  await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#overlayWrap').boundingBox())!;
  await page.mouse.move(r.x + start[0] * r.width, r.y + start[1] * r.height);
  const previous = await page.locator('.detection-box.manual').count();
  await page.mouse.down();
  await page.mouse.move(r.x + end[0] * r.width, r.y + end[1] * r.height);
  await page.mouse.up();
  await expect(page.locator('.detection-box.manual')).toHaveCount(previous + 1);
}
async function download(page: Page) {
  await page.locator('#btnRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const result = await pending;
  return { name: result.suggestedFilename(), bytes: readFileSync(await result.path()) };
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture anchor download'); };
  });
  await page.goto('/');
});

for (const deviceScaleFactor of [1, 2]) {
  test.describe(`manual export at DPR ${deviceScaleFactor}`, () => {
    test.use({ deviceScaleFactor, viewport: { width: deviceScaleFactor === 1 ? 1280 : 800, height: 1000 } });
    test('fractional size, CSS zoom and resize preserve selected output pixels', async ({ page }) => {
      const source = await page.evaluate(() => {
        const c = document.createElement('canvas'); c.width = 1000; c.height = 700;
        const ctx = c.getContext('2d')!; ctx.fillStyle = '#ed3c5a'; ctx.fillRect(0, 0, c.width, c.height);
        return c.toDataURL('image/png').split(',')[1];
      });
      await page.locator('#fileInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(source, 'base64') });
      await waitScan(page);
      await page.locator('#mainContainer').evaluate(el => { el.style.width = '333.3px'; el.style.zoom = '1.25'; });
      await draw(page, [.2, .25], [.6, .65]);
      // Percentage overlays follow resizing without a new detector pass.
      await page.locator('#mainContainer').evaluate(el => { el.style.width = '250.2px'; });
      const canvasRect = (await page.locator('#mainCanvas').boundingBox())!;
      await page.locator('.detection-box.manual').evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished)); });
      const maskRect = (await page.locator('.detection-box.manual').boundingBox())!;
      expect(Math.abs(maskRect.x - canvasRect.x - .2 * canvasRect.width)).toBeLessThan(1);
      expect(Math.abs(maskRect.width - .4 * canvasRect.width)).toBeLessThan(1);
      const output = await download(page); expect(output.name).toBe('scrubbed.jpg');
      expect(output.bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      const coverage = await page.evaluate(async data => {
        const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
        const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
        const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(200, 175, 400, 280).data;
        let uncovered = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8 || pixels[i + 3] !== 255) uncovered++;
        return { uncovered, outside: [...ctx.getImageData(10, 10, 1, 1).data], width: image.width, height: image.height };
      }, output.bytes.toString('base64'));
      expect(coverage.uncovered).toBe(0); expect(coverage.outside[0]).toBeGreaterThan(200);
      expect([coverage.width, coverage.height]).toEqual([1000, 700]);
    });
  });
}

test('rotated PDF pages retain manual masks across navigation and in raster output', async ({ page }) => {
  test.setTimeout(120000);
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] });
  pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 200, 300, 'F');
  pdf.addPage([300, 200], 'landscape'); pdf.rect(0, 0, 300, 200, 'F');
  pdf.internal.events.subscribe('putPage', (data: { pageNumber: number }) => {
    if (data.pageNumber === 2) (pdf.internal as unknown as { write(s: string): void }).write('/Rotate 90');
  });
  await page.locator('#fileInput').setInputFiles({ name: 'rotated.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await waitScan(page); await draw(page, [.2, .2], [.6, .6]); await page.locator('#previewToggle').click();
  await page.locator('#nextPage').click();
  await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2'); await waitScan(page);
  await draw(page, [.8, .8], [1, 1]); await page.locator('#previewToggle').click();
  await page.locator('#prevPage').click();
  await expect(page.locator('#pageInfo')).toHaveText('Page 1 of 2'); await waitScan(page);
  const retained = await page.locator('#mainCanvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(Math.round(c.width * .3), Math.round(c.height * .3), 1, 1).data]);
  expect(retained.slice(0, 3).every(v => v <= 8)).toBe(true);
  const result = await download(page); expect(result.name).toBe('scrubbed.pdf');
  const pages = await page.evaluate(async encoded => {
    const { getDocument } = await import('/e2e/browser-harness.ts');
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const task = getDocument({ data: bytes, isEvalSupported: false });
    const doc = await task.promise;
    const results = [];
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p); const vp = page.getViewport({ scale: 1 });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d')!; await page.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        const from = p === 1 ? .2 : .8, to = p === 1 ? .6 : 1;
        const x = Math.ceil(c.width * from), y = Math.ceil(c.height * from);
        const pixels = ctx.getImageData(x, y, Math.floor(c.width * to) - x, Math.floor(c.height * to) - y).data;
        let uncovered = 0;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) uncovered++;
        results.push({ uncovered, text: (await page.getTextContent()).items.length, w: c.width, h: c.height });
      }
    } finally { await task.destroy(); }
    return results;
  }, result.bytes.toString('base64'));
  expect(pages).toHaveLength(2);
  for (const p of pages) { expect(p.uncovered).toBe(0); expect(p.text).toBe(0); }
});

test('EXIF orientation is normalized before drawing and exporting a boundary mask', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles({ name: 'oriented.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/orientation-6.jpg', import.meta.url)) });
  await waitScan(page);
  const source = await page.locator('#mainCanvas').evaluate((c: HTMLCanvasElement) => ({ w: c.width, h: c.height, pixel: [...c.getContext('2d')!.getImageData(65, 5, 1, 1).data] }));
  expect([source.w, source.h]).toEqual([80, 120]); expect(source.pixel[1]).toBeGreaterThan(200);
  await draw(page, [.65, .02], [.99, .25]);
  const mask = await page.locator('.detection-box.manual').evaluate(el => ({ left: (el as HTMLElement).style.left, top: (el as HTMLElement).style.top, width: (el as HTMLElement).style.width, height: (el as HTMLElement).style.height }));
  const result = await download(page);
  const output = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(60, 0, 20, 20).data;
    let uncovered = 0; const examples = [];
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) {
      uncovered++; if (examples.length < 4) examples.push({ x: 60 + (i / 4) % 20, y: Math.floor(i / 4 / 20), pixel: [...pixels.slice(i, i + 4)] });
    }
    return { w: c.width, h: c.height, uncovered, examples };
  }, result.bytes.toString('base64'));
  await test.info().attach('orientation-coverage', { body: JSON.stringify({ mask, output }), contentType: 'application/json' });
  expect([output.w, output.h]).toEqual([80, 120]);
  expect(output.uncovered).toBe(0);
});
