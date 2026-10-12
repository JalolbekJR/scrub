import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('replacing a file cancels an unfinished brush gesture', async ({ page }) => {
  await page.goto('/');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    canvas.getContext('2d')!.fillRect(0, 0, 400, 300);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const buffer = Buffer.from(data, 'base64');
  await page.locator('#fileInput').setInputFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#customize').click(); await page.locator('#toolBrush').click();
  const canvas = page.locator('#mainCanvas'); await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5);
  await expect(page.locator('.brush-draft')).toHaveCount(1);
  await page.locator('#fileInput').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer });
  await page.mouse.up();
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('.brush-draft')).toHaveCount(0);
  await expect(page.locator('.detection-box.manual')).toHaveCount(0);
  await expect(page.locator('.editor-toolbar')).toBeHidden();
});

test('Retry scan preserves edits and requires fresh verification', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#customize').click(); await page.locator('#btnDraw').click(); await page.locator('#addShape').click();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#regionColor').fill('#112233'); await page.locator('#regionColor').dispatchEvent('change');
  await page.locator('#btnRedact').click(); await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 }); await page.keyboard.press('Escape');
  let confirmations = 0; page.once('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  await page.locator('#retryScan').click();
  expect(confirmations).toBe(0); await expect(page.locator('#btnDownload')).toBeDisabled();
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#customize').click(); await expect(page.locator('#editorUndo')).toBeEnabled();
  await page.getByRole('button', { name: 'Manual 1, page 1', exact: true }).click();
  await expect(page.locator('#regionColor')).toHaveValue('#112233');
});

test('original landing guide stays static with exactly three familiar steps', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.onboarding-title')).toHaveText('Three steps. Nothing leaves your device.');
  await expect(page.locator('.step-title')).toHaveText(['Drop a file', "Review what's found", 'Download clean']);
  await expect(page.locator('.risk-ticker-wrap')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByText('Designed & Engineered by Jalolbek JR', { exact: true })).toBeVisible();
  for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    const rows = await page.locator('.step').evaluateAll(els => els.map(el => el.getBoundingClientRect().top));
    expect(width > 600 ? new Set(rows).size === 1 : rows[0] < rows[1] && rows[1] < rows[2]).toBe(true);
  }
});

test('ticker keeps character typing, full-line pause, two-character deletion and next-line gap', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-12T00:00:00Z') });
  await page.goto('/'); await page.clock.pauseAt(new Date('2026-10-12T00:00:10Z'));
  await page.evaluate(async () => { const { initTicker } = await import('/src/ticker.ts'); initTicker(); });
  await expect(page.locator('#riskTicker')).toHaveText('D');
  await page.clock.runFor(32); await expect(page.locator('#riskTicker')).toHaveText('Dr');
  const first = 'Drop a photo or PDF. Scrub checks it right here.';
  await page.clock.runFor((first.length - 2) * 32); await expect(page.locator('#riskTicker')).toHaveText(first);
  await page.clock.runFor(500); await expect(page.locator('#riskTicker')).toHaveText(first);
  await page.clock.runFor(2200);
  const shorter = await page.locator('#riskTicker').innerText(); expect(shorter.length).toBeLessThan(first.length); expect(first.startsWith(shorter)).toBe(true);
  await page.clock.runFor(1700); await expect(page.locator('#riskTicker')).toContainText('Choose');
  const paused = await page.locator('#riskTicker').innerText();
  await page.evaluate(() => document.body.classList.add('document-loaded'));
  await page.clock.runFor(5000); await expect(page.locator('#riskTicker')).toHaveText(paused);
});

test('reduced motion leaves helpful static text and incomplete scans do not claim success', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  await expect(page.locator('#riskTicker')).toHaveText('Drop a photo or PDF. Scrub checks it right here.');
  expect(await page.locator('.risk-caret').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.evaluate(async () => { const s = await import('/src/scanner.ts'); s.startScan(); s.setPhase('faces'); s.finishScan(false); });
  await expect(page.locator('#scannerPhase')).toHaveText('Scan incomplete');
  await expect(page.locator('#ringPct')).toHaveText('—');
  await expect(page.locator('#scannerLog')).not.toContainText('done —');
});

test('small-screen support dialog keeps download primary and external actions optional', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = []; (window as Window & { supportCalls?: string[] }).supportCalls = calls;
    window.open = url => { calls.push(String(url)); return null; };
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); };
  });
  await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 }); await page.locator('#btnRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  await page.locator('#celebrateModal').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  const bounds = (await page.locator('#celebrateModal').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(12); expect(bounds.y + bounds.height).toBeLessThanOrEqual(556);
  const calls = () => page.evaluate(() => (window as Window & { supportCalls?: string[] }).supportCalls);
  expect(await calls()).toEqual([]);
  for (const id of ['celebStar', 'celebShare', 'celebSupport']) await page.locator(`#${id}`).click();
  expect((await calls())?.map(url => new URL(url).hostname)).toEqual(['github.com', 'twitter.com', 'boosty.to']);
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const download = await pending; expect(readFileSync(await download.path()).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
});

test('scanner restart cancels old collapse and log callbacks', async ({ page }) => {
  await page.goto('/'); await page.clock.install();
  await page.evaluate(async () => { const s = await import('/src/scanner.ts'); s.startScan(); s.phaseLog('read'); s.finishScan(); });
  await page.clock.runFor(500);
  await page.evaluate(async () => { const s = await import('/src/scanner.ts'); s.startScan(); s.setPhase('faces'); s.phaseLog('faces'); });
  await page.clock.runFor(500);
  await expect(page.locator('#scanner')).toBeVisible();
  await expect(page.locator('#scannerPhase')).toHaveText('Detecting faces');
  await expect(page.locator('#scannerLog')).not.toContainText('done');
});

test('simple review reveals customization without losing edits or verified-revision safeguards', async ({ page }) => {
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/astronaut.png', import.meta.url)) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('.editor-toolbar')).toBeHidden();
  await expect(page.locator('#retryScan')).toBeHidden();
  const mask = page.locator('.detection-box').first();
  const originalPosition = await mask.evaluate(el => [el.style.left, el.style.top]);
  const box = (await mask.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30); await page.mouse.up();
  expect(await mask.evaluate(el => [el.style.left, el.style.top])).toEqual(originalPosition);
  await page.getByRole('button', { name: 'Face 1, page 1', exact: true }).click();
  await expect(page.locator('#region-width')).toBeHidden();
  await page.locator('#regionStyle').selectOption('soft');
  await page.locator('#customize').click();
  await expect(page.locator('.editor-toolbar')).toBeVisible();
  await page.locator('#customize').click();
  await expect(page.locator('#regionStyle')).toHaveValue('soft');
  await page.locator('#btnRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  for (const id of ['celebDownload', 'celebStar', 'celebShare', 'celebCopy', 'celebSupport', 'celebLater', 'celebEdit']) await expect(page.locator(`#${id}`)).toBeVisible();
  await page.locator('#celebEdit').click();
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  await expect(page.locator('#mainCanvas')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Redact Face 1, page 1', exact: true }).uncheck();
  await expect(page.locator('#btnDownload')).toBeDisabled();
  await expect(page.locator('#regionStyle')).toHaveValue('soft');
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#showRegions').click();
  await page.getByRole('button', { name: 'Adjust area', exact: true }).click();
  await expect(page.locator('#regionInspector')).toBeHidden(); await expect(page.locator('.editor-toolbar')).toBeVisible();
  await expect(page.locator('#regionStyle')).toHaveValue('soft');
});
