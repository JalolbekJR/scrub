import { expect, it } from 'vitest';
import { recognitionScore, sourceWord, type QuarterTurn } from './ocr-orientation';
import { matchPii } from './pii-match';

it.each([0, 1, 2, 3] as QuarterTurn[])('remaps quarter-turn %i word edges to the original non-square raster', turn => {
  const boxes = [{ x0: 10, y0: 20, x1: 70, y1: 40 }, { x0: 40, y0: 10, x1: 60, y1: 70 }, { x0: 130, y0: 40, x1: 190, y1: 60 }, { x0: 20, y0: 130, x1: 40, y1: 190 }];
  expect(sourceWord({ text: 'test', bbox: boxes[turn] }, turn, 200, 80).bbox).toEqual(boxes[0]);
});
it('scores recognition confidence by character count, ignoring missing confidence', () => {
  expect(recognitionScore([])).toBe(0);
  expect(recognitionScore([{ text: 'x', confidence: 10 }, { text: 'abc', confidence: 90 }])).toBe(70);
  expect(recognitionScore([{ text: 'x' }])).toBe(0);
});
it.each([1, 2, 3] as QuarterTurn[])('preserves split-token reading order after quarter-turn %i remapping', turn => {
  const tokens = ['alice', '@', 'example', '.', 'com'];
  const words = tokens.map((text, order) => sourceWord({ text, order, line: 0, bbox: { x0: 10 + order * 20, y0: 10, x1: 25 + order * 20, y1: 20 } }, turn, 200, 200));
  expect(matchPii(words).map(d => d.type)).toEqual(['email']);
});

it('does not join actual separate lines or guess ambiguous OCR digits', () => {
  const word = (text: string, line: number) => ({ text, line, order: line, bbox: { x0: 10, y0: 10, x1: 120, y1: 30 } });
  expect(matchPii([word('alice @', 0), word('example.com', 1)])).toEqual([]);
  expect(matchPii([word('4I11 1111 1111 1111', 0)]).some(d => d.type === 'card')).toBe(false);
  expect(matchPii([word('+998 (90) 123-45-67', 0)]).map(d => d.type)).toEqual(['phone']);
});
