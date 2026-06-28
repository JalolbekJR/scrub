// Typewriter "risk ticker" for the hero — rotates through hidden-data risks
// framed for today's AI landscape. Educates without alarming.

const LINES = [
  'Your photos quietly record the exact GPS spot they were taken.',
  'Modern AI reads EXIF, faces and text in milliseconds.',
  "A cropped photo's hidden thumbnail can still show what you cropped out.",
  'AI upscalers can reverse weak blur — only destroyed pixels are safe.',
  'Metadata leaks your device, software and the exact second you shot it.',
  'Files can hide whole archives, scripts, even prompts aimed at AI.',
];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initTicker() {
  const el = document.getElementById('riskTicker');
  if (!el) return;

  if (reduceMotion) {
    el.textContent = LINES[0];
    return;
  }

  let line = 0;
  let char = 0;
  let deleting = false;

  const tick = () => {
    const text = LINES[line];
    if (!deleting) {
      char++;
      el.textContent = text.slice(0, char);
      if (char >= text.length) {
        deleting = true;
        setTimeout(tick, 2600); // hold the full line
        return;
      }
      setTimeout(tick, 32);
    } else {
      char -= 2;
      el.textContent = text.slice(0, Math.max(0, char));
      if (char <= 0) {
        deleting = false;
        line = (line + 1) % LINES.length;
        setTimeout(tick, 320);
        return;
      }
      setTimeout(tick, 14);
    }
  };
  tick();
}
