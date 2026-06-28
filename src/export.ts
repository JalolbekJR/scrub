import type { PDFDocumentProxy } from 'pdfjs-dist';
import { stripJpegMetadata } from './forensics';

const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

const redactedPages = new Map<number, string>(); // pageNum → dataURL
let exportAsPdf = false;
let pdfPageCount = 1;
let pdfDoc: PDFDocumentProxy | undefined;

export function setPdfContext(doc: PDFDocumentProxy, pageCount: number) {
  pdfDoc = doc;
  pdfPageCount = pageCount;
  exportAsPdf = true;
  redactedPages.clear();
}

export function storeRedactedPage(pageNum: number, canvas: HTMLCanvasElement) {
  redactedPages.set(pageNum, canvas.toDataURL('image/jpeg', 0.92));
}

export function initExport() {
  btnDownload.addEventListener('click', async () => {
    if (exportAsPdf && pdfPageCount > 1) {
      await exportMultiPagePdf();
    } else {
      exportImage();
    }
  });
}

function exportImage() {
  const stripMeta = (document.getElementById('chkMetadata') as HTMLInputElement | null)?.checked ?? true;
  mainCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const cleaned = stripMeta ? await stripJpegMetadata(blob) : blob;
    const url = URL.createObjectURL(cleaned);
    await triggerDownload(url, 'scrubbed.jpg', cleaned);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    document.dispatchEvent(new CustomEvent('export:done', { detail: { blob: cleaned } }));
  }, 'image/jpeg', 0.95);
}

async function exportMultiPagePdf() {
  const { jsPDF } = await import('jspdf');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  const doc = pdfDoc ?? await getDocument({ url: '' }).promise; // fallback
  const pdf = new jsPDF({ unit: 'px', compress: true });
  let first = true;

  for (let p = 1; p <= pdfPageCount; p++) {
    const imgData = redactedPages.get(p);
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1.5 });

    if (!first) pdf.addPage([vp.width, vp.height]);
    else {
      pdf.deletePage(1);
      pdf.addPage([vp.width, vp.height]);
    }
    first = false;

    if (imgData) {
      pdf.addImage(imgData, 'JPEG', 0, 0, vp.width, vp.height);
    } else {
      const offCanvas = document.createElement('canvas');
      offCanvas.width = vp.width;
      offCanvas.height = vp.height;
      const ctx = offCanvas.getContext('2d')!;
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: offCanvas, viewport: vp }).promise;
      pdf.addImage(offCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, vp.width, vp.height);
    }
  }

  const blob = pdf.output('blob');
  const url = URL.createObjectURL(blob);
  await triggerDownload(url, 'scrubbed.pdf', blob);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  document.dispatchEvent(new CustomEvent('export:done', { detail: { blob } }));
}

async function triggerDownload(dataUrl: string, filename: string, blob?: Blob) {
  if ('showSaveFilePicker' in window && blob) {
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
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function enableDownload() {
  btnDownload.disabled = false;
}

export function exportBatch(filename: string) {
  const stripMeta = (document.getElementById('chkMetadata') as HTMLInputElement | null)?.checked ?? true;
  mainCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const cleaned = stripMeta ? await stripJpegMetadata(blob) : blob;
    const url = URL.createObjectURL(cleaned);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    document.dispatchEvent(new CustomEvent('export:done', { detail: { blob: cleaned } }));
  }, 'image/jpeg', 0.95);
}
