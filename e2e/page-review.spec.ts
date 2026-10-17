import { openEditing } from './editor-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';

test('pending manual PDF selections survive navigation and export from another page', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); };
  });
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] });
  pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 200, 300, 'F');
  pdf.addPage(); pdf.rect(0, 0, 200, 300, 'F');
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'pending.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  const wait = async () => { await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 }); };
  await wait(); await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#overlayWrap').boundingBox())!;
  await page.mouse.move(r.x + .2 * r.width, r.y + .2 * r.height); await page.mouse.down();
  await page.mouse.move(r.x + .6 * r.width, r.y + .6 * r.height); await page.mouse.up();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#nextPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2'); await wait();
  await page.locator('#prevPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 1 of 2'); await wait();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#nextPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2'); await wait();
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const output = await pending; const bytes = readFileSync(await output.path());
  const uncovered = await page.evaluate(async data => {
    const { getDocument } = await import('/e2e/browser-harness.ts');
    const task = getDocument({ data: Uint8Array.from(atob(data), c => c.charCodeAt(0)), isEvalSupported: false });
    try {
      const doc = await task.promise; const p = await doc.getPage(1); const vp = p.getViewport({ scale: 1 });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!; await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
      const pixels = ctx.getImageData(Math.ceil(c.width * .2), Math.ceil(c.height * .2), Math.floor(c.width * .4), Math.floor(c.height * .4)).data;
      let uncovered = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) uncovered++;
      return uncovered;
    } finally { await task.destroy(); }
  }, bytes.toString('base64'));
  expect(uncovered).toBe(0);
});

test('applied PDF masks remain removable after navigation without contaminating original pixels', async ({ page }) => {
  test.setTimeout(120000);
  const pdf = new jsPDF({ unit: 'pt', format: [200, 300] });
  pdf.setFillColor(237, 60, 90); pdf.rect(0, 0, 200, 300, 'F');
  pdf.addPage(); pdf.rect(0, 0, 200, 300, 'F');
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'recoverable.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  const wait = async () => { await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 }); };
  await wait(); await page.locator('#mainContainer').evaluate(el => { el.style.width = '333px'; });
  await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#overlayWrap').boundingBox())!;
  await page.mouse.move(r.x + r.width * .2, r.y + r.height * .2); await page.mouse.down();
  await page.mouse.move(r.x + r.width * .6, r.y + r.height * .6); await page.mouse.up();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#previewToggle').click(); await expect(page.locator('#scrubberWrap')).toBeVisible();
  await page.locator('#nextPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 2 of 2'); await wait();
  await page.locator('#prevPage').click(); await expect(page.locator('#pageInfo')).toHaveText('Page 1 of 2'); await wait();
  await page.locator('.detection-box.manual .detection-box-del').click();
  await page.locator('#previewToggle').click(); await expect(page.locator('#scrubberWrap')).toBeVisible();
  const pixels = await page.evaluate(() => ['originalCanvas', 'redactedCanvas'].map(id => {
    const c = document.getElementById(id) as HTMLCanvasElement;
    return [...c.getContext('2d')!.getImageData(c.width * .4, c.height * .4, 1, 1).data];
  }));
  expect(pixels[1]).toEqual(pixels[0]);
  expect(pixels[0][0]).toBeGreaterThan(230);
  expect(pixels[0][3]).toBe(255);
});
