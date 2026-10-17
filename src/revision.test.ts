import { expect, it } from 'vitest';
import { DocumentRevision } from './revision';

it('rejects edits, page changes and prior document results without reusing revisions', () => {
  const state = new DocumentRevision(); state.newDocument();
  const original = state.token(); expect(state.matches(original)).toBe(true);
  state.change(); const edited = state.token();
  expect(state.matches(original)).toBe(false);
  expect(edited.revision).toBeGreaterThan(original.revision);
  state.newDocument(); expect(state.matches(edited)).toBe(false);
  expect(state.token().revision).toBeGreaterThan(edited.revision);
});
