import type { BoundingBox } from './types';

// Pad boxes outward a little so edge pixels don't leak, but stay tight to the
// detected region — a face box should cover the face, not the area around it.
export function paddedBox(box: BoundingBox, canvasW: number, canvasH: number): BoundingBox {
  const padX = Math.max(8, Math.round(box.width * 0.12));
  const padY = Math.max(8, Math.round(box.height * 0.12));
  const x = Math.max(0, Math.floor(box.x - padX));
  const y = Math.max(0, Math.floor(box.y - padY));
  const right = Math.min(canvasW, Math.ceil(box.x + box.width + padX));
  const bottom = Math.min(canvasH, Math.ceil(box.y + box.height + padY));
  return { x, y, width: right - x, height: bottom - y };
}

// Replace pixels independently of source color and alpha. putImageData avoids
// inheriting transforms, opacity, shadows or compositing from the caller.
export function redactPixels(ctx: CanvasRenderingContext2D, rawBox: BoundingBox) {
  if (![rawBox.x, rawBox.y, rawBox.width, rawBox.height].every(Number.isFinite)
      || rawBox.width <= 0 || rawBox.height <= 0) throw new Error('Invalid redaction box');
  const { x, y, width, height } = paddedBox(rawBox, ctx.canvas.width, ctx.canvas.height);
  if (width <= 0 || height <= 0) return;
  const pixels = ctx.createImageData(width, height);
  for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 255;
  ctx.putImageData(pixels, x, y);
}

export function redactAll(canvas: HTMLCanvasElement, boxes: BoundingBox[]) {
  const ctx = canvas.getContext('2d')!;
  for (const box of boxes) redactPixels(ctx, box);
}
