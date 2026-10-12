import type { Finding } from './forensics';
import type { WordResult } from './detectors/pii-match';

export function inspectText(input: string, source: string, location?: Finding['location']): Finding[] {
  const findings: Finding[] = [];
  let text = input.slice(0, 65536).normalize('NFKC').replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, '');
  let obscured = text !== input.slice(0, 65536);
  text = text.replace(/&#(?:x([a-f\d]{1,6})|(\d{1,7}));/gi, (_, hex, dec) => String.fromCodePoint(Math.min(0x10ffff, parseInt(hex ?? dec, hex ? 16 : 10))));
  try { const decoded = decodeURIComponent(text); obscured ||= decoded !== text; text = decoded; } catch { /* invalid percent escapes are not instructions */ }
  // Only explicitly marked bounded base64 text, never decode arbitrary pixels.
  text = text.replace(/base64[:\s]+([a-z\d+/=]{16,4096})/gi, (match, data: string) => {
    try { const decoded = atob(data); if ([...decoded].every(c => { const n = c.charCodeAt(0); return [9, 10, 13].includes(n) || (n >= 32 && n <= 126); })) { obscured = true; return decoded; } } catch { /* invalid encoding */ }
    return match;
  });
  const quoted = /\b(example|quoted?|article|cybersecurity|training|demonstration)\b/i.test(text);
  const manipulation = /\b(ignore|disregard|override)\s+(?:all\s+)?(?:previous|earlier|prior|system|developer)\s+(?:instructions|directions|messages|prompts)\b|\b(reveal|print|disclose)\s+(?:the\s+)?(?:hidden|system|developer)\s+prompts?\b|\[(?:system|developer)\]\s*[:\s]|\b(?:send|upload|transmit)\s+(?:the\s+)?(?:confidential|private|secret)\s+(?:data|files|information)\s+to\b/i.test(text);
  if (manipulation) findings.push({ label: 'Possible instruction manipulation', category: 'threat', severity: quoted ? 'low' : 'medium', evidence: 'indicator', source, location,
    risk: quoted ? 'AI-directed instructions appear in an example or quoted context. This may be educational content, not an attack.' : 'AI-directed override or disclosure wording was recognized. Intent depends on context; this is not proof of an attack.',
    sanitization: /metadata|chunk|comment|Appended/.test(source) ? 'removed' : 'manual', detail: obscured ? 'Normalized Unicode or encoded text matched a bounded instruction rule.' : 'A contextual instruction rule matched; private text is not displayed.' });
  for (const match of text.matchAll(/(?:https?:\/\/|javascript:|data:|file:|vbscript:|https?%3a)[^\s<>"']{1,2048}/gi)) {
    const finding = inspectLink(match[0], source, location); if (finding) findings.push(finding);
  }
  return findings;
}

export function inspectLink(destination: string, source: string, location?: Finding['location'], displayed?: string): Finding | undefined {
  let reason: string | undefined;
  const value = destination.slice(0, 4096).normalize('NFKC');
  if (/^(javascript|data|file|vbscript|shell|ms-[a-z-]+):/i.test(value)) reason = 'The destination uses an active or local-resource URI scheme.';
  else {
    try {
      const url = new URL(value);
      if (url.username || url.password) reason = 'The URL contains credentials before the actual destination host.';
      if (/^0x[\da-f]+$|^\d{8,}$|%[\da-f]{2}/i.test(value.replace(/^https?:\/\//i, '').split('/')[0])) reason = 'The destination host uses an encoded or numeric representation.';
      if (/[\u200b-\u200f\u202a-\u202e]/.test(destination)) reason = 'The destination contains invisible or direction-changing characters.';
      if (displayed) { const shown = displayed.match(/https?:\/\/[^\s]+/i)?.[0]; if (shown && new URL(shown).hostname !== url.hostname) reason = 'The visible URL host differs from the PDF link destination host.'; }
    } catch { if (value.includes(':')) reason = 'The destination could not be interpreted as a standard URL.'; }
  }
  return reason ? { label: 'Link destination needs review', risk: `${reason} This does not establish phishing or malware. Scrub never visits extracted links.`, severity: 'medium', category: 'threat', evidence: 'indicator', source, location, sanitization: /metadata|chunk|comment|Appended/.test(source) ? 'removed' : source === 'PDF link annotation' ? 'interaction-only' : 'manual' } : undefined;
}

export function inspectOcrWords(words: WordResult[], page: number): Finding[] {
  const lines = new Map<number, WordResult[]>();
  for (const word of words.slice(0, 10000)) { const id = word.line ?? 0; const line = lines.get(id) ?? []; line.push(word); lines.set(id, line); }
  const findings: Finding[] = [];
  for (const line of lines.values()) {
    line.sort((a, b) => (a.order ?? a.bbox.x0) - (b.order ?? b.bbox.x0));
    const x = Math.min(...line.map(w => w.bbox.x0)), y = Math.min(...line.map(w => w.bbox.y0));
    const bbox = { x, y, width: Math.max(...line.map(w => w.bbox.x1)) - x, height: Math.max(...line.map(w => w.bbox.y1)) - y };
    findings.push(...inspectText(line.map(w => w.text).join(' '), 'OCR-visible text', { page, bbox, coordinates: 'canvas' }));
  }
  return [...new Map(findings.map(f => [f.label, f])).values()];
}
