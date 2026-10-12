// Success modal — appears after the first successful scrub. It IS the download
// step (primary action), with gentle, non-nagging support / star / share CTAs.

const REPO = 'https://github.com/JalolbekJR/scrub';
const SUPPORT = 'https://boosty.to/unusual_one/donate';
const SHARE_TEXT = 'I just scrubbed faces, private info & hidden metadata from a file — 100% in my browser, nothing uploaded. Check out Scrub:';

let lastFocus: HTMLElement | null = null;
let onDownloadCb: (() => void) | null = null;

function $(id: string) { return document.getElementById(id)!; }

function trackThanks(key: string, btn: HTMLElement, label: string) {
  // A non-sensitive UI flag only (no file data). Lets us say a warm thanks and
  // gives the author a rough sense of engagement on their own machine.
  try { sessionStorage.setItem(`scrub-${key}`, '1'); } catch { /* ignore */ }
  btn.classList.add('thanked');
  btn.textContent = `✓ Thanks! ${label}`;
  updateGratitude();
}

function updateGratitude() {
  const helped = ['star', 'share', 'support'].filter((k) => {
    try { return sessionStorage.getItem(`scrub-${k}`) === '1'; } catch { return false; }
  }).length;
  if (helped > 0) {
    const g = $('celebGratitude');
    g.hidden = false;
    g.textContent = helped >= 3 ? '💜 You did all three — you are a legend. Thank you!' : '💜 Thank you for supporting an indie project!';
  }
}

function close() {
  const backdrop = $('celebrateBackdrop');
  backdrop.hidden = true;
  document.removeEventListener('keydown', onKey);
  lastFocus?.focus();
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { close(); return; }
  if (e.key === 'Tab') {
    const modal = $('celebrateModal');
    const f = [...modal.querySelectorAll<HTMLElement>('button, a[href]')].filter((x) => !x.hasAttribute('disabled') && x.getClientRects().length > 0);
    if (f.length === 0) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;

  $('celebClose').addEventListener('click', close);
  $('celebLater').addEventListener('click', close);
  $('celebEdit').addEventListener('click', () => {
    close();
    if (document.body.classList.contains('is-preview')) $('previewToggle').click();
    $('customize').focus();
  });
  $('celebrateBackdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) close();
  });

  $('celebDownload').addEventListener('click', () => {
    onDownloadCb?.();
    close();
  });

  $('celebStar').addEventListener('click', (e) => {
    window.open(REPO, '_blank', 'noopener');
    trackThanks('star', e.currentTarget as HTMLElement, 'Starred');
  });

  $('celebShare').addEventListener('click', (e) => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(REPO)}`;
    window.open(url, '_blank', 'noopener');
    trackThanks('share', e.currentTarget as HTMLElement, 'Shared');
  });

  $('celebCopy').addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLElement;
    const prev = btn.textContent;
    try { await navigator.clipboard.writeText(REPO); btn.textContent = '✓ Link copied'; }
    catch { btn.textContent = 'Could not copy — try again'; }
    setTimeout(() => { if (!btn.classList.contains('thanked')) btn.textContent = prev; }, 1800);
  });

  $('celebSupport').addEventListener('click', (e) => {
    window.open(SUPPORT, '_blank', 'noopener');
    trackThanks('support', e.currentTarget as HTMLElement, 'Supported');
  });
}

export interface CelebrateSummary {
  redacted: number;
  metaItems: number;
  verifiedClean: boolean;
  downloadableFiles?: number;
  pdfPages?: number;
  // Bundle mode: one entry per file with a plain-language line of what was
  // actually removed from it. When present, the popup renders a per-file list
  // and switches its title / download button to the multi-file wording.
  perFile?: { name: string; summary: string }[];
}

// Renders (or clears) the per-file "what was removed" list shown for bundles.
function renderBreakdown(perFile?: { name: string; summary: string }[]) {
  const el = $('celebBreakdown');
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!perFile || perFile.length === 0) { el.hidden = true; return; }
  el.hidden = false;

  const title = document.createElement('p');
  title.className = 'celeb-breakdown-title';
  title.textContent = `Processing results (${perFile.length})`;
  el.appendChild(title);

  const list = document.createElement('ul');
  list.className = 'celeb-breakdown-list';
  for (const f of perFile) {
    const li = document.createElement('li');
    const nm = document.createElement('span');
    nm.className = 'celeb-breakdown-name';
    nm.textContent = f.name;
    nm.title = f.name;
    const sm = document.createElement('span');
    sm.className = 'celeb-breakdown-summary';
    sm.textContent = f.summary;
    li.appendChild(nm);
    li.appendChild(sm);
    list.appendChild(li);
  }
  el.appendChild(list);
}

export function celebrate(summary: CelebrateSummary, onDownload: () => void, returnFocus?: HTMLElement) {
  onDownloadCb = onDownload;
  wire();

  const parts: string[] = [];
  if (summary.pdfPages) parts.push(`${summary.pdfPages}-page raster PDF rebuilt`);
  else if (summary.redacted > 0) parts.push(`${summary.redacted} selected region${summary.redacted !== 1 ? 's' : ''} rendered`);
  if (summary.metaItems > 0) parts.push(`${summary.metaItems} hidden item${summary.metaItems !== 1 ? 's' : ''} removed`);
  parts.push(summary.verifiedClean ? 'export structure and metadata checks passed' : 'metadata stripped');
  $('celebSummary').textContent = parts.join(' · ') + '.';

  // Multi-file bundle vs single file: adjust title + primary button wording.
  const n = summary.downloadableFiles ?? summary.perFile?.length ?? 0;
  if (summary.perFile) {
    $('celebTitle').textContent = `${n} verified file${n !== 1 ? 's' : ''} ready`;
    $('celebDownload').textContent = `Download ${n} file${n !== 1 ? 's' : ''}`;
  } else {
    $('celebTitle').textContent = 'Verified export ready';
    $('celebDownload').textContent = 'Download verified copy';
  }
  renderBreakdown(summary.perFile);

  updateGratitude();

  lastFocus = returnFocus ?? document.activeElement as HTMLElement;
  $('celebrateBackdrop').hidden = false;
  document.addEventListener('keydown', onKey);
  ($('celebDownload') as HTMLButtonElement).focus();
}
