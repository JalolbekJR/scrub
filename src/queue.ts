import type { ScanResult } from './types';

type BatchPhase = 'none' | 'scan' | 'redact';

let q: File[] = [];
let allFiles: File[] = [];
let batchPhase: BatchPhase = 'none';
let scanResults: ScanResult[] = [];
let redactIndex = 0;
let done = 0;
let total = 0;

let onNext:         ((file: File) => void) | null = null;
let onProgress:     ((done: number, total: number) => void) | null = null;
let onScanComplete: ((results: ScanResult[]) => void) | null = null;

export function getBatchPhase(): BatchPhase { return batchPhase; }
export function isBatchActive(): boolean { return batchPhase !== 'none'; }
export function getBatchTotal(): number { return total; }
export function getCurrentScanResult(): ScanResult | null { return scanResults[redactIndex] ?? null; }

export function initQueue(
  nextFn: (file: File) => void,
  progressFn: (done: number, total: number) => void,
  scanCompleteFn: (results: ScanResult[]) => void,
) {
  onNext = nextFn;
  onProgress = progressFn;
  onScanComplete = scanCompleteFn;
}

export function enqueue(files: File[]) {
  if (files.length === 0) return;
  if (files.length === 1) {
    batchPhase = 'none';
    q = []; allFiles = []; scanResults = [];
    done = 0; total = 0;
    onNext?.(files[0]);
    return;
  }
  allFiles = [...files];
  q = [...files];
  scanResults = [];
  done = 0;
  total = files.length;
  batchPhase = 'scan';
  onProgress?.(done, total);
  processNext();
}

export function fileScanned(result: ScanResult) {
  scanResults.push(result);
  done++;
  if (q.length > 0) {
    onProgress?.(done, total);
    setTimeout(processNext, 300);
  } else {
    onScanComplete?.(scanResults);
    batchPhase = 'none';
  }
}

export function startRedactPhase() {
  q = [...allFiles];
  done = 0;
  redactIndex = 0;
  batchPhase = 'redact';
  onProgress?.(done, total);
  processNext();
}

function processNext() {
  if (q.length === 0) {
    batchPhase = 'none';
    onProgress?.(done, total);
    return;
  }
  const file = q.shift()!;
  onNext?.(file);
}

export function fileFinished() {
  done++;
  redactIndex++;
  onProgress?.(done, total);
  if (q.length > 0) {
    setTimeout(processNext, 600);
  } else {
    batchPhase = 'none';
  }
}
