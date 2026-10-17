import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { unzipSync } from 'fflate';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

const root = resolve('dist');
const groups = []; let group;
for (const line of readFileSync('dist/_headers', 'utf8').split(/\r?\n/)) {
  if (line.startsWith('/')) { group = { pattern: line.trim(), headers: {} }; groups.push(group); }
  else if (group && /^\s+[^:]+:/.test(line)) { const colon = line.indexOf(':'); group.headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim(); }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const tls = process.env.SCRUB_TEST_TLS_PFX ? { pfx: readFileSync(process.env.SCRUB_TEST_TLS_PFX), passphrase: process.env.SCRUB_TEST_TLS_PASSWORD } : null;
const serve = (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    let file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep) || path === '/_headers') throw new Error('Not an asset');
    if (!existsSync(file) && request.headers.accept?.includes('text/html')) file = resolve(root, 'index.html');
    const headers = { 'Cache-Control': 'public, max-age=0, must-revalidate' };
    for (const rule of groups) if (rule.pattern === '/*' || path.startsWith(rule.pattern.replace(/\*$/, ''))) Object.assign(headers, rule.headers);
    response.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' }); response.end(readFileSync(file));
  } catch { response.writeHead(404); response.end(); }
};
const server = tls ? https.createServer(tls, serve) : http.createServer(serve);
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}`;
const engine = process.env.SCRUB_TEST_BROWSER ?? 'chromium';
const browser = await ({ chromium, firefox, webkit }[engine]).launch(engine === 'chromium' && process.env.SCRUB_BROWSER_EXECUTABLE ? { executablePath: process.env.SCRUB_BROWSER_EXECUTABLE } : {});
const results = [], requests = [], errors = [];
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: Boolean(tls), viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(90000);
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    expect(dialog.message()).toBe('Replace these files and discard their edits that have not been downloaded?');
    await dialog.accept();
  });
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), body: request.postData() }));
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    window.loadedCount = 0; document.addEventListener('file:loaded', () => window.loadedCount++);
    window.downloadAudit = { permissions: 0, downloads: [], revoked: [] };
    window.showSaveFilePicker = async () => { window.downloadAudit.permissions++; throw new Error('File-write permission forbidden'); };
    if (window.FileSystemFileHandle) window.FileSystemFileHandle.prototype.createWritable = async () => { window.downloadAudit.permissions++; throw new Error('Writable handle forbidden'); };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), blobs = new Map();
    URL.createObjectURL = blob => { const url = create(blob); blobs.set(url, blob); return url; };
    URL.revokeObjectURL = url => { window.downloadAudit.revoked.push(url); blobs.delete(url); revoke(url); };
    document.addEventListener('change', event => { if (event.target.id === 'fileInput') window.uploadedFiles = Array.from(event.target.files); }, true);
    document.addEventListener('click', event => {
      if (event.target instanceof HTMLAnchorElement && event.target.download) {
        const a = event.target;
        window.downloadAudit.downloads.push({ url: a.href, name: a.download, type: blobs.get(a.href)?.type });
      }
    }, true);
  });
  await page.clock.install();
  const response = await page.goto(origin);
  await page.bringToFront();
  await expect(page.locator('#customize')).toHaveAttribute('aria-controls', 'editingTools');
  expect(response.headers()['content-security-policy']).toContain("connect-src 'self'");
  await expect(page.getByRole('heading', { name: 'Three steps. Nothing leaves your device.' })).toBeVisible();
  await page.clock.runFor(1800); await expect(page.locator('#riskTicker')).toContainText('Drop a photo or PDF'); await page.clock.resume();
  const portrait = readFileSync('fixtures/astronaut.png').toString('base64');
  const images = await page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0);
    return ['image/jpeg', 'image/png', 'image/webp'].map(type => ({ type, data: canvas.toDataURL(type).split(',')[1], width: canvas.width, height: canvas.height }));
  }, portrait);
  // A valid single-frame GIF and a generated uncompressed 24-bit BMP exercise the other native codecs.
  images.push({ type: 'image/gif', data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', width: 1, height: 1 });
  const width = 80, height = 60, stride = Math.ceil(width * 3 / 4) * 4, bmp = Buffer.alloc(54 + stride * height, 220);
  bmp.write('BM'); bmp.writeUInt32LE(bmp.length, 2); bmp.writeUInt32LE(0, 6); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(width, 18); bmp.writeInt32LE(height, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(0, 30); bmp.writeUInt32LE(stride * height, 34); bmp.fill(0, 38, 54);
  images.push({ type: 'image/bmp', data: bmp.toString('base64'), width, height });
  async function upload(files) {
    const before = await page.evaluate(() => window.loadedCount);
    await page.locator('#fileInput').setInputFiles(files);
    await page.waitForFunction(before => window.loadedCount > before, before);
    await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 90000 });
  }
  async function download() {
    const pending = page.waitForEvent('download'); await page.locator('#btnRedact').click();
    const output = await pending;
    await expect(page.locator('#celebDownload')).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.hero')).toBeVisible(); await expect(page.locator('#onboarding')).toBeVisible();
    await expect(page.locator('#canvasArea')).toBeHidden(); await expect(page.locator('.detection-box')).toHaveCount(0);
    await expect(page.locator('#celebTitle')).toHaveText('Download started');
    for (const id of ['celebStar', 'celebShare', 'celebCopy', 'celebSupport', 'celebLater', 'celebEdit']) await expect(page.locator('#' + id)).toBeVisible();
    return { bytes: readFileSync(await output.path()), name: output.suggestedFilename() };
  }
  async function jpeg(output, expected) {
    expect(output.bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255])); expect(output.name).toMatch(/\.jpg$/);
    const decoded = await page.evaluate(async data => {
      const image = new Image(); image.src = `data:image/jpeg;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, center: [...ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data] };
    }, output.bytes.toString('base64'));
    expect([decoded.width, decoded.height]).toEqual([expected.width, expected.height]);
    if (expected.covered) expect(decoded.center.slice(0, 3).every(value => value <= 8)).toBe(true);
  }
  async function pdf(bytes, pages) {
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 });
    try {
      const doc = await task.promise; expect(doc.numPages).toBe(pages); expect(await doc.getAttachments()).toBeNull(); expect(await doc.getJSActions()).toBeNull();
      const metadata = await doc.getMetadata(); for (const key of ['Title', 'Subject', 'Author', 'Keywords', 'Creator']) expect(metadata.info[key] ?? '').toBe('');
      for (let i = 1; i <= pages; i++) {
        const page = await doc.getPage(i); expect((await page.getTextContent()).items).toHaveLength(0); expect(await page.getAnnotations()).toHaveLength(0);
        const ops = await page.getOperatorList(); expect(ops.fnArray.filter(op => op === OPS.paintImageXObject)).toHaveLength(1);
      }
    } finally { await task.destroy(); }
  }
  for (const image of images) {
    const started = performance.now(), extension = image.type.split('/')[1];
    await upload({ name: `public-fixture.${extension}`, mimeType: image.type, buffer: Buffer.from(image.data, 'base64') });
    console.warn(engine + ': loaded ' + extension);
    let covered = false;
    if (image.width >= 4) { if (!await page.locator('#btnDraw').isVisible()) await page.locator('#customize').click(); await page.locator('#toolSelect').click(); await page.locator('#btnDraw').click(); await expect(page.locator('#btnDraw')).toHaveAttribute('aria-pressed', 'true'); await page.locator('#addShape').click(); covered = true; }
    const output = await download(); await jpeg(output, { ...image, covered });
    // The input File remains byte-identical after rendering and downloading.
    const original = await page.evaluate(async () => Array.from(new Uint8Array(await window.uploadedFiles[0].arrayBuffer())));
    expect(Buffer.from(original)).toEqual(Buffer.from(image.data, 'base64'));
    if (extension === 'jpeg') {
      const repeat = page.waitForEvent('download'); await page.locator('#celebDownload').click();
      const again = await repeat; expect(readFileSync(await again.path())).toEqual(output.bytes);
      let unexpected = 0; const observe = () => unexpected++; page.on('download', observe);
      await page.locator('#celebClose').click(); await page.locator('#celebDownload').dispatchEvent('click');
      await page.waitForTimeout(100); expect(unexpected).toBe(0); page.off('download', observe);
    }
    results.push({ input: extension, output: 'JPEG', bytes: output.bytes.length, totalMs: Math.round(performance.now() - started) });
    console.warn(engine + ': checked ' + extension);
  }
  const makePdf = count => {
    const source = new jsPDF({ unit: 'pt', format: [200, 300] }); source.setProperties({ author: 'SYNTHETIC_PRIVATE_SENTINEL' }); source.addJS('app.alert("SYNTHETIC DEMO")');
    for (let i = 1; i <= count; i++) { if (i > 1) source.addPage(); source.text('Synthetic ordinary page ' + i, 15, 40); }
    return Buffer.from(source.output('arraybuffer'));
  };
  for (const pages of [1, 3]) {
    const started = performance.now(); await upload({ name: 'ordinary.pdf', mimeType: 'application/pdf', buffer: makePdf(pages) }); const output = await download();
    expect(output.name).toMatch(/\.pdf$/); await pdf(output.bytes, pages); expect(output.bytes.toString()).not.toContain('SYNTHETIC_PRIVATE_SENTINEL');
    results.push({ input: 'PDF', pages, bytes: output.bytes.length, totalMs: Math.round(performance.now() - started) });
  }
  await page.locator('#fileInput').setInputFiles([{ name: 'ordinary.pdf', mimeType: 'application/pdf', buffer: makePdf(2) }, { name: 'portrait.png', mimeType: 'image/png', buffer: readFileSync('fixtures/astronaut.png') }]);
  await expect(page.locator('#batchBackdrop')).toBeVisible({ timeout: 90000 });
  const pending = page.waitForEvent('download'); await page.locator('#btnBatchRedact').click(); const output = await pending, bytes = readFileSync(await output.path()); expect(output.suggestedFilename()).toBe('scrubbed-bundle.zip');
  const entries = unzipSync(bytes); expect(Object.keys(entries)).toHaveLength(2);
  for (const [name, bytes] of Object.entries(entries)) { if (name.endsWith('.pdf')) await pdf(bytes, 2); else await jpeg({ name, bytes: Buffer.from(bytes) }, { width: 512, height: 512 }); }
  results.push({ input: 'mixed batch', entries: Object.keys(entries), bytes: bytes.length });
  // Retain the old prepared output failure guard in the actual built app.
  await upload({ name: 'retry.png', mimeType: 'image/png', buffer: readFileSync('fixtures/astronaut.png') });
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = () => { throw new Error('Synthetic export failure'); }; });
  let failedDownloads = 0; page.on('download', () => failedDownloads++);
  await page.locator('#btnRedact').click(); await expect(page.locator('#canvasArea')).toBeVisible();
  await expect(page.locator('#statusText')).toContainText(/failed|could not|error/i);
  await expect(page.locator('#btnRedact')).not.toHaveAttribute('data-export-state', 'verified');
  await expect(page.locator('#celebrateBackdrop')).toBeHidden();
  await page.waitForTimeout(100); expect(failedDownloads).toBe(0);
  // Advancing the clock verifies every download URL is eventually released.
  await page.clock.runFor(61000);
  const audit = await page.evaluate(() => window.downloadAudit);
  expect(dialogs).toHaveLength(0);
  expect(audit.permissions).toBe(0); expect(audit.downloads).toHaveLength(9);
  for (const download of audit.downloads) {
    expect(audit.revoked.filter(url => url === download.url)).toHaveLength(1);
    expect(download.type).toBe(download.name.endsWith('.pdf') ? 'application/pdf' : download.name.endsWith('.zip') ? 'application/zip' : 'image/jpeg');
  }
  expect(await page.locator('a[download][href^="blob:"]').count()).toBe(0);
  await page.setViewportSize({ width: 320, height: 568 }); await page.locator('#themeToggle').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sameOrigin = requests.every(request => (new URL(request.url).origin === origin || request.url.startsWith('blob:')) && request.method === 'GET' && !request.body);
  expect(sameOrigin).toBe(true); expect(errors).toEqual([]);
  console.warn(JSON.stringify({ engine, forbiddenPermissionCalls: audit.permissions, cleanedDownloadUrls: audit.downloads.length, productionSmoke: results, requests: requests.length, onlyLocalAssetOrBlobReads: sameOrigin, pageOrConsoleErrors: errors }));
} catch (error) { console.warn(JSON.stringify({ engine, pageOrConsoleErrors: errors })); throw error; } finally { await browser.close(); await new Promise(done => server.close(done)); }
