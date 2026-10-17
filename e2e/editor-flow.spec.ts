import { openRegions } from './editor-controls';
import { openEditing, openGeometry } from './editor-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { unzipSync } from 'fflate';

const black = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture anchor download'); };
  });
  await page.goto('/');
});

test('preview loops remain responsive and keyboard operable without discarding edits', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/astronaut.png', import.meta.url)) });
  await expect(page.locator('#controlsResult')).toBeVisible();
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await openRegions(page);
  await page.getByRole('button', { name: 'Face 1, page 1', exact: true }).click();
  await openRegions(page);
  await page.locator('#regionStyle').selectOption('soft');
  await openEditing(page);
  await page.locator('#previewToggle').click();
  const slider = page.getByRole('slider', { name: 'Before/after comparison slider' });
  await slider.focus(); await slider.press('ArrowRight'); await expect(slider).toHaveAttribute('aria-valuenow', '55');
  await page.setViewportSize({ width: 390, height: 844 });
  const geometry = await page.locator('#scrubberContainer').evaluate(el => {
    const rect = el.getBoundingClientRect(); const divider = document.getElementById('scrubberDivider')!.getBoundingClientRect();
    return { ratio: rect.width / rect.height, fraction: (divider.x - rect.x) / rect.width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(geometry.ratio).toBeCloseTo(1, 2); expect(geometry.fraction).toBeCloseTo(.55, 1); expect(geometry.overflow).toBe(0);
  await page.locator('#previewToggle').click(); await expect(page.locator('#mainCanvas')).toBeVisible();
  await page.locator('#previewToggle').click(); await expect(slider).toBeVisible();
  await page.locator('#previewToggle').click();
  await page.locator('#showRegions').click();
  await expect(page.locator('#regionStyle')).toHaveValue('soft');
  await page.getByRole('button', { name: 'Close region settings' }).click();
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const output = await pending; expect(readFileSync(await output.path()).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
});

test('batch traps focus, supports dismissal and preserves page-specific masks and color through ZIP export', async ({ page }) => {
  test.setTimeout(180000);
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] });
  pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 200, 300, 'F'); pdf.addPage(); pdf.rect(0, 0, 200, 300, 'F');
  const files = [
    { name: 'pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) },
    { name: 'black.jpg', mimeType: 'image/jpeg', buffer: black },
  ];
  await page.locator('#fileInput').setInputFiles(files);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab'); expect(await page.evaluate(() => document.getElementById('batchBackdrop')!.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(page.locator('#batchBackdrop')).toBeHidden();
  await page.locator('#fileInput').setInputFiles(files);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  await page.locator('.batch-file-row').filter({ hasText: 'pages.pdf' }).getByRole('button', { name: 'Review / Edit' }).click();
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await page.locator('#nextPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2');
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(r.x + r.width * .2, r.y + r.height * .2); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .6, r.y + r.height * .6); await page.mouse.up();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await openRegions(page);
  await page.locator('#regionColor').fill('#112233'); await page.locator('#regionColor').dispatchEvent('change');
  await page.locator('#returnBatch').click(); await expect(page.locator('#batchBackdrop')).toBeVisible();
  await page.locator('#btnBatchRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click(); const output = await pending;
  const entries = unzipSync(readFileSync(await output.path())); expect(Object.keys(entries).sort()).toEqual(['scrubbed-black.jpg', 'scrubbed-pages.pdf']);
  const result = await page.evaluate(async encoded => {
    const { getDocument } = await import('/e2e/browser-harness.ts');
    const task = getDocument({ data: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), isEvalSupported: false });
    try {
      const doc = await task.promise; const p = await doc.getPage(2), vp = p.getViewport({ scale: 1 });
      const canvas = document.createElement('canvas'); canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d')!; await p.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      return { pages: doc.numPages, pixel: [...ctx.getImageData(canvas.width * .4, canvas.height * .4, 1, 1).data], text: (await p.getTextContent()).items.length };
    } finally { await task.destroy(); }
  }, Buffer.from(entries['scrubbed-pages.pdf']).toString('base64'));
  expect(result.pages).toBe(2); expect(result.text).toBe(0); expect(result.pixel[3]).toBe(255);
  for (let i = 0; i < 3; i++) expect(Math.abs(result.pixel[i] - [17, 34, 51][i])).toBeLessThanOrEqual(4);
});

test('failed detector can recover through explicit Retry scan without a page reload', async ({ page }) => {
  await page.route('**/vendor/mediapipe/blaze_face_short_range.tflite', route => route.abort());
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: black });
  await expect(page.locator('#controlsResult')).toContainText('face detection failed', { timeout: 60000 });
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await page.unroute('**/vendor/mediapipe/blaze_face_short_range.tflite'); await page.locator('#retryScan').click();
  await expect(page.locator('#controlsResult')).toHaveClass(/scanning/, { timeout: 60000 });
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await expect(page.locator('#controlsResult')).not.toContainText('failed');
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
});

test('cancelled multipage export blocks download and supports a successful retry', async ({ page }) => {
  test.setTimeout(180000);
  const pdf = new jsPDF({ unit: 'pt', format: [300, 400] });
  for (let p = 1; p <= 8; p++) { if (p > 1) pdf.addPage(); pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 300, 400, 'F'); }
  await page.locator('#fileInput').setInputFiles({ name: 'cancel.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await page.locator('#btnRedact').click(); await page.locator('#btnCancelExport').click();
  await expect(page.locator('#statusText')).toContainText('cancelled', { timeout: 60000 });
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified'); await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 90000 });
});

test('PDF navigation disables stale page controls until the next raster and scan are ready', async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener('file:loaded', event => {
      const doc = (event as CustomEvent<{ pdfDoc?: import('pdfjs-dist').PDFDocumentProxy }>).detail.pdfDoc;
      if (!doc || (window as Window & { pdfPatched?: boolean }).pdfPatched) return;
      (window as Window & { pdfPatched?: boolean }).pdfPatched = true;
      const getPage = doc.getPage.bind(doc); let pause = true;
      doc.getPage = async number => {
        if (number === 2 && pause) { pause = false; await new Promise<void>(resolve => { (window as Window & { resumePdf?: () => void }).resumePdf = resolve; }); }
        return getPage(number);
      };
    });
  });
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] });
  pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 200, 300, 'F'); pdf.addPage([300, 200], 'landscape'); pdf.rect(0, 0, 300, 200, 'F');
  await page.locator('#fileInput').setInputFiles({ name: 'transition.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(r.x + r.width * .2, r.y + r.height * .2); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .6, r.y + r.height * .6); await page.mouse.up();
  await openGeometry(page); await expect(page.locator('#region-x')).toBeVisible();
  await page.locator('#nextPage').click();
  await expect(page.locator('#btnRedact')).toBeDisabled();
  await expect(page.locator('#region-x')).toHaveCount(0); await expect(page.locator('#chkFaces')).toBeDisabled(); await expect(page.locator('#editorUndo')).toBeDisabled();
  await page.evaluate(() => (window as Window & { resumePdf?: () => void }).resumePdf?.());
  await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2');
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#prevPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 1 of 2');
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 }); await expect(page.locator('.detection-box.manual')).toHaveCount(1);
});

test('editing during PDF preparation cancels obsolete progress and cannot publish verification', async ({ page }) => {
  const pdf = new jsPDF({ unit: 'pt', format: [300, 400] });
  for (let p = 1; p <= 8; p++) { if (p > 1) pdf.addPage(); pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 300, 400, 'F'); }
  await page.locator('#fileInput').setInputFiles({ name: 'revision.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await openRegions(page);
  await page.getByText('Category bulk controls', { exact: true }).click();
  await page.locator('#btnRedact').click(); await expect(page.locator('#exportProgress')).toBeVisible();
  await page.locator('#chkFaces').uncheck();
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('aria-busy', 'true', { timeout: 60000 });
  await expect(page.locator('#exportProgress')).toBeHidden(); await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await expect(page.locator('#forensicsVerify')).toBeHidden(); await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  await expect(page.locator('#statusText')).toContainText('Edits changed');
});
