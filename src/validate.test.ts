import { describe, it, expect } from 'vitest';
import { sniffKind, safeScale, LIMITS } from './validate';

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

describe('sniffKind — magic-byte detection', () => {
  it('recognises JPEG (FF D8 FF)', () => {
    expect(sniffKind(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image');
  });

  it('recognises PNG', () => {
    expect(sniffKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image');
  });

  it('recognises GIF', () => {
    expect(sniffKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe('image');
  });

  it('recognises BMP', () => {
    expect(sniffKind(bytes(0x42, 0x4d, 0x00, 0x00))).toBe('image');
  });

  it('recognises WEBP (RIFF....WEBP)', () => {
    expect(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe('image');
  });

  it('recognises PDF (%PDF-)', () => {
    expect(sniffKind(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34))).toBe('pdf');
  });

  it('rejects a spoofed file with no known signature', () => {
    // e.g. a renamed .exe / random bytes claiming to be an image
    expect(sniffKind(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });

  it('rejects an SVG / XML text header (no binary magic)', () => {
    // "<?xml" — not in the allow-list of binary signatures
    expect(sniffKind(bytes(0x3c, 0x3f, 0x78, 0x6d, 0x6c))).toBeNull();
  });
});

describe('safeScale — decompression-bomb clamping', () => {
  it('leaves normal images untouched', () => {
    expect(safeScale(1920, 1080)).toBe(1);
  });

  it('downscales images past the max dimension', () => {
    const s = safeScale(LIMITS.maxDim * 2, 1000);
    expect(s).toBeLessThan(1);
    expect((LIMITS.maxDim * 2) * s).toBeLessThanOrEqual(LIMITS.maxDim + 1);
  });

  it('downscales images past the pixel cap', () => {
    const side = Math.ceil(Math.sqrt(LIMITS.maxPixels)) + 2000;
    const s = safeScale(side, side);
    expect(s).toBeLessThan(1);
    expect(side * s * side * s).toBeLessThanOrEqual(LIMITS.maxPixels + 1_000_000);
  });

  it('handles degenerate input', () => {
    expect(safeScale(0, 0)).toBe(1);
  });
});
