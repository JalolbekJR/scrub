import { describe, it, expect } from 'vitest';
import { verifyCleanPdf } from './forensics';

function pdfBlob(body: string): Blob {
  const text = `%PDF-1.4\n${body}\n%%EOF\n`;
  return new Blob([new TextEncoder().encode(text)], { type: 'application/pdf' });
}

describe('verifyCleanPdf — token-level verification of the generated PDF', () => {
  it('passes a minimal PDF with no scripts or metadata', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</Type/Catalog>>endobj'));
    expect(r.clean).toBe(true);
    expect(r.threats).toHaveLength(0);
    expect(r.residualFields).toBe(0);
  });

  it('flags embedded JavaScript actions', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</Type/Action/S/JavaScript/JS(app.alert(1))>>endobj'));
    expect(r.clean).toBe(false);
    expect(r.threats).toContain('/JavaScript');
  });

  it('flags an auto-run OpenAction', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</OpenAction 2 0 R>>endobj'));
    expect(r.clean).toBe(false);
    expect(r.threats).toContain('/OpenAction');
  });

  it('flags embedded files', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</Type/Filespec/EF<</F 2 0 R>>/EmbeddedFile 2 0 R>>endobj'));
    expect(r.clean).toBe(false);
    expect(r.threats).toContain('/EmbeddedFile');
  });

  it('flags leftover user metadata in the Info dictionary', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</Author(John Smith)/Title(Passport scan)>>endobj'));
    expect(r.clean).toBe(false);
    expect(r.residualFields).toBeGreaterThanOrEqual(1);
  });

  it('ignores empty Info fields (generator default)', async () => {
    const r = await verifyCleanPdf(pdfBlob('1 0 obj<</Author()/Title()>>endobj'));
    expect(r.residualFields).toBe(0);
    expect(r.clean).toBe(true);
  });

  it('flags an XMP metadata packet', async () => {
    const r = await verifyCleanPdf(pdfBlob('<?xpacket begin="" ?><x:xmpmeta></x:xmpmeta>'));
    expect(r.clean).toBe(false);
    expect(r.residualFields).toBeGreaterThanOrEqual(1);
  });
});
