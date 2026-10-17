import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  messages: unknown[] = [];
  terminated = false;
  constructor() { workers.push(this); }
  postMessage(data: unknown) { this.messages.push(data); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); workers.length = 0;
  vi.stubGlobal('document', { getElementById: () => ({ textContent: '' }) });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const image = () => new ImageData(new Uint8ClampedArray(4), 1, 1);

it('serializes concurrent OCR calls without overwriting response handlers', async () => {
  const { detectPii } = await import('./pii');
  const first = detectPii(image()); const second = detectPii(image());
  await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(1); expect(workers[0].messages).toHaveLength(1);
  workers[0].reply({ words: [], ms: 1 }); expect(await first).toEqual([]);
  await vi.advanceTimersByTimeAsync(0);
  expect(workers[0].messages).toHaveLength(2);
  workers[0].reply({ words: [], ms: 2 }); expect(await second).toEqual([]);
});

it('terminates timed-out OCR so a late result cannot satisfy the next request', async () => {
  const { detectPii } = await import('./pii');
  const first = detectPii(image()); const failure = expect(first).rejects.toThrow('OCR failed');
  await vi.advanceTimersByTimeAsync(60000); await failure;
  expect(workers[0].terminated).toBe(true);
  const next = detectPii(image()); await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(2);
  workers[0].reply({ words: [], ms: 1 });
  workers[1].reply({ words: [], ms: 2 }); expect(await next).toEqual([]);
});

it.each([{}, { words: [{ text: 'alice@example.com', bbox: { x0: NaN, y0: 0, x1: 10, y1: 10 } }], ms: 1 }])('rejects malformed OCR results', async reply => {
  const { detectPii } = await import('./pii');
  const result = detectPii(image()); const failure = expect(result).rejects.toThrow('OCR failed');
  await vi.advanceTimersByTimeAsync(0); workers[0].reply(reply); await failure;
  expect(workers[0].terminated).toBe(true);
});
