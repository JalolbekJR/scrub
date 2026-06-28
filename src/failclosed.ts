import type { DetectorHealth } from './types';

// Pure fail-closed decision: a page must not be exported if any detector that
// actually ran reported failure (model unavailable, OCR timeout/crash). Kept in
// its own DOM-free module so it can be unit-tested in a node environment.
export function exportBlockedBy(health: DetectorHealth): string | null {
  if (health.face === 'failed' || health.ocr === 'failed') {
    return health.failureMessage ?? 'A required detector failed';
  }
  return null;
}
