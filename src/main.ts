import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';
import { EditorDocument, type EditorPage } from './editor-state';
import { availableExportName } from './export-names';
import { DocumentRevision, type RevisionToken } from './revision';
import { selectedTypes } from './autoredact';
import { initTheme } from './theme';
import { initUpload } from './upload';
import { buildExport, triggerDownload, enableDownload, buildBatchBlob, setPdfContext, storeReviewedPage, getReviewedPage, resetExportContext, type BuiltExport } from './export';
import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { inspectOcrWords } from './threat-text';
import { renderRegions } from './mask-renderer';
import { initEditor } from './editor-ui';
import { renderOverlay, clearOverlay, updateCountBadge } from './overlay';
import { verifyClean, verifyCleanPdf, type ForensicReport, type Finding, type VerifyResult } from './forensics';
import { inspectOriginal, cancelOriginalInspection } from './inspection-client';
import { startScan, setPhase, phaseLog, updateOcrProgress, finishScan, cancelScan } from './scanner';
import { celebrate } from './celebrate';
import { initTicker } from './ticker';
import { enqueue, initQueue, getBatchPhase, isBatchActive, fileScanned, fileFinished, startRedactPhase, getCurrentScanResult } from './queue';
import type { ScanResult } from './types';
import { handleFile } from './upload';
import { LIMITS, safeBaseName } from './validate';
import { exportBlockedBy } from './failclosed';
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
        ? `Finished — ${total} file${total !== 1 ? 's' : ''} processed`
        : `Redacting ${done + 1} of ${total}…`;
    } else if (done >= total) {
      queueLabel.textContent = `Finished — ${total} file${total !== 1 ? 's' : ''} processed`;
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

  if (hasUnsavedEdits() && !window.confirm('Replace these files and discard their edits that have not been downloaded?')) return;
  documentSessions.clear();
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

let editorDocument = new EditorDocument('initial');
let editorPage: EditorPage | null = null;
const documentSessions = new Map<File, EditorDocument>();
let batchReviewResults: ScanResult[] = [];
let editingBatchResult: ScanResult | null = null;
let currentDetections: Detection[] = [];
let currentCanvas: HTMLCanvasElement | null = null;
let originalImageData: ImageData | null = null;
let currentPageNum = 1;
let currentIsPdf = false;
let metaItemsFound = 0;
let forensicsGate: Promise<void> = Promise.resolve();
let activeGen = 0;
let currentFile: File | null = null;
let currentDetectionFailure: string | null = null;
let forensicsFailed = false;
let currentForensicReport: ForensicReport | null = null;
const pageSecurityFindings = new Map<number, Finding[]>();
let detectionComplete = false;
let pageEpoch = 0;
let faceController: AbortController | null = null;
const documentRevision = new DocumentRevision();

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
  const epoch = ++pageEpoch;
  faceController?.abort();
  const controller = new AbortController(); faceController = controller;
  document.body.classList.remove('scan-complete');
  currentCanvas = canvas;
  document.getElementById('canvasArea')!.style.setProperty('--page-aspect', String(canvas.width / canvas.height));
  currentPageNum = currentPage;
  currentIsPdf = isPdf;
  currentDetectionFailure = null;
  detectionComplete = false;
  btnRedact.disabled = true;

  resetView();
  lastBuilt = null;

  const pdfWarning = document.getElementById('pdfWarning') as HTMLParagraphElement;
  if (isPdf && pdfDoc) {
    const info = setPdfContext(pdfDoc, pageCount);
    // Warn before the heavy export: every unopened page is auto-scanned on export.
    if (info.truncated) {
      pdfWarning.textContent = `⚠ This PDF has ${info.sourcePages} pages, above the ${info.exportedPages}-page processing limit. Export is blocked so no pages are omitted; split the file and try again.`;
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
  if (gen !== activeGen || epoch !== pageEpoch) return;

  let faceFailed = false;
  let ocrFailed = false;

  setPhase('faces');
  phaseLog('faces');
  try {
    // Face detection only reads this snapshot into its own canvas.
    const faces = await detectFaces(cleanImageData, controller.signal);
    if (gen !== activeGen || epoch !== pageEpoch) return;
    const faceDetections: Detection[] = faces.map((bb) => ({ type: 'face' as const, bbox: bb }));
    currentDetections.push(...faceDetections);
    updateCountBadge('countFaces', faces.length);
  } catch {
    faceFailed = true;
    if (gen !== activeGen || epoch !== pageEpoch) return;
    console.error('Face detection failed');
  }

  setPhase('ocr', { progress: 0 });
  phaseLog('ocr');
  try {
    // The OCR client already clones before transferring to its worker.
    const piiDetections = await detectPii(cleanImageData, (_status, progress) => {
      if (gen === activeGen && epoch === pageEpoch) updateOcrProgress(progress);
    }, words => {
      if (gen !== activeGen || epoch !== pageEpoch) return;
      pageSecurityFindings.set(currentPage, inspectOcrWords(words, currentPage));
      if (currentForensicReport && getBatchPhase() !== 'scan') renderForensics({ ...currentForensicReport, findings: [...currentForensicReport.findings, ...[...pageSecurityFindings.values()].flat()] });
    });
    if (gen !== activeGen || epoch !== pageEpoch) return;
    currentDetections.push(...piiDetections);
    updateCountBadge('countEmails', countType('email'));
    updateCountBadge('countPhones', countType('phone'));
    updateCountBadge('countCards',  countType('card'));
    updateCountBadge('countNames',  countType('name'));
  } catch {
    ocrFailed = true;
    console.error('PII detection failed');
  }

  if (gen !== activeGen || epoch !== pageEpoch) return;
  const review = isPdf && pdfDoc ? getReviewedPage(pdfDoc, currentPage) : undefined;
  if (review && !faceFailed && !ocrFailed) {
    if (review.width !== canvas.width || review.height !== canvas.height) {
      ocrFailed = true; // Never apply saved coordinates to a changed bitmap.
    } else {
      currentDetections = review.detections;
      updateCountBadge('countFaces', countType('face'));
      updateCountBadge('countEmails', countType('email'));
      updateCountBadge('countPhones', countType('phone'));
      updateCountBadge('countCards', countType('card'));
      updateCountBadge('countNames', countType('name'));
    }
  }

  if (!faceFailed && !ocrFailed && !forensicsFailed) {
    editorPage = editorDocument.reviewPage(currentPage, canvas.width, canvas.height, currentDetections.map(d => ({ ...d, included: d.included ?? (isBatchActive() ? true : selectedTypes()[d.type]) })));
    currentDetections = editorPage.regions();
  }

  dropZone.classList.remove('detecting');
  refreshOverlay();
  finishScan(!faceFailed && !ocrFailed && !forensicsFailed);

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
    msg = `Suggestions: ${parts.join(', ')}. Review for anything missed.`;
  } else {
    msg = 'No supported faces or private text detected. Review the image and add boxes for anything missed.';
  }
  msg += forensicsFailed
    ? '  Metadata inspection could not complete.'
    : metaItemsFound > 0
      ? `  ${metaItemsFound} embedded finding${metaItemsFound !== 1 ? 's' : ''} will be stripped on export.`
      : '  No supported embedded findings detected.';

  // Be honest when a detector didn't run — "nothing found" must not be confused
  // with "the scanner failed". Prompt the user to review manually.
  const warnings: string[] = [];
  if (faceFailed) warnings.push('face detection');
  if (ocrFailed) warnings.push('text detection');
  if (forensicsFailed) warnings.push('metadata inspection');
  const detectorWarning = warnings.length > 0
    ? `⚠ ${warnings.join(' and ')} failed. Export is blocked for this file; use Retry scan.`
    : '';
  currentDetectionFailure = forensicsFailed ? 'Metadata inspection failed' : exportBlockedBy({
    face: faceFailed ? 'failed' : 'success',
    ocr: ocrFailed ? 'failed' : 'success',
  });
  detectionComplete = true;
  setReviewControls(!isBatchActive());
  document.body.classList.add('scan-complete');
  if (currentDetectionFailure) { editorDocument.failedPages.add(currentPage); const failedPage = editorDocument.pages.get(currentPage); if (failedPage) failedPage.status = 'failed'; }
  else if (editorPage) editorPage.status = 'reviewed';
  document.getElementById('pageReviewStatus')!.hidden = !isPdf;
  document.getElementById('pageReviewStatus')!.textContent = isPdf
    ? `${editorDocument.pages.size}/${pageCount} pages reviewed · ${[...editorDocument.pages.values()].filter(p => p.edited).length} edited · ${editorDocument.failedPages.size} failed`
    : 'Review the suggested masks';
  editor.refresh();
  if (detectorWarning) msg += `  ${detectorWarning}`;

  controlsResult.className = warnings.length > 0 ? 'controls-result warn' : 'controls-result';
  controlsResult.textContent = msg;

  markFound('itemFaces',  countType('face')  > 0);
  markFound('itemEmails', countType('email') > 0);
  markFound('itemPhones', countType('phone') > 0);
  markFound('itemCards',  countType('card')  > 0);
  markFound('itemNames',  countType('name')  > 0);
  markFound('itemMeta',   metaItemsFound      > 0);

  setStatus(
    currentDetectionFailure
      ? `Detection failed — export blocked. Use Retry scan.`
      : 'Scan finished. Review your file, then prepare a protected copy.',
    false,
    !currentDetectionFailure
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
      scanFailure: currentDetectionFailure ?? undefined,
    });
    return;
  }

  if (phase === 'redact') {
    // Use stored detections from scan phase — no re-detection
    const stored = getCurrentScanResult();
    if (!stored || !currentCanvas || !originalImageData) { fileFinished(); return; }
    if (stored.scanFailure || currentDetectionFailure) {
      batchAllClean = false;
      batchBreakdown.push({ name: stored.file.name, summary: 'detection failed — not included' });
      fileFinished();
      return;
    }

    // Honour this file's own category choices. Metadata sanitation is mandatory.
    const sel = batchSelections.get(stored)
      ?? { types: new Set<DetectionType>(['face', 'email', 'phone', 'card', 'name', 'manual']) };

    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);
    const toRedact = (editorPage?.regions() ?? stored.detections).filter((d) => d.included !== false && sel.types.has(d.type));
    renderRegions(currentCanvas, toRedact);
    clearOverlay();
    setStatus(`Redacting ${stored.file.name}…`, true);

    // Build & verify the blob, but DON'T download yet — collect it and offer a
    // single ZIP download from the finished popup once the whole bundle is done.
    // Sanitise the name so it's safe as a ZIP entry (no path traversal / slip).
    const baseName = safeBaseName(stored.file.name);
    const metaRemoved = stored.meta;
    const token = documentRevision.token();
    try {
      if (editorDocument.failedPages.size > 0) throw new Error('A PDF page scan failed');
      if (currentIsPdf) for (const [pageNumber, page] of editorDocument.pages) {
        storeReviewedPage(pageNumber, page.regions().map(d => ({ ...d, included: d.included && sel.types.has(d.type) })), { width: page.width, height: page.height } as HTMLCanvasElement);
      }
      const selection = Object.fromEntries(['face', 'email', 'phone', 'card', 'name', 'manual'].map(type => [type, type === 'manual' || sel.types.has(type as DetectionType)])) as Record<DetectionType, boolean>;
      const built = await buildBatchBlob({ selection });
      const blob = built.blob;
      const result = built.isPdf ? await verifyCleanPdf(blob, built.pageCount) : await verifyClean(blob);
      if (!documentRevision.matches(token)) throw new Error('Document changed during batch export');
      if (!result.clean) throw new Error('Batch export verification failed');
      batchRedactedTotal += toRedact.length;
      batchMetaTotal += metaRemoved;
      batchOutputs.push({ filename: availableExportName(`scrubbed-${baseName}.${built.isPdf ? 'pdf' : 'jpg'}`, batchOutputs.map(f => f.filename)), blob });
      batchBreakdown.push({ name: stored.file.name, summary: built.isPdf ? `${built.pageCount}-page raster PDF rebuilt and verified` : summariseRemoved(toRedact, metaRemoved) });
    } catch {
      console.error('Batch file export failed');
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
  return parts.length ? parts.join(', ') + ' processed; metadata sanitized' : 'metadata sanitized';
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
  if (!detectionComplete) {
    setStatus('Scanning is still in progress; wait before exporting.', false);
    return;
  }
  if (currentDetectionFailure || editorDocument.failedPages.size > 0) {
    setStatus(`Export blocked: ${currentDetectionFailure ?? 'A page scan failed'}. Use Retry scan.`, false);
    return;
  }
  const gen = activeGen;
  const token = documentRevision.token();
  const selection = selectedTypes();
  const delivered = lastBuilt?.downloaded;
  redacting = true;
  btnDownload.disabled = true;
  forensicsVerify.hidden = true;
  if (lastBuilt) lastBuilt.verified = false;
  btnRedact.setAttribute('aria-busy', 'true');

  try {
    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);

    const toRedact = currentDetections.filter((d) => {
      if (d.included === false) return false;
      if (d.id) return true;
      if (d.type === 'face'  && !chkFaces.checked)  return false;
      if (d.type === 'email' && !chkEmails.checked) return false;
      if (d.type === 'phone' && !chkPhones.checked) return false;
      if (d.type === 'card'  && !chkCards.checked)  return false;
      if (d.type === 'name'  && !chkNames.checked)  return false;
      return true;
    });

    renderRegions(currentCanvas, toRedact);
    clearOverlay();

    if (currentIsPdf) {
      for (const [pageNumber, page] of editorDocument.pages) storeReviewedPage(pageNumber, page.regions(), { width: page.width, height: page.height } as HTMLCanvasElement);
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
      const built = await buildExport({
        onProgress: (done, total) => { if (gen === activeGen && documentRevision.matches(token)) updateExportProgress(done, total); },
        signal: exportController.signal,
        selection,
      });
      if (gen !== activeGen || !documentRevision.matches(token)) return;
      lastBuilt = { ...built, token, verified: false, downloaded: delivered };
    } catch (err) {
      if (gen !== activeGen || !documentRevision.matches(token)) return;
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
    let result: VerifyResult;
    try {
      result = lastBuilt.isPdf ? await verifyCleanPdf(lastBuilt.blob, lastBuilt.pageCount) : await verifyClean(lastBuilt.blob);
    } catch {
      if (gen === activeGen && documentRevision.matches(token)) setStatus('Verification could not complete; download is blocked.', false);
      return;
    }
    if (gen !== activeGen || !documentRevision.matches(token)) return;
    renderVerify(result);
    if (!result.clean) {
      setStatus(`${toRedact.length} redacted — verification failed; download is blocked`, false);
      return;
    }
    lastBuilt.verified = true;
    enableDownload();

    setStatus(lastBuilt.isPdf ? `${lastBuilt.pageCount}-page raster PDF rebuilt and verified — ready to download` : `${toRedact.length} region${toRedact.length !== 1 ? 's' : ''} rendered · export structure verified — ready to download`, false, true);

    celebrate(
      { redacted: toRedact.length, metaItems: metaItemsFound, verifiedClean: true, pdfPages: lastBuilt.pageCount },
      () => { void doDownload(); }, btnRedact
    );
  } finally {
    redacting = false;
    btnRedact.removeAttribute('aria-busy');
  }
});

const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

let lastBuilt: (BuiltExport & { token: RevisionToken; verified: boolean; downloaded?: boolean }) | null = null;

let downloading = false;
async function doDownload() {
  if (downloading || !lastBuilt?.verified || !documentRevision.matches(lastBuilt.token)) return;
  const prepared = lastBuilt;
  downloading = true;
  try {
    const delivered = await triggerDownload(prepared.filename, prepared.blob, () => lastBuilt === prepared && prepared.verified && documentRevision.matches(prepared.token));
    if (delivered && lastBuilt === prepared && documentRevision.matches(prepared.token)) prepared.downloaded = true;
  }
  finally { downloading = false; }
}

btnDownload.addEventListener('click', () => { void doDownload(); });

// ── Manual redaction: draw / delete boxes the detectors missed ────────────────

function invalidateExport() {
  documentRevision.change();
  batchEpoch++;
  exportController?.abort();
  hideExportProgress();
  lastBuilt = null;
  btnDownload.disabled = true;
  forensicsVerify.hidden = true;
  if (!(document.getElementById('celebrateBackdrop') as HTMLElement).hidden) document.getElementById('celebClose')?.click();
  if (currentCanvas) setStatus('Edits changed. Verify before downloading.', false);
}
for (const checkbox of [chkFaces, chkEmails, chkPhones, chkCards, chkNames]) {
  checkbox.addEventListener('change', () => {
    const type = ({ chkFaces: 'face', chkEmails: 'email', chkPhones: 'phone', chkCards: 'card', chkNames: 'name' } as Record<string, DetectionType>)[checkbox.id];
    for (const page of editorDocument.pages.values()) page.bulk(r => r.type === type, checkbox.checked);
    currentDetections = editorPage?.regions() ?? currentDetections;
    invalidateExport(); resetView(); editor.refresh();
    if (currentIsPdf && currentCanvas) storeReviewedPage(currentPageNum, currentDetections, currentCanvas);
  });
}


let selectedRegion: string | null = null;
function refreshOverlay() {
  if (currentCanvas && originalImageData) {
    currentCanvas.getContext('2d')!.putImageData(originalImageData, 0, 0);
    const selected = selectedTypes();
    renderRegions(currentCanvas, currentDetections.filter(d => d.included !== false && (d.id || selected[d.type])));
  }
  renderOverlay(currentDetections, deleteDetection, id => editor.select(id), selectedRegion);
}

function deleteDetection(index: number) {
  invalidateExport();
  const region = currentDetections[index];
  if (editorPage && region?.id) editorPage.remove(region.id);
  currentDetections = editorPage?.regions() ?? currentDetections.filter((_, i) => i !== index);
  editor.refresh();
  updateCountBadge('countFaces',  countType('face'));
  updateCountBadge('countEmails', countType('email'));
  updateCountBadge('countPhones', countType('phone'));
  updateCountBadge('countCards',  countType('card'));
  updateCountBadge('countNames',  countType('name'));
}

const editor = initEditor({
  page: () => detectionComplete && !currentDetectionFailure && getBatchPhase() !== 'redact' ? editorPage : null,
  canvas: () => currentCanvas,
  pageNumber: () => currentPageNum,
  changed: () => {
    currentDetections = editorPage?.regions() ?? [];
    invalidateExport(); resetView();
    if (currentIsPdf && currentCanvas) storeReviewedPage(currentPageNum, currentDetections, currentCanvas);
  },
  render: selected => { selectedRegion = selected; refreshOverlay(); },
});

// Loaded files use the same controls in a compact workspace.
btnRedact.querySelector('.btn-text')!.textContent = 'Prepare copy';
btnRedact.setAttribute('aria-label', 'Prepare and verify export');
const fileHeader = document.createElement('div'); fileHeader.className = 'loaded-file-header'; fileHeader.id = 'fileHeader'; fileHeader.hidden = true;
const brand = document.createElement('strong'); brand.textContent = 'Scrub';
const filenameLabel = document.createElement('span'); filenameLabel.id = 'loadedFilename'; filenameLabel.className = 'loaded-filename';
const pageStatus = document.createElement('span'); pageStatus.id = 'pageReviewStatus';
const localPrivacy = document.createElement('span'); localPrivacy.className = 'local-privacy'; localPrivacy.textContent = 'On device · no uploads';
fileHeader.append(brand, filenameLabel, localPrivacy, pageStatus);
const headerActions = document.createElement('div'); headerActions.className = 'file-actions'; fileHeader.append(headerActions);
function headerButton(label: string, id: string, action: () => void) {
  const b = document.createElement('button'); b.type = 'button'; b.id = id; b.textContent = label; b.onclick = action; headerActions.append(b); return b;
}
headerButton('New file', 'newFile', () => (document.getElementById('fileInput') as HTMLInputElement).click());
const customize = headerButton('Customize', 'customize', () => {
  editor.setCustomization(!editor.isCustomizing());
  (document.getElementById('retryScan') as HTMLElement).hidden = !editor.isCustomizing() && !currentDetectionFailure && !forensicsFailed;
});
customize.setAttribute('aria-expanded', 'false'); customize.setAttribute('aria-controls', 'editingTools');
headerButton('Preview', 'previewToggle', () => {
  if (!currentCanvas || !originalImageData || !detectionComplete) return;
  editor.cancel();
  if (document.body.classList.contains('is-preview')) resetView(false);
  else { refreshOverlay(); showScrubber(originalImageData, currentCanvas); }
});
headerButton('Review suggestions', 'showRegions', () => {
  editor.refresh();
  document.getElementById('regionInspector')!.classList.add('sheet-open');
  (document.querySelector('#regionInspector button') as HTMLElement | null)?.focus();
});
headerButton('Retry scan', 'retryScan', () => { if (currentFile && !isBatchActive()) void handleFile(currentFile); });
const returnBatch = headerButton('Return to batch review', 'returnBatch', () => {
  editor.cancel();
  if (editingBatchResult) {
    editingBatchResult.detections = editorDocument.pages.get(1)?.regions() ?? editingBatchResult.detections;
    editingBatchResult.scanFailure = editorDocument.failedPages.size > 0 ? 'A page scan failed' : undefined;
  }
  editingBatchResult = null; returnBatch.hidden = true; showBatchModal(batchReviewResults, true);
});
returnBatch.hidden = true;
headerActions.append(btnRedact, btnDownload);
document.querySelector('.main-content')!.prepend(fileHeader);
document.getElementById('canvasArea')!.before(controlsResult);
const inspector = document.getElementById('regionInspector')!;
const closeInspector = document.createElement('button'); closeInspector.type = 'button'; closeInspector.className = 'sheet-close'; closeInspector.textContent = 'Close region settings';
closeInspector.onclick = () => { inspector.classList.remove('sheet-open'); document.getElementById('showRegions')!.focus(); }; inspector.prepend(closeInspector);
const bulk = document.createElement('details'); bulk.className = 'bulk-controls';
const bulkSummary = document.createElement('summary'); bulkSummary.textContent = 'Category bulk controls'; bulk.append(bulkSummary, document.getElementById('controlsPanel')!); inspector.append(bulk);
const forensicDetails = document.createElement('details'); forensicDetails.id = 'forensicDetails'; forensicDetails.hidden = true;
const forensicTitle = document.createElement('summary'); forensicTitle.textContent = 'Security & Privacy Findings'; forensicDetails.append(forensicTitle);
const existingForensics = document.getElementById('forensicsPanel')!; existingForensics.before(forensicDetails); forensicDetails.append(existingForensics);
document.getElementById('canvasArea')!.after(document.getElementById('forensicsVerify')!);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && inspector.classList.contains('sheet-open')) closeInspector.click();
});

const batchBackdrop = document.getElementById('batchBackdrop') as HTMLDivElement;

let batchFocus: HTMLElement | null = null;
function batchKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); closeBatchModal(); return; }
  if (e.key !== 'Tab') return;
  const items = [...batchBackdrop.querySelectorAll<HTMLElement>('button, input, a[href]')].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
  const first = items[0], last = items.at(-1); if (!first || !last) return;
  if (e.shiftKey && (document.activeElement === first || !batchBackdrop.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (document.activeElement === last || !batchBackdrop.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
}
function openBatchModal() {
  batchFocus = document.activeElement as HTMLElement;
  batchBackdrop.hidden = false; document.addEventListener('keydown', batchKey);
  (batchBackdrop.querySelector('button') as HTMLButtonElement | null)?.focus();
}
function closeBatchModal() {
  batchBackdrop.hidden = true; document.removeEventListener('keydown', batchKey);
  batchFocus?.focus();
  setReviewControls(detectionComplete && !isBatchActive());
}

function setReviewControls(enabled: boolean) {
  btnRedact.disabled = !enabled;
  for (const id of ['previewToggle', 'retryScan', 'showRegions', 'customize']) (document.getElementById(id) as HTMLButtonElement).disabled = !enabled;
  (document.getElementById('retryScan') as HTMLElement).hidden = !editor.isCustomizing() && !currentDetectionFailure && !forensicsFailed;
  for (const checkbox of [chkFaces, chkEmails, chkPhones, chkCards, chkNames]) checkbox.disabled = !enabled;
}

// Per-file redaction choices from the review modal, keyed by the ScanResult so
// they survive independently of file order. `types` = which visible categories
// to render. Metadata sanitation is always mandatory.
interface FileSelection { types: Set<DetectionType>; }
const batchSelections = new Map<ScanResult, FileSelection>();

// Collected sanitised outputs for the current bundle, plus running totals and a
// per-file breakdown for the finished popup. Reset each time a redact pass starts.
let batchOutputs: { filename: string; blob: Blob }[] = [];
let batchEpoch = 0;
let batchDownloadedEpoch: number | null = null;

function hasUnsavedEdits() {
  const edited = [...documentSessions.values()].some(doc => [...doc.pages.values()].some(page => page.canUndo || page.canRedo));
  const delivered = (lastBuilt?.downloaded && documentRevision.matches(lastBuilt.token)) || batchDownloadedEpoch === batchEpoch;
  return edited && !delivered;
}
window.addEventListener('beforeunload', event => {
  if (hasUnsavedEdits()) { event.preventDefault(); event.returnValue = ''; }
});
let batchBreakdown: { name: string; summary: string }[] = [];
let batchAllClean = true;
let batchRedactedTotal = 0;
let batchMetaTotal = 0;

document.getElementById('btnBatchRedact')!.addEventListener('click', () => {
  // First click hides the modal; a queued second click sees it hidden and bails,
  // so the redact pass can't be started twice.
  if (batchBackdrop.hidden) return;
  closeBatchModal();
  batchOutputs = [];
  batchBreakdown = [];
  batchAllClean = true;
  batchRedactedTotal = 0;
  batchMetaTotal = 0;
  startRedactPhase();
});
document.getElementById('btnBatchCancel')!.addEventListener('click', () => {
  closeBatchModal();
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
async function downloadAllBatch(epoch: number) {
  if (epoch !== batchEpoch || batchOutputs.length === 0) return;
  const files = [...batchOutputs];
  if (files.length === 1) { saveBlob(files[0].filename, files[0].blob); batchDownloadedEpoch = epoch; return; }
  try {
    setStatus('Packaging your files into a ZIP…', true);
    const zipBlob = await zipOutputs(files);
    if (epoch !== batchEpoch) return;
    saveBlob('scrubbed-bundle.zip', zipBlob);
    batchDownloadedEpoch = epoch;
    setStatus(`Downloaded scrubbed-bundle.zip · ${batchOutputs.length} files`, false, true);
  } catch {
    if (epoch !== batchEpoch) return;
    console.error('ZIP packaging failed');
    setStatus('Could not build the ZIP — saving files individually…', false);
    files.forEach(({ filename, blob }, i) => setTimeout(() => {
      if (epoch !== batchEpoch) return;
      saveBlob(filename, blob); if (i === files.length - 1) batchDownloadedEpoch = epoch;
    }, i * 150));
  }
}

// All bundle files are redacted & verified — show the SAME finished popup as the
// single-file flow, now with a per-file breakdown and a single ZIP download.
function showBatchComplete() {
  setReviewControls(detectionComplete);
  const epoch = batchEpoch;
  const n = batchOutputs.length;
  if (n === 0) {
    setStatus('No files passed processing and verification; nothing is ready to download.', false);
    return;
  }
  setStatus(
    `${n} file${n !== 1 ? 's' : ''} scrubbed${batchAllClean ? ' · export structure verified' : ''} — ready to download`,
    false, true,
  );
  celebrate(
    { redacted: batchRedactedTotal, metaItems: batchMetaTotal, verifiedClean: batchAllClean, perFile: batchBreakdown, downloadableFiles: n },
    () => downloadAllBatch(epoch),
  );
}

// One toggle chip inside a file row. Pre-checked; keeps `onToggle` in sync and
// reflects state via the `.on` class for styling.
function makeChip(label: string, onToggle: (on: boolean) => void, included = true): HTMLLabelElement {
  const chip = document.createElement('label');
  chip.className = 'batch-chip' + (included ? ' on' : '');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = included;
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

function showBatchModal(results: ScanResult[], preserve = false) {
  batchReviewResults = results;
  const summary = document.getElementById('batchModalSummary') as HTMLParagraphElement;
  const fileList = document.getElementById('batchFileList') as HTMLDivElement;

  if (!preserve) batchSelections.clear();

  const totalVisible = results.reduce((s, r) => s + r.faces + r.emails + r.phones + r.cards + r.names, 0);
  const totalMeta    = results.reduce((s, r) => s + r.meta, 0);

  summary.textContent = totalVisible > 0
    ? `Found ${totalVisible} visible item${totalVisible !== 1 ? 's' : ''} across ${results.length} files. Tick exactly what to remove from each file below.`
    : `No supported detections in ${results.length} files — review manually.${totalMeta > 0 ? ` Hidden metadata will be stripped.` : ''}`;
  if (results.some((result) => result.scanFailure)) {
    summary.textContent += ' Files with failed scans will be excluded from the download.';
  }

  while (fileList.firstChild) fileList.removeChild(fileList.firstChild);

  for (const r of results) {
    // Everything found starts selected; the user unticks what they want to keep.
    const sel: FileSelection = batchSelections.get(r) ?? { types: new Set<DetectionType>(['face', 'email', 'phone', 'card', 'name', 'manual']) };
    batchSelections.set(r, sel);

    const row = document.createElement('div');
    row.className = 'batch-file-row';

    const name = document.createElement('span');
    name.className = 'batch-filename';
    name.textContent = r.file.name;
    name.title = r.file.name;
    row.appendChild(name);
    const reviewButton = document.createElement('button'); reviewButton.className = 'batch-review'; reviewButton.textContent = 'Review / Edit'; reviewButton.type = 'button';
    reviewButton.onclick = () => {
      editingBatchResult = r; closeBatchModal();
      document.getElementById('returnBatch')!.hidden = false;
      void handleFile(r.file);
    };
    row.append(reviewButton);

    if (r.scanFailure) {
      const failure = document.createElement('span');
      failure.className = 'batch-none';
      failure.textContent = 'Scan failed — excluded from export';
      row.appendChild(failure);
      fileList.appendChild(row);
      continue;
    }

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
      if (d.count <= 0 && !r.file.name.toLowerCase().endsWith('.pdf')) continue;
      chips.appendChild(makeChip(`${d.label}s (${d.count} found on first page)`, (on) => {
        if (on) sel.types.add(d.type); else sel.types.delete(d.type);
      }, sel.types.has(d.type)));
    }

    if (chips.childElementCount === 0) {
      const none = document.createElement('span');
      none.className = 'batch-none';
      none.textContent = 'No supported detections — review manually';
      row.appendChild(none);
    } else {
      row.appendChild(chips);
    }

    fileList.appendChild(row);
  }

  openBatchModal();
}

// Reset the preview to the single live canvas (used when a new file loads).
function resetView(disableDownload = true) {
  const scrubberWrap = document.getElementById('scrubberWrap')     as HTMLDivElement;
  const singleWrap   = document.getElementById('singleCanvasWrap') as HTMLDivElement;
  scrubberWrap.hidden = true;
  singleWrap.hidden = false;
  if (disableDownload) btnDownload.disabled = true;
  document.body.classList.remove('is-preview');
  document.getElementById('previewToggle')!.textContent = 'Preview';
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

  container.style.aspectRatio = `${w} / ${h}`;
  container.style.width = '100%';
  origCanvas.style.width = redCanvas.style.width = '100%';
  origCanvas.style.height = redCanvas.style.height = '100%';
  singleWrap.hidden = true; scrubberWrap.hidden = false;
  document.body.classList.add('is-preview');
  document.getElementById('previewToggle')!.textContent = 'Back to editing';
  if (!container.dataset.wired) {
    container.dataset.wired = 'true';
    let pointer: number | null = null;
    const move = (clientX: number) => { const r = container.getBoundingClientRect(); setComparison(100 * (clientX - r.left) / r.width); };
    container.addEventListener('pointerdown', e => { pointer = e.pointerId; container.setPointerCapture(e.pointerId); move(e.clientX); });
    container.addEventListener('pointermove', e => { if (pointer === e.pointerId) move(e.clientX); });
    container.addEventListener('pointerup', () => { pointer = null; });
    container.addEventListener('pointercancel', () => { pointer = null; });
    divider.tabIndex = 0;
    divider.addEventListener('keydown', e => {
      const value = Number(divider.getAttribute('aria-valuenow') ?? 50);
      const next = ({ ArrowLeft: value - 5, ArrowRight: value + 5, Home: 0, End: 100 } as Record<string, number>)[e.key];
      if (next !== undefined) { e.preventDefault(); setComparison(next); }
    });
  }
  setComparison(50);
}
function setComparison(value: number) {
  const percent = Math.max(0, Math.min(100, value));
  const divider = document.getElementById('scrubberDivider')!;
  divider.style.left = `${percent}%`; divider.setAttribute('aria-valuenow', String(Math.round(percent)));
  document.getElementById('originalCanvas')!.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
  document.getElementById('redactedCanvas')!.style.clipPath = `inset(0 0 0 ${percent}%)`;
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
  document.getElementById('forensicDetails')!.hidden = false;
  forensicsList.replaceChildren();
  document.querySelector('#forensicDetails > summary')!.textContent = `Security & Privacy Findings${report.inspectionFailed ? ' · incomplete' : report.findings.length ? ` · ${report.findings.length} to review` : ''}`;
  forensicsSummary.textContent = report.inspectionFailed ? 'Inspection failed or incomplete - export blocked' : report.findings.length ? `${report.findings.length} findings to review` : 'No supported indicators detected';
  forensicsSummary.className = 'forensics-summary' + (report.inspectionFailed || report.findings.length ? ' dirty' : '');
  const notice = document.createElement('li'); notice.className = 'forensics-empty';
  notice.textContent = report.inspectionFailed ? 'Some checks failed or reached a limit. Known findings are shown below. Export is blocked; use Retry scan.' : 'Original-file findings only. No detected indicator is a guarantee of safety. Visual text remains unless you choose masks; export verification is separate.';
  if (report.inspectionFailed) notice.setAttribute('role', 'alert');
  forensicsList.append(notice);
  for (const f of report.findings) {
    const li = document.createElement('li'); li.className = `finding ${f.severity}`;
    const body = document.createElement('div'); body.className = 'finding-body';
    const head = document.createElement('div');
    const label = document.createElement('strong'); label.className = 'finding-label'; label.textContent = f.label + ((f.count ?? 0) > 1 ? ` (${f.count} grouped)` : '');
    const priority = document.createElement('span'); priority.className = 'finding-cat'; priority.textContent = `${f.severity === 'high' ? 'Priority review' : f.severity === 'medium' ? 'Review' : 'Information'} · ${f.evidence === 'indicator' ? 'Suspicious indicator' : 'Structural finding'} · ${CAT_LABEL[f.category]}`;
    head.append(label, priority);
    const description = document.createElement('p'); description.className = 'finding-detail'; description.textContent = f.risk;
    const action = document.createElement('p'); action.className = 'finding-detail';
    action.textContent = f.sanitization === 'manual' ? 'Manual review: visible text/URLs remain in the image unless you redact them.' : f.sanitization === 'interaction-only' ? 'PDF link interaction is removed by reconstruction; displayed text remains unless redacted.' : 'Supported reconstruction omits this embedded content or metadata. The original is unchanged.';
    const technical = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = 'Source and technical details';
    const detail = document.createElement('p'); detail.textContent = `${f.source ?? 'Embedded metadata'}${f.location?.page ? ` · Page ${f.location.page}` : ''}${f.location?.bbox ? ` · ${f.location.coordinates ?? 'source'} region (${Math.round(f.location.bbox.x)}, ${Math.round(f.location.bbox.y)}, ${Math.round(f.location.bbox.width)}, ${Math.round(f.location.bbox.height)})` : ''}. ${f.detail ?? 'Values and destinations are not displayed or logged.'}`;
    technical.append(summary, detail); body.append(head, description, action, technical); li.append(body); forensicsList.append(li);
  }
  const checks = document.createElement('li'); checks.className = 'forensics-empty';
  checks.textContent = [...(report.checks ?? []), ...(report.limitations ?? []), 'OCR text checks cover pages opened for scanning; embedded compressed text and arbitrary encodings may be missed.'].join(' · ');
  forensicsList.append(checks); forensicsPanel.hidden = false;
  if (report.inspectionFailed || report.findings.some(f => f.severity === 'high')) (document.getElementById('forensicDetails') as HTMLDetailsElement).open = true;
}

const onboarding = document.getElementById('onboarding') as HTMLElement;

document.addEventListener('file:started', (e: Event) => {
  cancelScan();
  faceController?.abort();
  cancelOriginalInspection();
  const { gen } = (e as CustomEvent<{ gen: number }>).detail;
  activeGen = gen;
  document.body.classList.remove('scan-complete');
  editorDocument = new EditorDocument(`document-${gen}`);
  editorPage = null;
  editor.reset();
  inspector.classList.remove('sheet-open');
  documentRevision.newDocument();
  invalidateExport();
  pageEpoch++;
  exportController?.abort();
  hideExportProgress();
  resetExportContext();
  currentCanvas = null;
  originalImageData = null;
  currentDetectionFailure = null;
  forensicsFailed = false;
  currentForensicReport = null; pageSecurityFindings.clear();
  detectionComplete = false;
  btnRedact.disabled = true;
  currentFile = null;
  currentDetections = [];
  lastBuilt = null;
  btnDownload.disabled = true;
  (document.getElementById('canvasArea') as HTMLElement).hidden = true;
  (document.getElementById('controlsPanel') as HTMLElement).hidden = true;
  (document.getElementById('pdfNav') as HTMLElement).hidden = true;
  setReviewControls(false); editor.refresh();
  document.body.classList.remove('document-loaded'); fileHeader.hidden = true;
  forensicsPanel.hidden = true; controlsResult.hidden = true;
});

document.addEventListener('page:started', (e: Event) => {
  faceController?.abort();
  const { gen } = (e as CustomEvent<{ gen: number }>).detail;
  if (gen !== activeGen) return;
  if (currentIsPdf && currentCanvas && detectionComplete && !currentDetectionFailure) {
    storeReviewedPage(currentPageNum, currentDetections, currentCanvas);
  }
  invalidateExport();
  editor.cancel();
  pageEpoch++;
  detectionComplete = false;
  setReviewControls(false); editor.refresh();
  lastBuilt = null;
  btnDownload.disabled = true;
});

document.addEventListener('file:raw', (e: Event) => {
  const { file, gen } = (e as CustomEvent<{ file: File; gen: number }>).detail;
  activeGen = gen;
  currentFile = file;
  const previous = documentSessions.get(file);
  if (previous) editorDocument = previous;
  else documentSessions.set(file, editorDocument);
  document.body.classList.add('document-loaded');
  fileHeader.hidden = false;
  document.getElementById('loadedFilename')!.textContent = file.name;
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
      const report = await inspectOriginal(file);
      if (gen !== activeGen) return;
      forensicsFailed = report.inspectionFailed;
      currentForensicReport = report;
      if (getBatchPhase() !== 'scan') renderForensics(report);
      metaItemsFound = report.findings.filter(f => f.sanitization !== 'manual' && f.sanitization !== 'interaction-only').length;
      updateCountBadge('countMetadata', metaItemsFound);
    } catch {
      console.error('Forensic scan failed');
      if (gen === activeGen) { forensicsFailed = true; renderForensics({ findings: [], inspectionFailed: true, trailingBytes: 0, metaFieldCount: 0, checks: ['Scan failed: original-file inspection could not complete'] }); }
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
      scanFailure: 'File processing failed',
    });
  } else if (phase === 'redact') {
    if (file) batchBreakdown.push({ name: file.name, summary: 'could not process — skipped' });
    batchAllClean = false;
    fileFinished();
  }

  if (gen !== activeGen) return;
  dropZone.classList.remove('detecting');
  finishScan(false);
});

function renderVerify(result: VerifyResult) {
  forensicsVerify.hidden = false;
  if (result.clean) {
    forensicsVerify.className = 'forensics-verify ok';
    forensicsVerify.textContent = '✓ Export verified — metadata, appended data and supported active-content checks passed. Review visible content for missed detections';
  } else {
    forensicsVerify.className = 'forensics-verify warn';
    const bits: string[] = [];
    if (result.residualFields > 0) bits.push(`${result.residualFields} metadata field(s)`);
    if (result.threats.length > 0) bits.push(`${result.threats.length} active-content token(s)`);
    if (result.trailingBytes > 0) bits.push(`${result.trailingBytes} trailing byte(s)`);
    forensicsVerify.textContent = `⚠ ${bits.join(', ') || 'residual data'} remain in the exported file`;
  }
}
