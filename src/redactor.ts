import type { BoundingBox } from './types';

// Pad boxes outward — detection boxes hug content tightly and edge pixels leak.
function padBox(box: BoundingBox, canvasW: number, canvasH: number): BoundingBox {
  const padX = Math.max(14, Math.round(box.height * 0.4));
  const padY = Math.max(10, Math.round(box.height * 0.32));
  const x = Math.max(0, Math.floor(box.x - padX));
  const y = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(canvasW, Math.ceil(box.x + box.width + padX));
  const bottom = Math.min(canvasH, Math.ceil(box.y + box.height + padY));
  return { x, y, width: right - x, height: bottom - y };
}

// Block size scales to the region (~6 cells across) so large faces collapse
// to a handful of flat averaged cells with no recoverable structure.
export function redactPixels(ctx: CanvasRenderingContext2D, rawBox: BoundingBox) {
  const { x, y, width, height } = padBox(rawBox, ctx.canvas.width, ctx.canvas.height);
  if (width <= 0 || height <= 0) return;

  const imageData = ctx.getImageData(x, y, width, height);
  const data = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const block = Math.max(14, Math.min(120, Math.round(Math.min(w, h) / 6)));

  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      const bw = Math.min(block, w - bx);
      const bh = Math.min(block, h - by);
      let r = 0, g = 0, b = 0, count = 0;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; count++;
        }
      }
      const ar = r / count, ag = g / count, ab = b / count;
      for (let py = 0; py < bh; py++) {
        for (let px = 0; px < bw; px++) {
          const idx = ((by + py) * w + (bx + px)) * 4;
          data[idx] = ar; data[idx + 1] = ag; data[idx + 2] = ab;
        }
      }
    }
  }
  ctx.putImageData(imageData, x, y);
}

export function redactAll(canvas: HTMLCanvasElement, boxes: BoundingBox[]) {
  const ctx = canvas.getContext('2d')!;
  for (const box of boxes) redactPixels(ctx, box);
}
