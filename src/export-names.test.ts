import { expect, it } from 'vitest';
import { availableExportName } from './export-names';
it('keeps every ZIP entry when sanitized basenames collide', () => {
  expect(availableExportName('scrubbed-a.jpg', [])).toBe('scrubbed-a.jpg');
  expect(availableExportName('scrubbed-a.jpg', ['scrubbed-a.jpg', 'scrubbed-a-2.jpg'])).toBe('scrubbed-a-3.jpg');
  expect(availableExportName('scrubbed-a.pdf', ['scrubbed-a.jpg'])).toBe('scrubbed-a.pdf');
});
