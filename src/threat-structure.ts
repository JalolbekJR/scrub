export interface ByteRegion { start: number; end: number; source: string; text?: boolean; }
export interface ImageStructure { format: string; end: number; regions: ByteRegion[]; animated?: boolean; }
const ascii = (b: Uint8Array, p: number, n: number) => String.fromCharCode(...b.subarray(p, p + n));

// Walk containers; never interpret compressed pixels as executable text.
export function imageStructure(b: Uint8Array): ImageStructure {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength), regions: ByteRegion[] = [];
  const need = (p: number, n: number) => { if (p < 0 || n < 0 || p + n > b.length) throw new Error('Truncated image structure'); };
  const u32 = (p: number, le = true) => { need(p, 4); return view.getUint32(p, le); };
  let steps = 0;
  const step = () => { if (++steps > 10000) throw new Error('Container inspection budget exceeded'); };
  if (b[0] === 255 && b[1] === 216) {
    let p = 2, scan = false, frame = false;
    while (p < b.length) {
      step();
      need(p, 2); if (b[p++] !== 255) throw new Error('Invalid JPEG marker');
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 217) { if (!scan || !frame) throw new Error('Incomplete JPEG'); return { format: 'jpeg', end: p, regions }; }
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      need(p, 2); const size = view.getUint16(p); if (size < 2) throw new Error('Invalid JPEG segment'); need(p, size);
      if ((marker >= 224 && marker <= 239) || marker === 254) regions.push({ start: p + 2, end: p + size, source: 'JPEG metadata segment', text: marker === 254 });
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) frame = true;
      p += size;
      if (marker === 218) {
        scan = true;
        while (p < b.length) {
          if (b[p] !== 255) { p++; continue; }
          const q = p; while (b[p] === 255) p++;
          if (b[p] === 0 || (b[p] >= 208 && b[p] <= 215)) { p++; continue; }
          p = q; break;
        }
      }
    }
  } else if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') {
    let p = 8, header = false, pixels = false, animated = false;
    while (p < b.length) {
      step();
      const size = u32(p, false); need(p, size + 12); const type = ascii(b, p + 4, 4);
      if (!header && (type !== 'IHDR' || size !== 13)) throw new Error('Missing PNG header');
      header = true;
      let crc = 0xffffffff;
      for (let i = p + 4; i < p + 8 + size; i++) crc = CRC[(crc ^ b[i]) & 255] ^ (crc >>> 8);
      if (((crc ^ 0xffffffff) >>> 0) !== u32(p + 8 + size, false)) throw new Error('PNG checksum mismatch');
      if (type === 'IDAT') pixels = true;
      if (type === 'acTL' && size >= 8) animated = u32(p + 8, false) > 1;
      if (!['IHDR', 'IDAT', 'IEND', 'PLTE', 'tRNS'].includes(type)) regions.push({ start: p + 8, end: p + 8 + size, source: 'PNG ancillary chunk', text: type === 'tEXt' || type === 'iTXt' });
      p += size + 12;
      if (type === 'IEND') { if (size || !pixels) throw new Error('Incomplete PNG'); return { format: 'png', end: p, regions, animated }; }
    }
  } else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const end = u32(4) + 8; need(0, end); let p = 12, pixels = false, animated = false;
    while (p < end) {
      step();
      need(p, 8); const type = ascii(b, p, 4), size = u32(p + 4); const next = p + 8 + size + (size % 2);
      if (next > end) throw new Error('Invalid WEBP chunk');
      if (['VP8 ', 'VP8L', 'ANMF'].includes(type)) pixels = true;
      if (type === 'ANIM') animated = true;
      if (['EXIF', 'XMP ', 'ICCP'].includes(type)) regions.push({ start: p + 8, end: p + 8 + size, source: 'WEBP metadata chunk', text: type === 'XMP ' });
      p = next;
    }
    if (!pixels) throw new Error('Missing WEBP pixels'); return { format: 'webp', end, regions, animated };
  } else if (ascii(b, 0, 3) === 'GIF') {
    need(0, 13); let p = 13, pixels = 0;
    if (b[10] & 128) p += 3 * (1 << ((b[10] & 7) + 1));
    const blocks = () => { while (true) { step(); need(p, 1); const size = b[p++]; if (!size) return; need(p, size); p += size; } };
    while (p < b.length) {
      step();
      need(p, 1); const kind = b[p++];
      if (kind === 59) { if (!pixels) throw new Error('Empty GIF'); return { format: 'gif', end: p, regions, animated: pixels > 1 }; }
      if (kind === 33) { need(p, 1); const label = b[p++], start = p; blocks(); if (label === 254) regions.push({ start, end: p, source: 'GIF comment blocks', text: true }); }
      else if (kind === 44) { need(p, 9); const packed = b[p + 8]; p += 9; if (packed & 128) p += 3 * (1 << ((packed & 7) + 1)); need(p, 1); p++; blocks(); pixels++; }
      else throw new Error('Invalid GIF block');
    }
  } else if (ascii(b, 0, 2) === 'BM') {
    const end = u32(2), offset = u32(10), dib = u32(14);
    if (end < 26 || offset < 14 + dib || offset >= end) throw new Error('Invalid BMP offsets'); need(0, end);
    return { format: 'bmp', end, regions };
  }
  throw new Error('Unsupported or incomplete image structure');
}
const CRC = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function payloadIndicator(b: Uint8Array): 'ZIP structure' | 'archive signature' | 'executable header' | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (ascii(b, 0, 4) === 'PK\x03\x04') {
    // Validate end-directory offsets without expanding any archive member.
    for (let p = b.length - 22; p >= Math.max(0, b.length - 65557); p--) {
      if (ascii(b, p, 4) !== 'PK\x05\x06') continue;
      const count = v.getUint16(p + 10, true), size = v.getUint32(p + 12, true), offset = v.getUint32(p + 16, true);
      if (count > 0 && offset + size === p && ascii(b, offset, 4) === 'PK\x01\x02' && p + 22 + v.getUint16(p + 20, true) === b.length) return 'ZIP structure';
    }
    return 'archive signature';
  }
  if (ascii(b, 0, 6) === 'Rar!\x1a\x07' || ascii(b, 0, 6) === '7z\xbc\xaf\x27\x1c') return 'archive signature';
  if (b.length >= 52 && ascii(b, 0, 4) === '\x7fELF' && [1, 2].includes(b[4]) && [1, 2].includes(b[5])) return 'executable header';
  if (b.length >= 64 && ascii(b, 0, 2) === 'MZ') { const p = v.getUint32(60, true); if (p + 24 <= b.length && ascii(b, p, 4) === 'PE\0\0') return 'executable header'; }
  return undefined;
}

export function embeddedPayload(b: Uint8Array): ReturnType<typeof payloadIndicator> {
  // At most one candidate of each kind, so adversarial repeated signatures
  // cannot turn the bounded region scan into quadratic directory searches.
  for (const signature of [[80, 75, 3, 4], [82, 97, 114, 33], [55, 122, 188, 175], [127, 69, 76, 70], [77, 90]]) {
    outer: for (let i = 0; i <= b.length - signature.length; i++) {
      for (let n = 0; n < signature.length; n++) if (b[i + n] !== signature[n]) continue outer;
      const indicator = payloadIndicator(b.subarray(i)); if (indicator) return indicator; break;
    }
  }
  return undefined;
}
