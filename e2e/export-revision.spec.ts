import { blockNextDownload, openRegions } from './editor-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { unzipSync } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';


test('category changes invalidate verified image bytes before and after export', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  await openRegions(page);
  await page.getByText('Category bulk controls', { exact: true }).click();
  await page.locator('#chkEmails').uncheck();
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await blockNextDownload(page);
  await page.locator('#btnRedact').click();
  await expect(page.locator('#btnRedact')).toHaveAttribute('data-export-state', 'verified', { timeout: 60000 });
  await expect(page.locator('#statusText')).toContainText('could not start');
  await page.locator('#chkEmails').check();
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await expect(page.locator('#forensicsVerify')).toBeHidden();
  await expect(page.locator('#statusText')).not.toContainText('verified');
});

test('repeated ordinary downloads avoid file permissions and stale revisions stay blocked', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { saveCalls: number; showSaveFilePicker: () => Promise<never> };
    state.saveCalls = 0;
    state.showSaveFilePicker = async () => { state.saveCalls++; throw new Error('Writable permission forbidden'); };
  });
  await page.goto('/');
  const original = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const first = await pending;
  const repeated = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const second = await repeated;
  expect(readFileSync(await first.path())).toEqual(readFileSync(await second.path()));
  expect([...readFileSync(await second.path()).subarray(0, 3)]).toEqual([255, 216, 255]);
  expect(await page.evaluate(() => (window as Window & { saveCalls: number }).saveCalls)).toBe(0);
  expect(readFileSync(new URL('../fixtures/black.jpg', import.meta.url))).toEqual(original);
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#celebClose').click();
  // Dismissing completion releases the old retry; a hidden stale action is inert.
  await page.locator('#celebDownload').dispatchEvent('click');
  expect(downloads).toBe(0);
  await page.locator('#fileInput').setInputFiles({ name: 'next.jpg', mimeType: 'image/jpeg', buffer: original });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#btnRedact')).toHaveAttribute('data-export-state', 'required');
  expect(downloads).toBe(0);
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
