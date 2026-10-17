// View-only sizing: source pixels and mask coordinates are never transformed.
// The editor maps pointer positions through the displayed overlay's bounds.
export function initDocumentView(cancelGesture: () => void) {
  const canvas = document.getElementById('mainCanvas') as HTMLCanvasElement;
  const container = document.getElementById('mainContainer')!;
  const viewport = document.getElementById('singleCanvasWrap')!;
  const toolbar = document.getElementById('editingTools')!;
  const label = document.createElement('label'); label.className = 'view-settings'; label.textContent = 'Zoom';
  const zoom = document.createElement('input'); zoom.id = 'viewZoom'; zoom.type = 'range'; zoom.min = '1'; zoom.max = '3'; zoom.step = '.25'; zoom.value = '1'; zoom.setAttribute('aria-label', 'Preview zoom');
  const amount = document.createElement('output'); amount.textContent = '100%'; label.append(zoom, amount);
  const fit = document.createElement('button'); fit.type = 'button'; fit.textContent = 'Fit view'; fit.id = 'viewFit';
  const pan = document.createElement('button'); pan.type = 'button'; pan.textContent = 'Pan'; pan.id = 'viewPan'; pan.setAttribute('aria-pressed', 'false');
  toolbar.append(label, fit, pan);
  let panning = false, fullFit = false;
  let resizeFrame = 0;
  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  function cancel() {
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    drag = null;
  }
  function setPan(enabled: boolean) { cancelGesture(); cancel(); panning = enabled; pan.setAttribute('aria-pressed', String(enabled)); viewport.classList.toggle('panning', enabled); }
  function size() {
    if (!canvas.width || !canvas.height) return;
    const available = viewport.clientWidth;
    const tools = matchMedia('(max-width: 899px)').matches && !toolbar.hidden ? toolbar.getBoundingClientRect().height : 0;
    const height = Math.max(120, innerHeight - Math.max(0, viewport.getBoundingClientRect().top) - 24 - tools);
    const fitWidth = Math.min(available, Math.max(fullFit ? 0 : Math.min(available, 280), height * canvas.width / canvas.height));
    zoom.max = String(Math.max(3, Math.ceil(available / Math.max(1, fitWidth))));
    container.style.width = `${fitWidth * Number(zoom.value)}px`;
    viewport.classList.toggle('view-zoomed', Number(zoom.value) > 1);
    pan.disabled = Number(zoom.value) <= 1;
    pan.title = pan.disabled ? 'Zoom in before panning' : 'Drag to move around the enlarged preview';
    amount.textContent = `${Math.round(Number(zoom.value) * 100)}%`;
    zoom.setAttribute('aria-valuetext', amount.textContent);
  }
  zoom.oninput = () => { cancelGesture(); cancel(); size(); };
  function reset() { cancelAnimationFrame(resizeFrame); resizeFrame = 0; cancelGesture(); cancel(); setPan(false); zoom.value = '1'; viewport.scrollTo(0, 0); size(); }
  fit.onclick = () => { fullFit = true; reset(); }; pan.onclick = () => setPan(!panning);
  toolbar.addEventListener('click', e => { if (e.target instanceof HTMLButtonElement && e.target !== pan) setPan(false); });
  viewport.addEventListener('pointerdown', e => {
    if (!panning || Number(zoom.value) <= 1 || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); cancelGesture();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; viewport.setPointerCapture(e.pointerId);
  }, true);
  viewport.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    viewport.scrollTo(drag.left + drag.x - e.clientX, drag.top + drag.y - e.clientY); e.preventDefault();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(event, cancel);
  // One observer for the app lifetime, rather than one per upload/page.
  let viewportWidth = viewport.clientWidth;
  new ResizeObserver(entries => {
    const width = entries[0]?.contentRect.width ?? viewport.clientWidth;
    // Canvas resizing changes the wrapper height. Reacting to that height
    // would overwrite sizing again and shift coordinates during a gesture.
    if (Math.abs(width - viewportWidth) < .5) return;
    viewportWidth = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; size(); });
  }).observe(viewport);
  document.addEventListener('file:loaded', () => { fullFit = false; reset(); });
  window.addEventListener('resize', () => { cancelGesture(); cancel(); size(); });
  return { reset: () => { fullFit = false; reset(); }, fit: size };
}
