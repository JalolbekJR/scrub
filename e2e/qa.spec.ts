import { openEditing } from './editor-controls';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';

const black = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('a browser drop event accepts a supported file and reaches review', async ({ page }) => {
  await page.evaluate(encoded => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'dropped.jpg', { type: 'image/jpeg' }));
    document.getElementById('dropZone')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, black.toString('base64'));
  await expect(page.locator('#loadedFilename')).toHaveText('dropped.jpg');
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
});

test('reduced motion disables decorative animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.badge-dot').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
});

test('clipboard failure is explained and the download dialog restores keyboard focus', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Synthetic permission denial'); } } });
  });
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: black });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#btnRedact').click();
  await expect(page.locator('#celebrateBackdrop')).toBeVisible({ timeout: 60000 });
  await page.locator('#celebCopy').click();
  await expect(page.locator('#celebCopy')).toContainText('Could not copy');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.getElementById('celebrateModal')!.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#dropZone')).toBeFocused();
});

test('a manual mask can be created and adjusted entirely with the keyboard', async ({ page }) => {
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: black });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await openEditing(page); await page.locator('#btnDraw').focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Add centered mask' }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await expect(page.locator('#region-width')).toBeFocused();
  const width = Number(await page.locator('#region-width').inputValue());
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('Tab');
  await expect(page.locator('#region-width')).toHaveValue(String(width + 1));
  await page.locator('#editorUndo').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#region-width')).toHaveValue(String(width));
});

test('blocked image parsing is preempted without blocking the main thread', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ImageInspection } = await import('/src/inspection-client.ts');
    const client = new ImageInspection(() => new Worker('/e2e/stalled-worker.ts', { type: 'module' }), 250);
    let ticks = 0; const timer = setInterval(() => ticks++, 10);
    const start = performance.now(); const report = await client.inspect(new File(['synthetic'], 'input.jpg'));
    clearInterval(timer); return { report, ticks, ms: performance.now() - start };
  });
  expect(result.report.inspectionFailed).toBe(true); expect(result.report.checks).toContain('Scan failed: image inspection timed out');
  expect(result.ticks).toBeGreaterThan(5); expect(result.ms).toBeLessThan(1500);
});

test('overlapping uploads retain the latest selection without a stale scan', async ({ page }) => {
  await page.evaluate(async encoded => {
    const { handleFile } = await import('/src/upload.ts');
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const first = new File([bytes], 'first.jpg', { type: 'image/jpeg' });
    const slice = first.slice.bind(first); let release!: () => void; let delayed = false;
    first.slice = (...args) => {
      const blob = slice(...args), read = blob.arrayBuffer.bind(blob); if (delayed) return blob; delayed = true;
      blob.arrayBuffer = async () => { await new Promise<void>(resolve => { release = resolve; }); return read(); }; return blob;
    };
    const pending = handleFile(first);
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    await handleFile(new File([bytes], 'latest.jpg', { type: 'image/jpeg' })); release(); await pending;
  }, black.toString('base64'));
  await expect(page.locator('#loadedFilename')).toHaveText('latest.jpg');
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
});

test('replacing a PDF releases its loading task, including rejected replacement files', async ({ page }) => {
  await page.evaluate(() => {
    document.addEventListener('file:loaded', event => {
      const doc = (event as CustomEvent<{ pdfDoc?: import('pdfjs-dist').PDFDocumentProxy }>).detail.pdfDoc;
      if (doc) (window as Window & { oldPdfTask?: import('pdfjs-dist').PDFDocumentLoadingTask }).oldPdfTask = doc.loadingTask;
    });
  });
  const pdf = new jsPDF(); pdf.text('Synthetic page', 20, 30);
  await page.locator('#fileInput').setInputFiles({ name: 'source.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#fileInput').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not supported') });
  await expect.poll(() => page.evaluate(() => (window as Window & { oldPdfTask?: import('pdfjs-dist').PDFDocumentLoadingTask }).oldPdfTask?.destroyed)).toBe(true);
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await page.locator('#fileInput').setInputFiles({ name: 'black.jpg', mimeType: 'image/jpeg', buffer: black });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
});

test('mobile touch drawing, zoomed layout and accessible control names', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch drag injection uses Chromium CDP; other engines receive keyboard/layout checks.');
  await page.setViewportSize({ width: 390, height: 844 });
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ed3c5a'; ctx.fillRect(0, 0, 400, 300); return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await openEditing(page); await page.locator('#btnDraw').click(); await page.locator('#mainCanvas').scrollIntoViewIfNeeded();
  const r = (await page.locator('#mainCanvas').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + .2 * r.width, y: r.y + .2 * r.height }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: r.x + .7 * r.width, y: r.y + .7 * r.height }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  await expect(page.locator('.detection-box.manual')).toHaveCount(1);
  await page.locator('#showRegions').click();
  await expect(page.locator('#regionInspector')).toBeVisible();
  await page.getByRole('button', { name: 'Close region settings' }).click();
  const overlap = await page.evaluate(() => {
    const theme = document.getElementById('themeToggle')!.getBoundingClientRect();
    return ['.local-privacy', '.loaded-filename'].some(selector => {
      const r = document.querySelector(selector)!.getBoundingClientRect(); return r.left < theme.right && r.right > theme.left && r.top < theme.bottom && r.bottom > theme.top;
    });
  });
  expect(overlap).toBe(false);
  const tools = page.locator('.editor-toolbar button:visible');
  for (const tool of await tools.all()) { const box = (await tool.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(24); expect(box.height).toBeGreaterThanOrEqual(24); expect(await tool.innerText()).not.toBe(''); }
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});
