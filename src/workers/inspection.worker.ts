import type { ForensicReport } from '../forensics';
import { inspectOriginalFile } from '../original-inspection';

self.onmessage = async (event: MessageEvent<File>) => {
  let report: ForensicReport;
  try { report = await inspectOriginalFile(event.data); }
  catch { report = { findings: [], metaFieldCount: 0, trailingBytes: 0, inspectionFailed: true, checks: ['Scan failed: image inspection could not complete'] }; }
  // Report categories only; no decoded private values or parser exceptions.
  self.postMessage(report);
};
