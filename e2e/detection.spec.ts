import { openRegions, openEditing } from './editor-controls';
import { test, expect } from '@playwright/test';
import { piiImage } from './fixtures';

test.describe('Image redaction workflow', () => {
  test('page loads and displays title', async ({ page }) => {
    await page.goto('/');
    const title = await page.locator('.hero-title').textContent();
    expect(title).toContain('Scrub');
  });

  test('uploads image and detects content', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(await piiImage(page));

    // Wait for detection to complete (telemetry shows results, not "Scanning...")
    await page.waitForFunction(
      () => {
        const result = document.getElementById('controlsResult')?.textContent;
        return result && !document.getElementById('controlsResult')?.classList.contains('scanning');
      },
      undefined, { timeout: 60000 }
    );

    // Verify detection happened and shows a count
    const controlsResult = await page.locator('#controlsResult').textContent();
    expect(controlsResult).toBeTruthy();
    await openRegions(page);
    await expect(page.getByRole('button', { name: 'Email 1, page 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Phone 1, page 1', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Card 1, page 1', exact: true })).toBeVisible();
  });

  test('draw button is visible and toggles', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles(await piiImage(page));

    // Wait for UI to be ready (detection telemetry shows)
    await page.waitForFunction(
      () => !(document.getElementById('btnRedact') as HTMLButtonElement).disabled,
      undefined, { timeout: 60000 }
    );

    // Verify draw button exists
    await openEditing(page);
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
    await fileInput.setInputFiles(await piiImage(page));

    await page.waitForFunction(
      () => document.getElementById('telFaceBackend')?.textContent !== '—',
      undefined, { timeout: 60000 }
    );

    // Redact
    const redactBtn = page.locator('#btnRedact');
    await redactBtn.click();

    // Wait for verification to complete
    await page.waitForFunction(
      () => !document.getElementById('celebrateBackdrop')?.hidden,
      undefined, { timeout: 60000 }
    );

    const status = await page.locator('#celebSummary').textContent();
    expect(status).toContain('checks passed');

    // Download button should be enabled
    const downloadBtn = page.locator('#celebDownload');
    await expect(downloadBtn).toBeEnabled();
  });

});
