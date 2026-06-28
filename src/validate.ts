export const LIMITS = {
  maxBytes: 40 * 1024 * 1024,
  maxDim: 12000,
  maxPixels: 40 * 1000 * 1000,
  maxPdfPages: 50,
  pdfRenderScale: 1.5,
} as const;

// SVG excluded — active document format, can embed scripts.
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp',
]);

export interface Validation { ok: boolean; reason?: string; kind?: 'image' | 'pdf'; }

export function validateFile(file: File): Validation {
  if (!file || file.size === 0) return { ok: false, reason: 'That file is empty.' };
  if (file.size > LIMITS.maxBytes) {
    return { ok: false, reason: `File is too large (max ${Math.round(LIMITS.maxBytes / 1024 / 1024)} MB).` };
  }
  if (file.type === 'application/pdf') return { ok: true, kind: 'pdf' };
  if (file.type === 'image/svg+xml') {
    return { ok: false, reason: 'SVG files are not supported — they can contain active code. Please use a JPEG, PNG, WEBP, GIF, or PDF.' };
  }
  if (ALLOWED_IMAGE_TYPES.has(file.type)) return { ok: true, kind: 'image' };
  // Unknown/spoofed type
  return { ok: false, reason: 'Unsupported file type. Please drop a JPEG, PNG, WEBP, GIF image or a PDF.' };
}

// Returns scale <=1 to keep the bitmap within caps (defuses decompression bombs).
export function safeScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1;
  let scale = 1;
  const maxSide = Math.max(width, height);
  if (maxSide > LIMITS.maxDim) scale = Math.min(scale, LIMITS.maxDim / maxSide);
  const pixels = width * height;
  if (pixels > LIMITS.maxPixels) scale = Math.min(scale, Math.sqrt(LIMITS.maxPixels / pixels));
  return scale;
}

let generation = 0;
export function nextGeneration(): number { return ++generation; }
export function currentGeneration(): number { return generation; }
