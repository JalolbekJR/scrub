import { test, expect } from '@playwright/test';

test.describe('Bundle (multi-file) upload flow', () => {
  // Two files with face detection + OCR each takes a while; give it room.
  test.setTimeout(120000);

  test('scan → review modal → finished popup → download (no silent saves)', async ({ page }) => {
    // Fail loudly if anything downloads before the user clicks Download.
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await page.goto('/');
    await page.locator('#fileInput').setInputFiles([
      'public/test/face.jpg',
      'public/test/screenshot.jpg',
    ]);

    // 1) Review modal appears after scanning all files, one row per file.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      { timeout: 90000 }
    );
    expect(downloads, 'no download at upload/scan time').toHaveLength(0);
    expect(await page.locator('.batch-file-row').count()).toBe(2);

    // Per-file, per-type toggle chips are present and pre-selected (.on).
    const chips = page.locator('.batch-chip.on');
    expect(await chips.count()).toBeGreaterThan(0);

    // 2) Press "Redact selected" → the finished popup appears, still NO download.
    await page.locator('#btnBatchRedact').click();
    await page.waitForFunction(
      () => document.getElementById('celebrateBackdrop')?.hidden === false,
      { timeout: 60000 }
    );
    expect(downloads, 'no silent download — user must click Download').toHaveLength(0);

    // The popup carries the support / GitHub affordances + a per-file breakdown.
    await expect(page.locator('#celebSupport')).toBeVisible();
    await expect(page.locator('#celebStar')).toBeVisible();
    await expect(page.locator('#celebBreakdown')).toBeVisible();
    expect(await page.locator('.celeb-breakdown-list li').count()).toBe(2);

    // 3) One click → one ZIP download containing the whole bundle.
    const zipDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#celebDownload').click();
    const dl = await zipDownload;
    expect(dl.suggestedFilename()).toBe('scrubbed-bundle.zip');
    expect(downloads).toEqual(['scrubbed-bundle.zip']);
  });

  // Abuse/edge case: one unsupported (or corrupt/malicious) file in a bundle
  // must not stall the whole run — the queue has to advance past it.
  test('a bad file in the bundle does not hang the scan', async ({ page }) => {
    await page.goto('/');
    await page.locator('#fileInput').setInputFiles([
      'public/test/face.jpg',
      'public/test/README.txt', // not an image/PDF — fails validation
    ]);

    // The review modal still opens (proving the bad file advanced the queue),
    // with a row for each file.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      { timeout: 90000 }
    );
    expect(await page.locator('.batch-file-row').count()).toBe(2);
    // The unsupported file shows as nothing-to-redact rather than blocking.
    await expect(page.locator('.batch-none')).toHaveCount(1);
  });
});
