import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateFile } from './validate';
import { rasterDimensions } from './image-size';

describe('encoded raster allocation limits', () => {
  it.each(['black.jpg', 'black.png', 'orientation-6.jpg'])('reads real synthetic %s headers', name => {
    const dims = rasterDimensions(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
    expect(dims).toEqual(name === 'orientation-6.jpg' ? { width: 120, height: 80 } : { width: 2, height: 2 });
  });
  it('reads GIF and both BMP header layouts, including top-down BMP', () => {
    const gif = Uint8Array.from([71, 73, 70, 56, 57, 97, 100, 0, 80, 0]);
    expect(rasterDimensions(gif)).toEqual({ width: 100, height: 80 });
    const bmp = new Uint8Array(54), view = new DataView(bmp.buffer); bmp.set([66, 77]);
    view.setUint32(14, 40, true); view.setInt32(18, 100, true); view.setInt32(22, -80, true);
    expect(rasterDimensions(bmp)).toEqual({ width: 100, height: 80 });
    view.setUint32(14, 12, true); view.setUint16(18, 100, true); view.setUint16(20, 80, true);
    expect(rasterDimensions(bmp)).toEqual({ width: 100, height: 80 });
  });
  it.each(['VP8X', 'VP8L', 'VP8 '])('reads %s WEBP dimensions', type => {
    const b = new Uint8Array(30), v = new DataView(b.buffer);
    b.set(new TextEncoder().encode('RIFF')); b.set(new TextEncoder().encode('WEBP'), 8); b.set(new TextEncoder().encode(type), 12); v.setUint32(16, 10, true);
    if (type === 'VP8X') { b[24] = 99; b[27] = 79; }
    else if (type === 'VP8L') { b[20] = 47; v.setUint32(21, 99 | 79 << 14, true); }
    else { b.set([157, 1, 42], 23); v.setUint16(26, 100, true); v.setUint16(28, 80, true); }
    expect(rasterDimensions(b)).toEqual({ width: 100, height: 80 });
  });
  it('rejects missing, truncated and oversized JPEG segments without decoding', () => {
    for (const bytes of [new Uint8Array(), Uint8Array.from([255, 216, 255, 224, 255, 255])]) expect(() => rasterDimensions(bytes)).toThrow();
  });
  it('rejects huge PNG dimensions before invoking an image decoder', async () => {
    const bytes = readFileSync(new URL('../fixtures/black.png', import.meta.url));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(16, 50000); view.setUint32(20, 50000);
    // Header preflight precedes full-container checksum and pixel decoding.
    const result = await validateFile(new File([bytes], 'huge.png', { type: 'image/png' }));
    expect(result.ok).toBe(false); expect(result.reason).toContain('dimensions');
  });
  it('preserves a normal real image and rejects zero-sized dimensions', async () => {
    const bytes = readFileSync(new URL('../fixtures/black.png', import.meta.url));
    expect((await validateFile(new File([bytes], 'clean.png'))).ok).toBe(true);
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(16, 0);
    expect((await validateFile(new File([bytes], 'empty.png'))).ok).toBe(false);
  });
});
