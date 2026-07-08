import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';
import { initTheme } from './theme';
import { initUpload } from './upload';
import { buildExport, triggerDownload, enableDownload, buildBatchBlob, setPdfContext, storeRedactedPage, resetExportContext, type BuiltExport } from './export';
import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { redactAll } from './redactor';
import { renderOverlay, clearOverlay, updateCountBadge } from './overlay';
import { inspectFile, verifyClean, verifyCleanPdf, type ForensicReport, type Finding, type VerifyResult } from './forensics';
import { startScan, setPhase, phaseLog, updateOcrProgress, finishScan } from './scanner';
import { celebrate } from './celebrate';
import { initTicker } from './ticker';
import { enqueue, initQueue, getBatchPhase, isBatchActive, fileScanned, fileFinished, startRedactPhase, getCurrentScanResult } from './queue';
import type { ScanResult } from './types';
import { handleFile } from './upload';
import { LIMITS, safeBaseName } from './validate';
import type { Detection, DetectionType, FileLoadedDetail } from './types';
import { zip } from 'fflate';

initTheme();

// Queue status UI elements
const queueBar  = document.getElementById('queueBar')  as HTMLDivElement;
const queueLabel = document.getElementById('queueLabel') as HTMLSpanElement;
const queueFill  = document.getElementById('queueFill')  as HTMLDivElement;

initQueue(
  (file) => handleFile(file),
  (done, total) => {
    if (total <= 1) { queueBar.hidden = true; return; }
    queueBar.hidden = false;
    const phase = getBatchPhase();
    if (phase === 'scan') {
      queueLabel.textContent = `Scanning ${done + 1} of ${total}…`;
    } else if (phase === 'redact') {
      queueLabel.textContent = done >= total
        ? `Done — ${total} file${total !== 1 ? 's' : ''} scrubbed`
        : `Redacting ${done + 1} of ${total}…`;
    } else if (done >= total) {
      queueLabel.textContent = `Done — ${total} file${total !== 1 ? 's' : ''} scrubbed`;
    }
    queueFill.style.width = `${Math.round((done / total) * 100)}%`;
  },
  (results) => showBatchModal(results),
  () => showBatchComplete(),
);

initUpload((files) => acceptFiles(files));
initTicker();

// Guarded entry for every upload/drop: refuse new work while a batch is still
// running or awaiting review, and cap how much a single bundle may hold so the
// tab can't be memory-exhausted by dropping thousands of (or huge) files.
function acceptFiles(files: File[]) {
  if (isBatchActive() || !batchBackdrop.hidden) {
    setStatus('Still working on your current files — please wait for them to finish.', false);
    return;
  }

  let batch = files;
  const notes: string[] = [];

  if (batch.length > LIMITS.maxBatchFiles) {
    notes.push(`only the first ${LIMITS.maxBatchFiles} of ${batch.length} files were queued`);
    batch = batch.slice(0, LIMITS.maxBatchFiles);
  }

  // Keep files until the running total would exceed the bundle byte cap.
  const kept: File[] = [];
  let running = 0;
  for (const f of batch) {
    if (running + f.size > LIMITS.maxBatchBytes) { notes.push(`total size capped at ${Math.round(LIMITS.maxBatchBytes / 1024 / 1024)} MB`); break; }
    running += f.size;
    kept.push(f);
  }
  batch = kept;

  if (batch.length === 0) {
    setStatus('Those files are too large to process together — try fewer or smaller files.', false);
    return;
  }
  if (notes.length > 0) setStatus(`Heads up: ${notes.join('; ')}.`, false);

  enqueue(batch);
}

const btnRedact  = document.getElementById('btnRedact')  as HTMLButtonElement;
const chkFaces   = document.getElementById('chkFaces')   as HTMLInputElement;
const chkEmails  = document.getElementById('chkEmails')  as HTMLInputElement;
const chkPhones  = document.getElementById('chkPhones')  as HTMLInputElement;
const chkCards   = document.getElementById('chkCards')   as HTMLInputElement;
const chkNames   = document.getElementById('chkNames')   as HTMLInputElement;
const statusBar  = document.getElementById('statusBar')  as HTMLDivElement;
const statusText = document.getElementById('statusText') as HTMLSpanElement;
const statusRing = document.getElementById('statusRing') as HTMLDivElement;

let currentDetections: Detection[] = [];
let currentCanvas: HTMLCanvasElement | null = null;
let originalImageData: ImageData | null = null;
let currentPageNum = 1;
let currentIsPdf = false;
let metaItemsFound = 0;
let forensicsGate: Promise<void> = Promise.resolve();
let activeGen = 0;
let currentFile: File | null = null;

const dropZone = document.getElementById('dropZone') as HTMLDivElement;
const controlsResult = document.getElementById('controlsResult') as HTMLParagraphElement;

function setStatus(msg: string, spinning = false, done = false) {
  statusBar.hidden = false;
  statusText.textContent = msg;
  statusRing.classList.toggle('spinning', spinning);
  statusRing.classList.toggle('done', done);
}

function countType(type: string) {
  return currentDetections.filter((d) => d.type === type).length;
}

function markFound(itemId: string, found: boolean) {
  document.getElementById(itemId)?.classList.toggle('found', found);
}

// After a file loads, run the full detection pipeline
document.addEventListener('file:loaded', async (e: Event) => {
  const { canvas, cleanImageData, isPdf, pdfDoc, pageCount, currentPage, gen } = (e as CustomEvent<FileLoadedDetail>).detail;
  if (gen !== activeGen) return; // a newer file has superseded this one
  currentCanvas = canvas;
  currentPageNum = currentPage;
  currentIsPdf = isPdf;

  resetView();
  lastBuilt = null;

  const pdfWarning = document.getElementById('pdfWarning') as HTMLParagraphElement;
  if (isPdf && pdfDoc) {
    const info = setPdfContext(pdfDoc, pageCount);
    // Warn before the heavy export: every unopened page is auto-scanned on export.
    if (info.truncated) {
      pdfWarning.textContent = `⚠ This PDF has ${info.sourcePages} pages — only the first ${info.exportedPages} will be processed and exported. Split the file to cover the rest.`;
      pdfWarning.hidden = false;
    } else if (info.exportedPages >= 10) {
      pdfWarning.textContent = `Heads up: all ${info.exportedPages} pages are scanned & redacted on export, which can take a while. You can cancel mid-export.`;
      pdfWarning.hidden = false;
    } else {
      pdfWarning.hidden = true;
    }
  } else {
    resetExportContext();
    pdfWarning.hidden = true;
  }

  originalImageData = new ImageData(
    new Uint8ClampedArray(cleanImageData.data),
    cleanImageData.width,
    cleanImageData.height
  );

  currentDetections = [];
  clearOverlay();
  updateCountBadge('countFaces',  0);
  updateCountBadge('countEmails', 0);
  updateCountBadge('countPhones', 0);
  updateCountBadge('countCards',  0);
  updateCountBadge('countNames',  0);
  ['itemFaces','itemEmails','itemPhones','itemCards','itemNames','itemMeta'].forEach((id) => markFound(id, false));
  controlsResult.hidden = false;
  controlsResult.className = 'controls-result scanning';
  controlsResult.textContent = 'Scanning the image for faces and private text…';
  dropZone.classList.add('detecting');

  await forensicsGate;
  if (gen !== activeGen) return;

  let faceFailed = false;
  let ocrFailed = false;

  setPhase('faces');
  phaseLog('faces');
  try {
    const faceCopy = new ImageData(
      new Uint8ClampedArray(cleanImageData.data),
      cleanImageData.width,
      cleanImageData.height
    );
    const faces = await detectFaces(faceCopy);
    if (gen !== activeGen) return;
    const faceDetections: Detection[] = faces.map((bb) => ({ type: 'face' as const, bbox: bb }));
    currentDetections.push(...faceDetections);
    updateCountBadge('countFaces', faces.length);
  } catch (err) {
    faceFailed = true;
    console.error('Face detection failed:', err);
  }

  setPhase('ocr', { progress: 0 });
  phaseLog('ocr');
  try {
    const ocrCopy = new ImageData(
      new Uint8ClampedArray(cleanImageData.data),
      cleanImageData.width,
      cleanImageData.height
    );
    const piiDetections = await detectPii(ocrCopy, (_status, progress) => updateOcrProgress(progress));
    if (gen !== activeGen) return;
    currentDetections.push(...piiDetections);
    updateCountBadge('countEmails', countType('email'));
    updateCountBadge('countPhones', countType('phone'));
    updateCountBadge('countCards',  countType('card'));
    updateCountBadge('countNames',  countType('name'));
  } catch (err) {
    ocrFailed = true;
    console.error('PII detection failed:', err);
  }

  dropZone.classList.remove('detecting');
  refreshOverlay();
  finishScan();

  const counts: Array<[string, string]> = [
    ['face', 'face'], ['email', 'email'], ['phone', 'phone number'],
    ['card', 'card number'], ['name', 'name'],
  ];
  const parts = counts
    .map(([t, label]) => [countType(t), label] as [number, string])
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}${n !== 1 ? 's' : ''}`);

  let msg: string;
  if (parts.length > 0) {
    msg = `Detected on the image: ${parts.join(', ')} — boxed above.`;
  } else {
    msg = 'No faces or readable private text found on the image.';
  }
  msg += metaItemsFound > 0
    ? `  ${metaItemsFound} hidden metadata item${metaItemsFound !== 1 ? 's' : ''} will be stripped on export.`
    : '  No hidden metadata.';

  // Be honest when a detector didn't run — "nothing found" must not be confused
  // with "the scanner failed". Prompt the user to review manually.
  const warnings: string[] = [];
  if (faceFailed) warnings.push('face detection');
  if (ocrFailed) warnings.push('text detection');
  const detectorWarning = warnings.length > 0
    ? `⚠ ${warnings.join(' and ')} did not run on this image — review and use Draw redaction box to cover anything sensitive manually.`
    : '';
  if (detectorWarning) msg += `  ${detectorWarning}`;

  controlsResult.className = warnings.length > 0 ? 'controls-result warn' : 'controls-result';
  controlsResult.textContent = msg;

  markFound('itemFaces',  countType('face')  > 0);
  markFound('itemEmails', countType('email') > 0);
  markFound('itemPhones', countType('phone') > 0);
  markFound('itemCards',  countType('card')  > 0);
  markFound('itemNames',  countType('name')  > 0);
  markFound('itemMeta',   metaItemsFound      > 0);

  const total = currentDetections.length;
  setStatus(
    total > 0
      ? `Found ${total} visible item${total !== 1 ? 's' : ''} + ${metaItemsFound} hidden — review & redact below`
      : `No visible PII · ${metaItemsFound} hidden item${metaItemsFound !== 1 ? 's' : ''} found`,
    false,
    true
  );

  const phase = getBatchPhase();

  if (phase === 'scan') {
    fileScanned({
      file: currentFile ?? new File([], ''),
      faces:  countType('face'),
      emails: countType('email'),
      phones: countType('phone'),
      cards:  countType('card'),
      names:  countType('name'),
      meta:   metaItemsFound,
      detections: [...currentDetections],
    });
    return;
  }

  if (phase === 'redact') {
    // Use stored detections from scan phase — no re-detection
    const stored = getCurrentScanResult();
    if (!stored || !currentCanvas || !originalImageData) { fileFinished(); return; }

    // Honour this file's OWN choices from the review modal (which types, and
    // whether to strip its hidden metadata). Fall back to "redact everything"
    // if a selection somehow wasn't recorded.
    const sel = batchSelections.get(stored)
      ?? { types: new Set<DetectionType>(['face', 'email', 'phone', 'card', 'name']), meta: true };

    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);
    const toRedact = stored.detections.filter((d) => sel.types.has(d.type));
    redactAll(currentCanvas, toRedact.map((d) => d.bbox));
    clearOverlay();
    setStatus(`Redacting ${stored.file.name}…`, true);

    // Build & verify the blob, but DON'T download yet — collect it and offer a
    // single ZIP download from the finished popup once the whole bundle is done.
    // Sanitise the name so it's safe as a ZIP entry (no path traversal / slip).
    const baseName = safeBaseName(stored.file.name);
    const metaRemoved = sel.meta ? stored.meta : 0;
    try {
      const blob = await buildBatchBlob(sel.meta);
      const result = await verifyClean(blob);
      if (!result.clean) batchAllClean = false;
      batchRedactedTotal += toRedact.length;
      batchMetaTotal += metaRemoved;
      batchOutputs.push({ filename: `scrubbed-${baseName}.jpg`, blob });
      batchBreakdown.push({ name: stored.file.name, summary: summariseRemoved(toRedact, metaRemoved) });
    } catch (err) {
      console.error('Batch file export failed:', err);
      batchAllClean = false;
      batchBreakdown.push({ name: stored.file.name, summary: 'failed — not included' });
    }
    fileFinished();
    return;
  }
});

// Plain-language line of what was actually removed from one file, for the
// finished-popup breakdown (e.g. "3 faces, 2 emails, 1 hidden removed").
function summariseRemoved(dets: Detection[], meta: number): string {
  const counts = new Map<string, number>();
  for (const d of dets) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
  const order: [DetectionType, string][] = [
    ['face', 'face'], ['email', 'email'], ['phone', 'phone'],
    ['card', 'card'], ['name', 'name'], ['manual', 'manual box'],
  ];
  const parts: string[] = [];
  for (const [t, label] of order) {
    const n = counts.get(t);
    if (n) parts.push(`${n} ${label}${n !== 1 ? 's' : ''}`);
  }
  if (meta > 0) parts.push(`${meta} hidden`);
  return parts.length ? parts.join(', ') + ' removed' : 'metadata stripped';
}

// ── PDF export progress + cancel ──────────────────────────────────────────────

const exportProgress     = document.getElementById('exportProgress')     as HTMLDivElement;
const exportProgressText = document.getElementById('exportProgressText') as HTMLSpanElement;
const exportProgressBar  = document.getElementById('exportProgressBar')  as HTMLDivElement;
const btnCancelExport    = document.getElementById('btnCancelExport')    as HTMLButtonElement;

let exportController: AbortController | null = null;

btnCancelExport.addEventListener('click', () => exportController?.abort());

function showExportProgress() {
  exportProgressBar.style.width = '0%';
  exportProgressText.textContent = 'Sanitising pages…';
  exportProgress.hidden = false;
}
function updateExportProgress(done: number, total: number) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  exportProgressBar.style.width = `${pct}%`;
  exportProgressText.textContent = done === 0
    ? `Sanitising ${total} pages…`
    : `Sanitising page ${done} of ${total}…`;
}
function hideExportProgress() {
  exportProgress.hidden = true;
  exportController = null;
}

// ── Redact button ─────────────────────────────────────────────────────────────

let redacting = false;
btnRedact.addEventListener('click', async () => {
  // Ignore repeat clicks while a redact/export is already in flight, so button
  // spam can't launch overlapping builds or stack multiple finished popups.
  if (redacting) return;
  if (!currentCanvas || !originalImageData) return;
  redacting = true;
  btnRedact.setAttribute('aria-busy', 'true');

  try {
    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);

    const toRedact = currentDetections.filter((d) => {
      if (d.type === 'face'  && !chkFaces.checked)  return false;
      if (d.type === 'email' && !chkEmails.checked) return false;
      if (d.type === 'phone' && !chkPhones.checked) return false;
      if (d.type === 'card'  && !chkCards.checked)  return false;
      if (d.type === 'name'  && !chkNames.checked)  return false;
      return true;
    });

    redactAll(currentCanvas, toRedact.map((d) => d.bbox));
    clearOverlay();

    if (currentIsPdf) {
      storeRedactedPage(currentPageNum, currentCanvas);
    }
    showScrubber(originalImageData, currentCanvas);

    btnRedact.classList.add('pulsed', 'done');
    setTimeout(() => btnRedact.classList.remove('pulsed', 'done'), 2000);

    // Build the final file and verify it BEFORE offering the download, so the
    // success message reflects the actual exported bytes — not an assumption.
    setStatus('Re-encoding & verifying the clean file…', true);
    exportController = new AbortController();
    showExportProgress();
    try {
      lastBuilt = await buildExport({
        onProgress: updateExportProgress,
        signal: exportController.signal,
      });
    } catch (err) {
      hideExportProgress();
      const msg = String(err);
      if ((err as DOMException)?.name === 'AbortError') {
        setStatus('Export cancelled. Nothing was downloaded.', false);
        return;
      }
      setStatus(
        msg.includes('auto-redaction failed')
          ? `Export blocked: ${msg}. Please manually review and redact this page.`
          : `Could not build the clean file: ${msg}`,
        false
      );
      return;
    }
    hideExportProgress();
    const result = lastBuilt.isPdf ? await verifyCleanPdf(lastBuilt.blob) : await verifyClean(lastBuilt.blob);
    renderVerify(result);
    enableDownload();

    setStatus(
      result.clean
        ? `${toRedact.length} item${toRedact.length !== 1 ? 's' : ''} redacted · verified clean — ready to download`
        : `${toRedact.length} redacted — verification flagged residual data (see panel)`,
      false, true,
    );

    const stripMeta = (document.getElementById('chkMetadata') as HTMLInputElement).checked;
    celebrate(
      { redacted: toRedact.length, metaItems: stripMeta ? metaItemsFound : 0, verifiedClean: result.clean },
      () => { void doDownload(); }
    );
  } finally {
    redacting = false;
    btnRedact.removeAttribute('aria-busy');
  }
});

const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

let lastBuilt: BuiltExport | null = null;

let downloading = false;
async function doDownload() {
  // Re-entrancy guard: repeated clicks must not build twice or open several
  // save dialogs at once.
  if (downloading) return;
  downloading = true;
  try {
    if (!lastBuilt) {
      setStatus('Preparing the clean file…', true);
      exportController = new AbortController();
      showExportProgress();
      try {
        lastBuilt = await buildExport({
          onProgress: updateExportProgress,
          signal: exportController.signal,
        });
      } catch (err) {
        hideExportProgress();
        const msg = String(err);
        if ((err as DOMException)?.name === 'AbortError') {
          setStatus('Export cancelled. Nothing was downloaded.', false);
          return;
        }
        setStatus(
          msg.includes('auto-redaction failed')
            ? `Export blocked: ${msg}. Please manually review and redact this page.`
            : `Could not build the clean file: ${msg}`,
          false
        );
        return;
      }
      hideExportProgress();
      const result = lastBuilt.isPdf ? await verifyCleanPdf(lastBuilt.blob) : await verifyClean(lastBuilt.blob);
      renderVerify(result);
    }
    await triggerDownload(lastBuilt.filename, lastBuilt.blob);
  } finally {
    downloading = false;
  }
}

btnDownload.addEventListener('click', () => { void doDownload(); });

// ── Manual redaction: draw / delete boxes the detectors missed ────────────────

const mainContainer = document.getElementById('mainContainer') as HTMLDivElement;
const overlayWrap   = document.getElementById('overlayWrap')   as HTMLDivElement;
const btnDraw       = document.getElementById('btnDraw')       as HTMLButtonElement;

function refreshOverlay() {
  renderOverlay(currentDetections, deleteDetection);
}

function deleteDetection(index: number) {
  currentDetections.splice(index, 1);
  refreshOverlay();
  updateCountBadge('countFaces',  countType('face'));
  updateCountBadge('countEmails', countType('email'));
  updateCountBadge('countPhones', countType('phone'));
  updateCountBadge('countCards',  countType('card'));
  updateCountBadge('countNames',  countType('name'));
}

let drawMode = false;
let draft: HTMLDivElement | null = null;
let startX = 0, startY = 0;

btnDraw.addEventListener('click', () => {
  drawMode = !drawMode;
  btnDraw.setAttribute('aria-pressed', String(drawMode));
  btnDraw.classList.toggle('active', drawMode);
  overlayWrap.classList.toggle('drawing', drawMode);
});

function localPoint(e: PointerEvent): { x: number; y: number } {
  const rect = overlayWrap.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width,  e.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
  };
}

mainContainer.addEventListener('pointerdown', (e) => {
  if (!drawMode || !currentCanvas) return;
  const p = localPoint(e);
  startX = p.x; startY = p.y;
  draft = document.createElement('div');
  draft.className = 'detection-box draft';
  draft.style.left = `${startX}px`;
  draft.style.top = `${startY}px`;
  overlayWrap.appendChild(draft);
});

window.addEventListener('pointermove', (e) => {
  if (!draft) return;
  const p = localPoint(e);
  draft.style.left   = `${Math.min(startX, p.x)}px`;
  draft.style.top    = `${Math.min(startY, p.y)}px`;
  draft.style.width  = `${Math.abs(p.x - startX)}px`;
  draft.style.height = `${Math.abs(p.y - startY)}px`;
});

window.addEventListener('pointerup', (e) => {
  if (!draft || !currentCanvas) { draft?.remove(); draft = null; return; }
  const p = localPoint(e);
  const dx = Math.min(startX, p.x), dy = Math.min(startY, p.y);
  const dw = Math.abs(p.x - startX), dh = Math.abs(p.y - startY);
  draft.remove();
  draft = null;
  if (dw < 6 || dh < 6) return; // ignore stray clicks

  // Convert display pixels → canvas pixels.
  const sx = currentCanvas.width  / overlayWrap.clientWidth;
  const sy = currentCanvas.height / overlayWrap.clientHeight;
  currentDetections.push({
    type: 'manual',
    label: 'MANUAL',
    bbox: { x: dx * sx, y: dy * sy, width: dw * sx, height: dh * sy },
  });
  refreshOverlay();
});

const batchBackdrop = document.getElementById('batchBackdrop') as HTMLDivElement;

// Per-file redaction choices from the review modal, keyed by the ScanResult so
// they survive independently of file order. `types` = which visible categories
// to burn; `meta` = whether to strip this file's hidden metadata.
interface FileSelection { types: Set<DetectionType>; meta: boolean; }
const batchSelections = new Map<ScanResult, FileSelection>();

// Collected sanitised outputs for the current bundle, plus running totals and a
// per-file breakdown for the finished popup. Reset each time a redact pass starts.
let batchOutputs: { filename: string; blob: Blob }[] = [];
let batchBreakdown: { name: string; summary: string }[] = [];
let batchAllClean = true;
let batchRedactedTotal = 0;
let batchMetaTotal = 0;

document.getElementById('btnBatchRedact')!.addEventListener('click', () => {
  // First click hides the modal; a queued second click sees it hidden and bails,
  // so the redact pass can't be started twice.
  if (batchBackdrop.hidden) return;
  batchBackdrop.hidden = true;
  batchOutputs = [];
  batchBreakdown = [];
  batchAllClean = true;
  batchRedactedTotal = 0;
  batchMetaTotal = 0;
  startRedactPhase();
});
document.getElementById('btnBatchCancel')!.addEventListener('click', () => {
  batchBackdrop.hidden = true;
});

function saveBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Bundle the collected files into one ZIP (store mode — the JPEGs are already
// compressed) so the user gets a single download instead of many Save dialogs.
function zipOutputs(files: { filename: string; blob: Blob }[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    Promise.all(files.map(async (f) => [f.filename, new Uint8Array(await f.blob.arrayBuffer())] as const))
      .then((pairs) => {
        const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
        for (const [name, data] of pairs) entries[name] = [data, { level: 0 }];
        zip(entries, (err, data) => {
          if (err) reject(err);
          else resolve(new Blob([data], { type: 'application/zip' }));
        });
      })
      .catch(reject);
  });
}

// Save the whole bundle as a single ZIP. Falls back to individual saves only if
// zipping fails, so the user never leaves without their files.
async function downloadAllBatch() {
  if (batchOutputs.length === 0) return;
  if (batchOutputs.length === 1) { saveBlob(batchOutputs[0].filename, batchOutputs[0].blob); return; }
  try {
    setStatus('Packaging your files into a ZIP…', true);
    const zipBlob = await zipOutputs(batchOutputs);
    saveBlob('scrubbed-bundle.zip', zipBlob);
    setStatus(`Downloaded scrubbed-bundle.zip · ${batchOutputs.length} files`, false, true);
  } catch (err) {
    console.error('ZIP packaging failed:', err);
    setStatus('Could not build the ZIP — saving files individually…', false);
    batchOutputs.forEach(({ filename, blob }, i) => setTimeout(() => saveBlob(filename, blob), i * 150));
  }
}

// All bundle files are redacted & verified — show the SAME finished popup as the
// single-file flow, now with a per-file breakdown and a single ZIP download.
function showBatchComplete() {
  const n = batchOutputs.length;
  setStatus(
    `${n} file${n !== 1 ? 's' : ''} scrubbed${batchAllClean ? ' · verified clean' : ''} — ready to download`,
    false, true,
  );
  celebrate(
    { redacted: batchRedactedTotal, metaItems: batchMetaTotal, verifiedClean: batchAllClean, perFile: batchBreakdown },
    () => downloadAllBatch(),
  );
}

// One toggle chip inside a file row. Pre-checked; keeps `onToggle` in sync and
// reflects state via the `.on` class for styling.
function makeChip(label: string, onToggle: (on: boolean) => void, meta = false): HTMLLabelElement {
  const chip = document.createElement('label');
  chip.className = 'batch-chip on' + (meta ? ' meta' : '');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  const txt = document.createElement('span');
  txt.textContent = label;
  cb.addEventListener('change', () => {
    chip.classList.toggle('on', cb.checked);
    onToggle(cb.checked);
  });
  chip.appendChild(cb);
  chip.appendChild(txt);
  return chip;
}

function showBatchModal(results: ScanResult[]) {
  const summary = document.getElementById('batchModalSummary') as HTMLParagraphElement;
  const fileList = document.getElementById('batchFileList') as HTMLDivElement;

  batchSelections.clear();

  const totalVisible = results.reduce((s, r) => s + r.faces + r.emails + r.phones + r.cards + r.names, 0);
  const totalMeta    = results.reduce((s, r) => s + r.meta, 0);

  summary.textContent = totalVisible > 0
    ? `Found ${totalVisible} visible item${totalVisible !== 1 ? 's' : ''} across ${results.length} files. Tick exactly what to remove from each file below.`
    : `No visible faces or text found in ${results.length} files.${totalMeta > 0 ? ` Hidden metadata will be stripped.` : ''}`;

  while (fileList.firstChild) fileList.removeChild(fileList.firstChild);

  for (const r of results) {
    // Everything found starts selected; the user unticks what they want to keep.
    const sel: FileSelection = { types: new Set<DetectionType>(), meta: r.meta > 0 };
    batchSelections.set(r, sel);

    const row = document.createElement('div');
    row.className = 'batch-file-row';

    const name = document.createElement('span');
    name.className = 'batch-filename';
    name.textContent = r.file.name;
    name.title = r.file.name;
    row.appendChild(name);

    const chips = document.createElement('div');
    chips.className = 'batch-chips';

    const typeDefs: { type: DetectionType; count: number; label: string }[] = [
      { type: 'face',  count: r.faces,  label: 'face' },
      { type: 'email', count: r.emails, label: 'email' },
      { type: 'phone', count: r.phones, label: 'phone' },
      { type: 'card',  count: r.cards,  label: 'card' },
      { type: 'name',  count: r.names,  label: 'name' },
    ];
    for (const d of typeDefs) {
      if (d.count <= 0) continue;
      sel.types.add(d.type);
      chips.appendChild(makeChip(`${d.count} ${d.label}${d.count !== 1 ? 's' : ''}`, (on) => {
        if (on) sel.types.add(d.type); else sel.types.delete(d.type);
      }));
    }
    if (r.meta > 0) {
      chips.appendChild(makeChip(`${r.meta} hidden`, (on) => { sel.meta = on; }, true));
    }

    if (chips.childElementCount === 0) {
      const none = document.createElement('span');
      none.className = 'batch-none';
      none.textContent = 'Nothing found — still re-encoded clean';
      row.appendChild(none);
    } else {
      row.appendChild(chips);
    }

    fileList.appendChild(row);
  }

  batchBackdrop.hidden = false;
}

// Reset the preview to the single live canvas (used when a new file loads).
function resetView() {
  const scrubberWrap = document.getElementById('scrubberWrap')     as HTMLDivElement;
  const singleWrap   = document.getElementById('singleCanvasWrap') as HTMLDivElement;
  scrubberWrap.hidden = true;
  singleWrap.hidden = false;
  btnDownload.disabled = true;
  btnRedact.classList.remove('pulsed', 'done');
}

// ── Before/After Scrubber ────────────────────────────────────────────────────

function showScrubber(origData: ImageData, workCanvas: HTMLCanvasElement) {
  const scrubberWrap = document.getElementById('scrubberWrap')     as HTMLDivElement;
  const singleWrap   = document.getElementById('singleCanvasWrap') as HTMLDivElement;
  const origCanvas   = document.getElementById('originalCanvas')   as HTMLCanvasElement;
  const redCanvas    = document.getElementById('redactedCanvas')   as HTMLCanvasElement;
  const divider      = document.getElementById('scrubberDivider')  as HTMLDivElement;
  const container    = document.getElementById('scrubberContainer') as HTMLDivElement;

  const w = workCanvas.width;
  const h = workCanvas.height;
  origCanvas.width  = w;  origCanvas.height  = h;
  redCanvas.width   = w;  redCanvas.height   = h;

  origCanvas.getContext('2d')!.putImageData(origData, 0, 0);
  redCanvas.getContext('2d')!.drawImage(workCanvas, 0, 0);

  const displayW = workCanvas.offsetWidth  || w;
  const displayH = workCanvas.offsetHeight || h;
  container.style.width  = `${displayW}px`;
  container.style.height = `${displayH}px`;
  origCanvas.style.width  = `${displayW}px`;
  origCanvas.style.height = `${displayH}px`;
  redCanvas.style.width   = `${displayW}px`;
  redCanvas.style.height  = `${displayH}px`;

  const divX = { value: displayW / 2 };
  divider.style.left = `${divX.value}px`;
  updateClip(origCanvas, redCanvas, divX.value, displayW);

  singleWrap.hidden   = true;
  scrubberWrap.hidden = false;

  let dragging = false;

  container.addEventListener('mousedown', (ev) => { dragging = true; move(ev.clientX); });
  window.addEventListener('mousemove',  (ev) => { if (dragging) move(ev.clientX); });
  window.addEventListener('mouseup',    ()   => { dragging = false; });

  container.addEventListener('touchstart', (ev) => { dragging = true; move(ev.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove',  (ev) => { if (dragging) move(ev.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend',   ()   => { dragging = false; });

  function move(clientX: number) {
    const rect = container.getBoundingClientRect();
    divX.value = Math.max(0, Math.min(displayW, clientX - rect.left));
    divider.style.left = `${divX.value}px`;
    divider.setAttribute('aria-valuenow', String(Math.round((divX.value / displayW) * 100)));
    updateClip(origCanvas, redCanvas, divX.value, displayW);
  }
}

function updateClip(orig: HTMLCanvasElement, red: HTMLCanvasElement, divX: number, totalW: number) {
  orig.style.clipPath = `inset(0 ${totalW - divX}px 0 0)`;
  red.style.clipPath  = `inset(0 0 0 ${divX}px)`;
}

// ── Forensic hidden-data scan ─────────────────────────────────────────────────

const forensicsPanel   = document.getElementById('forensicsPanel')   as HTMLDivElement;
const forensicsList    = document.getElementById('forensicsList')    as HTMLUListElement;
const forensicsSummary = document.getElementById('forensicsSummary') as HTMLSpanElement;
const forensicsVerify  = document.getElementById('forensicsVerify')  as HTMLDivElement;

const CAT_LABEL: Record<Finding['category'], string> = {
  location: 'location', device: 'device', identity: 'identity', timestamp: 'time',
  software: 'software', embedded: 'embedded', threat: 'threat', other: 'meta',
};

function renderForensics(report: ForensicReport) {
  while (forensicsList.firstChild) forensicsList.removeChild(forensicsList.firstChild);
  forensicsVerify.hidden = true;

  const high = report.findings.filter((f) => f.severity === 'high').length;

  if (report.findings.length === 0) {
    forensicsSummary.textContent = 'No hidden data found';
    forensicsSummary.className = 'forensics-summary clean';
    const li = document.createElement('li');
    li.className = 'forensics-empty';
    li.textContent = 'No metadata, embedded previews, or appended payloads detected. The file is still re-encoded clean on export.';
    forensicsList.appendChild(li);
  } else {
    forensicsSummary.textContent = `${report.findings.length} item${report.findings.length !== 1 ? 's' : ''} found${high ? ` · ${high} high-risk` : ''}`;
    forensicsSummary.className = 'forensics-summary dirty';

    // We render only the category label + fixed risk copy. Actual values are
    // never present in the report, so there is nothing sensitive to show or log.
    for (const f of report.findings) {
      const li = document.createElement('li');
      li.className = `finding ${f.severity}`;

      const dot = document.createElement('span');
      dot.className = 'finding-dot';

      const body = document.createElement('div');
      body.className = 'finding-body';

      const head = document.createElement('div');
      const label = document.createElement('span');
      label.className = 'finding-label';
      label.textContent = f.label;
      const cat = document.createElement('span');
      cat.className = 'finding-cat';
      cat.textContent = CAT_LABEL[f.category];
      head.appendChild(label);
      head.appendChild(cat);

      const detail = document.createElement('div');
      detail.className = 'finding-detail';
      detail.textContent = f.risk;

      body.appendChild(head);
      body.appendChild(detail);
      li.appendChild(dot);
      li.appendChild(body);
      forensicsList.appendChild(li);
    }
  }

  forensicsPanel.hidden = false;
}

const onboarding = document.getElementById('onboarding') as HTMLElement;

document.addEventListener('file:raw', (e: Event) => {
  const { file, gen } = (e as CustomEvent<{ file: File; gen: number }>).detail;
  activeGen = gen;
  currentFile = file;
  onboarding.hidden = true;
  forensicsPanel.hidden = true;
  updateCountBadge('countMetadata', 0);
  metaItemsFound = 0;

  // Skip heavy UI + forensics in redact phase — detections are already stored
  if (getBatchPhase() === 'redact') {
    forensicsGate = Promise.resolve();
    return;
  }

  startScan();
  phaseLog('read');
  setPhase('scan');
  phaseLog('scan');

  forensicsGate = (async () => {
    try {
      const report = await inspectFile(file);
      if (gen !== activeGen) return;
      if (getBatchPhase() !== 'scan') renderForensics(report);
      metaItemsFound = report.findings.length;
      updateCountBadge('countMetadata', metaItemsFound);
    } catch {
      console.error('Forensic scan failed');
    }
  })();
});

// If a file couldn't be validated/decoded, advance the batch queue so one bad
// (corrupt, spoofed, oversized, or malicious) file can't stall an entire bundle
// — then stop the scanner cleanly so the UI never hangs.
document.addEventListener('file:failed', (e: Event) => {
  const { gen, file } = (e as CustomEvent<{ gen: number; file?: File }>).detail;

  const phase = getBatchPhase();
  if (phase === 'scan') {
    // Record an empty result so scan/redact indices stay aligned across files.
    fileScanned({
      file: file ?? currentFile ?? new File([], 'file'),
      faces: 0, emails: 0, phones: 0, cards: 0, names: 0, meta: 0, detections: [],
    });
  } else if (phase === 'redact') {
    if (file) batchBreakdown.push({ name: file.name, summary: 'could not process — skipped' });
    batchAllClean = false;
    fileFinished();
  }

  if (gen !== activeGen) return;
  dropZone.classList.remove('detecting');
  finishScan();
});

function renderVerify(result: VerifyResult) {
  forensicsVerify.hidden = false;
  if (result.clean) {
    forensicsVerify.className = 'forensics-verify ok';
    forensicsVerify.textContent = '✓ Verified clean — the exported file has no metadata, scripts, embedded files, or appended data';
  } else {
    forensicsVerify.className = 'forensics-verify warn';
    const bits: string[] = [];
    if (result.residualFields > 0) bits.push(`${result.residualFields} metadata field(s)`);
    if (result.threats.length > 0) bits.push(`${result.threats.length} active-content token(s)`);
    if (result.trailingBytes > 0) bits.push(`${result.trailingBytes} trailing byte(s)`);
    forensicsVerify.textContent = `⚠ ${bits.join(', ') || 'residual data'} remain in the exported file`;
  }
}

