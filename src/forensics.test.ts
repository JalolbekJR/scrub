import { describe, it, expect, vi } from 'vitest';
import { stripJpegMetadata, verifyClean, verifyCleanPdf } from './forensics';
import { jsPDF } from 'jspdf';
import { readFileSync } from 'node:fs';

const jpegDataUrl = `data:image/jpeg;base64,${readFileSync(new URL('../fixtures/black.jpg', import.meta.url)).toString('base64')}`;

function rasterPdfBlob(): Blob {
  const pdf = new jsPDF();
  pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, 10, 10);
  return pdf.output('blob');
}

function pdfBlob(body: string): Blob {
  const text = `%PDF-1.4\n${body}\n%%EOF\n`;
  return new Blob([new TextEncoder().encode(text)], { type: 'application/pdf' });
}

describe('verifyCleanPdf — structural and byte verification of generated PDFs', () => {
  it('keeps private parser identifiers out of console diagnostics while rejecting non-raster content', async () => {
    const pdf = new jsPDF();
    pdf.internal.write('/SYNTHETIC_PRIVATE_COLORSPACE_SENTINEL cs');
    pdf.text('Ordinary synthetic page', 20, 40);
    const logs: string[] = [];
    const capture = (...values: unknown[]) => { logs.push(values.map(String).join(' ')); };
    const log = vi.spyOn(console, 'log').mockImplementation(capture);
    const warn = vi.spyOn(console, 'warn').mockImplementation(capture);
    try {
      const result = await verifyCleanPdf(pdf.output('blob'), 1);
      expect(result.clean).toBe(false);
      expect(logs.join('\n')).not.toContain('SYNTHETIC_PRIVATE_COLORSPACE_SENTINEL');
    } finally { log.mockRestore(); warn.mockRestore(); }
  });

  it('passes a generated raster PDF with no scripts or user metadata', async () => {
    const r = await verifyCleanPdf(rasterPdfBlob(), 1);
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
    expect(r.clean).toBe(false); // This isolated object is not a valid document.
  });

  it('flags an XMP metadata packet', async () => {
    const r = await verifyCleanPdf(pdfBlob('<?xpacket begin="" ?><x:xmpmeta></x:xmpmeta>'));
    expect(r.clean).toBe(false);
    expect(r.residualFields).toBeGreaterThanOrEqual(1);
  });
});

describe('export verification format checks', () => {
  it('classifies PDF input by signature when its browser MIME type is wrong', async () => {
    const input = new File([rasterPdfBlob()], 'synthetic.pdf', { type: 'image/jpeg' });
    const { inspectFile } = await import('./forensics');
    const report = await inspectFile(input);
    expect(report.inspectionFailed).toBe(false);
    expect(report.trailingBytes).toBe(0);
  });
  it('rejects a PDF-looking file that has no valid page tree', async () => {
    const result = await verifyCleanPdf(pdfBlob('1 0 obj<</Type/Catalog>>endobj'));
    expect(result.clean).toBe(false);
  });

  it('rejects hidden selectable text in a generated PDF', async () => {
    const pdf = new jsPDF();
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, 10, 10);
    pdf.text('PRIVATE SOURCE TEXT', 10, 10);
    const result = await verifyCleanPdf(pdf.output('blob'));
    expect(result.clean).toBe(false);
    expect(result.threats).toContain('Page 1 selectable text');
  });

  it('rejects vector drawing alongside a flattened page image', async () => {
    const pdf = new jsPDF();
    pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, 10, 10);
    pdf.rect(20, 20, 10, 10);
    const result = await verifyCleanPdf(pdf.output('blob'));
    expect(result.clean).toBe(false);
    expect(result.threats).toContain('Page 1 contains non-image drawing');
  });

  it('rejects a generated PDF whose page count does not match the export request', async () => {
    const result = await verifyCleanPdf(rasterPdfBlob(), 2);
    expect(result.clean).toBe(false);
    expect(result.threats).toContain('PDF page count mismatch');
  });

  it('rejects data appended after an earlier PDF EOF marker', async () => {
    const result = await verifyCleanPdf(new Blob([rasterPdfBlob(), '\nPRIVATE STASH\n%%EOF'], { type: 'application/pdf' }));
    expect(result.clean).toBe(false);
  });
  it('rejects a PDF MIME type with non-PDF bytes', async () => {
    const result = await verifyCleanPdf(new Blob(['not a PDF'], { type: 'application/pdf' }));
    expect(result.clean).toBe(false);
  });

  it('rejects image bytes whose signature does not match the MIME type', async () => {
    const result = await verifyClean(new Blob(['not a JPEG'], { type: 'image/jpeg' }));
    expect(result.clean).toBe(false);
  });

  it('removes appended JPEG bytes even when they contain a second EOI marker', async () => {
    const jpeg = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
    const appended = new Blob([jpeg, 'PRIVATE STASH', new Uint8Array([0xff, 0xd9])], { type: 'image/jpeg' });
    expect((await verifyClean(appended)).clean).toBe(false);
    const stripped = await stripJpegMetadata(appended);
    expect((await verifyClean(stripped)).clean).toBe(true);
    expect(new TextDecoder('latin1').decode(await stripped.arrayBuffer())).not.toContain('PRIVATE STASH');
  });

  it('removes synthetic EXIF author metadata from output JPEG bytes', async () => {
    const input = readFileSync(new URL('../fixtures/with-exif.jpg', import.meta.url));
    expect(new TextDecoder('latin1').decode(input).includes('PRIVATE AUTHOR')).toBe(true);
    const stripped = await stripJpegMetadata(new Blob([input], { type: 'image/jpeg' }));
    expect(new TextDecoder('latin1').decode(await stripped.arrayBuffer())).not.toContain('PRIVATE AUTHOR');
    expect((await verifyClean(stripped)).clean).toBe(true);
  });

  it('rejects even a single appended byte after a JPEG export', async () => {
    const jpeg = readFileSync(new URL('../fixtures/black.jpg', import.meta.url));
    const result = await verifyClean(new Blob([jpeg, new Uint8Array([0x41])], { type: 'image/jpeg' }));
    expect(result.clean).toBe(false);
  });

  it('rejects a PNG with data hidden behind a fake second IEND', async () => {
    const png = readFileSync(new URL('../fixtures/black.png', import.meta.url));
    const appended = new Blob([png, 'PRIVATE STASH', 'IEND', new Uint8Array(4)], { type: 'image/png' });
    const result = await verifyClean(appended);
    expect(result.trailingBytes).toBeGreaterThan(0);
    expect(result.clean).toBe(false);
  });
});
