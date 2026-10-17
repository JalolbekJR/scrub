import { afterEach, expect, it, vi } from 'vitest';
import { enqueue, fileFinished, fileScanned, getBatchPhase, getBatchTotal, getCurrentScanResult, initQueue, resetQueue } from './queue';
afterEach(() => { resetQueue(); vi.useRealTimers(); });
it('home reset cancels a scheduled batch advance before a new upload', () => {
 vi.useFakeTimers(); const next = vi.fn(); initQueue(next, vi.fn(), vi.fn(), vi.fn());
 const first = new File([], 'first.jpg'), oldNext = new File([], 'old-next.jpg'), replacement = new File([], 'new.jpg');
 enqueue([first, oldNext]); fileScanned({ file: first } as never); resetQueue(); enqueue([replacement]);
 vi.advanceTimersByTime(1000); expect(next.mock.calls.map(call => call[0])).toEqual([first, replacement]);
 expect(getBatchPhase()).toBe('none'); expect(getBatchTotal()).toBe(0); expect(getCurrentScanResult()).toBeNull();
});
it('late completion notifications cannot revive a cleared batch', () => {
 const completed = vi.fn(); initQueue(vi.fn(), vi.fn(), completed, completed); resetQueue();
 fileScanned({ file: new File([], 'old.jpg') } as never); fileFinished();
 expect(completed).not.toHaveBeenCalled(); expect(getCurrentScanResult()).toBeNull();
});
