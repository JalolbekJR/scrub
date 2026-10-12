import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';


test('category changes invalidate verified image bytes before and after export', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await page.getByText('Category bulk controls', { exact: true }).click();
  await page.locator('#chkEmails').uncheck();
  await expect(page.locator('#btnDownload')).toBeDisabled();
  await page.locator('#btnRedact').click();
  await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  await page.locator('#celebClose').click();
  await page.locator('#chkEmails').check();
  await expect(page.locator('#btnDownload')).toBeDisabled();
  await expect(page.locator('#forensicsVerify')).toBeHidden();
  await expect(page.locator('#statusText')).not.toContainText('verified');
});

test('a pending save dialog cannot write obsolete bytes after a newer revision is verified', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { showSaveFilePicker: () => Promise<FileSystemFileHandle>; finishSave?: () => void; saveWrites: number };
    state.saveWrites = 0;
    state.showSaveFilePicker = () => new Promise(resolve => {
      state.finishSave = () => resolve({ createWritable: async () => ({
        write: async () => { state.saveWrites++; }, close: async () => {}, abort: async () => {},
      }) } as unknown as FileSystemFileHandle);
    });
  });
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  await expect(page.locator('#controlsResult')).toBeVisible(); await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  await page.locator('#celebDownload').click();
  await page.getByText('Category bulk controls', { exact: true }).click(); await page.locator('#chkEmails').uncheck();
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  await page.evaluate(() => (window as Window & { finishSave?: () => void }).finishSave?.());
  // Allow the awaited picker and writable continuations to settle.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))));
  expect(await page.evaluate(() => (window as Window & { saveWrites: number }).saveWrites)).toBe(0);
});

test('mixed batch downloads a complete raster PDF and JPEG with matching signatures', async ({ page }) => {
  test.setTimeout(180000);
  const pdf = new jsPDF({ unit: 'pt', format: [100, 150] });
  pdf.setFillColor(240, 80, 90); pdf.rect(0, 0, 100, 150, 'F');
  pdf.addPage(); pdf.setFillColor(60, 90, 220); pdf.rect(0, 0, 100, 150, 'F');
  pdf.setProperties({ author: 'PRIVATE AUTHOR' });
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles([
    { name: 'two-pages.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) },
    { name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) },
  ]);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  await page.locator('#btnBatchRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('scrubbed-bundle.zip');
  const entries = unzipSync(readFileSync(await download.path()));
  expect(Object.keys(entries).sort()).toEqual(['scrubbed-black.jpg', 'scrubbed-two-pages.pdf']);
  const bytes = entries['scrubbed-two-pages.pdf'];
  expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
  expect(Buffer.from(bytes).toString('latin1')).not.toContain('PRIVATE AUTHOR');
  expect([...entries['scrubbed-black.jpg'].subarray(0, 3)]).toEqual([255, 216, 255]);
  const task = getDocument({ data: bytes });
  try {
    const result = await task.promise; expect(result.numPages).toBe(2);
    for (let p = 1; p <= 2; p++) expect((await (await result.getPage(p)).getTextContent()).items).toHaveLength(0);
  } finally { await task.destroy(); }
});

test('colliding image basenames retain two distinct JPEG entries in the ZIP', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles([
    { name: 'same.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) },
    { name: 'same.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/black.png', import.meta.url)) },
  ]);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  await page.locator('#btnBatchRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const output = await pending; const entries = unzipSync(readFileSync(await output.path()));
  expect(Object.keys(entries).sort()).toEqual(['scrubbed-same-2.jpg', 'scrubbed-same.jpg']);
  for (const bytes of Object.values(entries)) expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
});
