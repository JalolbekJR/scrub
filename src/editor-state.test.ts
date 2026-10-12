import { expect, it } from 'vitest';
import { EditorDocument } from './editor-state';

it('keeps immutable suggestions and reversible page-specific commands across scans', () => {
  const doc = new EditorDocument('document-a');
  const suggestions = [{ type: 'face' as const, bbox: { x: 10, y: 20, width: 30, height: 40 } }];
  const page = doc.reviewPage(1, 100, 100, suggestions);
  suggestions[0].bbox.x = 999;
  const face = page.regions()[0];
  page.update(face.id, { included: false });
  expect(page.regions()[0].included).toBe(false);
  doc.reviewPage(2, 100, 100, []);
  expect(doc.reviewPage(1, 100, 100, suggestions)).toBe(page);
  expect(page.regions()[0].included).toBe(false);
  expect(page.suggestions()[0].bbox.x).toBe(10);
  page.undo(); expect(page.regions()[0].included).toBe(true);
  page.redo(); expect(page.regions()[0].included).toBe(false);
});

it('moving and resizing a brush mask transforms its instructions and undo restores them', () => {
  const page = new EditorDocument('brush').reviewPage(1, 100, 100, []);
  const id = page.add({ type: 'manual', shape: 'brush', bbox: { x: 10, y: 10, width: 20, height: 20 }, strokes: [{ points: [{ x: 20, y: 20 }], size: 10 }] });
  page.update(id, { bbox: { x: 30, y: 30, width: 40, height: 40 } });
  expect(page.regions()[0].strokes).toEqual([{ points: [{ x: 50, y: 50 }], size: 20 }]);
  page.undo(); expect(page.regions()[0].strokes).toEqual([{ points: [{ x: 20, y: 20 }], size: 10 }]);
});

it('records a completed geometry gesture once and clears redo on a new edit', () => {
  const page = new EditorDocument('a').reviewPage(1, 100, 100, []);
  const id = page.add({ type: 'manual', bbox: { x: 1, y: 2, width: 20, height: 30 } });
  page.update(id, { bbox: { x: 3, y: 4, width: 20, height: 30 } });
  page.undo(); expect(page.regions()[0].bbox.x).toBe(1);
  page.undo(); expect(page.regions()).toHaveLength(0);
  page.redo(); expect(page.regions()).toHaveLength(1);
  page.update(id, { included: false }); expect(page.canRedo).toBe(false);
  expect(() => page.update(id, { bbox: { x: NaN, y: 0, width: 1, height: 1 } })).toThrow();
  expect(() => page.update(id, { bbox: { x: 0, y: 0, width: 1000, height: 1 } })).toThrow();
});

it('selecting an unchanged region does not create a geometry undo command', () => {
  const page = new EditorDocument('selection').reviewPage(1, 100, 100, [{ type: 'face', bbox: { x: 10, y: 10, width: 20, height: 20 } }]);
  const region = page.regions()[0]; page.update(region.id, { bbox: region.bbox });
  expect(page.canUndo).toBe(false);
});
