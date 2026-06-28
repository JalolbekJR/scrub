import type { Detection } from './types';

const overlayWrap = document.getElementById('overlayWrap') as HTMLDivElement;
const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;

const TYPE_LABELS: Record<string, string> = {
  face: 'FACE',
  email: 'EMAIL',
  phone: 'PHONE',
  card: 'CARD',
  name: 'NAME',
  manual: 'MANUAL',
};

function removeChildren(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

// onDelete, when supplied, renders a small ✕ on each box so the user can drop
// a detection (e.g. a false positive) before redacting.
export function renderOverlay(detections: Detection[], onDelete?: (index: number) => void) {
  removeChildren(overlayWrap);

  const scaleX = mainCanvas.offsetWidth / mainCanvas.width;
  const scaleY = mainCanvas.offsetHeight / mainCanvas.height;

  detections.forEach((det, i) => {
    const { x, y, width, height } = det.bbox;
    const box = document.createElement('div');
    box.className = 'detection-box';
    if (det.type === 'manual') box.classList.add('manual');
    box.style.left   = `${x * scaleX}px`;
    box.style.top    = `${y * scaleY}px`;
    box.style.width  = `${width * scaleX}px`;
    box.style.height = `${height * scaleY}px`;

    const label = document.createElement('span');
    label.className = 'detection-box-label';
    label.textContent = det.label ?? TYPE_LABELS[det.type] ?? det.type.toUpperCase();
    box.appendChild(label);

    if (onDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'detection-box-del';
      del.setAttribute('aria-label', 'Remove this box');
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(i); });
      box.appendChild(del);
    }

    overlayWrap.appendChild(box);
  });
}

export function clearOverlay() {
  removeChildren(overlayWrap);
}

export function updateCountBadge(id: string, count: number) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count > 0 ? String(count) : '';
}
