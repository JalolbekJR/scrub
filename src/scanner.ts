// Phase-aware scanning animation — a flat, forensic-instrument progress UI.
// Segmented ring + scan-beam over the preview + ETA + a typewritten log.
// No gradients / glassmorphism, per the design system.

export type Phase = 'read' | 'scan' | 'faces' | 'ocr' | 'done';

const PHASES: Phase[] = ['read', 'scan', 'faces', 'ocr'];

// Each phase owns a slice of the overall 0–100% bar.
const PHASE_RANGE: Record<Phase, [number, number]> = {
  read:  [0, 6],
  scan:  [6, 22],
  faces: [22, 48],
  ocr:   [48, 99],
  done:  [100, 100],
};

const PHASE_COPY: Record<Phase, { title: string; sub: string; log: string }> = {
  read:  { title: 'Reading file',          sub: 'Opening locally — nothing is uploaded',         log: 'opening file in a local sandbox' },
  scan:  { title: 'Scanning for hidden data', sub: 'EXIF · GPS · embedded payloads · scripts',   log: 'parsing headers + signature scan' },
  faces: { title: 'Detecting faces',       sub: 'On-device neural network',                       log: 'running face detector' },
  ocr:   { title: 'Reading text',          sub: 'Looking for emails, phones, cards & names',      log: 'OCR pass — recognising characters' },
  done:  { title: 'Scan complete',         sub: 'Nothing left your device',                       log: 'done — nothing left your device' },
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// DOM
let el: {
  scanner: HTMLElement; ringFill: SVGCircleElement; ringPct: HTMLElement;
  phase: HTMLElement; sub: HTMLElement; eta: HTMLElement; steps: HTMLElement;
  log: HTMLElement; container: HTMLElement | null;
} | null = null;

function dom() {
  if (!el) {
    el = {
      scanner:   document.getElementById('scanner') as HTMLElement,
      ringFill:  document.getElementById('ringFill') as unknown as SVGCircleElement,
      ringPct:   document.getElementById('ringPct') as HTMLElement,
      phase:     document.getElementById('scannerPhase') as HTMLElement,
      sub:       document.getElementById('scannerSub') as HTMLElement,
      eta:       document.getElementById('scannerEta') as HTMLElement,
      steps:     document.getElementById('scannerSteps') as HTMLElement,
      log:       document.getElementById('scannerLog') as HTMLElement,
      container: document.getElementById('mainContainer'),
    };
  }
  return el;
}

const RING_C = 2 * Math.PI * 34; // r=34

let target = 0;          // target % we are easing toward
let shown = 0;           // currently displayed %
let raf = 0;
let startTime = 0;
let currentPhase: Phase = 'read';

function frame() {
  shown += (target - shown) * 0.12;
  if (Math.abs(target - shown) < 0.2) shown = target;
  const d = dom();
  d.ringFill.style.strokeDashoffset = String(RING_C * (1 - shown / 100));
  d.ringPct.textContent = `${Math.round(shown)}%`;

  // ETA from elapsed time and progress so far
  const elapsed = performance.now() - startTime;
  if (shown > 3 && shown < 99.5) {
    const remaining = (elapsed / shown) * (100 - shown);
    d.eta.textContent = remaining > 1500 ? `~${Math.ceil(remaining / 1000)}s left` : 'almost done…';
  } else if (shown >= 99.5) {
    d.eta.textContent = '';
  }

  if (shown !== target) raf = requestAnimationFrame(frame);
}

function ease() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

// ── Typewriter log (capped, newest at bottom) ────────────────────────────────
const logLines: string[] = [];
let typing = false;
const typeQueue: string[] = [];

function renderLog() { dom().log.textContent = logLines.join('\n'); }

function pumpType() {
  if (typing) return;
  const next = typeQueue.shift();
  if (next == null) return;
  typing = true;
  const prefix = '> ';
  logLines.push(prefix);
  if (logLines.length > 5) logLines.shift();
  const idx = logLines.length - 1;
  if (reduceMotion) {
    logLines[idx] = prefix + next;
    renderLog(); typing = false; pumpType();
    return;
  }
  let i = 0;
  const tick = () => {
    logLines[idx] = prefix + next.slice(0, i);
    renderLog();
    if (i++ < next.length) {
      setTimeout(tick, 18);
    } else { typing = false; pumpType(); }
  };
  tick();
}

function logLine(text: string) { typeQueue.push(text); pumpType(); }

// ── Public API ───────────────────────────────────────────────────────────────

export function startScan() {
  const d = dom();
  logLines.length = 0; typeQueue.length = 0; typing = false;
  renderLog();
  d.ringFill.style.strokeDasharray = String(RING_C);
  target = 0; shown = 0;
  startTime = performance.now();
  d.eta.textContent = '';
  d.scanner.hidden = false;
  d.container?.classList.add('scanning');
  setPhase('read');
}

export function setPhase(phase: Phase, opts?: { progress?: number }) {
  const d = dom();
  currentPhase = phase;
  const [lo, hi] = PHASE_RANGE[phase];
  const frac = Math.max(0, Math.min(1, opts?.progress ?? 0));
  target = phase === 'done' ? 100 : lo + (hi - lo) * frac;
  ease();

  const copy = PHASE_COPY[phase];
  d.phase.textContent = copy.title;
  d.sub.textContent = copy.sub;

  // Step indicators
  [...d.steps.querySelectorAll('li')].forEach((li) => {
    const p = li.getAttribute('data-phase') as Phase;
    const isDone = phase === 'done' || PHASES.indexOf(p) < PHASES.indexOf(phase);
    const isActive = p === phase;
    li.classList.toggle('done', isDone);
    li.classList.toggle('active', isActive);
  });

  // Beam tint per phase (data attr drives CSS)
  d.container?.setAttribute('data-phase', phase);
}

// Call when entering a phase the first time, to add a log line.
const logged = new Set<Phase>();
export function phaseLog(phase: Phase) {
  if (logged.has(phase)) return;
  logged.add(phase);
  logLine(PHASE_COPY[phase].log);
}

export function updateOcrProgress(progress: number) {
  if (currentPhase !== 'ocr') return;
  setPhase('ocr', { progress });
}

export function finishScan() {
  const d = dom();
  setPhase('done');
  phaseLog('done');
  d.container?.classList.remove('scanning');
  // Briefly hold the completed ring, then collapse the scanner.
  window.setTimeout(() => {
    d.scanner.hidden = true;
    logged.clear();
  }, reduceMotion ? 0 : 900);
}

export function resetScanLog() { logged.clear(); }
