import type { Detection } from './types';
import { paddedBox } from './redactor';

function cosmetic(region: Detection) { return region.style === 'mosaic' || region.style === 'blur'; }

function brushCoverage(region: Detection, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  for (const stroke of region.strokes ?? []) {
    if (!Number.isFinite(stroke.size) || stroke.size <= 0 || stroke.size > Math.max(width, height) * 2) throw new Error('Invalid brush size');
    const radius = stroke.size / 2;
    for (let p = 0; p < stroke.points.length; p++) {
      const a = stroke.points[Math.max(0, p - 1)], b = stroke.points[p];
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw new Error('Invalid brush point');
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const left = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius));
      const top = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius));
      const right = Math.min(width, Math.ceil(Math.max(a.x, b.x) + radius));
      const bottom = Math.min(height, Math.ceil(Math.max(a.y, b.y) + radius));
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const t = length ? Math.max(0, Math.min(1, ((x + .5 - a.x) * dx + (y + .5 - a.y) * dy) / length)) : 0;
        if ((x + .5 - a.x - t * dx) ** 2 + (y + .5 - a.y - t * dy) ** 2 <= radius * radius) mask[y * width + x] = stroke.erase ? 0 : 1;
      }
    }
  }
  return mask;
}

// The same pixel replacement runs for editing, comparison and encoded exports.
export function renderRegions(canvas: HTMLCanvasElement, regions: Detection[]) {
  // Source-derived effects go first: they cannot expose a secure overlapping core.
  const included = regions.filter(r => r.included !== false).sort((a, b) => Number(cosmetic(b)) - Number(cosmetic(a)));
  if (!included.length) return;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const source = included.some(cosmetic) ? image.data.slice() : undefined;
  for (const region of included) {
    const box = region.bbox;
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw new Error('Invalid redaction box');
    const bounds = paddedBox(box, canvas.width, canvas.height);
    const mask = region.shape === 'brush' ? brushCoverage(region, canvas.width, canvas.height) : undefined;
    const hex = region.color ?? (region.style === 'soft' ? '#c99a78' : '#000000');
    if (!/^#[a-f\d]{6}$/i.test(hex)) throw new Error('Invalid mask color');
    const base = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
        if (mask && !mask[y * canvas.width + x]) continue;
        if (!mask && (region.shape === 'ellipse' || region.style === 'soft')) {
          const dx = (x + .5 - bounds.x - bounds.width / 2) / (bounds.width / 2);
          const dy = (y + .5 - bounds.y - bounds.height / 2) / (bounds.height / 2);
          // Rounded outer corners preserve the full rectangular protected core.
          // No alpha feathering or source sampling is used at any mask edge.
          const profile = region.style === 'soft' ? 4 : 2;
          const insideRectangle = region.shape !== 'ellipse' && x + .5 >= box.x && x + .5 <= box.x + box.width && y + .5 >= box.y && y + .5 <= box.y + box.height;
          const insideEllipse = region.shape === 'ellipse' && ((x + .5 - box.x - box.width / 2) / (box.width / 2)) ** 2 + ((y + .5 - box.y - box.height / 2) / (box.height / 2)) ** 2 <= 1;
          // Styling must never shrink a rectangular protected area. The rounded
          // contour may extend outside it, but every selected pixel is opaque.
          if (!insideRectangle && !insideEllipse && Math.abs(dx) ** profile + Math.abs(dy) ** profile > 1) continue;
        }
        const offset = (y * canvas.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          let value = base[channel];
          if (region.style === 'gradient' || region.style === 'soft') {
            const nx = (x - bounds.x) / bounds.width, ny = (y - bounds.y) / bounds.height;
            const grain = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 101 / 100 - .5;
            const texture = region.style === 'soft' ? grain * 1.8 : 0;
            const shade = region.style === 'soft' ? 11 * Math.exp(-((nx - .32) ** 2 + (ny - .22) ** 2) * 5) - 10 * ny - 5 * nx * nx + texture : 24 * (nx + ny - 1);
            value = Math.max(0, Math.min(255, value + shade));
          } else if (source && cosmetic(region)) {
            const block = Math.max(8, Math.round(Math.min(box.width, box.height) / 12));
            if (region.style === 'mosaic') {
              const sx = Math.min(canvas.width - 1, Math.max(0, Math.floor(x / block) * block + Math.floor(block / 2)));
              const sy = Math.min(canvas.height - 1, Math.max(0, Math.floor(y / block) * block + Math.floor(block / 2)));
              value = source[(sy * canvas.width + sx) * 4 + channel];
            } else {
              let sum = 0;
              for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const sx = Math.max(0, Math.min(canvas.width - 1, x + dx * block / 2 | 0));
                const sy = Math.max(0, Math.min(canvas.height - 1, y + dy * block / 2 | 0));
                sum += source[(sy * canvas.width + sx) * 4 + channel];
              }
              value = sum / 25;
            }
          }
          image.data[offset + channel] = value;
        }
        image.data[offset + 3] = 255;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
}
