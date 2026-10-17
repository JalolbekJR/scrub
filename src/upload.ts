import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist';
import { LIMITS, validateFile, safeScale, nextGeneration, currentGeneration, effectiveMaxPdfPages } from './validate';

const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
const canvasArea = document.getElementById('canvasArea') as HTMLDivElement;
const controlsPanel = document.getElementById('controlsPanel') as HTMLDivElement;
const statusBar = document.getElementById('statusBar') as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const statusRing = document.getElementById('statusRing') as HTMLDivElement;
const pdfNav = document.getElementById('pdfNav') as HTMLDivElement;
const pageInfo = document.getElementById('pageInfo') as HTMLSpanElement;
const prevPageBtn = document.getElementById('prevPage') as HTMLButtonElement;
const nextPageBtn = document.getElementById('nextPage') as HTMLButtonElement;
const telemetry = document.getElementById('telemetry') as HTMLDivElement;

let busy = false;
let pendingFile: File | null = null;
let pdfTask: PDFDocumentLoadingTask | null = null;
let cancelDecode: (() => void) | null = null;
// Invalidate pending decodes before restoring home. Existing downloads own
// separate Blob URLs; releasing the input must not revoke those URLs.
export function resetUpload() {
  pendingFile = null;
  const gen = nextGeneration();
  cancelDecode?.(); cancelDecode = null;
  document.dispatchEvent(new CustomEvent('file:started', { detail: { gen } }));
  prevPageBtn.onclick = null; nextPageBtn.onclick = null;
  fileInput.value = '';
  void releasePdf().catch(() => {});
}
async function releasePdf() {
  const task = pdfTask; pdfTask = null;
  if (task) await task.destroy();
}

function setStatus(msg: string, spinning = false, done = false) {
  statusBar.hidden = false;
  statusText.textContent = msg;
  statusRing.classList.toggle('spinning', spinning);
  statusRing.classList.toggle('done', done);
}

function setError(msg: string) {
  statusBar.hidden = false;
  statusText.textContent = msg;
  statusRing.classList.remove('spinning', 'done');
}

async function loadImage(file: File, gen: number) {
  setStatus('Loading image…', true);
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('Image decode timed out')), 20000);
      cancelDecode = () => { clearTimeout(t); img.onload = null; img.onerror = null; img.src = ''; rej(new DOMException('Image load cancelled', 'AbortError')); };
      img.onload = () => { clearTimeout(t); res(); };
      img.onerror = () => { clearTimeout(t); rej(new Error('Could not decode this image — it may be corrupt.')); };
      img.src = url;
    });
  } finally {
    cancelDecode = null;
    URL.revokeObjectURL(url);
  }
  if (gen !== currentGeneration()) return;

  const w = img.naturalWidth, h = img.naturalHeight;
  if (w <= 0 || h <= 0) throw new Error('Image has no pixels.');

  const scale = safeScale(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));

  const ctx = mainCanvas.getContext('2d')!;
  mainCanvas.width = tw;
  mainCanvas.height = th;
  ctx.clearRect(0, 0, tw, th);
  ctx.drawImage(img, 0, 0, tw, th);

  const cleanImageData = ctx.getImageData(0, 0, tw, th);
  if (gen !== currentGeneration()) return;

  canvasArea.hidden = false;
  controlsPanel.hidden = false;
  telemetry.hidden = false;
  pdfNav.hidden = true;

  const note = scale < 1 ? ` (downscaled to ${tw}×${th} for safety)` : '';
  setStatus(`Image loaded — metadata stripped${note}`, false, true);

  document.dispatchEvent(new CustomEvent('file:loaded', {
    detail: { canvas: mainCanvas, cleanImageData, isPdf: false, pageCount: 1, currentPage: 1, gen },
  }));
}

async function renderPdfPage(doc: PDFDocumentProxy, pageNum: number, gen: number) {
  const page = await doc.getPage(pageNum);
  const raw = page.getViewport({ scale: LIMITS.pdfRenderScale });
  const scale = safeScale(raw.width, raw.height) * LIMITS.pdfRenderScale;
  const viewport = page.getViewport({ scale });
  const ctx = mainCanvas.getContext('2d')!;
  mainCanvas.width = Math.max(1, Math.round(viewport.width));
  mainCanvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: mainCanvas, viewport }).promise;
  if (gen !== currentGeneration()) return;
  const imageData = ctx.getImageData(0, 0, mainCanvas.width, mainCanvas.height);

  pageInfo.textContent = `Page ${pageNum} of ${doc.numPages}`;
  prevPageBtn.disabled = pageNum <= 1;
  nextPageBtn.disabled = pageNum >= doc.numPages;

  document.dispatchEvent(new CustomEvent('file:loaded', {
    detail: { canvas: mainCanvas, cleanImageData: imageData, isPdf: true, pdfDoc: doc, pageCount: doc.numPages, currentPage: pageNum, gen },
  }));
}

async function loadPdf(file: File, gen: number) {
  setStatus('Loading PDF…', true);
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

  const arrayBuffer = await file.arrayBuffer();
  if (gen !== currentGeneration()) return;
  const pdfParams = { data: arrayBuffer, isEvalSupported: false, disableAutoFetch: true, disableStream: true, verbosity: 0 };
  const task = getDocument(pdfParams as unknown as Parameters<typeof getDocument>[0]);
  pdfTask = task;
  let timer: ReturnType<typeof setTimeout>;
  let doc: PDFDocumentProxy;
  try {
    doc = await Promise.race([task.promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void task.destroy(); reject(new Error('PDF loading timed out. Try an unencrypted, smaller PDF.')); }, 15000);
    })]);
  } finally { clearTimeout(timer!); }
  if (gen !== currentGeneration()) { await task.destroy(); return; }

  const maxPages = effectiveMaxPdfPages();
  if (doc.numPages > maxPages) {
    throw new Error(`PDF has ${doc.numPages} pages, above the ${maxPages}-page processing limit. Split it before exporting.`);
  }

  canvasArea.hidden = false;
  controlsPanel.hidden = false;
  telemetry.hidden = false;
  const usablePages = Math.min(doc.numPages, maxPages);
  pdfNav.hidden = usablePages <= 1;

  let currentPage = 1;
  let rendering = false;
  await renderPdfPage(doc, currentPage, gen);
  if (gen !== currentGeneration()) return;
  setStatus(`PDF loaded — ${usablePages} page(s)`, false, true);

  prevPageBtn.onclick = async () => {
    if (rendering || currentPage <= 1 || gen !== currentGeneration()) return;
    rendering = true;
    const target = currentPage - 1;
    document.dispatchEvent(new CustomEvent('page:started', { detail: { gen } }));
    setStatus(`Rendering page ${target}…`, true);
    try {
      await renderPdfPage(doc, target, gen);
      if (gen !== currentGeneration()) return;
      currentPage = target;
      setStatus(`Page ${currentPage} of ${usablePages}`, false, true);
    } catch {
      if (gen === currentGeneration()) setError('Could not render that page.');
    } finally {
      rendering = false;
    }
  };
  nextPageBtn.onclick = async () => {
    if (rendering || currentPage >= usablePages || gen !== currentGeneration()) return;
    rendering = true;
    const target = currentPage + 1;
    document.dispatchEvent(new CustomEvent('page:started', { detail: { gen } }));
    setStatus(`Rendering page ${target}…`, true);
    try {
      await renderPdfPage(doc, target, gen);
      if (gen !== currentGeneration()) return;
      currentPage = target;
      setStatus(`Page ${currentPage} of ${usablePages}`, false, true);
    } catch {
      if (gen === currentGeneration()) setError('Could not render that page.');
    } finally {
      rendering = false;
    }
  };
}

export async function handleFile(file: File) {
  if (busy) { pendingFile = file; return; }
  busy = true;

  // Allocate the generation up front so a validation failure can still emit a
  // `file:failed` the batch queue will act on — otherwise one bad file in a
  // bundle would leave the queue waiting forever.
  const gen = nextGeneration();
  document.dispatchEvent(new CustomEvent('file:started', { detail: { gen } }));
  try {
    // Release PDF.js workers, fonts and cached page resources on replacement,
    // including a rejected replacement. Old navigation cannot render it.
    await releasePdf();
    if (gen !== currentGeneration()) return;
    const v = await validateFile(file);
    if (gen !== currentGeneration()) return;
    if (!v.ok) {
      setError(v.reason ?? 'Unsupported file.');
      document.dispatchEvent(new CustomEvent('file:failed', { detail: { gen, file, reason: v.reason } }));
      return;
    }

    document.dispatchEvent(new CustomEvent('file:raw', { detail: { file, gen } }));
    if (v.kind === 'pdf') await loadPdf(file, gen);
    else await loadImage(file, gen);
  } catch (err) {
    if (gen !== currentGeneration()) return;
    await releasePdf();
    console.error('file processing failed');
    setError(err instanceof Error ? err.message : 'Could not process this file.');
    document.dispatchEvent(new CustomEvent('file:failed', { detail: { gen, file } }));
  } finally {
    busy = false;
    const next = pendingFile; pendingFile = null;
    if (next) void handleFile(next);
  }
}

export function initUpload(onFiles: (files: File[]) => void) {
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) onFiles([...files]);
  });

  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  fileInput.addEventListener('change', () => {
    const files = fileInput.files;
    if (files && files.length > 0) onFiles([...files]);
    fileInput.value = '';
  });
}
