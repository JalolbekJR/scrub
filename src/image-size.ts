// Bounded header preflight, before browser pixel allocation. This is not a full
// codec validator: container integrity and actual decoding still must succeed.
export function rasterDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const need = (p: number, n: number) => { if (p < 0 || p + n > bytes.length) throw new Error('Image dimensions unavailable within header budget'); };
  const u16 = (p: number, little = false) => { need(p, 2); return view.getUint16(p, little); };
  const u32 = (p: number, little = false) => { need(p, 4); return view.getUint32(p, little); };
  const text = (p: number, n: number) => { need(p, n); return String.fromCharCode(...bytes.subarray(p, p + n)); };
  const u24 = (p: number) => { need(p, 3); return bytes[p] | bytes[p + 1] << 8 | bytes[p + 2] << 16; };
  if (text(0, 4) === '\x89PNG' && text(12, 4) === 'IHDR') return { width: u32(16), height: u32(20) };
  if (text(0, 3) === 'GIF') return { width: u16(6, true), height: u16(8, true) };
  if (text(0, 2) === 'BM') {
    const dib = u32(14, true);
    if (dib === 12) return { width: u16(18, true), height: u16(20, true) };
    if (dib >= 40) { need(18, 8); return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) }; }
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let p = 2;
    while (p < bytes.length) {
      need(p, 2); if (bytes[p++] !== 255) break;
      while (bytes[p] === 255) p++;
      need(p, 1); const marker = bytes[p++];
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (marker === 218 || marker === 217) break;
      const size = u16(p); if (size < 2) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (size < 8) break;
        return { width: u16(p + 5), height: u16(p + 3) };
      }
      need(p, size); p += size;
    }
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    let p = 12;
    while (p + 8 <= bytes.length) {
      const type = text(p, 4), size = u32(p + 4, true), data = p + 8;
      if (type === 'VP8X' && size >= 10) return { width: u24(data + 4) + 1, height: u24(data + 7) + 1 };
      if (type === 'VP8L' && size >= 5 && bytes[data] === 47) {
        const bits = u32(data + 1, true); return { width: (bits & 16383) + 1, height: ((bits >>> 14) & 16383) + 1 };
      }
      if (type === 'VP8 ' && size >= 10 && text(data + 3, 3) === '\x9d\x01\x2a') return { width: u16(data + 6, true) & 16383, height: u16(data + 8, true) & 16383 };
      need(data, size); p = data + size + size % 2;
    }
  }
  throw new Error('Image dimensions are malformed or outside the header inspection budget');
}
