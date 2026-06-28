import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stripJpegMetadata } from './forensics';
import { autoRedactCanvas } from './autoredact';
import { LIMITS } from './validate';

const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

const redactedPages = new Map<number, string>(); // pageNum → dataURL
let exportAsPdf = false;
let pdfPageCount = 1;
let pdfDoc: PDFDocumentProxy | undefined;

export interface BuiltExport { blob: Blob; filename: string; isPdf: boolean; }

export function setPdfContext(doc: PDFDocumentProxy, pageCount: number) {
  pdfDoc = doc;
  pdfPageCount = Math.min(pageCount, LIMITS.maxPdfPages);
  exportAsPdf = true;
  redactedPages.clear();
}

export function resetExportContext() {
  exportAsPdf = false;
  pdfPageCount = 1;
  pdfDoc = undefined;
  redactedPages.clear();
}

export function storeRedactedPage(pageNum: number, canvas: HTMLCanvasElement) {
  redactedPages.set(pageNum, canvas.toDataURL('image/jpeg', 0.92));
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
  const stripMeta = (document.getElementById('chkMetadata') as HTMLInputElement | null)?.checked ?? true;
  const raw = await blobFromCanvas(mainCanvas);
  return stripMeta ? await stripJpegMetadata(raw) : raw;
}

async function buildPdfBlob(): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  const doc = pdfDoc ?? await getDocument({ url: '' }).promise;
  const pdf = new jsPDF({ unit: 'px', compress: true });
  // Strip generator-added user metadata fields.
  pdf.setProperties({ title: '', subject: '', author: '', keywords: '', creator: '' });
  let first = true;

  for (let p = 1; p <= pdfPageCount; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: LIMITS.pdfRenderScale });

    if (!first) pdf.addPage([vp.width, vp.height]);
    else { pdf.deletePage(1); pdf.addPage([vp.width, vp.height]); }
    first = false;

    const stored = redactedPages.get(p);
    if (stored) {
      pdf.addImage(stored, 'JPEG', 0, 0, vp.width, vp.height);
      continue;
    }

    // Page was never opened/redacted by the user — render it, auto-detect and
    // redact faces & text so it can't be exported with visible private data.
    const off = document.createElement('canvas');
    off.width = vp.width;
    off.height = vp.height;
    const ctx = off.getContext('2d')!;
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: off, viewport: vp }).promise;
    await autoRedactCanvas(off);
    pdf.addImage(off.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, vp.width, vp.height);
  }

  return pdf.output('blob');
}

// Produce the final sanitised file (does not write to disk).
export async function buildExport(): Promise<BuiltExport> {
  if (exportAsPdf && pdfPageCount > 1) {
    return { blob: await buildPdfBlob(), filename: 'scrubbed.pdf', isPdf: true };
  }
  return { blob: await buildImageBlob(), filename: 'scrubbed.jpg', isPdf: false };
}

export async function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    if ('showSaveFilePicker' in window) {
      try {
        const ext = filename.split('.').pop() ?? 'jpg';
        const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };
        const handle = await (window as unknown as Window & { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Scrubbed file', accept: { [mimeMap[ext] ?? 'application/octet-stream']: [`.${ext}`] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      } catch (err) {
        if ((err as DOMException).name === 'AbortError') return;
      }
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

// Batch mode: build, verify (via export:done listener) and auto-save silently.
export function exportBatch(filename: string) {
  buildImageBlob().then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    document.dispatchEvent(new CustomEvent('export:done', { detail: { blob, isPdf: false } }));
  });
}
