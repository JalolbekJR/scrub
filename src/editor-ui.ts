import type { EditorPage } from './editor-state';
import type { BoundingBox, Detection } from './types';
import { pointToCanvas } from './geometry';

interface EditorAccess {
  page(): EditorPage | null;
  canvas(): HTMLCanvasElement | null;
  pageNumber(): number;
  changed(): void;
  render(selected: string | null): void;
}
export function initEditor(access: EditorAccess) {
  const container = document.getElementById('mainContainer')!;
  const overlay = document.getElementById('overlayWrap')!;
  const toolbar = document.createElement('div'); toolbar.className = 'editor-toolbar'; toolbar.id = 'editingTools'; toolbar.hidden = true; toolbar.setAttribute('aria-label', 'Editing tools');
  const panel = document.createElement('aside'); panel.className = 'region-inspector'; panel.id = 'regionInspector'; panel.setAttribute('aria-label', 'Regions and properties');
  const content = document.createElement('div'); content.className = 'region-content'; panel.append(content);
  const stage = document.createElement('div'); stage.className = 'editor-stage';
  stage.append(toolbar, document.getElementById('singleCanvasWrap')!, document.getElementById('scrubberWrap')!);
  document.getElementById('canvasArea')!.append(stage, panel);
  let selected: string | null = null;
  let customizing = false, advancedOpen = false, listOpen = false;
  let tool: 'select' | 'rectangle' | 'ellipse' | 'brush' | 'eraser' = 'select';
  let brushSize = 32;
  let gesture: { pointer: number; start: { x: number; y: number }; box?: BoundingBox; resize: boolean; draft: HTMLElement; points: { x: number; y: number }[] } | null = null;
  function button(label: string, id: string, action: () => void) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.id = id;
    b.addEventListener('click', action); toolbar.append(b); return b;
  }
  const selectButton = button('Select', 'toolSelect', () => setTool('select'));
  const rectButton = document.getElementById('btnDraw') as HTMLButtonElement;
  toolbar.append(rectButton); rectButton.textContent = 'Shape';
  rectButton.onclick = () => setTool(tool === 'rectangle' || tool === 'ellipse' ? 'select' : 'rectangle');
  const ellipseButton = button('Ellipse', 'toolEllipse', () => setTool('ellipse'));
  ellipseButton.hidden = true;
  const shapeSettings = document.createElement('label'); shapeSettings.className = 'shape-settings'; shapeSettings.textContent = 'Shape';
  const shapeKind = document.createElement('select'); shapeKind.id = 'shapeKind'; shapeKind.setAttribute('aria-label', 'Mask shape');
  for (const value of ['rectangle', 'ellipse']) { const option = document.createElement('option'); option.value = value; option.textContent = value; shapeKind.append(option); }
  shapeKind.onchange = () => setTool(shapeKind.value as 'rectangle' | 'ellipse'); shapeSettings.append(shapeKind); toolbar.append(shapeSettings);
  // Keyboard alternative to dragging: create a mask, then edit its numeric bounds.
  const addShape = button('Add centered mask', 'addShape', () => {
    const state = access.page(), canvas = access.canvas(); if (!state || !canvas) return;
    const width = Math.max(1, Math.floor(canvas.width / 4)), height = Math.max(1, Math.floor(canvas.height / 4));
    selected = state.add({ type: 'manual', shape: tool === 'ellipse' ? 'ellipse' : 'rectangle', bbox: { x: Math.floor((canvas.width - width) / 2), y: Math.floor((canvas.height - height) / 2), width, height } });
    advancedOpen = true; committed(); panel.classList.add('sheet-open'); document.getElementById('region-width')?.focus();
  });
  const brushButton = button('Brush', 'toolBrush', () => setTool('brush'));
  const eraserButton = button('Mask eraser', 'toolEraser', () => setTool('eraser'));
  const brushSettings = document.createElement('label'); brushSettings.className = 'brush-settings'; brushSettings.textContent = 'Brush size';
  const size = document.createElement('input'); size.type = 'range'; size.min = '2'; size.max = '200'; size.value = String(brushSize); size.id = 'brushSize'; size.setAttribute('aria-label', 'Brush size in document pixels');
  const sizeValue = document.createElement('output'); sizeValue.textContent = `${brushSize}px`;
  size.oninput = () => { brushSize = Number(size.value); sizeValue.textContent = `${brushSize}px`; };
  brushSettings.append(size, sizeValue); toolbar.append(brushSettings);
  const cursor = document.createElement('div'); cursor.className = 'brush-cursor'; cursor.hidden = true; overlay.append(cursor);
  const undo = button('Undo', 'editorUndo', () => { access.page()?.undo(); committed(); });
  const redo = button('Redo', 'editorRedo', () => { access.page()?.redo(); committed(); });
  function setTool(value: typeof tool) {
    cancel(); tool = value;
    for (const [b, active] of [[selectButton, tool === 'select'], [rectButton, tool === 'rectangle' || tool === 'ellipse'], [ellipseButton, tool === 'ellipse'], [brushButton, tool === 'brush'], [eraserButton, tool === 'eraser']] as const) b.setAttribute('aria-pressed', String(active));
    brushSettings.hidden = tool !== 'brush' && tool !== 'eraser';
    shapeSettings.hidden = tool !== 'rectangle' && tool !== 'ellipse';
    addShape.hidden = shapeSettings.hidden;
    if (!shapeSettings.hidden) shapeKind.value = tool;
    eraserButton.hidden = tool !== 'brush' && tool !== 'eraser' && access.page()?.regions().find(r => r.id === selected)?.shape !== 'brush';
    container.style.touchAction = tool === 'select' ? 'pan-y' : 'none';
    overlay.classList.toggle('drawing', tool !== 'select');
  }
  function committed() { access.changed(); refresh(); }
  function setCustomization(enabled: boolean) {
    customizing = enabled; toolbar.hidden = !enabled;
    document.body.classList.toggle('editing-active', enabled);
    // Review outlines are keyboard buttons; editing exposes separate delete
    // controls and the accessible region list, without nested button roles.
    for (const box of overlay.querySelectorAll<HTMLElement>('.detection-box[data-region-id]')) {
      if (enabled) { box.removeAttribute('role'); box.removeAttribute('tabindex'); }
      else { box.setAttribute('role', 'button'); box.tabIndex = 0; }
      for (const control of box.querySelectorAll<HTMLButtonElement>('.detection-box-del')) control.hidden = !enabled;
    }
    if (!enabled) setTool('select');
    const toggle = document.getElementById('customize');
    toggle?.setAttribute('aria-expanded', String(enabled));
    if (toggle) toggle.textContent = enabled ? 'Done customizing' : 'Customize';
  }
  function select(id: string) {
    selected = id; refresh();
    panel.classList.add('sheet-open');
    document.getElementById('regionKeep')?.focus({ preventScroll: true });
  }
  function refresh() {
    const focusedId = content.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
    const state = access.page(); const regions = state?.regions() ?? [];
    eraserButton.hidden = tool !== 'brush' && tool !== 'eraser' && regions.find(r => r.id === selected)?.shape !== 'brush';
    if (!regions.some(r => r.id === selected)) selected = null;
    undo.disabled = !state?.canUndo; redo.disabled = !state?.canRedo;
    access.render(selected);
    content.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = selected ? 'Selected cover' : 'Review regions'; content.append(heading);
    const summary = document.createElement('p'); summary.className = 'region-summary'; summary.textContent = `${regions.filter(r => r.included).length} included / ${regions.length} suggestions and manual masks`; content.append(summary);
    const browser = document.createElement('details'); browser.className = 'region-browser'; browser.open = listOpen;
    const title = document.createElement('summary'); title.textContent = `All regions (${regions.length})`; browser.append(title);
    browser.ontoggle = () => { if (browser.isConnected) listOpen = browser.open; };
    const list = document.createElement('div'); list.className = 'region-list'; browser.append(list); content.append(browser);
    const counts: Record<string, number> = {};
    for (const r of regions) {
      const ordinal = counts[r.type] = (counts[r.type] ?? 0) + 1;
      const name = `${r.type[0].toUpperCase()}${r.type.slice(1)} ${ordinal}, page ${access.pageNumber()}`;
      const row = document.createElement('div'); row.className = 'region-row';
      const b = document.createElement('button'); b.textContent = name; b.id = `select-${r.id}`; b.setAttribute('aria-pressed', String(selected === r.id)); b.onclick = () => select(r.id);
      const include = document.createElement('input'); include.type = 'checkbox'; include.id = `include-${r.id}`; include.checked = r.included; include.setAttribute('aria-label', `Redact ${name}`);
      include.onchange = () => { state!.update(r.id, { included: include.checked }); selected = r.id; committed(); document.getElementById(include.id)?.focus(); };
      row.append(include, b); list.append(row);
    }
    const region = regions.find(r => r.id === selected); if (!region || !state) { if (focusedId) document.getElementById(focusedId)?.focus(); return; }
    const properties = document.createElement('fieldset'); properties.className = 'region-properties'; content.append(properties);
    const legend = document.createElement('legend'); legend.textContent = 'Selected region'; properties.append(legend);
    const keep = document.createElement('button'); keep.type = 'button'; keep.id = 'regionKeep'; keep.className = 'region-keep';
    keep.textContent = region.included ? 'Keep visible' : region.type === 'face' ? 'Cover this face' : 'Cover this area';
    keep.onclick = () => { state.update(region.id, { included: !region.included }); committed(); document.getElementById('regionKeep')?.focus(); }; properties.append(keep);
    const styleLabel = document.createElement('label'); styleLabel.textContent = 'Cover style'; styleLabel.className = 'style-control';
    const style = document.createElement('select'); style.id = 'regionStyle'; style.setAttribute('aria-label', 'Concealment style');
    for (const [value, text] of [['solid', 'Secure Solid'], ['gradient', 'Secure Gradient'], ['soft', 'Soft Conceal · opaque cover'], ['mosaic', 'Mosaic · cosmetic only'], ['blur', 'Portrait Blur · cosmetic only']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; style.append(option);
    }
    style.value = region.style ?? 'solid'; style.onchange = () => { state.update(region.id, { style: style.value as Detection['style'], color: style.value === 'soft' ? '#c99a78' : region.color }); committed(); };
    styleLabel.append(style); properties.append(styleLabel);
    const assurance = document.createElement('p'); assurance.className = 'style-assurance';
    assurance.textContent = region.style === 'mosaic' || region.style === 'blur' ? 'Cosmetic only: original information remains. Use Secure Solid for private text.' : region.style === 'soft' ? 'Replaces the covered pixels. Cover all facial features; hair and clothing can still identify someone. Adjust complex edges by hand.' : 'Covered pixels are replaced. Check the edges for anything missed.';
    properties.append(assurance);
    if (region.style !== 'mosaic' && region.style !== 'blur') {
      const colorLabel = document.createElement('label'); colorLabel.textContent = 'Mask color';
      const color = document.createElement('input'); color.type = 'color'; color.value = region.color ?? (region.style === 'soft' ? '#c99a78' : '#000000'); color.id = 'regionColor';
      color.onchange = () => { state.update(region.id, { color: color.value }); committed(); }; colorLabel.append(color); properties.append(colorLabel);
    }
    const adjust = document.createElement('button'); adjust.type = 'button'; adjust.textContent = 'Adjust area'; adjust.className = 'adjust-area';
    adjust.onclick = () => {
      setCustomization(true); setTool('select');
      panel.classList.remove('sheet-open');
      container.scrollIntoView({ block: 'nearest' }); selectButton.focus();
    };
    properties.append(adjust);
    const advanced = document.createElement('details'); advanced.id = 'regionAdvanced'; advanced.open = advancedOpen;
    const advancedTitle = document.createElement('summary'); advancedTitle.textContent = 'Advanced details';
    const geometry = document.createElement('div'); geometry.className = 'region-geometry';
    const adjustHelp = document.createElement('p'); adjustHelp.textContent = 'Drag the selected outline to move it, or its corner to resize. You can also enter exact sizes below.';
    advanced.append(advancedTitle, adjustHelp, geometry); properties.append(advanced);
    advanced.ontoggle = () => { if (advanced.isConnected) advancedOpen = advanced.open; };
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      const label = document.createElement('label'); label.textContent = key;
      const input = document.createElement('input'); input.type = 'number'; input.step = '1'; input.min = '0'; input.value = String(Math.round(region.bbox[key])); input.id = `region-${key}`;
      input.onchange = () => {
        try { state.update(region.id, { bbox: { ...region.bbox, [key]: Number(input.value) } }); committed(); }
        catch { input.setCustomValidity('Keep the region inside the page.'); input.reportValidity(); }
      };
      label.append(input); geometry.append(label);
    }
    if (region.type === 'manual') {
      const remove = document.createElement('button'); remove.textContent = 'Delete manual mask'; remove.onclick = () => { state.remove(region.id); committed(); }; properties.append(remove);
    }
    content.insertBefore(properties, browser);
    if (focusedId) document.getElementById(focusedId)?.focus();
  }
  function point(e: PointerEvent) {
    const canvas = access.canvas()!;
    return pointToCanvas(e.clientX, e.clientY, overlay.getBoundingClientRect(), canvas.width, canvas.height);
  }
  function cancel() {
    const pending = gesture; gesture = null; pending?.draft.remove(); cursor.hidden = true;
    if (pending && container.hasPointerCapture(pending.pointer)) container.releasePointerCapture(pending.pointer);
  }
  container.addEventListener('pointerdown', e => {
    // Review taps select a region, while scroll/drag cannot silently move it.
    // Adjust area or Customize explicitly enables editing gestures.
    if (tool === 'select' && !customizing) return;
    if (!access.page() || !access.canvas() || e.button !== 0 || gesture || (e.target as HTMLElement).closest('button')) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-region-id]');
    if (tool === 'select') {
      if (!target) { selected = null; refresh(); return; }
      selected = target.dataset.regionId!; refresh();
    }
    if (tool === 'eraser' && access.page()!.regions().find(r => r.id === selected)?.shape !== 'brush') {
      const note = document.createElement('p'); note.textContent = 'Select a brush mask in Regions to erase part of it.'; panel.append(note); return;
    }
    const region = tool === 'select' ? access.page()!.regions().find(r => r.id === selected) : undefined;
    const draft = document.createElement('div'); draft.className = 'detection-box draft'; overlay.append(draft);
    if (tool === 'brush' || tool === 'eraser') {
      draft.className = 'brush-draft';
      const c = access.canvas()!;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${c.width} ${c.height}`);
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('fill', 'none'); path.setAttribute('stroke', tool === 'brush' ? '#000' : '#ff8a65');
      path.setAttribute('stroke-width', String(brushSize)); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
      svg.append(path); draft.append(svg);
    }
    gesture = { pointer: e.pointerId, start: point(e), box: region?.bbox, resize: (e.target as HTMLElement).classList.contains('resize-handle'), draft, points: [point(e)] };
    container.setPointerCapture(e.pointerId); e.preventDefault();
  });
  function bounds(e: PointerEvent): BoundingBox {
    const p = point(e), g = gesture!;
    if (g.box) {
      const c = access.canvas()!, dx = p.x - g.start.x, dy = p.y - g.start.y;
      if (g.resize) return { ...g.box, width: Math.max(1, Math.min(c.width - g.box.x, g.box.width + dx)), height: Math.max(1, Math.min(c.height - g.box.y, g.box.height + dy)) };
      return { ...g.box, x: Math.max(0, Math.min(c.width - g.box.width, g.box.x + dx)), y: Math.max(0, Math.min(c.height - g.box.height, g.box.y + dy)) };
    }
    return { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) };
  }
  container.addEventListener('pointermove', e => {
    if (tool === 'brush' || tool === 'eraser') {
      const c = access.canvas(); if (!c) return;
      const p = point(e); cursor.hidden = false;
      Object.assign(cursor.style, { left: `${100 * p.x / c.width}%`, top: `${100 * p.y / c.height}%`, width: `${100 * brushSize / c.width}%`, height: `${100 * brushSize / c.height}%` });
      if (!cursor.isConnected) overlay.append(cursor);
    } else cursor.hidden = true;
    if (!gesture || e.pointerId !== gesture.pointer) return;
    if (tool === 'brush' || tool === 'eraser') {
      const p = point(e); const previous = gesture.points.at(-1)!;
      if (Math.hypot(p.x - previous.x, p.y - previous.y) > .5) gesture.points.push(p);
      gesture.draft.querySelector('path')?.setAttribute('d', gesture.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' '));
      return;
    }
    const b = bounds(e), c = access.canvas()!;
    Object.assign(gesture.draft.style, { left: `${100 * b.x / c.width}%`, top: `${100 * b.y / c.height}%`, width: `${100 * b.width / c.width}%`, height: `${100 * b.height / c.height}%`, borderRadius: tool === 'ellipse' ? '50%' : '4px' });
  });
  container.addEventListener('pointerup', e => {
    if (!gesture || e.pointerId !== gesture.pointer) return;
    const b = bounds(e), g = gesture; cancel();
    const state = access.page()!;
    if (tool === 'brush' || tool === 'eraser') {
      g.points.push(point(e));
      const stroke = { points: g.points, size: brushSize, erase: tool === 'eraser' };
      if (tool === 'eraser' && selected) {
        const region = state.regions().find(r => r.id === selected)!;
        state.update(selected, { strokes: [...(region.strokes ?? []), stroke] });
      } else {
        const c = access.canvas()!;
        const xs = g.points.map(p => p.x), ys = g.points.map(p => p.y);
        const x = Math.max(0, Math.min(...xs) - brushSize / 2), y = Math.max(0, Math.min(...ys) - brushSize / 2);
        const right = Math.min(c.width, Math.max(...xs) + brushSize / 2), bottom = Math.min(c.height, Math.max(...ys) + brushSize / 2);
        selected = state.add({ type: 'manual', shape: 'brush', bbox: { x, y, width: right - x, height: bottom - y }, strokes: [stroke] });
      }
    } else if (g.box && selected) {
      if ((['x', 'y', 'width', 'height'] as const).every(key => Math.abs(b[key] - g.box![key]) < .01)) { select(selected); return; }
      state.update(selected, { bbox: b });
    }
    else if (b.width >= 2 && b.height >= 2) selected = state.add({ type: 'manual', bbox: b, shape: tool === 'ellipse' ? 'ellipse' : 'rectangle' });
    else return;
    committed();
  });
  container.addEventListener('pointercancel', cancel);
  container.addEventListener('lostpointercapture', cancel);
  container.addEventListener('pointerleave', () => { cursor.hidden = true; });
  setTool('select');
  return { refresh, cancel, select, setCustomization,
    showList: () => { listOpen = true; panel.classList.add('sheet-open'); refresh(); content.querySelector<HTMLElement>('.region-browser summary')?.focus(); }, isCustomizing: () => customizing,
    reset: () => { cancel(); selected = null; advancedOpen = false; listOpen = false; panel.classList.remove('sheet-open'); setCustomization(false); } };
}
