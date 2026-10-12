import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let changed: () => void, loaded: boolean, element: { textContent: string };
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); loaded = false; element = { textContent: '' };
  media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', { getElementById: () => element, hidden: false, body: { classList: { contains: () => loaded } }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { changed = callback; } observe() {} disconnect() {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('original ticker interaction', () => {
  it('types at 32ms, holds 2600ms, deletes two letters at 14ms and waits 320ms', async () => {
    const { initTicker } = await import('./ticker'); const dispose = initTicker();
    const first = 'Drop a photo or PDF. Scrub checks it right here.';
    expect(element.textContent).toBe('D'); vi.advanceTimersByTime(32); expect(element.textContent).toBe('Dr');
    vi.advanceTimersByTime((first.length - 2) * 32); expect(element.textContent).toBe(first);
    vi.advanceTimersByTime(2599); expect(element.textContent).toBe(first);
    vi.advanceTimersByTime(1); expect(element.textContent).toBe(first.slice(0, -2));
    vi.advanceTimersByTime(Math.ceil((first.length - 2) / 2) * 14); expect(element.textContent).toBe('');
    vi.advanceTimersByTime(319); expect(element.textContent).toBe(''); vi.advanceTimersByTime(1); expect(element.textContent).toBe('C'); dispose?.();
  });
  it('does not leave duplicate timers after initialization or disposal', async () => {
    const { initTicker } = await import('./ticker'); initTicker(); const dispose = initTicker();
    expect(vi.getTimerCount()).toBe(1); dispose?.(); expect(vi.getTimerCount()).toBe(0);
  });
  it('stops while editing and resumes without a stale callback', async () => {
    const { initTicker } = await import('./ticker'); const dispose = initTicker();
    loaded = true; changed(); vi.advanceTimersByTime(10000); expect(element.textContent).toBe('D'); expect(vi.getTimerCount()).toBe(0);
    loaded = false; changed(); vi.advanceTimersByTime(32); expect(element.textContent).toBe('Dr'); dispose?.();
  });
  it('uses an instructional static line for reduced motion', async () => {
    media.matches = true; const { initTicker } = await import('./ticker'); initTicker();
    expect(element.textContent).toBe('Drop a photo or PDF. Scrub checks it right here.'); expect(vi.getTimerCount()).toBe(0);
  });
});
