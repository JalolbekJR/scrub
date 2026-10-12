import { describe, expect, it } from 'vitest';
import { matchPii, type WordResult } from './pii-match';

function words(text: string): WordResult[] {
  let x = 0;
  return text.split(' ').map(text => {
    const x0 = x; x += text.length * 10 + 10;
    return { text, bbox: { x0, y0: 10, x1: x - 10, y1: 30 } };
  });
}

describe('PII matching with known OCR words', () => {
  it.each([
    ['alice @ example . com', 'email'],
    ['＋４４ (２０) ７９４６ ０９５８', 'phone'],
    ['+998 (90) 123-45-67', 'phone'],
    ['4111 1111 1111 1111', 'card'],
    ['4000000000000000006', 'card'],
    ['Dr. Élodie Durand', 'name'],
  ])('matches %s as %s without duplicates', (text, type) => {
    const result = matchPii(words(text));
    expect(result.map(d => d.type)).toEqual([type]);
    expect(result[0].bbox).toEqual({ x: 0, y: 10, width: text.normalize('NFKC').length * 10, height: 20 });
  });
  it.each(['Date: 2026-10-11', 'Order: 0000000000000000', 'Invalid: 4111 1111 1111 1112', 'Version 1.2.3456', 'Price: 123.4567'])('rejects %s', text => {
    expect(matchPii(words(text))).toEqual([]);
  });
  it('keeps distinct OCR lines separate even when their boxes overlap', () => {
    const a = words('alice@example.com').map(w => ({ ...w, line: 0 }));
    const b = words('bob@example.com').map(w => ({ ...w, line: 1 }));
    expect(matchPii([...a, ...b])).toHaveLength(2);
    const split = [...words('alice @').map(w => ({ ...w, line: 0 })), ...words('example.com').map(w => ({ ...w, line: 1 }))];
    expect(matchPii(split)).toEqual([]);
  });
});
