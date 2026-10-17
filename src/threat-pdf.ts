import type { Finding } from './forensics';
import { inspectText, inspectLink } from './threat-text';
import { LIMITS } from './validate';

// Supplement public PDF.js APIs for Launch/AA names they do not expose.
// Inspect only bounded uncompressed dictionaries, skipping strings and streams.
export function pdfDictionaryIndicators(bytes: Uint8Array): Set<string> {
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 256 * 1024));
  const result = new Set<string>(); let p = 0, depth = 0, previous = '';
  while (p < text.length) {
    if (text[p] === '%') { while (p < text.length && text[p] !== '\n' && text[p] !== '\r') p++; continue; }
    if (text[p] === '(') { let nest = 1; p++; while (p < text.length && nest) { if (text[p] === '\\') p += 2; else { if (text[p] === '(') nest++; if (text[p] === ')') nest--; p++; } } previous = ''; continue; }
    if (text.slice(p, p + 2) === '<<') { depth++; p += 2; previous = ''; continue; }
    if (text.slice(p, p + 2) === '>>') { depth--; p += 2; previous = ''; continue; }
    if (text[p] === '<') { p++; while (p < text.length && text[p] !== '>') p++; p++; previous = ''; continue; }
    if (text.slice(p, p + 6) === 'stream' && /\s/.test(text[p + 6] ?? '')) { const end = text.indexOf('endstream', p + 6); p = end < 0 ? text.length : end + 9; previous = ''; continue; }
    if (text[p] === '/') {
      const start = ++p; while (p < text.length && !/[\s<>()[\]{}/%]/.test(text[p])) p++;
      const name = text.slice(start, p).replace(/#([a-f\d]{2})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
      if (depth > 0 && previous === 'S' && name === 'Launch') result.add('Launch');
      if (depth > 0 && name === 'AA') result.add('AA');
      previous = name; continue;
    }
    if (!/\s/.test(text[p])) previous = '';
    p++;
  }
  return result;
}

export async function inspectPdf(bytes: Uint8Array): Promise<{ findings: Finding[]; incomplete: boolean; failure?: string }> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  if (typeof window !== 'undefined') GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;
  const options = { data: bytes.slice(), isEvalSupported: false, disableAutoFetch: true, disableStream: true, verbosity: 0 };
  const task = getDocument(options);
  const findings: Finding[] = []; let expired = false, incomplete = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; void task.destroy(); reject(new Error('PDF inspection timed out')); }, 15000); });
  const add = (label: string, risk: string, source = 'PDF catalog', location?: Finding['location']) => findings.push({ label, risk, source, location, evidence: 'structural', category: 'threat', severity: 'high', sanitization: 'removed' });
  try {
    return await Promise.race([timeout, (async () => {
      const doc = await task.promise;
      const indicators = pdfDictionaryIndicators(bytes);
      for (const indicator of indicators) findings.push({ label: indicator === 'Launch' ? 'PDF Launch action dictionary' : 'PDF additional-action entry', risk: 'A supported uncompressed PDF dictionary contains this action entry. Whether it is reachable or malicious is not established; nothing is executed.', category: 'threat', severity: 'medium', evidence: 'indicator', source: 'PDF dictionary scan', sanitization: 'removed' });
      const { info, metadata } = await doc.getMetadata();
      for (const key of ['Author', 'Title', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate']) {
        const value = (info as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.trim()) {
          findings.push({ label: 'PDF descriptive or identifying metadata', risk: 'Supported PDF fields contain identity, descriptive, software or timestamp information. Source values are kept private and not copied into reconstructed exports; the exporter creates its own technical fields.', category: 'other', severity: 'low', evidence: 'structural', source: 'PDF metadata', sanitization: 'removed' });
          findings.push(...inspectText(value, 'PDF metadata'));
        }
      }
      if (metadata) findings.push(...inspectText(metadata.getRaw(), 'PDF metadata'));
      if ((await doc.getAttachments())?.size) add('PDF embedded attachments', 'The PDF attachment tree references embedded files. They are not opened or expanded. Reconstructed export omits them.');
      const js = await doc.getJSActions();
      if (js?.size) add('PDF JavaScript actions', 'The parser found PDF JavaScript action entries. Presence does not prove malicious intent. No script is executed.');
      if (js?.has('OpenAction')) add('PDF automatic JavaScript action', 'The parser found an opening JavaScript action. It is not executed.');
      const open = await doc.getOpenAction();
      if (open && !open.has('dest')) add('PDF automatic action', 'The parser found an opening action rather than a page destination. It is not executed.');
      const limit = Math.min(doc.numPages, LIMITS.maxPdfPages);
      for (let p = 1; p <= limit; p++) {
        if (expired) throw new Error('PDF inspection timed out');
        const page = await doc.getPage(p), location = { page: p };
        if ((await page.getJSActions())?.size) add('PDF JavaScript actions', 'The parser found page JavaScript actions. No script is executed.', 'PDF page actions', location);
        const content = await page.getTextContent();
        if (content.items.length > 10000) incomplete = true;
        let remaining = 65536, joined = '';
        const textItems = content.items.slice(0, 10000).filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
        for (const item of textItems) {
          if (remaining <= 0) { incomplete = true; break; }
          const text = item.str.slice(0, remaining); if (text.length < item.str.length) incomplete = true;
          remaining -= text.length; joined += text + ' ';
          findings.push(...inspectText(text, 'PDF-visible text', { page: p, bbox: { x: item.transform[4], y: item.transform[5], width: item.width, height: item.height }, coordinates: 'pdf' }));
        }
        // Text items may split a single sentence; retain page reference for the joined pass.
        findings.push(...inspectText(joined, 'PDF-visible text', location));
        const annotations = await page.getAnnotations({ intent: 'any' });
        if (annotations.length > 10000) incomplete = true;
        for (const annotation of annotations.slice(0, 10000)) {
          const a = annotation as { unsafeUrl?: string; url?: string; rect?: number[]; attachment?: unknown; actions?: Record<string, unknown> };
          if (a.attachment) add('PDF embedded attachments', 'The parser found a file-attachment annotation. No attachment is opened.', 'PDF annotation', location);
          if (a.actions && (a.actions instanceof Map ? a.actions.size : Object.keys(a.actions).length)) add('PDF annotation actions', 'The parser found action entries on an annotation. They are not executed.', 'PDF annotation', location);
          const uri = a.unsafeUrl ?? a.url;
          if (uri) {
            const nearby = textItems.filter(i => a.rect && i.transform[4] >= a.rect[0] && i.transform[4] <= a.rect[2] && i.transform[5] >= a.rect[1] - i.height && i.transform[5] <= a.rect[3] + i.height).map(i => i.str).join(' ');
            const f = inspectLink(uri, 'PDF link annotation', location, nearby); if (f) findings.push(f);
          }
        }
        page.cleanup();
      }
      return { findings, incomplete: incomplete || doc.numPages > limit };
    })()]);
  } catch { return { findings, incomplete: true, failure: 'Scan failed: PDF parsing or inspection timeout' }; }
  finally { clearTimeout(timer!); await task.destroy(); }
}
