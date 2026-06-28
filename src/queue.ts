type QueueItem = File;

let q: QueueItem[] = [];
let active = false;
let onNext: ((file: File) => void) | null = null;
let onProgress: ((done: number, total: number) => void) | null = null;
let done = 0;
let total = 0;

export function isBatchActive(): boolean { return active; }
export function batchDone(): number { return done; }
export function batchTotal(): number { return total; }

export function initQueue(
  nextFn: (file: File) => void,
  progressFn: (done: number, total: number) => void,
) {
  onNext = nextFn;
  onProgress = progressFn;
}

export function enqueue(files: File[]) {
  if (files.length === 0) return;
  if (files.length === 1) {
    active = false;
    q = [];
    done = 0;
    total = 0;
    onNext?.(files[0]);
    return;
  }
  q = [...files];
  done = 0;
  total = files.length;
  active = true;
  onProgress?.(done, total);
  processNext();
}

export function processNext() {
  if (q.length === 0) {
    active = false;
    onProgress?.(done, total);
    return;
  }
  const file = q.shift()!;
  onNext?.(file);
}

export function fileFinished() {
  done++;
  onProgress?.(done, total);
  if (q.length > 0) {
    setTimeout(processNext, 600);
  } else {
    active = false;
  }
}
