import { expect, it } from 'vitest';
import { renderRegions } from './mask-renderer';

function raster(fill = 173) {
  const pixels = new Uint8ClampedArray(100 * 100 * 4).fill(fill);
  const ctx = {
    canvas: { width: 100, height: 100 },
    getImageData: () => ({ data: pixels.slice(), width: 100, height: 100 }),
    putImageData: (image: { data: Uint8ClampedArray }) => pixels.set(image.data),
  };
  return { pixels, canvas: { width: 100, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement };
}
it('replaces an included ellipse core and preserves excluded regions', () => {
  const { canvas, pixels } = raster();
  renderRegions(canvas, [{ type: 'manual', shape: 'ellipse', bbox: { x: 20, y: 20, width: 40, height: 40 } }]);
  expect([...pixels.slice((40 * 100 + 40) * 4, (40 * 100 + 40) * 4 + 4)]).toEqual([0, 0, 0, 255]);
  expect(pixels[0]).toBe(173);
  const excluded = raster(); renderRegions(excluded.canvas, [{ type: 'manual', included: false, bbox: { x: 1, y: 1, width: 98, height: 98 } }]);
  expect(excluded.pixels.every(v => v === 173)).toBe(true);
});

it.each(['solid', 'gradient', 'soft'] as const)('%s replaces the protected core independently of source RGBA', style => {
  const first = raster(173), second = raster(23);
  const region = { type: 'manual' as const, style, color: '#bc8760', bbox: { x: 20, y: 20, width: 60, height: 60 } };
  renderRegions(first.canvas, [region]); renderRegions(second.canvas, [region]);
  expect(first.pixels[(50 * 100 + 50) * 4]).toBeGreaterThan(100);
  if (style !== 'solid') expect(first.pixels[(35 * 100 + 35) * 4]).not.toBe(first.pixels[(60 * 100 + 60) * 4]);
  for (let y = 35; y < 65; y++) for (let x = 35; x < 65; x++) {
    const i = (y * 100 + x) * 4;
    expect([...first.pixels.slice(i, i + 4)]).toEqual([...second.pixels.slice(i, i + 4)]);
    expect(first.pixels[i + 3]).toBe(255);
  }
});

it('interpolates brush gaps and erases only the mask without damaging source pixels', () => {
  const image = raster();
  const strokes = [{ points: [{ x: 10, y: 50 }, { x: 90, y: 50 }], size: 10 }];
  const region = { type: 'manual' as const, shape: 'brush' as const, bbox: { x: 5, y: 45, width: 90, height: 10 }, strokes };
  renderRegions(image.canvas, [region]);
  expect(image.pixels[(50 * 100 + 50) * 4]).toBe(0);
  expect(image.pixels[(20 * 100 + 50) * 4]).toBe(173);
  const erased = raster();
  renderRegions(erased.canvas, [{ ...region, strokes: [...strokes, { points: [{ x: 50, y: 50 }], size: 12, erase: true }] }]);
  expect(erased.pixels[(50 * 100 + 50) * 4]).toBe(173);
  expect(erased.pixels[(50 * 100 + 20) * 4]).toBe(0);
});

it('cosmetic overlaps cannot expose an opaque protected core regardless of ordering', () => {
  for (const style of ['mosaic', 'blur'] as const) {
    const image = raster();
    renderRegions(image.canvas, [
      { type: 'manual', bbox: { x: 20, y: 20, width: 40, height: 40 } },
      { type: 'manual', style, bbox: { x: 10, y: 10, width: 80, height: 80 } },
    ]);
    expect([...image.pixels.slice((40 * 100 + 40) * 4, (40 * 100 + 40) * 4 + 4)]).toEqual([0, 0, 0, 255]);
  }
});

it('Soft Conceal cannot leave source pixels inside a rectangular face detection', () => {
  const a = raster(173), b = raster(23);
  const region = { type: 'face' as const, style: 'soft' as const, bbox: { x: 20, y: 20, width: 60, height: 60 } };
  renderRegions(a.canvas, [region]); renderRegions(b.canvas, [region]);
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) {
    const i = (y * 100 + x) * 4;
    expect([...a.pixels.slice(i, i + 4)]).toEqual([...b.pixels.slice(i, i + 4)]);
    expect(a.pixels[i + 3]).toBe(255);
  }
});

it.each(['solid', 'gradient', 'soft'] as const)('%s protects an ellipse clipped by the image edge', style => {
  const a = raster(173), b = raster(23);
  const region = { type: 'manual' as const, shape: 'ellipse' as const, style, bbox: { x: 0, y: 0, width: 40, height: 60 } };
  renderRegions(a.canvas, [region]); renderRegions(b.canvas, [region]);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 40; x++) {
    if (((x + .5 - 20) / 20) ** 2 + ((y + .5 - 30) / 30) ** 2 > 1) continue;
    const i = (y * 100 + x) * 4;
    expect([...a.pixels.slice(i, i + 4)]).toEqual([...b.pixels.slice(i, i + 4)]);
    expect(a.pixels[i + 3]).toBe(255);
  }
});

it('sparse fast diagonal brush movement covers every capsule pixel without alpha feathering', () => {
  const a = raster(173), b = raster(23);
  const region = { type: 'manual' as const, shape: 'brush' as const, style: 'soft' as const, bbox: { x: 0, y: 0, width: 100, height: 100 }, strokes: [{ points: [{ x: 5, y: 5 }, { x: 95, y: 95 }], size: 12 }] };
  renderRegions(a.canvas, [region]); renderRegions(b.canvas, [region]);
  for (let y = 8; y < 92; y++) for (let x = 8; x < 92; x++) {
    if (Math.abs(x - y) / Math.SQRT2 > 6) continue;
    const i = (y * 100 + x) * 4;
    expect([...a.pixels.slice(i, i + 4)]).toEqual([...b.pixels.slice(i, i + 4)]);
    expect(a.pixels[i + 3]).toBe(255);
  }
});
