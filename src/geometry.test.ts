import { expect, it } from 'vitest';
import { pointToCanvas } from './geometry';
import { redactPixels } from './redactor';

it.each([1, 1.25, 2])('maps fractional display geometry at scale %s', scale => {
  const rect = { left: 17, top: 31, width: 333.3 * scale, height: 444.4 * scale };
  expect(pointToCanvas(rect.left + rect.width / 4, rect.top + rect.height / 2, rect, 1200, 1600)).toEqual({ x: 300, y: 800 });
  expect(pointToCanvas(-100, 10000, rect, 1200, 1600)).toEqual({ x: 0, y: 1600 });
});

it('clips padded fractional masks outward and replaces every channel', () => {
  let placed: { pixels: ImageData; x: number; y: number } | undefined;
  const ctx = {
    canvas: { width: 100, height: 80 },
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (pixels: ImageData, x: number, y: number) => { placed = { pixels, x, y }; },
  } as unknown as CanvasRenderingContext2D;
  redactPixels(ctx, { x: 95.5, y: 70.5, width: 10, height: 20 });
  expect(placed!.x).toBe(87); expect(placed!.y).toBe(62);
  expect(placed!.pixels.width).toBe(13); expect(placed!.pixels.height).toBe(18);
  for (let i = 0; i < placed!.pixels.data.length; i += 4) expect([...placed!.pixels.data.slice(i, i + 4)]).toEqual([0, 0, 0, 255]);
  expect(() => redactPixels(ctx, { x: NaN, y: 0, width: 10, height: 10 })).toThrow('Invalid');
});
