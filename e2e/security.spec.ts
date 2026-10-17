import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';


test('synthetic PDF export is raster-only and a failed next upload clears download state', async ({ page, baseURL }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    // Force the anchor fallback so Playwright can capture the generated file.
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => {
      throw new Error('Use browser download fallback in this test');
    };
  });
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('http') && new URL(request.url()).origin !== new URL(baseURL!).origin) {
      externalRequests.push(request.url());
    }
  });

  const jpeg = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
  const pdf = new jsPDF();
  pdf.addImage(`data:image/jpeg;base64,${jpeg.toString('base64')}`, 'JPEG', 0, 0, 10, 10);
  pdf.setProperties({ author: 'PRIVATE SOURCE AUTHOR' });
  pdf.text('PRIVATE HIDDEN SOURCE', 1000, 1000); // Outside the visible page.
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({
    name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')),
  });

  await expect(page.locator('#controlsResult')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 90000 });
  await page.locator('#btnRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#celebDownload').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('scrubbed.pdf');
  const bytes = readFileSync(await download.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.toString('latin1')).not.toContain('PRIVATE SOURCE AUTHOR');
  expect(bytes.toString('latin1')).not.toContain('PRIVATE HIDDEN SOURCE');
  const task = getDocument({ data: new Uint8Array(bytes) });
  try {
    const result = await task.promise;
    expect(result.numPages).toBe(1);
    expect((await (await result.getPage(1)).getTextContent()).items).toHaveLength(0);
  } finally {
    await task.destroy();
  }

  await page.locator('#fileInput').setInputFiles({
    name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF'),
  });
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await expect(page.locator('#canvasArea')).toBeHidden();
  expect(externalRequests).toEqual([]);
});

test('a failed required face detector blocks image export', async ({ page }) => {
  test.setTimeout(90000);
  await page.route('**/vendor/mediapipe/blaze_face_short_range.tflite', (route) => route.abort());
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({
    name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)),
  });
  await expect(page.locator('#controlsResult')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#controlsResult')).toContainText('face detection failed', { timeout: 60000 });
  await page.locator('#btnRedact').click();
  await expect(page.locator('#statusText')).toContainText('Export blocked');
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
});

test('a batch with failed scans offers no clean download', async ({ page }) => {
  test.setTimeout(120000);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));
  await page.route('**/vendor/mediapipe/blaze_face_short_range.tflite', (route) => route.abort());
  await page.goto('/');
  const black = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
  await page.locator('#fileInput').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: black },
    { name: 'b.jpg', mimeType: 'image/jpeg', buffer: black },
  ]);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  await expect(page.locator('.batch-file-row .batch-none')).toHaveCount(2);
  await page.locator('#btnBatchRedact').click();
  await expect(page.locator('#statusText')).toContainText('No files passed processing and verification', { timeout: 90000 });
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  expect(downloads).toEqual([]);
});
