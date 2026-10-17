import { test, expect } from '@playwright/test';
import { piiImage } from './fixtures';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); }; });
});

test.describe('Bundle (multi-file) upload flow', () => {
  // Two files with face detection + OCR each takes a while; give it room.
  test.setTimeout(120000);

  test('scan → review → one-click verified download → completion over home', async ({ page }) => {
    // Fail loudly if anything downloads before the user clicks Download.
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await page.goto('/');
    await page.locator('#fileInput').setInputFiles([
      await piiImage(page, 'one.png'),
      await piiImage(page, 'two.png'),
    ]);

    // 1) Review modal appears after scanning all files, one row per file.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      undefined, { timeout: 90000 }
    );
    expect(downloads, 'no download at upload/scan time').toHaveLength(0);
    expect(await page.locator('.batch-file-row').count()).toBe(2);

    // Per-file, per-type toggle chips are present and pre-selected (.on).
    const chips = page.locator('.batch-chip.on');
    expect(await chips.count()).toBeGreaterThan(0);

    // Download is requested explicitly from review; upload alone never saves.
    const zipDownload = page.waitForEvent('download', { timeout: 90000 });
    await page.locator('#btnBatchRedact').click();
    await page.waitForFunction(
      () => document.getElementById('celebrateBackdrop')?.hidden === false,
      undefined, { timeout: 60000 }
    );
    const dl = await zipDownload;
    expect(downloads, 'one download from the explicit primary action').toEqual(['scrubbed-bundle.zip']);
    await expect(page.locator('.hero')).toBeVisible();

    // The popup carries the support / GitHub affordances + a per-file breakdown.
    await expect(page.locator('#celebSupport')).toBeVisible();
    await expect(page.locator('#celebStar')).toBeVisible();
    await expect(page.locator('#celebBreakdown')).toBeVisible();
    expect(await page.locator('.celeb-breakdown-list li').count()).toBe(2);

    // 3) One click → one ZIP download containing the whole bundle.

    expect(dl.suggestedFilename()).toBe('scrubbed-bundle.zip');
    expect(downloads).toEqual(['scrubbed-bundle.zip']);
    const entries = unzipSync(readFileSync(await dl.path()));
    expect(Object.keys(entries).sort()).toEqual(['scrubbed-one.jpg', 'scrubbed-two.jpg']);
    for (const bytes of Object.values(entries)) expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  });

  // Abuse/edge case: one unsupported (or corrupt/malicious) file in a bundle
  // must not stall the whole run — the queue has to advance past it.
  test('a bad file in the bundle does not hang the scan', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fileInput').setInputFiles([
      await piiImage(page, 'one.png'),
      { name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic unsupported file') }, // not an image/PDF — fails validation
    ]);

    // The review modal still opens (proving the bad file advanced the queue),
    // with a row for each file.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      undefined, { timeout: 90000 }
    );
    expect(await page.locator('.batch-file-row').count()).toBe(2);
    // A failed review cannot turn into a successful scan by returning to the batch.
    await page.locator('.batch-file-row').filter({ hasText: 'unsupported.txt' }).getByRole('button', { name: 'Review / Edit' }).click();
    await expect(page.locator('#statusText')).toContainText(/unsupported|supported|format/i);
    await page.locator('#returnBatch').click();
    // The failed file is explicitly excluded, while the valid file remains exportable.
    await expect(page.locator('.batch-file-row').filter({ hasText: 'unsupported.txt' })).toContainText('Scan failed — excluded from export');
    await page.locator('#btnBatchRedact').click();
    await expect(page.locator('#btnBatchVerified')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#celebrateBackdrop')).toBeHidden();
    const pending = page.waitForEvent('download'); await page.locator('#btnBatchVerified').click(); const dl = await pending;
    // A partial batch with one valid result downloads that JPEG directly.
    expect(dl.suggestedFilename()).toBe('scrubbed-one.jpg');
    expect([...readFileSync(await dl.path()).subarray(0, 3)]).toEqual([255, 216, 255]);
  });
});
