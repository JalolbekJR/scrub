import type { Detection, BoundingBox } from './types';

export interface EditorRegion extends Detection {
  id: string;
  included: boolean;
}
interface Change { id: string; before?: EditorRegion; after?: EditorRegion; }

// History stores region instructions, never a copy of the page's pixels.
export class EditorPage {
  private items = new Map<string, EditorRegion>();
  private initial: Detection[];
  private past: Change[][] = [];
  private future: Change[][] = [];
  private nextId = 0;
  status: 'reviewed' | 'failed' = 'reviewed';
  readonly key: string;
  readonly width: number;
  readonly height: number;
  constructor(key: string, width: number, height: number, suggestions: Detection[]) {
    this.key = key; this.width = width; this.height = height;
    this.initial = structuredClone(suggestions);
    for (const suggestion of suggestions) {
      const region = this.create(suggestion); this.items.set(region.id, region);
    }
  }
  private validate(box: BoundingBox) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0
      || box.x < 0 || box.y < 0 || box.x + box.width > this.width + .001 || box.y + box.height > this.height + .001) {
      throw new Error('Region must be inside the page with finite positive dimensions');
    }
  }
  private create(detection: Detection): EditorRegion {
    this.validate(detection.bbox);
    return { ...structuredClone(detection), id: `${this.key}:${++this.nextId}`, included: detection.included ?? true };
  }
  regions(): EditorRegion[] { return structuredClone([...this.items.values()]); }
  suggestions(): Detection[] { return structuredClone(this.initial); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get edited() { return this.past.length > 0; }
  private apply(changes: Change[], forward: boolean) {
    for (const change of changes) {
      const value = forward ? change.after : change.before;
      if (value) this.items.set(change.id, structuredClone(value)); else this.items.delete(change.id);
    }
  }
  private commit(changes: Change[]) {
    if (!changes.length) return;
    this.apply(changes, true); this.past.push(structuredClone(changes)); this.future = [];
  }
  add(detection: Detection): string {
    const region = this.create(detection);
    this.commit([{ id: region.id, after: region }]); return region.id;
  }
  update(id: string, patch: Partial<Omit<EditorRegion, 'id' | 'type'>>) {
    const before = this.items.get(id); if (!before) throw new Error('Unknown region');
    const after = { ...structuredClone(before), ...structuredClone(patch), id };
    if (patch.bbox && before.shape === 'brush' && before.strokes && !patch.strokes) {
      const next = patch.bbox, old = before.bbox;
      after.strokes = before.strokes.map(stroke => ({ ...stroke,
        size: stroke.size * Math.min(next.width / old.width, next.height / old.height),
        points: stroke.points.map(p => ({ x: next.x + (p.x - old.x) * next.width / old.width, y: next.y + (p.y - old.y) * next.height / old.height })),
      }));
    }
    this.validate(after.bbox);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.commit([{ id, before, after }]);
  }
  bulk(predicate: (region: EditorRegion) => boolean, included: boolean) {
    this.commit([...this.items.values()].filter(r => predicate(r) && r.included !== included)
      .map(before => ({ id: before.id, before, after: { ...before, included } })));
  }
  remove(id: string) {
    const before = this.items.get(id); if (!before) return;
    if (before.type !== 'manual') { this.update(id, { included: false }); return; }
    this.commit([{ id, before }]);
  }
  undo() { const command = this.past.pop(); if (command) { this.apply(command, false); this.future.push(command); } }
  redo() { const command = this.future.pop(); if (command) { this.apply(command, true); this.past.push(command); } }
}

export class EditorDocument {
  readonly pages = new Map<number, EditorPage>();
  activePage = 1;
  readonly failedPages = new Set<number>();
  readonly id: string;
  constructor(id: string) { this.id = id; }
  reviewPage(page: number, width: number, height: number, suggestions: Detection[]): EditorPage {
    let state = this.pages.get(page);
    if (state && (state.width !== width || state.height !== height)) throw new Error('Page dimensions changed');
    if (!state) { state = new EditorPage(`${this.id}:page-${page}`, width, height, suggestions); this.pages.set(page, state); }
    this.failedPages.delete(page); state.status = 'reviewed';
    this.activePage = page; return state;
  }
}
