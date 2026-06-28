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

async function loadStarCount() {
  try {
    const res = await fetch('https://api.github.com/repos/JalolbekJR/scrub', { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.stargazers_count === 'number') {
      $('starCount').textContent = `· ${data.stargazers_count}`;
    }
  } catch { /* offline / repo not public yet — silently skip */ }
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
    const f = [...modal.querySelectorAll<HTMLElement>('button, a[href]')].filter((x) => !x.hasAttribute('disabled'));
    if (f.length === 0) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;

  $('celebClose').addEventListener('click', close);
  $('celebLater').addEventListener('click', close);
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
    try { await navigator.clipboard.writeText(REPO); } catch { /* ignore */ }
    const btn = e.currentTarget as HTMLElement;
    const prev = btn.textContent;
    btn.textContent = '✓ Link copied';
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
}

export function celebrate(summary: CelebrateSummary, onDownload: () => void) {
  onDownloadCb = onDownload;
  wire();

  const parts: string[] = [];
  if (summary.redacted > 0) parts.push(`${summary.redacted} visible item${summary.redacted !== 1 ? 's' : ''} redacted`);
  if (summary.metaItems > 0) parts.push(`${summary.metaItems} hidden item${summary.metaItems !== 1 ? 's' : ''} removed`);
  parts.push(summary.verifiedClean ? 'metadata stripped & verified' : 'metadata stripped');
  $('celebSummary').textContent = parts.join(' · ') + '.';

  updateGratitude();
  loadStarCount();

  lastFocus = document.activeElement as HTMLElement;
  $('celebrateBackdrop').hidden = false;
  document.addEventListener('keydown', onKey);
  ($('celebDownload') as HTMLButtonElement).focus();
}
