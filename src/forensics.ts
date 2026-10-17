import exifr from 'exifr';
import { inspectOriginalFile } from './original-inspection';
import { inspectPdf } from './threat-pdf';

// Private values are processed transiently; reports contain categories and locations, never extracted content.

export type Severity = 'high' | 'medium' | 'low';
export type Category =
  | 'location' | 'device' | 'identity' | 'timestamp'
  | 'software' | 'embedded' | 'threat' | 'other';

export interface Finding {
  label: string;
  risk: string;
  severity: Severity;
  category: Category;
  evidence?: 'structural' | 'indicator';
  source?: string;
  location?: { page?: number; bbox?: { x: number; y: number; width: number; height: number }; coordinates?: 'canvas' | 'pdf' };
  sanitization?: 'removed' | 'manual' | 'interaction-only';
  detail?: string;
  count?: number;
}

export interface ForensicReport {
  findings: ReadonlyArray<Finding>;
  metaFieldCount: number;
  trailingBytes: number;
  inspectionFailed: boolean;
  limitations?: readonly string[];
  checks?: readonly string[];
}

function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

function firstIndexOfSeq(bytes: Uint8Array, seq: number[], from = 0): number {
  outer: for (let i = from; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function computeTrailing(bytes: Uint8Array, type: string): number {
  if (type.includes('jpeg') || type.includes('jpg')) {
    const eoi = firstIndexOfSeq(bytes, [0xff, 0xd9]);
    return eoi >= 0 ? bytes.length - (eoi + 2) : bytes.length;
  }
  if (type.includes('png')) {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (!signature.every((byte, i) => bytes[i] === byte)) return bytes.length;
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
      const end = offset + 12 + length;
      if (end > bytes.length) return bytes.length;
      const isEnd = bytes[offset + 4] === 0x49 && bytes[offset + 5] === 0x45
        && bytes[offset + 6] === 0x4e && bytes[offset + 7] === 0x44;
      if (isEnd) return length === 0 ? bytes.length - end : bytes.length;
      offset = end;
    }
    return bytes.length;
  }
  return 0;
}

export function inspectFile(file: File): Promise<ForensicReport> {
  return inspectOriginalFile(file, inspectPdf);
}

// ── Strip ALL metadata segments from a JPEG (APPn + comments, incl. ICC) ──────
function stripJpegSegments(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const keep: Array<[number, number]> = [[0, 2]];
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 1 < bytes.length) { i++; marker = bytes[i + 1]; }
    if (marker === 0xd9) { keep.push([i, i + 2]); break; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const seg = i + 2 + len;
    if (len < 2 || seg > bytes.length) throw new Error('Invalid JPEG segment length');
    if (marker === 0xda) {
      const eoi = firstIndexOfSeq(bytes, [0xff, 0xd9], seg);
      if (eoi < 0) throw new Error('JPEG is missing its end marker');
      keep.push([i, eoi + 2]);
      break;
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if (!isApp && !isCom) keep.push([i, seg]);
    i = seg;
  }
  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const [s, e] of keep) { out.set(bytes.subarray(s, e), off); off += e - s; }
  return out;
}

export async function stripJpegMetadata(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const cleaned = stripJpegSegments(bytes);
  return new Blob([cleaned.buffer as ArrayBuffer], { type: 'image/jpeg' });
}

// ── Post-export verification ──────────────────────────────────────────────────
export interface VerifyResult {
  clean: boolean;
  residualFields: number;
  trailingBytes: number;
  // PDF content and structure issues; always empty for images.
  threats: string[];
}

export async function verifyClean(blob: Blob): Promise<VerifyResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let residualFields = 0;
  let parseFailed = false;
  try {
    const parsed = await exifr.parse(bytes, { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true });
    residualFields = parsed ? Object.keys(parsed).length : 0;
  } catch { parseFailed = true; }
  const trailingBytes = computeTrailing(bytes, blob.type || 'image/jpeg');
  const validJpeg = blob.type === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const validPng = blob.type === 'image/png' && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const validGif = blob.type === 'image/gif' && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  const validBmp = blob.type === 'image/bmp' && bytes[0] === 0x42 && bytes[1] === 0x4d;
  const validWebp = blob.type === 'image/webp' && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  const signatureValid = validJpeg || validPng || validGif || validBmp || validWebp;
  const verificationFailed = parseFailed || !signatureValid;
  return { clean: !verificationFailed && residualFields === 0 && trailingBytes === 0, residualFields, trailingBytes, threats: [] };
}

// Active-content constructs that must never appear in a sanitised PDF.
const PDF_THREAT_TOKENS = ['/JavaScript', '/JS', '/AA', '/Launch', '/EmbeddedFile', '/RichMedia', '/AcroForm', '/GoToR'];
// Info-dictionary fields that would carry user-identifying text.
const PDF_META_RE = /\/(Author|Title|Subject|Keywords|Creator)\s*\(([^)]*)\)/g;

// Parse each generated page and check that it contains only a raster image,
// with no text, annotations, forms, attachments, layers, user metadata, or
// extra bytes. A byte scan also catches unexpected active-content names.
// Producer and CreationDate are generated locally and contain no source data.
export async function verifyCleanPdf(blob: Blob, expectedPages?: number): Promise<VerifyResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = bytesToLatin1(bytes);
  const validSignature = blob.type === 'application/pdf' && text.startsWith('%PDF-');

  const threats = PDF_THREAT_TOKENS.filter((t) => text.includes(t));
  // jsPDF writes a harmless page-fit destination. Any other auto-open action
  // is unexpected in a raster-only export.
  const benignOpenAction = /\/OpenAction\s*\[\s*\d+\s+\d+\s+R\s+\/FitH\s+null\s*\]/g;
  if (text.replace(benignOpenAction, '').includes('/OpenAction')) threats.push('/OpenAction');

  let residualFields = 0;
  for (const m of text.matchAll(PDF_META_RE)) {
    if ((m[2] ?? '').trim().length > 0) residualFields++;
  }
  if (text.includes('<?xpacket') || text.includes('<x:xmpmeta')) residualFields++;

  // Anything after the final %%EOF is appended/trailing data.
  const eofSeq = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
  const eof = firstIndexOfSeq(bytes, eofSeq);
  const tail = eof >= 0 ? bytes.subarray(eof + eofSeq.length) : bytes;
  const trailingBytes = tail.length;
  const cleanTail = eof >= 0 && tail.length <= 2 && tail.every((byte) => byte === 0x0a || byte === 0x0d);

  if (validSignature) {
    let task: ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs').getDocument> | undefined;
    try {
      const { getDocument, OPS, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (typeof window !== 'undefined') {
        GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
      }
      task = getDocument({ data: bytes, isEvalSupported: false, disableAutoFetch: true, disableStream: true, verbosity: 0 } as Parameters<typeof getDocument>[0]);
      const doc = await task.promise;
      if (doc.numPages < 1 || (expectedPages !== undefined && doc.numPages !== expectedPages)) {
        threats.push('PDF page count mismatch');
      }
      const { info, metadata } = await doc.getMetadata();
      const fields = info as Record<string, unknown>;
      for (const key of ['Author', 'Title', 'Subject', 'Keywords', 'Creator']) {
        if (typeof fields[key] === 'string' && fields[key].trim()) residualFields++;
      }
      if (metadata) residualFields++;
      if (await doc.getAttachments()) threats.push('PDF attachments');
      if (await doc.getJSActions()) threats.push('PDF JavaScript');
      if (await doc.getFieldObjects()) threats.push('PDF form fields');
      if ((await doc.getOutline())?.length > 0) threats.push('PDF outline');
      const openAction = await doc.getOpenAction();
      if (openAction) {
        const dest = openAction.get('dest');
        const safeDestination = openAction.size === 1 && Array.isArray(dest) && dest.length === 3
          && typeof dest[0]?.num === 'number' && dest[1]?.name === 'FitH' && dest[2] === null;
        if (!safeDestination && !threats.includes('/OpenAction')) threats.push('/OpenAction');
      }
      const layers = await doc.getOptionalContentConfig({ intent: 'any' });
      if ([...layers].length > 0) threats.push('PDF optional layers');
      const rasterOps = new Set([
        OPS.setLineWidth, OPS.setStrokeRGBColor, OPS.save, OPS.transform,
        OPS.dependency, OPS.paintImageXObject, OPS.restore,
      ]);
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        if ((await page.getAnnotations({ intent: 'any' })).length > 0) threats.push(`Page ${p} annotations`);
        if ((await page.getTextContent()).items.length > 0) threats.push(`Page ${p} selectable text`);
        const operations = await page.getOperatorList();
        if (!operations.fnArray.includes(OPS.paintImageXObject)) threats.push(`Page ${p} has no flattened image`);
        if (operations.fnArray.some((operation) => !rasterOps.has(operation))) {
          threats.push(`Page ${p} contains non-image drawing`);
        }
      }
    } catch {
      threats.push('PDF parsing failed');
    } finally {
      try { await task?.destroy(); } catch { threats.push('PDF worker cleanup failed'); }
    }
  }

  return {
    clean: validSignature && cleanTail && threats.length === 0 && residualFields === 0,
    residualFields: residualFields + (validSignature ? 0 : 1),
    trailingBytes: Math.max(0, trailingBytes),
    threats,
  };
}
