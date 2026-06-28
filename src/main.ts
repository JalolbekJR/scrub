import './style.css';
import { initTheme } from './theme';
import { initUpload } from './upload';
import { initExport, enableDownload, exportBatch, setPdfContext, storeRedactedPage } from './export';
import { detectFaces } from './detectors/face';
import { detectPii } from './detectors/pii';
import { redactAll } from './redactor';
import { renderOverlay, clearOverlay, updateCountBadge } from './overlay';
import { inspectFile, verifyClean, type ForensicReport, type Finding } from './forensics';
import { startScan, setPhase, phaseLog, updateOcrProgress, finishScan } from './scanner';
import { celebrate } from './celebrate';
import { initTicker } from './ticker';
import { enqueue, initQueue, isBatchActive, fileFinished } from './queue';
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
    queueLabel.textContent = total === done
      ? `Batch complete — ${done} file${done !== 1 ? 's' : ''} scrubbed`
      : `Processing ${done + 1} of ${total}…`;
    queueFill.style.width = `${Math.round((done / total) * 100)}%`;
  }
);

initUpload((files) => enqueue(files));
initExport();
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
let originalImageData: ImageData | null = null; // pristine copy — never mutated
let currentPageNum = 1;
let currentIsPdf = false;
let metaItemsFound = 0;          // count only — never the values
let lastVerifiedClean = false;
let forensicsGate: Promise<void> = Promise.resolve();
let activeGen = 0;               // newest upload wins; stale async results are dropped

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

  if (isPdf && pdfDoc) {
    setPdfContext(pdfDoc, pageCount);
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
  renderOverlay(currentDetections);
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

  if (isBatchActive() && currentCanvas && originalImageData) {
    const ctx = currentCanvas.getContext('2d')!;
    ctx.putImageData(originalImageData, 0, 0);
    redactAll(currentCanvas, currentDetections.map((d) => d.bbox));
    clearOverlay();
    const safeName = `scrubbed-${Date.now()}.jpg`;
    exportBatch(safeName);
    document.addEventListener('export:done', () => fileFinished(), { once: true });
    setStatus(`Auto-redacted — downloading ${safeName}`, false, true);
  }
});

// ── Redact button ─────────────────────────────────────────────────────────────

btnRedact.addEventListener('click', () => {
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

  enableDownload();
  btnRedact.classList.add('pulsed', 'done');
  setTimeout(() => btnRedact.classList.remove('pulsed', 'done'), 2000);

  setStatus(`${toRedact.length} item${toRedact.length !== 1 ? 's' : ''} redacted — ready to download`, false, true);

  const stripMeta = (document.getElementById('chkMetadata') as HTMLInputElement).checked;
  celebrate(
    { redacted: toRedact.length, metaItems: stripMeta ? metaItemsFound : 0, verifiedClean: lastVerifiedClean || stripMeta },
    () => btnDownload.click()
  );
});

const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement;

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
  forensicsList.innerHTML = '';
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
      li.innerHTML = `
        <span class="finding-dot"></span>
        <div class="finding-body">
          <div><span class="finding-label"></span><span class="finding-cat"></span></div>
          <div class="finding-detail"></div>
        </div>`;
      (li.querySelector('.finding-label') as HTMLElement).textContent = f.label;
      (li.querySelector('.finding-cat') as HTMLElement).textContent = CAT_LABEL[f.category];
      (li.querySelector('.finding-detail') as HTMLElement).textContent = f.risk;
      forensicsList.appendChild(li);
    }
  }

  forensicsPanel.hidden = false;
}

const onboarding = document.getElementById('onboarding') as HTMLElement;

document.addEventListener('file:raw', (e: Event) => {
  const { file, gen } = (e as CustomEvent<{ file: File; gen: number }>).detail;
  activeGen = gen;
  // First file loaded — retire the onboarding guide.
  onboarding.hidden = true;
  // Reset panel for the new file
  forensicsPanel.hidden = true;
  updateCountBadge('countMetadata', 0);
  metaItemsFound = 0;
  lastVerifiedClean = false;

  // Kick off the animated scanner: read → scan phases happen here.
  startScan();
  phaseLog('read');
  setPhase('scan');
  phaseLog('scan');

  // Expose the forensics work as a gate the detection pipeline awaits.
  forensicsGate = (async () => {
    try {
      const report = await inspectFile(file);
      if (gen !== activeGen) return;
      renderForensics(report);
      metaItemsFound = report.findings.length;
      updateCountBadge('countMetadata', metaItemsFound);
    } catch {
      console.error('Forensic scan failed'); // never log file contents
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

document.addEventListener('export:done', async (e: Event) => {
  const { blob } = (e as CustomEvent<{ blob: Blob }>).detail;
  try {
    const result = await verifyClean(blob);
    lastVerifiedClean = result.clean;
    forensicsVerify.hidden = false;
    if (result.clean) {
      forensicsVerify.className = 'forensics-verify ok';
      forensicsVerify.textContent = '✓ Verified clean — exported file has no metadata, thumbnail, or appended data';
    } else {
      forensicsVerify.className = 'forensics-verify warn';
      forensicsVerify.textContent = `⚠ ${result.residualFields} metadata field(s), ${result.trailingBytes} trailing byte(s) remain`;
    }
  } catch (err) {
    console.error('Verification failed:', err);
  }
});
