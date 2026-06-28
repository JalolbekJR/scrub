import type { Detection } from './types';

const overlayWrap = document.getElementById('overlayWrap') as HTMLDivElement;
const mainCanvas = document.getElementById('mainCanvas') as HTMLCanvasElement;

const TYPE_LABELS: Record<string, string> = {
  face: 'FACE',
  email: 'EMAIL',
  phone: 'PHONE',
  card: 'CARD',
  name: 'NAME',
};

export function renderOverlay(detections: Detection[]) {
  overlayWrap.innerHTML = '';

  // Canvas may be scaled by CSS — compute scale factor
  const scaleX = mainCanvas.offsetWidth / mainCanvas.width;
  const scaleY = mainCanvas.offsetHeight / mainCanvas.height;

  for (const det of detections) {
    const { x, y, width, height } = det.bbox;
    const box = document.createElement('div');
    box.className = 'detection-box';
    box.style.left   = `${x * scaleX}px`;
    box.style.top    = `${y * scaleY}px`;
    box.style.width  = `${width * scaleX}px`;
    box.style.height = `${height * scaleY}px`;

    const label = document.createElement('span');
    label.className = 'detection-box-label';
    label.textContent = det.label ?? TYPE_LABELS[det.type] ?? det.type.toUpperCase();
    box.appendChild(label);
    overlayWrap.appendChild(box);
  }
}

export function clearOverlay() {
  overlayWrap.innerHTML = '';
}

export function updateCountBadge(id: string, count: number) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count > 0 ? String(count) : '';
}
