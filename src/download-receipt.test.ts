import { afterEach, expect, it, vi } from 'vitest';
import { DownloadReceipt } from './download-receipt';
afterEach(() => vi.useRealTimers());
it('retains a retry only for a bounded completion window', () => {
 vi.useFakeTimers(); const expired = vi.fn(); const receipt = new DownloadReceipt(expired);
 const copy = { filename: 'scrubbed.jpg', blob: new Blob(['verified']) };
 receipt.keep(copy); expect(receipt.current()).toBe(copy);
 vi.advanceTimersByTime(299999); expect(receipt.current()).toBe(copy);
 vi.advanceTimersByTime(1); expect(receipt.current()).toBeNull(); expect(expired).toHaveBeenCalledOnce();
});
it('dismissal or a new session releases the previous output and timer', () => {
 vi.useFakeTimers(); const expired = vi.fn(); const receipt = new DownloadReceipt(expired);
 receipt.keep({ filename: 'old.pdf', blob: new Blob() }); receipt.clear();
 expect(receipt.current()).toBeNull(); vi.runAllTimers(); expect(expired).not.toHaveBeenCalled();
 receipt.keep({ filename: 'new.pdf', blob: new Blob() }); expect(receipt.current()?.filename).toBe('new.pdf'); receipt.clear();
});
