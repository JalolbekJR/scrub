import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';


test('bounded real face and synthetic OCR benchmark', async ({ page }) => {
  test.setTimeout(120000);
  const external: string[] = [];
  page.on('request', r => { if (!new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/) && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto('/');
  const portrait = readFileSync(new URL('../fixtures/astronaut.png', import.meta.url)).toString('base64');
  const results = await page.evaluate(async (portrait) => {
    const { detectFaces } = await import('/src/detectors/face.ts');
    const { detectPii } = await import('/src/detectors/pii.ts');
    const { redactPixels } = await import('/src/redactor.ts');
    const image = new Image(); image.src = `data:image/png;base64,${portrait}`; await image.decode();
    const faceCases = [
      { name: 'original', w: 512, h: 512, placements: [[0, 0, 512]] },
      { name: 'multiple', w: 1024, h: 512, placements: [[0, 0, 512], [512, 0, 512]] },
      { name: 'small-edge', w: 1200, h: 800, placements: [[1030, 0, 170], [0, 630, 170]] },
      { name: 'low-resolution', w: 128, h: 128, placements: [[0, 0, 128]] },
      { name: 'tilted-15', w: 512, h: 512, placements: [[0, 0, 512]], angle: 15 },
      { name: 'rotated-90', w: 512, h: 512, placements: [[0, 0, 512]], angle: 90 },
      { name: 'occluded', w: 512, h: 512, placements: [[0, 0, 512]], occluded: true },
      { name: 'blank-negative', w: 512, h: 512, placements: [] },
      { name: 'pdf-face', w: 512, h: 512, placements: [[0, 0, 512]], pdf: true },
    ];
    const faces = [];
    for (const f of faceCases) {
      const canvas = document.createElement('canvas'); canvas.width = f.w; canvas.height = f.h;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, f.w, f.h);
      const expected = f.placements.map(([x, y, size]) => {
        ctx.save(); ctx.translate(x + size / 2, y + size / 2); ctx.rotate((f.angle ?? 0) * Math.PI / 180);
        ctx.drawImage(image, -size / 2, -size / 2, size, size); ctx.restore();
        const corners = [[175, 65], [275, 65], [175, 180], [275, 180]].map(([px, py]) => {
          const a = (f.angle ?? 0) * Math.PI / 180;
          return [x + size / 2 + ((px - 256) * Math.cos(a) - (py - 256) * Math.sin(a)) * size / 512,
            y + size / 2 + ((px - 256) * Math.sin(a) + (py - 256) * Math.cos(a)) * size / 512];
        });
        const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
      });
      if (f.occluded) { ctx.fillStyle = 'white'; ctx.fillRect(170, 133, 110, 48); }
      if (f.pdf) {
        const { jsPDF, getDocument } = await import('/e2e/browser-harness.ts');
        const pdf = new jsPDF({ unit: 'pt', format: [512, 512] });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 512, 512);
        const task = getDocument({ data: new Uint8Array(pdf.output('arraybuffer')), isEvalSupported: false });
        try {
          const doc = await task.promise; const page = await doc.getPage(1);
          await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
        } finally { await task.destroy(); }
      }
      const t0 = performance.now();
      const boxes = await detectFaces(ctx.getImageData(0, 0, f.w, f.h));
      const matched = new Set<number>(); let tp = 0; const ious: number[] = [];
      for (const b of boxes) {
        const i = expected.findIndex((e, i) => {
          const inter = Math.max(0, Math.min(b.x + b.width, e.x + e.width) - Math.max(b.x, e.x)) * Math.max(0, Math.min(b.y + b.height, e.y + e.height) - Math.max(b.y, e.y));
          const iou = inter / (b.width * b.height + e.width * e.height - inter);
          if (!matched.has(i) && iou >= .3) { ious.push(iou); return true; }
          return false;
        });
        if (i >= 0) { matched.add(i); tp++; }
      }
      const ms = Math.round(performance.now() - t0);
      boxes.forEach(b => redactPixels(ctx, b));
      const encoded = new Image(); encoded.src = canvas.toDataURL('image/jpeg', .95); await encoded.decode();
      ctx.drawImage(encoded, 0, 0);
      let uncovered = 0, annotatedPixels = 0;
      for (const e of expected) {
        const x = Math.ceil(e.x), y = Math.ceil(e.y), w = Math.floor(e.x + e.width) - x, h = Math.floor(e.y + e.height) - y;
        const pixels = ctx.getImageData(x, y, w, h).data; annotatedPixels += w * h;
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) uncovered++;
      }
      faces.push({ name: f.name, tp, fp: boxes.length - tp, fn: expected.length - tp, boxes, ms, ious, uncovered, annotatedPixels });
    }
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 360;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 360);
    ctx.fillStyle = 'black'; ctx.font = '28px monospace';
    const lines = ['alice@example.com', '+44 (20) 7946 0958', '4111 1111 1111 1111', 'Dr. Alice Smith', 'Date: 2026-10-11', 'Order: 0000000000000000'];
    lines.forEach((line, i) => ctx.fillText(line, 30, 45 + i * 50));
    const pii = await detectPii(ctx.getImageData(0, 0, 1000, 360));
    const rotated = document.createElement('canvas'); rotated.width = 360; rotated.height = 1000;
    const rc = rotated.getContext('2d')!; rc.translate(360, 0); rc.rotate(Math.PI / 2); rc.drawImage(canvas, 0, 0);
    const rotatedPii = await detectPii(rc.getImageData(0, 0, 360, 1000));
    const small = document.createElement('canvas'); small.width = 500; small.height = 180;
    const sc = small.getContext('2d')!; sc.drawImage(canvas, 0, 0, 500, 180);
    const smallPii = await detectPii(sc.getImageData(0, 0, 500, 180));
    pii.forEach(d => redactPixels(ctx, d.bbox));
    const output = new Image(); output.src = canvas.toDataURL('image/jpeg', .95); await output.decode(); ctx.drawImage(output, 0, 0);
    let piiUncovered = 0;
    for (const d of pii) {
      const b = d.bbox; const pixels = ctx.getImageData(b.x, b.y, b.width, b.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 8 || pixels[i + 1] > 8 || pixels[i + 2] > 8) piiUncovered++;
    }
    return { faces, pii, rotatedPii, smallPii, piiUncovered };
  }, portrait);
  await test.info().attach('accuracy', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
  console.warn('ACCURACY', JSON.stringify(results));
  for (const face of results.faces) {
    expect(face.fn).toBe(0); expect(face.fp).toBe(0); expect(face.uncovered).toBe(0);
  }
  expect(results.faces.find(f => f.name === 'blank-negative')!.fp).toBe(0);
  expect(results.pii.map(d => d.type)).toEqual(['email', 'phone', 'card', 'name']);
  expect(results.pii[3].bbox.x + results.pii[3].bbox.width).toBeGreaterThan(250);
  expect(results.piiUncovered).toBe(0);
  expect(results.rotatedPii.map(d => d.type).sort()).toEqual(['card', 'email', 'name', 'phone']);
  expect(results.smallPii.map(d => d.type)).toEqual(['email', 'phone', 'card', 'name']);
  expect(external).toEqual([]);
});

test('selected pixels are replaced with opaque output-independent pixels', async ({ page }) => {
  await page.goto('/');
  const pixels = await page.evaluate(async () => {
    const { redactPixels } = await import('/src/redactor.ts');
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'rgba(250,40,70,.5)'; ctx.fillRect(0, 0, 100, 100);
    redactPixels(ctx, { x: 25.2, y: 25.7, width: 30.1, height: 30.4 });
    return [...ctx.getImageData(30, 30, 1, 1).data];
  });
  expect(pixels).toEqual([0, 0, 0, 255]);
});
