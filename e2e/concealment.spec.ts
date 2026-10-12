import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

for (const style of ['solid', 'gradient', 'soft'] as const) test(`${style}: recognizable protected patterns cannot survive downloaded JPEG or PDF`, async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture output'); }; });
  const outputs: { jpg: Buffer; pdf: Buffer }[] = [];
  for (const variant of [0, 1]) {
    const jpgEvent = page.waitForEvent('download');
    const source = await page.evaluate(async ({ style, variant }) => {
      const { renderRegions } = await import('/src/mask-renderer.ts');
      const { EditorDocument } = await import('/src/editor-state.ts');
      const { buildExport, resetExportContext, triggerDownload } = await import('/src/export.ts');
      const c = document.getElementById('mainCanvas') as HTMLCanvasElement; c.width = 320; c.height = 240;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#eeeeee'; ctx.fillRect(0, 0, 320, 240);
      // Two different high-contrast recognizable private patterns, identical surroundings.
      ctx.fillStyle = variant ? '#0000ff' : '#ff0000'; ctx.fillRect(80, 50, 160, 140);
      ctx.fillStyle = 'white'; ctx.font = '20px monospace'; ctx.fillText(variant ? 'SECRET B' : 'SECRET A', 90, 100);
      for (let y = 50; y < 190; y += 12) { ctx.fillStyle = variant ? 'yellow' : 'black'; ctx.fillRect(80, y, 160, 3); }
      const source = c.toDataURL('image/png'); const original = ctx.getImageData(0, 0, 320, 240);
      const editor = new EditorDocument('secure').reviewPage(1, 320, 240, []);
      editor.add({ type: 'manual', style, color: '#bc8760', bbox: { x: 80, y: 50, width: 160, height: 140 } });
      editor.update(editor.regions()[0].id, { color: '#112233' }); editor.undo(); editor.redo(); editor.undo();
      renderRegions(c, editor.regions());
      const rendered = ctx.getImageData(80, 50, 160, 140).data;
      const opaque = [...rendered].every((v, i) => i % 4 !== 3 || v === 255);
      // Undo/redo reconstructs from original, never from a previously masked raster.
      const expected = ctx.getImageData(0, 0, 320, 240).data.slice();
      ctx.putImageData(original, 0, 0); renderRegions(c, editor.regions());
      const reconstructed = ctx.getImageData(0, 0, 320, 240).data.every((v, i) => v === expected[i]);
      resetExportContext(); const built = await buildExport(); await triggerDownload(built.filename, built.blob);
      return { source, regions: editor.regions(), opaque, reconstructed };
    }, { style, variant });
    expect(source.opaque).toBe(true); expect(source.reconstructed).toBe(true);
    const jpg = readFileSync(await (await jpgEvent).path());
    const pdfEvent = page.waitForEvent('download');
    const inspection = await page.evaluate(async ({ source, regions }) => {
      const { jsPDF, getDocument } = await import('/e2e/browser-harness.ts');
      const { setPdfContext, storeReviewedPage, buildExport, triggerDownload } = await import('/src/export.ts');
      const { verifyCleanPdf } = await import('/src/forensics.ts');
      const pdf = new jsPDF({ unit: 'pt', format: [320, 240], orientation: 'landscape' });
      pdf.setProperties({ author: 'PRIVATE PATTERN AUTHOR' }); pdf.addImage(source, 'PNG', 0, 0, 320, 240);
      const task = getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), isEvalSupported: false });
      try {
        const doc = await task.promise; setPdfContext(doc, 1);
        const vp = (await doc.getPage(1)).getViewport({ scale: 1.5 });
        storeReviewedPage(1, regions.map(r => ({ ...r, bbox: { x: r.bbox.x * 1.5, y: r.bbox.y * 1.5, width: r.bbox.width * 1.5, height: r.bbox.height * 1.5 } })), { width: Math.round(vp.width), height: Math.round(vp.height) } as HTMLCanvasElement);
        const built = await buildExport(); const verified = await verifyCleanPdf(built.blob, 1);
        await triggerDownload(built.filename, built.blob); return verified;
      } finally { await task.destroy(); }
    }, source);
    expect(inspection.clean).toBe(true);
    const pdf = readFileSync(await (await pdfEvent).path());
    expect(pdf.includes(Buffer.from('PRIVATE PATTERN AUTHOR'))).toBe(false);
    // One flattened JPEG resource only: no second original image behind it,
    // including unused resources that would not appear in the decoded preview.
    expect(pdf.toString('latin1').match(/\/Subtype\s*\/Image\b/g)).toHaveLength(1);
    expect(jpg.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255])); expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    outputs.push({ jpg, pdf });
  }
  // Exact output identity proves no source dependence, including boundary JPEG blocks.
  expect(outputs[0].jpg.equals(outputs[1].jpg)).toBe(true);
  const decoded = await page.evaluate(async files => {
    const { getDocument } = await import('/e2e/browser-harness.ts');
    const results = [];
    for (const encoded of files) {
      const task = getDocument({ data: Uint8Array.from(atob(encoded), c => c.charCodeAt(0)), isEvalSupported: false });
      try {
        const doc = await task.promise, p = await doc.getPage(1), vp = p.getViewport({ scale: 1 });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); const ctx = c.getContext('2d')!;
        await p.render({ canvas: c, canvasContext: ctx, viewport: vp }).promise;
        results.push({ pages: doc.numPages, text: (await p.getTextContent()).items.length, pixels: Array.from(ctx.getImageData(0, 0, c.width, c.height).data) });
      } finally { await task.destroy(); }
    }
    return results;
  }, outputs.map(o => o.pdf.toString('base64')));
  expect(decoded[0].pages).toBe(1); expect(decoded[0].text).toBe(0); expect(decoded[1].text).toBe(0);
  expect(decoded[0].pixels).toEqual(decoded[1].pixels);
});

test('sparse rapid brush segments and cosmetic overlaps stay covered in downloaded pixels', async ({ page }) => {
  await page.goto('/'); const pending = page.waitForEvent('download');
  await page.evaluate(async () => {
    const { renderRegions } = await import('/src/mask-renderer.ts');
    const { buildExport, resetExportContext, triggerDownload } = await import('/src/export.ts');
    const c = document.getElementById('mainCanvas') as HTMLCanvasElement; c.width = 400; c.height = 300;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, 400, 300);
    renderRegions(c, [
      { type: 'manual', shape: 'brush', bbox: { x: 0, y: 130, width: 400, height: 40 }, strokes: [{ size: 32, points: [{ x: 0, y: 150 }, { x: 400, y: 150 }] }] },
      { type: 'manual', bbox: { x: 100, y: 100, width: 200, height: 100 } },
      { type: 'manual', style: 'blur', bbox: { x: 0, y: 0, width: 400, height: 300 } },
      { type: 'manual', style: 'mosaic', bbox: { x: 0, y: 0, width: 400, height: 300 } },
    ]);
    resetExportContext(); const built = await buildExport();
    (window as Window & { showSaveFilePicker?: () => Promise<never> }).showSaveFilePicker = async () => { throw new Error('Capture output'); };
    await triggerDownload(built.filename, built.blob);
  });
  const bytes = readFileSync(await (await pending).path());
  const uncovered = await page.evaluate(async encoded => {
    const image = new Image(); image.src = `data:image/jpeg;base64,${encoded}`; await image.decode();
    const c = document.createElement('canvas'); c.width = image.width; c.height = image.height; const ctx = c.getContext('2d')!; ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 143, 400, 14).data;
    let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8 || pixels[i + 3] !== 255) count++;
    return count;
  }, bytes.toString('base64'));
  expect(uncovered).toBe(0);
});
