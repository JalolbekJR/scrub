import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';

test('PDF parser diagnostics do not expose private source identifiers', async ({ page }) => {
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  await page.goto('/');
  const pdf = new jsPDF();
  pdf.internal.write('/SYNTHETIC_PRIVATE_COLORSPACE_SENTINEL cs');
  pdf.text('Ordinary synthetic page', 20, 40);
  await page.locator('#fileInput').setInputFiles({ name: 'unusual-color.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  expect(logs.join('\n')).not.toContain('SYNTHETIC_PRIVATE_COLORSPACE_SENTINEL');
});

test('batch export failures never log underlying private error content', async ({ page }) => {
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  await page.goto('/');
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = () => { throw new Error('SYNTHETIC_PRIVATE_ERROR_SENTINEL'); };
  });
  const buffer = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
  await page.locator('#fileInput').setInputFiles([
    { name: 'first.jpg', mimeType: 'image/jpeg', buffer },
    { name: 'second.jpg', mimeType: 'image/jpeg', buffer },
  ]);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  await page.locator('#btnBatchRedact').click();
  await expect(page.locator('#statusText')).toContainText('No files passed processing and verification', { timeout: 90000 });
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  expect(logs.join('\n')).not.toContain('SYNTHETIC_PRIVATE_ERROR_SENTINEL');
});

test('ticker retains all six privacy subjects alongside practical help', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-12T00:00:00Z') });
  await page.goto('/'); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 10000));
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as Window & { tickerSeen?: string[] }).tickerSeen = seen;
    new MutationObserver(() => seen.push(document.getElementById('riskTicker')!.textContent!))
      .observe(document.getElementById('riskTicker')!, { childList: true });
  });
  await page.evaluate(async () => { const { initTicker } = await import('/src/ticker.ts'); initTicker(); });
  await page.clock.runFor(90000);
  const text = await page.evaluate(() => (window as Window & { tickerSeen?: string[] }).tickerSeen!.join('\n'));
  for (const subject of ['GPS spot', 'AI can read faces', 'hidden thumbnail', 'Blur and mosaic', 'device, software', 'archives, scripts, even prompts']) expect(text).toContain(subject);
  for (const help of ['Drop a photo or PDF', 'Choose what to hide', 'Cover it with the brush', 'download your protected copy']) expect(text).toContain(help);
});
