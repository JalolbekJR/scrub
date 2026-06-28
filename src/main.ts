import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './style.css';
import { initTheme } from './theme';
import { initUpload } from './upload';
import { buildExport, triggerDownload, enableDownload, exportBatch, setPdfContext, storeRedactedPage, resetExportContext, type BuiltExport } from './export';
import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { redactAll } from './redactor';
import { renderOverlay, clearOverlay, updateCountBadge } from './overlay';
import { inspectFile, verifyClean, verifyCleanPdf, type ForensicReport, type Finding, type VerifyResult } from './forensics';
import { startScan, setPhase, phaseLog, updateOcrProgress, finishScan } from './scanner';
import { celebrate } from './celebrate';
import { initTicker } from './ticker';
import { enqueue, initQueue, getBatchPhase, fileScanned, fileFinished, startRedactPhase, getCurrentScanResult } from './queue';
import type { ScanResult } from './types';
import { handleFile } from './upload';
import type { Detection, FileLoadedDetail } from './types';

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
);

initUpload((files) => enqueue(files));
initTicker();

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

  if (isPdf && pdfDoc) {
    setPdfContext(pdfDoc, pageCount);
  } else {
    resetExportContext();
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

  controlsResult.className = 'controls-result';
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
    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);
    const toRedact = stored.detections.filter((d) => {
      if (d.type === 'face'  && !chkFaces.checked)  return false;
      if (d.type === 'email' && !chkEmails.checked) return false;
      if (d.type === 'phone' && !chkPhones.checked) return false;
      if (d.type === 'card'  && !chkCards.checked)  return false;
      if (d.type === 'name'  && !chkNames.checked)  return false;
      return true;
    });
    redactAll(currentCanvas, toRedact.map((d) => d.bbox));
    clearOverlay();
    const baseName = stored.file.name.replace(/\.[^.]+$/, '');
    exportBatch(`scrubbed-${baseName}.jpg`);
    document.addEventListener('export:done', () => fileFinished(), { once: true });
    setStatus(`Redacting ${stored.file.name}…`, true);
    return;
  }
});

// ── Redact button ─────────────────────────────────────────────────────────────

btnRedact.addEventListener('click', async () => {
  if (!currentCanvas || !originalImageData) return;

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
  try {
    lastBuilt = await buildExport();
  } catch {
    setStatus('Could not build the clean file. Please try again.', false);
    return;
  }
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
});

const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

let lastBuilt: BuiltExport | null = null;

async function doDownload() {
  if (!lastBuilt) {
    setStatus('Preparing the clean file…', true);
    try { lastBuilt = await buildExport(); }
    catch { setStatus('Could not build the clean file.', false); return; }
    const result = lastBuilt.isPdf ? await verifyCleanPdf(lastBuilt.blob) : await verifyClean(lastBuilt.blob);
    renderVerify(result);
  }
  await triggerDownload(lastBuilt.filename, lastBuilt.blob);
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
document.getElementById('btnBatchRedact')!.addEventListener('click', () => {
  batchBackdrop.hidden = true;
  startRedactPhase();
});
document.getElementById('btnBatchCancel')!.addEventListener('click', () => {
  batchBackdrop.hidden = true;
});

function showBatchModal(results: ScanResult[]) {
  const summary = document.getElementById('batchModalSummary') as HTMLParagraphElement;
  const fileList = document.getElementById('batchFileList') as HTMLDivElement;

  const totalVisible = results.reduce((s, r) => s + r.faces + r.emails + r.phones + r.cards + r.names, 0);
  const totalMeta    = results.reduce((s, r) => s + r.meta, 0);

  summary.textContent = totalVisible > 0
    ? `Found ${totalVisible} visible item${totalVisible !== 1 ? 's' : ''} across ${results.length} files. Review below, then redact all at once.`
    : `No visible faces or text found in ${results.length} files.${totalMeta > 0 ? ` Hidden metadata will be stripped.` : ''}`;

  while (fileList.firstChild) fileList.removeChild(fileList.firstChild);
  for (const r of results) {
    const row = document.createElement('div');
    row.className = 'batch-file-row';

    const parts: string[] = [];
    if (r.faces)  parts.push(`${r.faces} face${r.faces  !== 1 ? 's' : ''}`);
    if (r.emails) parts.push(`${r.emails} email${r.emails !== 1 ? 's' : ''}`);
    if (r.phones) parts.push(`${r.phones} phone${r.phones !== 1 ? 's' : ''}`);
    if (r.cards)  parts.push(`${r.cards} card${r.cards  !== 1 ? 's' : ''}`);
    if (r.names)  parts.push(`${r.names} name${r.names  !== 1 ? 's' : ''}`);

    const visibleStr = parts.length > 0 ? parts.join(', ') : 'nothing visible';
    const metaStr    = r.meta > 0 ? ` · ${r.meta} hidden` : '';

    const name = document.createElement('span');
    name.className = 'batch-filename';
    name.textContent = r.file.name;
    name.title = r.file.name;

    const found = document.createElement('span');
    found.className = `batch-found${parts.length > 0 ? ' has-items' : ' clean'}`;
    found.textContent = visibleStr + metaStr;

    row.appendChild(name);
    row.appendChild(found);
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

// If decoding/loading failed, stop the scanner cleanly so the UI never hangs.
document.addEventListener('file:failed', (e: Event) => {
  const { gen } = (e as CustomEvent<{ gen: number }>).detail;
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

// Batch path verifies here (single-file path verifies inline in the redact handler).
document.addEventListener('export:done', async (e: Event) => {
  const { blob, isPdf } = (e as CustomEvent<{ blob: Blob; isPdf?: boolean }>).detail;
  try {
    const result = isPdf ? await verifyCleanPdf(blob) : await verifyClean(blob);
    renderVerify(result);
  } catch (err) {
    console.error('Verification failed:', err);
  }
});
