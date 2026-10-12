import { afterEach, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { getElementById: () => ({}) });
const { triggerDownload } = await import('./export');
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('downloads a Blob normally without requesting a writable file', async () => {
  vi.useFakeTimers();
  const write = vi.fn(), picker = vi.fn(async () => ({ createWritable: write }));
  vi.stubGlobal('window', { showSaveFilePicker: picker });
  const anchor = { parentNode: {}, href: '', download: '', click: vi.fn(), remove: vi.fn() };
  const appendChild = vi.fn(), removeChild = vi.fn();
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild, removeChild } });
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:verified');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const blob = new Blob(['verified'], { type: 'image/jpeg' });
  expect(await triggerDownload('scrubbed.jpg', blob)).toBe(true);
  expect(picker).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  expect(create).toHaveBeenCalledWith(blob);
  expect(anchor.href).toBe('blob:verified'); expect(anchor.download).toBe('scrubbed.jpg');
  expect(anchor.click).toHaveBeenCalledOnce(); expect(removeChild).toHaveBeenCalledWith(anchor);
  expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60000); expect(revoke).toHaveBeenCalledWith('blob:verified');
});

it('blocks stale output before allocating a download URL', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  expect(await triggerDownload('scrubbed.pdf', new Blob(), () => false)).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

it.each(['invalidated', 'click failure'])('cleans up even after %s during initiation', async reason => {
  vi.useFakeTimers();
  const anchor = { parentNode: {}, click: vi.fn(() => { if (reason === 'click failure') throw new Error('blocked'); }) };
  const removeChild = vi.fn();
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn(), removeChild } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cancelled');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const current = vi.fn().mockReturnValueOnce(true).mockReturnValue(reason !== 'invalidated');
  const output = triggerDownload('scrubbed.jpg', new Blob(), current);
  if (reason === 'click failure') await expect(output).rejects.toThrow('blocked');
  else { expect(await output).toBe(false); expect(anchor.click).not.toHaveBeenCalled(); }
  expect(removeChild).toHaveBeenCalledWith(anchor);
  await vi.advanceTimersByTimeAsync(59999); expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(revoke).toHaveBeenCalledOnce();
});
