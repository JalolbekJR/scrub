import type { ForensicReport } from './forensics';
import { inspectFile } from './forensics';
import { sniffKind } from './validate';

const failed = (reason: string): ForensicReport => ({ findings: [], metaFieldCount: 0, trailingBytes: 0, inspectionFailed: true, checks: [`Scan failed: ${reason}`] });

// A dedicated worker makes the deadline preemptive even during synchronous
// container/EXIF decoding. File cloning shares immutable Blob storage, not pixels.
export class ImageInspection {
  private pending = new Set<() => void>();
  private createWorker: () => Worker;
  private deadlineMs: number;
  constructor(createWorker = () => new Worker(new URL('./workers/inspection.worker.ts', import.meta.url), { type: 'module' }), deadlineMs = 15000) {
    this.createWorker = createWorker; this.deadlineMs = deadlineMs;
  }
  cancel() { for (const cancel of this.pending) cancel(); }
  inspect(file: File): Promise<ForensicReport> {
    return new Promise(resolve => {
      let worker: Worker;
      try { worker = this.createWorker(); } catch { resolve(failed('image inspection worker unavailable')); return; }
      let finished = false;
      const finish = (report: ForensicReport) => {
        if (finished) return;
        finished = true; clearTimeout(timer); this.pending.delete(cancel); worker.terminate(); resolve(report);
      };
      const cancel = () => finish(failed('image inspection cancelled'));
      const timer = setTimeout(() => finish(failed('image inspection timed out')), this.deadlineMs);
      this.pending.add(cancel);
      worker.onmessage = event => finish(event.data as ForensicReport);
      worker.onerror = event => { event.preventDefault(); finish(failed('image inspection worker failed')); };
      worker.onmessageerror = () => finish(failed('image inspection response could not be read'));
      try { worker.postMessage(file); } catch { finish(failed('image inspection could not start')); }
    });
  }
}

const images = new ImageInspection();
let generation = 0;
export function cancelOriginalInspection() { generation++; images.cancel(); }
export async function inspectOriginal(file: File): Promise<ForensicReport> {
  const current = generation;
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (current !== generation) return failed('original inspection cancelled');
  // PDF.js already parses in its own worker and has a destruction deadline.
  return sniffKind(header) === 'pdf' ? inspectFile(file) : images.inspect(file);
}
