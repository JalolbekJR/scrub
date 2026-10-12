import { openEditing, openGeometry } from './editor-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

test('individual face geometry, exclusions, restoration and history remain synchronized', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture image download'); };
  });
  await page.goto('/');
  await page.locator('#fileInput').setInputFiles({ name: 'portrait.png', mimeType: 'image/png', buffer: readFileSync(new URL('../fixtures/astronaut.png', import.meta.url)) });
  await expect(page.locator('#controlsResult')).toBeVisible();
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
  const face = page.getByRole('button', { name: 'Face 1, page 1', exact: true });
  await face.click();
  await openGeometry(page);
  const width = page.locator('#region-width'); const before = Number(await width.inputValue());
  await width.fill(String(before - 2)); await width.press('Tab');
  await expect(page.locator('.detection-box.selected')).toHaveCount(1);
  const inclusion = page.getByRole('checkbox', { name: 'Redact Face 1, page 1', exact: true });
  await inclusion.uncheck(); await expect(page.locator('.detection-box.excluded')).toHaveCount(1);
  await expect(inclusion).not.toBeChecked();
  await page.locator('#editorUndo').click(); await expect(inclusion).toBeChecked();
  await page.locator('#editorRedo').click(); await expect(inclusion).not.toBeChecked();
  await inclusion.check(); await expect(inclusion).toBeChecked();
  const bounds = await page.evaluate(() => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number((document.getElementById(`region-${key}`) as HTMLInputElement).value)])));
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const download = await pending, bytes = readFileSync(await download.path());
  expect(download.suggestedFilename()).toBe('scrubbed.jpg'); expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  const uncovered = await page.evaluate(async ({ data, bounds }) => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) count++;
    return count;
  }, { data: bytes.toString('base64'), bounds });
  expect(uncovered).toBe(0);
  await inclusion.uncheck(); await expect(page.locator('#btnDownload')).toBeDisabled();
  await expect(inclusion).toBeFocused();
});

async function synthetic(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); };
  });
  await page.goto('/');
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ed3c5a'; ctx.fillRect(0, 0, 400, 300); return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.locator('#controlsResult')).toBeVisible();
  await expect(page.locator('#controlsResult')).not.toHaveClass(/scanning/, { timeout: 60000 });
}

test('brush gestures are undoable, redoable and flattened in downloaded JPEG pixels', async ({ page }) => {
  await synthetic(page); await openEditing(page); await page.locator('#toolBrush').click();
  await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const rect = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(rect.x + .2 * rect.width, rect.y + .5 * rect.height); await page.mouse.down();
  await page.mouse.move(rect.x + .8 * rect.width, rect.y + .5 * rect.height, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#editorUndo').click(); await expect(page.locator('.detection-box.manual')).toHaveCount(0);
  await page.locator('#editorRedo').click(); await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const output = await pending; const bytes = readFileSync(await output.path());
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  const pixels = await page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0); return [...ctx.getImageData(100, 146, 200, 8).data];
  }, bytes.toString('base64'));
  expect(pixels.every((value, i) => i % 4 === 3 ? value === 255 : value <= 8)).toBe(true);
});

test('Soft Conceal uses opaque synthesized core pixels in preview and flattened output', async ({ page }) => {
  await synthetic(page); await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const rect = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(rect.x + .2 * rect.width, rect.y + .2 * rect.height); await page.mouse.down();
  await page.mouse.move(rect.x + .8 * rect.width, rect.y + .8 * rect.height); await page.mouse.up();
  await page.locator('#regionStyle').selectOption('soft');
  await page.locator('#regionColor').fill('#bc8760'); await page.locator('#regionColor').dispatchEvent('change');
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const output = await pending; const bytes = readFileSync(await output.path());
  const pixel = await page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0); return [...ctx.getImageData(200, 150, 1, 1).data];
  }, bytes.toString('base64'));
  expect(pixel[3]).toBe(255); expect(pixel[0]).toBeGreaterThan(170); expect(pixel[0]).toBeLessThan(210);
  expect(pixel[1]).toBeGreaterThan(110); expect(pixel[1]).toBeLessThan(160);
});

test('mask eraser restores original pixels reversibly and exports only the remaining brush coverage', async ({ page }) => {
  await synthetic(page); await openEditing(page); await page.locator('#toolBrush').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(r.x + .2 * r.width, r.y + .5 * r.height); await page.mouse.down();
  await page.mouse.move(r.x + .8 * r.width, r.y + .5 * r.height, { steps: 8 }); await page.mouse.up();
  await page.locator('#toolEraser').click();
  const eraserRect = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(eraserRect.x + .5 * eraserRect.width, eraserRect.y + .5 * eraserRect.height); await page.mouse.down(); await page.mouse.up();
  const core = () => page.locator('#mainCanvas').evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(200, 150, 1, 1).data]);
  expect((await core())[0]).toBe(237);
  await page.locator('#editorUndo').click(); expect((await core())[0]).toBe(0);
  await page.locator('#editorRedo').click(); expect((await core())[0]).toBe(237);
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click(); const output = await pending;
  const pixels = await page.evaluate(async data => {
    const img = new Image(); img.src = `data:image/jpeg;base64,${data}`; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    return [100, 200].map(x => [...ctx.getImageData(x, 150, 1, 1).data]);
  }, readFileSync(await output.path()).toString('base64'));
  expect(pixels[0].slice(0, 3).every(v => v <= 8)).toBe(true);
  expect(pixels[1][0]).toBeGreaterThan(225); expect(pixels[1][3]).toBe(255);
});

test('replacing an edited file requires confirmation even after verification if no download occurred', async ({ page }) => {
  await synthetic(page); await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#mainCanvas').boundingBox())!;
  await page.mouse.move(r.x + .2 * r.width, r.y + .2 * r.height); await page.mouse.down();
  await page.mouse.move(r.x + .6 * r.width, r.y + .6 * r.height); await page.mouse.up();
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  await page.locator('#celebClose').click();
  const warning = page.waitForEvent('dialog');
  const replacement = page.locator('#fileInput').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: readFileSync(new URL('../fixtures/black.jpg', import.meta.url)) });
  const dialog = await warning; expect(dialog.type()).toBe('confirm'); await dialog.dismiss(); await replacement;
  await expect(page.locator('#loadedFilename')).toHaveText('synthetic.png');
  await expect(page.locator('#btnDownload')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Manual 1, page 1', exact: true })).toBeVisible();
});

test.describe('touch brush', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test('cancelled touch strokes leave no edits or drafts and the next stroke commits', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Touch cancellation injection requires Chromium CDP; mouse/keyboard editing is tested in every engine.');
    await synthetic(page); await openEditing(page); await page.locator('#toolBrush').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
    const rect = (await page.locator('#mainCanvas').boundingBox())!, cdp = await context.newCDPSession(page);
    const point = (x: number) => [{ x: rect.x + x * rect.width, y: rect.y + .5 * rect.height }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(.2) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(.5) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('.brush-draft')).toHaveCount(0); await expect(page.locator('.detection-box.manual')).toHaveCount(0);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(.2) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(.8) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  });
});
