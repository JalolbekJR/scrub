import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageInspection } from './inspection-client';

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn(); postMessage = vi.fn();
}
afterEach(() => vi.useRealTimers());
describe('preemptive original image inspection', () => {
  it('terminates a blocked decoder at the deadline and fails closed', async () => {
    vi.useFakeTimers(); const worker = new FakeWorker();
    const client = new ImageInspection(() => worker as unknown as Worker, 100);
    const pending = client.inspect(new File(['synthetic'], 'test.jpg'));
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).inspectionFailed).toBe(true); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('cancels replaced input and ignores a late successful response', async () => {
    const worker = new FakeWorker(), client = new ImageInspection(() => worker as unknown as Worker);
    const pending = client.inspect(new File(['synthetic'], 'test.jpg')); client.cancel();
    worker.onmessage?.({ data: { inspectionFailed: false } });
    expect((await pending).checks).toEqual(['Scan failed: image inspection cancelled']); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('releases successful workers and reports startup/runtime failures', async () => {
    const worker = new FakeWorker(), client = new ImageInspection(() => worker as unknown as Worker);
    const pending = client.inspect(new File(['synthetic'], 'test.jpg'));
    worker.onmessage?.({ data: { findings: [], inspectionFailed: false } });
    expect((await pending).inspectionFailed).toBe(false); expect(worker.terminate).toHaveBeenCalledOnce();
    const broken = new ImageInspection(() => { throw new Error('private decoder details'); });
    expect(JSON.stringify(await broken.inspect(new File([], 'test.jpg')))).not.toContain('private decoder');
    const pendingError = client.inspect(new File([], 'test.jpg')); worker.onerror?.({ preventDefault() {} });
    expect((await pendingError).inspectionFailed).toBe(true);
  });
});
