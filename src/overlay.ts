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
export function renderOverlay(detections: Detection[], onDelete?: (index: number) => void, onSelect?: (id: string) => void, selected?: string | null) {
  removeChildren(overlayWrap);

  const scaleX = 100 / mainCanvas.width;
  const scaleY = 100 / mainCanvas.height;

  detections.forEach((det, i) => {
    const { x, y, width, height } = det.bbox;
    const box = document.createElement('div');
    box.className = 'detection-box';
    if (det.id) {
      box.dataset.regionId = det.id;
      if (!document.body.classList.contains('editing-active')) { box.tabIndex = 0; box.setAttribute('role', 'button'); }
      box.setAttribute('aria-label', 'Select ' + det.type + ' region ' + (i + 1));
      box.onclick = () => onSelect?.(det.id!);
      box.onkeydown = e => { if (e.target === box && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect?.(det.id!); } };
    }
    if (det.id === selected) {
      box.classList.add('selected');
      const handle = document.createElement('span'); handle.className = 'resize-handle'; box.append(handle);
    }
    if (det.shape === 'ellipse') box.style.borderRadius = '50%';
    if (det.included === false) box.classList.add('excluded');
    if (det.type === 'manual') box.classList.add('manual');
    box.style.left   = `${x * scaleX}%`;
    box.style.top    = `${y * scaleY}%`;
    box.style.width  = `${width * scaleX}%`;
    box.style.height = `${height * scaleY}%`;

    const label = document.createElement('span');
    label.className = 'detection-box-label';
    label.textContent = det.label ?? TYPE_LABELS[det.type] ?? det.type.toUpperCase();
    box.appendChild(label);

    if (onDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.hidden = !document.body.classList.contains('editing-active');
      del.className = 'detection-box-del';
      del.setAttribute('aria-label', `${det.type === 'manual' ? 'Delete manual mask' : 'Exclude ' + det.type + ' suggestion'} ${i + 1}`);
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
