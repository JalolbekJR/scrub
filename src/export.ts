import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stripJpegMetadata } from './forensics';
import { autoRedactCanvas, selectedTypes } from './autoredact';
import { renderRegions } from './mask-renderer';
import type { Detection, DetectionType } from './types';
import { LIMITS, effectiveMaxPdfPages, safeScale } from './validate';

const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

const redactedPages = new Map<number, string>(); // pageNum → dataURL
interface ReviewedPage { detections: Detection[]; width: number; height: number; }
const reviewedPages = new Map<number, ReviewedPage>();
let exportAsPdf = false;
let pdfPageCount = 1;
let pdfDoc: PDFDocumentProxy | undefined;

export interface BuiltExport { blob: Blob; filename: string; isPdf: boolean; pageCount?: number; }

export interface BuildOptions {
  // Reports page-level progress while sanitising a multi-page PDF.
  onProgress?: (done: number, total: number) => void;
  // Lets the user cancel a long PDF export between pages.
  signal?: AbortSignal;
  selection?: Record<DetectionType, boolean>;
}

// Returns how the source page count was clamped, so the UI can warn the user
// when later pages won't be included or when the export will be slow.
export interface PdfContextInfo { sourcePages: number; exportedPages: number; truncated: boolean; }

export function setPdfContext(doc: PDFDocumentProxy, pageCount: number): PdfContextInfo {
  if (pdfDoc !== doc) { redactedPages.clear(); reviewedPages.clear(); }
  pdfDoc = doc;
  pdfPageCount = pageCount;
  exportAsPdf = true;
  const limit = effectiveMaxPdfPages();
  return { sourcePages: pageCount, exportedPages: Math.min(pageCount, limit), truncated: pageCount > limit };
}

export function resetExportContext() {
  exportAsPdf = false;
  pdfPageCount = 1;
  pdfDoc = undefined;
  redactedPages.clear();
  reviewedPages.clear();
}

// Only the UI's completed, successful scans may be stored here. Preserve user
// additions/deletions in canvas coordinates, without retaining source bytes.
export function storeReviewedPage(pageNum: number, detections: Detection[], canvas: HTMLCanvasElement) {
  reviewedPages.set(pageNum, { detections: structuredClone(detections), width: canvas.width, height: canvas.height });
}

export function getReviewedPage(doc: PDFDocumentProxy, pageNum: number): ReviewedPage | undefined {
  const page = pdfDoc === doc ? reviewedPages.get(pageNum) : undefined;
  return page ? structuredClone(page) : undefined;
}

function applyReview(canvas: HTMLCanvasElement, review: ReviewedPage, sel: Record<DetectionType, boolean>) {
  if (canvas.width !== review.width || canvas.height !== review.height) throw new Error('Reviewed page dimensions changed; export was blocked.');
  renderRegions(canvas, review.detections.filter(d => d.included !== false && (d.id || sel[d.type])));
}

export function storeRedactedPage(pageNum: number, canvas: HTMLCanvasElement) {
  redactedPages.set(pageNum, canvas.toDataURL('image/jpeg', 0.92));
}

export function getRedactedPage(doc: PDFDocumentProxy, pageNum: number): string | undefined {
  return pdfDoc === doc ? redactedPages.get(pageNum) : undefined;
}

export function enableDownload() {
  btnDownload.disabled = false;
}

function blobFromCanvas(canvas: HTMLCanvasElement, quality = 0.95): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality);
  });
}

async function buildImageBlob(): Promise<Blob> {
  return stripJpegMetadata(await blobFromCanvas(mainCanvas));
}

async function buildPdfBlob(doc: PDFDocumentProxy, pageCount: number, pages: Map<number, string>, reviews: Map<number, ReviewedPage>, { onProgress, signal, selection = selectedTypes() }: BuildOptions = {}): Promise<Blob> {
  if (pageCount > effectiveMaxPdfPages()) {
    throw new Error(`PDF has ${pageCount} pages, exceeding the ${effectiveMaxPdfPages()}-page processing limit. No pages were exported.`);
  }
  const { jsPDF } = await import('jspdf');

  const pdf = new jsPDF({ unit: 'px', compress: true });
  // Strip generator-added user metadata fields.
  pdf.setProperties({ title: '', subject: '', author: '', keywords: '', creator: '' });
  let first = true;

  onProgress?.(0, pageCount);
  for (let p = 1; p <= pageCount; p++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');

    const page = await doc.getPage(p);
    const raw = page.getViewport({ scale: LIMITS.pdfRenderScale });
    const vp = page.getViewport({ scale: safeScale(raw.width, raw.height) * LIMITS.pdfRenderScale });

    const orientation = vp.width > vp.height ? 'landscape' : 'portrait';
    if (!first) pdf.addPage([vp.width, vp.height], orientation);
    else { pdf.deletePage(1); pdf.addPage([vp.width, vp.height], orientation); }
    first = false;

    const stored = pages.get(p);
    const review = reviews.get(p);
    if (stored && !review) {
      pdf.addImage(stored, 'JPEG', 0, 0, vp.width, vp.height);
      onProgress?.(p, pageCount);
      continue;
    }

    // Render the page or its saved bitmap. Completed reviews retain manual
    // corrections; pages without a review still require automatic detection.
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(vp.width));
    off.height = Math.max(1, Math.round(vp.height));
    const ctx = off.getContext('2d')!;
    if (stored && !review) {
      const image = new Image(); image.src = stored; await image.decode();
      ctx.drawImage(image, 0, 0, off.width, off.height);
    } else {
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: off, viewport: vp }).promise;
    }
    try {
      if (review) applyReview(off, review, selection);
      else await autoRedactCanvas(off, selection);
    } catch (err) {
      // Detection or review-coordinate failures block the entire export.
      throw new Error(`Page ${p} auto-redaction failed: ${String(err)}`);
    }
    pdf.addImage(off.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, vp.width, vp.height);
    onProgress?.(p, pageCount);
  }

  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  return pdf.output('blob');
}

// Produce the final sanitised file (does not write to disk).
export async function buildExport(opts: BuildOptions = {}): Promise<BuiltExport> {
  if (exportAsPdf) {
    if (!pdfDoc || pdfPageCount < 1 || pdfDoc.numPages !== pdfPageCount) {
      throw new Error('PDF context is incomplete; export was blocked.');
    }
    const pageCount = pdfPageCount;
    return { blob: await buildPdfBlob(pdfDoc, pageCount, new Map(redactedPages), structuredClone(reviewedPages), opts), filename: 'scrubbed.pdf', isPdf: true, pageCount };
  }
  return { blob: await buildImageBlob(), filename: 'scrubbed.jpg', isPdf: false };
}

// Callers supply only verified output and bind validity to its document revision.
// The browser owns the save location; Scrub never obtains a writable file handle.
export async function triggerDownload(filename: string, blob: Blob, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  try {
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    if (!isCurrent()) return false;
    a.click();
    return true;
  } finally {
    if (a.parentNode) document.body.removeChild(a);
    // Give Firefox, WebKit and large downloads time to consume the Blob URL.
    // Each invocation owns its URL, including repeated or cancelled downloads.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

// Batch and single-file exports share the complete format-aware pipeline.
export async function buildBatchBlob(opts: BuildOptions = {}): Promise<BuiltExport> {
  return buildExport(opts);
}
