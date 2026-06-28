import { describe, it, expect } from 'vitest';
import { exportBlockedBy } from './failclosed';
import type { DetectorHealth } from './types';

// These guard the fail-closed contract: a PDF page must never be exported when a
// detector that was supposed to run failed (model unavailable, OCR timeout/crash).
describe('exportBlockedBy — fail-closed export decision', () => {
  it('allows export when both detectors succeeded', () => {
    const health: DetectorHealth = { face: 'success', ocr: 'success' };
    expect(exportBlockedBy(health)).toBeNull();
  });

  it('allows export when detectors were not needed (disabled)', () => {
    const health: DetectorHealth = { face: 'disabled', ocr: 'disabled' };
    expect(exportBlockedBy(health)).toBeNull();
  });

  it('blocks export when face detection failed', () => {
    const health: DetectorHealth = { face: 'failed', ocr: 'success', failureMessage: 'Face detection failed: model unavailable' };
    expect(exportBlockedBy(health)).toContain('Face detection failed');
  });

  it('blocks export when OCR failed or timed out', () => {
    const health: DetectorHealth = { face: 'success', ocr: 'failed', failureMessage: 'OCR failed: OCR failed or timed out' };
    expect(exportBlockedBy(health)).toContain('OCR failed');
  });

  it('blocks export when a detector failed even if disabled siblings exist', () => {
    const health: DetectorHealth = { face: 'failed', ocr: 'disabled' };
    expect(exportBlockedBy(health)).not.toBeNull();
  });

  it('returns a generic reason when no message was provided', () => {
    const health: DetectorHealth = { face: 'failed', ocr: 'success' };
    expect(exportBlockedBy(health)).toBe('A required detector failed');
  });
});
