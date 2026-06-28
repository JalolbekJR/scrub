import type { PDFDocumentProxy } from 'pdfjs-dist';
import { LIMITS, validateFile, safeScale, nextGeneration, currentGeneration } from './validate';

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
      img.onload = () => { clearTimeout(t); res(); };
      img.onerror = () => { clearTimeout(t); rej(new Error('Could not decode this image — it may be corrupt.')); };
      img.src = url;
    });
  } finally {
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
  const pdfParams = { data: arrayBuffer, isEvalSupported: false, disableAutoFetch: true, disableStream: true };
  const doc = await getDocument(pdfParams as unknown as Parameters<typeof getDocument>[0]).promise;

  if (doc.numPages > LIMITS.maxPdfPages) {
    setError(`PDF has ${doc.numPages} pages — only the first ${LIMITS.maxPdfPages} can be processed.`);
  }

  canvasArea.hidden = false;
  controlsPanel.hidden = false;
  telemetry.hidden = false;
  const usablePages = Math.min(doc.numPages, LIMITS.maxPdfPages);
  pdfNav.hidden = usablePages <= 1;

  let currentPage = 1;
  await renderPdfPage(doc, currentPage, gen);
  setStatus(`PDF loaded — ${usablePages} page(s)`, false, true);

  prevPageBtn.onclick = async () => {
    if (currentPage > 1) {
      currentPage--;
      setStatus(`Rendering page ${currentPage}…`, true);
      try { await renderPdfPage(doc, currentPage, gen); } catch { setError('Could not render that page.'); }
      setStatus(`Page ${currentPage} of ${usablePages}`, false, true);
    }
  };
  nextPageBtn.onclick = async () => {
    if (currentPage < usablePages) {
      currentPage++;
      setStatus(`Rendering page ${currentPage}…`, true);
      try { await renderPdfPage(doc, currentPage, gen); } catch { setError('Could not render that page.'); }
      setStatus(`Page ${currentPage} of ${usablePages}`, false, true);
    }
  };
}

export async function handleFile(file: File) {
  if (busy) return;

  const v = await validateFile(file);
  if (!v.ok) { setError(v.reason ?? 'Unsupported file.'); return; }

  busy = true;
  const gen = nextGeneration();
  try {
    document.dispatchEvent(new CustomEvent('file:raw', { detail: { file, gen } }));
    if (v.kind === 'pdf') await loadPdf(file, gen);
    else await loadImage(file, gen);
  } catch (err) {
    console.error('file processing failed');
    setError(err instanceof Error ? err.message : 'Could not process this file.');
    document.dispatchEvent(new CustomEvent('file:failed', { detail: { gen } }));
  } finally {
    busy = false;
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
