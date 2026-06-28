import { test, expect } from '@playwright/test';

test.describe('Bundle (multi-file) upload flow', () => {
  // Two files with face detection + OCR each takes a while; give it room.
  test.setTimeout(120000);

  test('scans and shows review modal BEFORE any redact or download', async ({ page }) => {
    // Fail loudly if anything downloads before the user opts in.
    const downloads: string[] = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));

    await page.goto('/');
    await page.locator('#fileInput').setInputFiles([
      'public/test/face.jpg',
      'public/test/screenshot.jpg',
    ]);

    // The batch review modal must appear after scanning all files.
    await page.waitForFunction(
      () => document.getElementById('batchBackdrop')?.hidden === false,
      { timeout: 90000 }
    );

    // CRITICAL regression guard: nothing is redacted or downloaded until the
    // user reviews the findings and presses "Redact all".
    expect(downloads, 'no download before user presses Redact').toHaveLength(0);

    // The modal lists every file with what was found.
    expect(await page.locator('.batch-file-row').count()).toBe(2);

    // Downloads begin only after the explicit user action.
    const firstDownload = page.waitForEvent('download', { timeout: 60000 });
    await page.locator('#btnBatchRedact').click();
    await firstDownload; // a scrubbed file is produced
    expect(downloads.length).toBeGreaterThan(0);
  });
});
