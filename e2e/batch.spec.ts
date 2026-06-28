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

    // 1) Review modal appears after scanning all files.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      { timeout: 90000 }
    );
    expect(downloads, 'no download at upload/scan time').toHaveLength(0);
    expect(await page.locator('.batch-file-row').count()).toBe(2);

    // 2) Press "Redact all" → the finished popup appears, still NO download yet.
    await page.locator('#btnBatchRedact').click();
    await page.waitForFunction(
      () => document.getElementById('celebrateBackdrop')?.hidden === false,
      { timeout: 60000 }
    );
    expect(downloads, 'no silent download — user must click Download').toHaveLength(0);

    // The popup carries the support / GitHub affordances.
    await expect(page.locator('#celebSupport')).toBeVisible();
    await expect(page.locator('#celebStar')).toBeVisible();

    // 3) Download happens only from the finished popup.
    const firstDownload = page.waitForEvent('download', { timeout: 30000 });
    await page.locator('#celebDownload').click();
    await firstDownload;
    expect(downloads.length).toBeGreaterThan(0);
  });
});
