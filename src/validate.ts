export const LIMITS = {
  maxBytes: 40 * 1024 * 1024,
  maxDim: 12000,
  maxPixels: 40 * 1000 * 1000,
  maxPdfPages: 50,
  maxPdfPagesMobile: 15,
  pdfRenderScale: 1.5,
} as const;

// Auto-redacting every unopened page (tiled face detection + OCR, sequentially)
// is heavy. Cap lower on small screens, where it is slowest and most likely to
// exhaust memory.
export function effectiveMaxPdfPages(): number {
  const isMobile = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 640px)').matches;
  return isMobile ? LIMITS.maxPdfPagesMobile : LIMITS.maxPdfPages;
}

export interface Validation { ok: boolean; reason?: string; kind?: 'image' | 'pdf'; }

const SUPPORTED = 'Please use a JPEG, PNG, WEBP, GIF, BMP, or PDF.';

// Identify a file by its real leading bytes, not the browser-supplied type,
// which a caller can spoof. Returns the true kind or null if unrecognised.
function sniff(b: Uint8Array): 'image' | 'pdf' | null {
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image';
  // PNG: 89 50 4E 47
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image';
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image';
  // BMP: "BM"
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image';
  // WEBP: "RIFF"...."WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image';
  // PDF: "%PDF-" (may sit a few bytes in after a BOM/whitespace)
  for (let i = 0; i <= 4 && i + 4 < b.length; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return 'pdf';
  }
  return null;
}

// Exposed for unit tests — pure signature check, no File needed.
export function sniffKind(bytes: Uint8Array): 'image' | 'pdf' | null {
  return sniff(bytes);
}

export async function validateFile(file: File): Promise<Validation> {
  if (!file || file.size === 0) return { ok: false, reason: 'That file is empty.' };
  if (file.size > LIMITS.maxBytes) {
    return { ok: false, reason: `File is too large (max ${Math.round(LIMITS.maxBytes / 1024 / 1024)} MB).` };
  }
  // SVG is an active document format (it can carry scripts) — reject by type up front.
  if (file.type === 'image/svg+xml') {
    return { ok: false, reason: 'SVG files are not supported — they can contain active code. ' + SUPPORTED };
  }

  // Decide the real format from the header bytes, not the (spoofable) file.type.
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const kind = sniff(header);
  if (!kind) {
    return { ok: false, reason: `This file isn't a recognised image or PDF — its contents don't match a supported format. ${SUPPORTED}` };
  }
  return { ok: true, kind };
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
