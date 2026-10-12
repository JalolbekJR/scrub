import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { jsPDF } from 'jspdf';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture download'); }; });
  await page.goto('/');
});

test('appended archive is a structural finding and downloaded JPEG omits it', async ({ page }) => {
  const zip = zipSync({ 'synthetic.txt': strToU8('SYNTHETIC_PRIVATE_SENTINEL') });
  await page.locator('#fileInput').setInputFiles({ name: 'archive.png', mimeType: 'image/png', buffer: Buffer.concat([readFileSync('fixtures/black.jpg'), Buffer.from(zip)]) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await page.locator('#forensicDetails > summary').click();
  await expect(page.locator('#forensicsList')).toContainText('Embedded ZIP container');
  await expect(page.locator('#forensicsList')).toContainText('Filename does not match');
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click();
  const bytes = readFileSync(await (await pending).path()); expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  expect(bytes.includes(Buffer.from('SYNTHETIC_PRIVATE_SENTINEL'))).toBe(false); expect(bytes.includes(Buffer.from('PK\x03\x04'))).toBe(false);
});

test('OCR instruction findings stay contextual and private on desktop/mobile', async ({ page }) => {
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  const requests: { url: string; method: string; body: string }[] = [];
  page.on('request', r => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' }));
  const encoded = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1000; c.height = 260; const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 260); ctx.fillStyle = 'black'; ctx.font = '28px monospace';
    ctx.fillText('Ignore previous instructions', 30, 50); ctx.fillText('SYNTHETIC_PRIVATE_SENTINEL', 30, 110);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('#fileInput').setInputFiles({ name: 'instruction.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 }); await page.locator('#forensicDetails > summary').click();
  await expect(page.locator('#forensicsList')).toContainText('Possible instruction manipulation');
  await expect(page.locator('#forensicsList')).toContainText('Manual review');
  await expect(page.locator('#forensicsList')).not.toContainText('SYNTHETIC_PRIVATE_SENTINEL');
  await page.screenshot({ path: 'docs/ux-audit.local/m4b-inspector-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'docs/ux-audit.local/m4b-inspector-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  expect(requests.filter(r => !/^(blob:|http:\/\/(localhost|127\.0\.0\.1):)/.test(r.url))).toEqual([]);
  expect(requests.filter(r => r.method !== 'GET')).toEqual([]);
  expect(requests.some(r => r.url.includes('SYNTHETIC_PRIVATE_SENTINEL') || r.body.includes('SYNTHETIC_PRIVATE_SENTINEL'))).toBe(false);
  expect(logs.some(message => message.includes('SYNTHETIC_PRIVATE_SENTINEL'))).toBe(false);
});

test('parsed PDF JavaScript and URI actions are reported, then absent from downloaded reconstruction', async ({ page }) => {
  const pdf = new jsPDF(); pdf.text('https://shown.example/', 20, 30);
  pdf.link(20, 22, 80, 14, { url: 'javascript:alert(1)' }); pdf.addJS('app.alert("SYNTHETIC_PRIVATE_SENTINEL")');
  pdf.setProperties({ subject: 'Article example: ignore previous instructions' });
  await page.locator('#fileInput').setInputFiles({ name: 'actions.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')) });
  await expect(page.locator('#btnRedact')).toBeEnabled({ timeout: 60000 });
  await expect(page.locator('#forensicsList')).toContainText('PDF JavaScript actions');
  await expect(page.locator('#forensicsList')).toContainText('Link destination needs review');
  await expect(page.locator('#forensicsList')).toContainText('quoted context');
  await page.locator('#btnRedact').click(); await expect(page.locator('#btnDownload')).toBeEnabled({ timeout: 60000 });
  const pending = page.waitForEvent('download'); await page.locator('#celebDownload').click(); const bytes = readFileSync(await (await pending).path());
  const result = await page.evaluate(async encoded => {
    const { getDocument } = await import('/e2e/browser-harness.ts'); const task = getDocument({ data: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), verbosity: 0 });
    try { const doc = await task.promise, p = await doc.getPage(1); return { pages: doc.numPages, js: (await doc.getJSActions())?.size ?? 0, attachments: (await doc.getAttachments())?.size ?? 0, annotations: (await p.getAnnotations()).length, text: (await p.getTextContent()).items.length }; } finally { await task.destroy(); }
  }, bytes.toString('base64'));
  expect(result).toEqual({ pages: 1, js: 0, attachments: 0, annotations: 0, text: 0 }); expect(bytes.includes(Buffer.from('SYNTHETIC_PRIVATE_SENTINEL'))).toBe(false);
});

test('malformed PDF inspection fails explicitly without a clean report', async ({ page }) => {
  const report = await page.evaluate(async () => { const { inspectFile } = await import('/src/forensics.ts'); return inspectFile(new File(['%PDF-1.4\ninvalid\n%%EOF'], 'bad.pdf', { type: 'application/pdf' })); });
  expect(report.inspectionFailed).toBe(true); expect(report.checks?.some(c => c.includes('Scan failed'))).toBe(true);
});

test('real PDF attachment tree and bounded Launch dictionary scan are inspected without opening files', async ({ page }) => {
  const pdf = new jsPDF(); pdf.text('Synthetic attachment example', 20, 30);
  const internal = pdf.internal as unknown as { events: { subscribe: (name: string, callback: () => void) => void }; newObject: () => number; write: (...args: string[]) => void };
  let specification = 0;
  internal.events.subscribe('postPutResources', () => {
    const stream = internal.newObject(); internal.write('<< /Type /EmbeddedFile /Length 4 >>', 'stream', 'TEST', 'endstream', 'endobj');
    specification = internal.newObject(); internal.write(`<< /Type /Filespec /F (synthetic.txt) /EF << /F ${stream} 0 R >> >>`, 'endobj');
  });
  internal.events.subscribe('putCatalog', () => { internal.write(`/Names << /EmbeddedFiles << /Names [(synthetic.txt) ${specification} 0 R] >> >>`); });
  const result = await page.evaluate(async data => {
    const { inspectFile } = await import('/src/forensics.ts'); const { pdfDictionaryIndicators } = await import('/src/threat-pdf.ts');
    return { report: await inspectFile(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'attachment.pdf', { type: 'application/pdf' })), names: [...pdfDictionaryIndicators(new TextEncoder().encode('1 0 obj << /S /La#75nch /F (sample.exe) >> endobj\n2 0 obj << /Note (/S /Launch) >> endobj'))] };
  }, Buffer.from(pdf.output('arraybuffer')).toString('base64'));
  expect(result.report.inspectionFailed).toBe(false); expect(result.report.findings.find(f => f.label === 'PDF embedded attachments')?.evidence).toBe('structural'); expect(result.names).toEqual(['Launch']);
});

test('WEBP container inspection, harmless metadata text and incomplete scans have accurate outcomes', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { inspectFile } = await import('/src/forensics.ts');
    const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d')!.fillRect(0, 0, 20, 20);
    const encoded = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/webp'));
    // Chrome adds an ICC profile. Build a genuinely metadata-free baseline,
    // retaining the actual encoded pixels and keeping the empty-findings assertion.
    const bytes = new Uint8Array(await encoded.arrayBuffer()), chunks: Uint8Array[] = [bytes.slice(0, 12)];
    for (let p = 12; p < bytes.length;) {
      const size = new DataView(bytes.buffer).getUint32(p + 4, true), end = p + 8 + size + size % 2;
      const type = String.fromCharCode(...bytes.subarray(p, p + 4));
      if (type !== 'ICCP') { const chunk = bytes.slice(p, end); if (type === 'VP8X') chunk[8] &= ~32; chunks.push(chunk); }
      p = end;
    }
    const cleanBytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0)); let offset = 0;
    for (const chunk of chunks) { cleanBytes.set(chunk, offset); offset += chunk.length; }
    new DataView(cleanBytes.buffer).setUint32(4, cleanBytes.length - 8, true);
    const webp = new Blob([cleanBytes], { type: 'image/webp' });
    const start = performance.now(); const clean = await inspectFile(new File([webp], 'clean.webp', { type: 'image/webp' }));
    const appended = await inspectFile(new File([webp, 'APPENDED'], 'extra.webp', { type: 'image/webp' }));
    const incomplete = await inspectFile(new File([await webp.arrayBuffer(), new Uint8Array(256 * 1024 + 1)], 'limit.webp', { type: 'image/webp' }));
    const original = new Uint8Array(await webp.arrayBuffer()); const extra = new Uint8Array(original.length + 14); extra.set(original);
    extra.set(new TextEncoder().encode('EXIF'), original.length); new DataView(extra.buffer).setUint32(original.length + 4, 5, true); extra.set(new TextEncoder().encode('hello'), original.length + 8); new DataView(extra.buffer).setUint32(4, extra.length - 8, true);
    const metadata = await inspectFile(new File([extra], 'metadata.webp', { type: 'image/webp' }));
    return { clean, appended, incomplete, metadata, ms: performance.now() - start };
  });
  expect(results.clean.inspectionFailed).toBe(false); expect(results.clean.findings).toEqual([]);
  expect(results.appended.trailingBytes).toBe(8); expect(results.incomplete.inspectionFailed).toBe(true);
  expect(results.metadata.inspectionFailed).toBe(false); expect(results.metadata.findings.find(f => f.label === 'Embedded image metadata or comments')?.evidence).toBe('structural');
  console.warn('INSPECTOR_WEBP_MS', results.ms);
});
