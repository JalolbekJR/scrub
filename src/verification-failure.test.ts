import { describe, expect, it, vi } from 'vitest';
import exifr from 'exifr';
import { readFileSync } from 'node:fs';

vi.mock('exifr', () => ({ default: { parse: vi.fn().mockRejectedValue(new Error('synthetic parser failure')) } }));

const { inspectFile, verifyClean } = await import('./forensics');

describe('fail-closed export verification', () => {
  it('bounds pending metadata inspection and reports a failed check', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(exifr.parse).mockImplementationOnce(() => new Promise(() => {}));
      const bytes = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
      const pending = inspectFile(new File([bytes], 'synthetic.jpg', { type: 'image/jpeg' }));
      await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(5001);
      const report = await pending;
      expect(report.inspectionFailed).toBe(true); expect(report.checks?.some(c => c.includes('timeout'))).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('does not treat metadata parser failure as a clean JPEG', async () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const result = await verifyClean(new Blob([jpegHeader], { type: 'image/jpeg' }));
    expect(result.clean).toBe(false);
  });

  it('reports input metadata inspection failure instead of claiming no hidden data', async () => {
    const input = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'synthetic.jpg', { type: 'image/jpeg' });
    const report = await inspectFile(input);
    expect(report.inspectionFailed).toBe(true);
    expect(report.metaFieldCount).toBe(0);
  });
});
