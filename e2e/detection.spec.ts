import { test, expect } from '@playwright/test';

test.describe('Image redaction workflow', () => {
  test('page loads and displays title', async ({ page }) => {
    await page.goto('/');
    const title = await page.locator('.hero-title').textContent();
    expect(title).toContain('Scrub');
  });

  test('uploads image and detects content', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('public/test/face.jpg');

    // Wait for detection to complete (telemetry shows results, not "Scanning...")
    await page.waitForFunction(
      () => {
        const result = document.getElementById('controlsResult')?.textContent;
        return result && !result.includes('Scanning');
      },
      { timeout: 40000 }
    );

    // Verify detection happened and shows a count
    const controlsResult = await page.locator('#controlsResult').textContent();
    expect(controlsResult).toBeTruthy();
    expect(controlsResult).toMatch(/\d+\s*(faces?|words?|detections?)/i);
  });

  test('draw button is visible and toggles', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('public/test/face.jpg');

    // Wait for UI to be ready (detection telemetry shows)
    await page.waitForFunction(
      () => document.getElementById('telemetry')?.textContent &&
             document.getElementById('telemetry')!.textContent!.length > 10,
      { timeout: 30000 }
    );

    // Verify draw button exists
    const drawBtn = page.locator('#btnDraw');
    await expect(drawBtn).toBeVisible();

    // Toggle draw mode on
    await drawBtn.click();
    const isPressedOn = await drawBtn.getAttribute('aria-pressed');
    expect(isPressedOn).toBe('true');

    // Toggle draw mode off
    await drawBtn.click();
    const isPressedOff = await drawBtn.getAttribute('aria-pressed');
    expect(isPressedOff).toBe('false');
  });

  test('redact and download', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('public/test/face.jpg');

    await page.waitForFunction(
      () => document.getElementById('telFaceBackend')?.textContent !== '—',
      { timeout: 15000 }
    );

    // Redact
    const redactBtn = page.locator('#btnRedact');
    await redactBtn.click();

    // Wait for verification to complete
    await page.waitForFunction(
      () => document.getElementById('statusText')?.textContent?.includes('verified'),
      { timeout: 15000 }
    );

    const status = await page.locator('#statusText').textContent();
    expect(status).toContain('verified');

    // Download button should be enabled
    const downloadBtn = page.locator('#btnDownload');
    await expect(downloadBtn).toBeEnabled();
  });

});
