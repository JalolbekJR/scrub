// The original gentle typewriter, with practical help alongside privacy risks.
const LINES = [
  'Drop a photo or PDF. Scrub checks it right here.',
  'Choose what to hide. You stay in control.',
  'Photos can quietly record the GPS spot they were taken.',
  'Missed something? Cover it with the brush.',
  "A cropped photo's hidden thumbnail can still show what you cropped out.",
  'Check your changes, then download your protected copy.',
  'AI can read faces, visible text and hidden details.',
  'Blur and mosaic can leave clues. Opaque covers replace pixels.',
  'Metadata can reveal your device, software and when you took a photo.',
  'Files can hide whole archives, scripts, even prompts aimed at AI.',
];

let disposePrevious: (() => void) | undefined;
export function initTicker() {
  disposePrevious?.();
  const el = document.getElementById('riskTicker');
  if (!el) return;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, line = 0, char = 0, deleting = false;
  const stop = () => { clearTimeout(timer); running = false; };
  const tick = () => {
    const text = LINES[line];
    if (!deleting) {
      el.textContent = text.slice(0, ++char);
      if (char >= text.length) { deleting = true; timer = setTimeout(tick, 2600); }
      else timer = setTimeout(tick, 32);
    } else {
      char -= 2; el.textContent = text.slice(0, Math.max(0, char));
      if (char <= 0) { deleting = false; line = (line + 1) % LINES.length; timer = setTimeout(tick, 320); }
      else timer = setTimeout(tick, 14);
    }
  };
  const sync = () => {
    if (media.matches || document.hidden || document.body.classList.contains('document-loaded')) {
      stop(); if (media.matches) el.textContent = LINES[0]; return;
    }
    if (running) return;
    running = true; line = 0; char = 0; deleting = false; tick();
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', sync); media.addEventListener('change', sync);
  disposePrevious = () => { stop(); observer.disconnect(); document.removeEventListener('visibilitychange', sync); media.removeEventListener('change', sync); };
  sync(); return disposePrevious;
}
