import exifr from 'exifr';

// Values are never returned, stored, or logged — only their presence (boolean).
// present() collapses a value the instant it's read; nothing sensitive escapes.

export type Severity = 'high' | 'medium' | 'low';
export type Category =
  | 'location' | 'device' | 'identity' | 'timestamp'
  | 'software' | 'embedded' | 'threat' | 'other';

export interface Finding {
  label: string;
  risk: string;
  severity: Severity;
  category: Category;
}

export interface ForensicReport {
  findings: ReadonlyArray<Finding>;
  metaFieldCount: number;
  trailingBytes: number;
}

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

interface KeyMeta { label: string; risk: string; severity: Severity; category: Category; }
const KEY_MAP: Record<string, KeyMeta> = {
  Make:                { label: 'Camera / phone make',   risk: 'Identifies the device brand — correlates your photos to one another.', severity: 'medium', category: 'device' },
  Model:               { label: 'Device model',          risk: 'Narrows down your exact device; combined with timestamps it can fingerprint you.', severity: 'medium', category: 'device' },
  LensModel:           { label: 'Lens model',            risk: 'Adds to your device fingerprint.', severity: 'low', category: 'device' },
  HostComputer:        { label: 'Host computer',         risk: 'Reveals the computer used to process the photo.', severity: 'medium', category: 'device' },
  SerialNumber:        { label: 'Camera serial number',  risk: 'A globally-unique ID that ties every photo to your specific device.', severity: 'high', category: 'identity' },
  BodySerialNumber:    { label: 'Body serial number',    risk: 'A globally-unique device fingerprint.', severity: 'high', category: 'identity' },
  InternalSerialNumber:{ label: 'Internal serial number',risk: 'A globally-unique device fingerprint.', severity: 'high', category: 'identity' },
  LensSerialNumber:    { label: 'Lens serial number',    risk: 'A unique hardware fingerprint.', severity: 'high', category: 'identity' },
  Artist:              { label: 'Author / artist name',  risk: 'Embeds a person’s name directly in the file.', severity: 'medium', category: 'identity' },
  Copyright:           { label: 'Copyright holder',      risk: 'May contain a real name or organisation.', severity: 'low', category: 'identity' },
  OwnerName:           { label: 'Owner name',            risk: 'Embeds the device owner’s name in the file.', severity: 'high', category: 'identity' },
  XPAuthor:            { label: 'Author',                risk: 'Embeds a person’s name in the file.', severity: 'medium', category: 'identity' },
  Creator:             { label: 'Creator',               risk: 'Embeds a person or tool identity.', severity: 'medium', category: 'identity' },
  'By-line':           { label: 'Photographer',          risk: 'Names the person who took the photo.', severity: 'medium', category: 'identity' },
  Software:            { label: 'Editing software',      risk: 'Reveals your software and workflow.', severity: 'low', category: 'software' },
  CreatorTool:         { label: 'Creator tool',          risk: 'Reveals the app used to create the file.', severity: 'low', category: 'software' },
  ProcessingSoftware:  { label: 'Processing software',   risk: 'Reveals your editing pipeline.', severity: 'low', category: 'software' },
  DateTimeOriginal:    { label: 'Original capture time', risk: 'Pinpoints exactly when the photo was taken.', severity: 'medium', category: 'timestamp' },
  CreateDate:          { label: 'Creation timestamp',    risk: 'Reveals when the file was created.', severity: 'low', category: 'timestamp' },
  ModifyDate:          { label: 'Modification timestamp',risk: 'Reveals when the file was last edited.', severity: 'low', category: 'timestamp' },
  City:                { label: 'City (IPTC)',           risk: 'Names the place the photo was taken.', severity: 'high', category: 'location' },
  State:               { label: 'Region / state (IPTC)', risk: 'Names the region the photo was taken.', severity: 'high', category: 'location' },
  Country:             { label: 'Country (IPTC)',        risk: 'Names the country of capture.', severity: 'medium', category: 'location' },
  'Sub-location':      { label: 'Sub-location (IPTC)',   risk: 'Names a specific place within a city.', severity: 'high', category: 'location' },
  CameraOwnerName:     { label: 'Camera owner name',     risk: 'The registered owner of the camera — embedded in the file.', severity: 'high', category: 'identity' },
  ImageUniqueID:       { label: 'Image unique ID',       risk: 'A unique fingerprint that links this image across every copy.', severity: 'high', category: 'identity' },
  ImageDescription:    { label: 'Image description',     risk: 'A free-text caption that may contain personal details.', severity: 'medium', category: 'identity' },
  UserComment:         { label: 'User comment',          risk: 'A free-text comment that may contain personal details.', severity: 'medium', category: 'identity' },
  XPComment:           { label: 'Comment (Windows)',     risk: 'A comment you or Windows added — may contain personal text.', severity: 'medium', category: 'identity' },
  XPTitle:             { label: 'Title (Windows)',       risk: 'A title field that may contain personal text.', severity: 'low', category: 'identity' },
  XPSubject:           { label: 'Subject (Windows)',     risk: 'A subject field that may contain personal text.', severity: 'low', category: 'identity' },
  XPKeywords:          { label: 'Tags / keywords (Windows)', risk: 'Tags you added — may reveal people, places or topics.', severity: 'medium', category: 'identity' },
  DocumentID:          { label: 'Document ID (XMP)',     risk: 'A unique ID linking edits and copies of this file.', severity: 'medium', category: 'identity' },
  OriginalDocumentID:  { label: 'Original document ID (XMP)', risk: 'Links this file back to its original.', severity: 'medium', category: 'identity' },
  InstanceID:          { label: 'Instance ID (XMP)',     risk: 'A unique ID for this exact version of the file.', severity: 'low', category: 'identity' },
  OffsetTimeOriginal:  { label: 'Time-zone offset',      risk: 'Reveals the capture time zone — a rough location hint.', severity: 'low', category: 'location' },
};

// Purely structural / colour fields that carry no personal information. They are
// excluded from the "other embedded metadata" catch-all (the ICC finding already
// represents the colour profile, and these are stripped on export regardless).
const STRUCTURAL_KEYS = new Set([
  'JFIFVersion', 'ResolutionUnit', 'XResolution', 'YResolution', 'Orientation', 'ColorSpace',
  'ThumbnailWidth', 'ThumbnailHeight', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight',
  'BitsPerSample', 'SamplesPerPixel', 'PhotometricInterpretation', 'PlanarConfiguration', 'Compression',
  'ProfileCMMType', 'ProfileVersion', 'ProfileClass', 'ColorSpaceData', 'ProfileConnectionSpace',
  'ProfileDateTime', 'ProfileFileSignature', 'PrimaryPlatform', 'DeviceManufacturer', 'DeviceModel',
  'RenderingIntent', 'ProfileCreator', 'ProfileDescription', 'ProfileCopyright', 'MediaWhitePoint',
  'RedMatrixColumn', 'GreenMatrixColumn', 'BlueMatrixColumn', 'RedTRC', 'GreenTRC', 'BlueTRC',
  'ChromaticAdaptation', 'Technology',
]);

// ── Byte-signature scan: embedded payloads, scripts, executables ──────────────
interface Signature { needle: string; label: string; risk: string; severity: Severity; category: Category; }

const SIGNATURES: Signature[] = [
  { needle: 'PK\x03\x04',   label: 'Hidden ZIP archive (polyglot)', risk: 'A full archive smuggled inside the image — can carry any files past upload filters.', severity: 'high', category: 'threat' },
  { needle: 'Rar!\x1a\x07', label: 'Hidden RAR archive',            risk: 'An archive concealed inside the image.', severity: 'high', category: 'threat' },
  { needle: '7z\xBC\xAF\x27\x1C', label: 'Hidden 7-Zip archive',     risk: 'An archive concealed inside the image.', severity: 'high', category: 'threat' },
  { needle: '\x7FELF',      label: 'Embedded Linux executable',     risk: 'A runnable binary hidden in the file — a malware-delivery technique.', severity: 'high', category: 'threat' },
  { needle: '<script',      label: 'Embedded HTML/JS script',       risk: 'Executable web code hidden in the file; dangerous if the file is opened in a browser.', severity: 'high', category: 'threat' },
  { needle: 'javascript:',  label: 'Embedded javascript: URI',      risk: 'A script URI that can execute when the file is mishandled.', severity: 'high', category: 'threat' },
  { needle: '<?php',        label: 'Embedded PHP code',             risk: 'Server-side code hidden in the file.', severity: 'high', category: 'threat' },
  { needle: '<iframe',      label: 'Embedded iframe',               risk: 'A hidden frame that can load external/attacker content.', severity: 'high', category: 'threat' },
  { needle: '<!doctype html', label: 'Embedded HTML document',      risk: 'A full web page concealed inside the image.', severity: 'high', category: 'threat' },
  { needle: 'powershell',   label: 'Embedded PowerShell',           risk: 'Windows commands hidden in the file — a malware technique.', severity: 'high', category: 'threat' },
  { needle: '#!/bin/',      label: 'Embedded shell script',         risk: 'Shell commands hidden in the file.', severity: 'high', category: 'threat' },
];

// AI prompt-injection: the matched phrase is NEVER echoed back.
const PROMPT_PHRASES = [
  'ignore previous', 'ignore all previous', 'disregard previous', 'disregard all',
  'you are now', 'system prompt', 'do anything now', 'jailbreak',
  'ignore your instructions', 'new instructions:',
];

const PDF_SIGNATURES: Signature[] = [
  { needle: '/JavaScript', label: 'PDF JavaScript action', risk: 'Code that can run automatically when the PDF is opened.', severity: 'high', category: 'threat' },
  { needle: '/OpenAction', label: 'PDF auto-run action',   risk: 'An action triggered the moment the PDF opens.', severity: 'high', category: 'threat' },
  { needle: '/Launch',     label: 'PDF Launch action',     risk: 'Can attempt to launch external programs.', severity: 'high', category: 'threat' },
  { needle: '/EmbeddedFile', label: 'PDF embedded file',   risk: 'Another file is hidden inside the PDF.', severity: 'high', category: 'threat' },
  { needle: '/RichMedia',  label: 'PDF rich-media object',  risk: 'Embedded media that can carry active content.', severity: 'medium', category: 'threat' },
];

function bytesToLatin1(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

function lastIndexOfSeq(bytes: Uint8Array, seq: number[]): number {
  outer: for (let i = bytes.length - seq.length; i >= 0; i--) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function computeTrailing(bytes: Uint8Array, type: string): number {
  if (type.includes('jpeg') || type.includes('jpg')) {
    const eoi = lastIndexOfSeq(bytes, [0xff, 0xd9]);
    return eoi >= 0 ? bytes.length - (eoi + 2) : 0;
  }
  if (type.includes('png')) {
    const iend = lastIndexOfSeq(bytes, [0x49, 0x45, 0x4e, 0x44]);
    return iend >= 0 ? bytes.length - (iend + 8) : 0;
  }
  return 0;
}

export async function inspectFile(file: File): Promise<ForensicReport> {
  const findings: Finding[] = [];
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = file.type === 'application/pdf';

  // Parse metadata, then immediately collapse every value to presence-only.
  let metaFieldCount = 0;
  if (!isPdf) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await exifr.parse(file, {
        tiff: true, exif: true, gps: true, interop: true,
        iptc: true, xmp: true, icc: true, jfif: true,
        makerNote: true, userComment: true, mergeOutput: true,
      })) || {};
    } catch { parsed = {}; }

    metaFieldCount = Object.keys(parsed).length;

    // GPS — presence only, coordinates are never read.
    if (present(parsed.latitude) && present(parsed.longitude)) {
      findings.push({
        label: 'GPS location',
        risk: 'Reveals exactly where the photo was taken — often your home or workplace. Modern AI can cross-reference this in seconds.',
        severity: 'high', category: 'location',
      });
    }
    for (const key of Object.keys(KEY_MAP)) {
      if (present(parsed[key])) {
        const m = KEY_MAP[key];
        findings.push({ label: m.label, risk: m.risk, severity: m.severity, category: m.category });
      }
    }
    if (present(parsed.ProfileDescription) || present(parsed.ColorSpaceData)) {
      findings.push({
        label: 'Embedded ICC color profile',
        risk: 'Low risk on its own, but stripped so the exported file is truly bare.',
        severity: 'low', category: 'other',
      });
    }

    // Catch-all: any remaining embedded field we didn't itemise (camera settings,
    // software tags, edit history, etc.). Counts only — values are never read.
    // Guarantees nothing embedded is silently ignored; all of it is stripped.
    let otherCount = 0;
    for (const key of Object.keys(parsed)) {
      if (STRUCTURAL_KEYS.has(key)) continue;
      if (key in KEY_MAP) continue;
      if (key === 'latitude' || key === 'longitude' || key.startsWith('GPS')) continue;
      if (present(parsed[key])) otherCount++;
    }
    if (otherCount > 0) {
      findings.push({
        label: 'Other embedded metadata',
        risk: `${otherCount} more embedded field${otherCount !== 1 ? 's' : ''} (camera settings, software tags, edit history) — all removed on export.`,
        severity: 'low', category: 'other',
      });
    }

    // Embedded thumbnail — detected by PRESENCE; its imagery is never decoded,
    // shown, or stored (it can leak a pre-crop original, so we keep it blind).
    try {
      const thumb = await exifr.thumbnail(file);
      if (thumb && thumb.byteLength > 0) {
        findings.push({
          label: 'Embedded thumbnail',
          risk: 'A hidden preview that can reveal the original image before you cropped or edited it.',
          severity: 'high', category: 'embedded',
        });
      }
    } catch { /* none */ }

    parsed = {}; // drop reference — nothing sensitive survives this function
  }

  // Trailing/appended data (count only).
  const trailingBytes = computeTrailing(bytes, file.type);
  if (trailingBytes > 16) {
    findings.push({
      label: 'Data appended after image end',
      risk: 'Hidden bytes after the real end of the image — a common way to smuggle files or code past filters.',
      severity: 'high', category: 'threat',
    });
  }

  // Signature scan — only the boolean "was it present" is kept.
  const head = bytesToLatin1(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)));
  const tail = trailingBytes > 0
    ? bytesToLatin1(bytes.subarray(Math.max(0, bytes.length - trailingBytes - 8)))
    : '';
  const haystack = (head + '\n' + tail).toLowerCase();
  const seen = new Set<string>();
  for (const sig of (isPdf ? [...PDF_SIGNATURES, ...SIGNATURES] : SIGNATURES)) {
    if (haystack.includes(sig.needle.toLowerCase()) && !seen.has(sig.label)) {
      seen.add(sig.label);
      findings.push({ label: sig.label, risk: sig.risk, severity: sig.severity, category: sig.category });
    }
  }
  if (PROMPT_PHRASES.some((p) => haystack.includes(p))) {
    findings.push({
      label: 'Hidden AI prompt-injection text',
      risk: 'Concealed instructions crafted to hijack AI systems that read this image. The text itself is never displayed.',
      severity: 'medium', category: 'threat',
    });
  }

  return Object.freeze({ findings: Object.freeze(findings), metaFieldCount, trailingBytes });
}

// ── Strip ALL metadata segments from a JPEG (APPn + comments, incl. ICC) ──────
function stripJpegSegments(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const keep: Array<[number, number]> = [[0, 2]];
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 1 < bytes.length) { i++; marker = bytes[i + 1]; }
    if (marker === 0xd9) { keep.push([i, i + 2]); break; }
    if (marker === 0xda) { keep.push([i, bytes.length]); break; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const seg = i + 2 + len;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const isCom = marker === 0xfe;
    if (!isApp && !isCom) keep.push([i, seg]);
    i = seg;
  }
  const total = keep.reduce((n, [s, e]) => n + (e - s), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const [s, e] of keep) { out.set(bytes.subarray(s, e), off); off += e - s; }
  return out;
}

export async function stripJpegMetadata(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const cleaned = stripJpegSegments(bytes);
  return new Blob([cleaned.buffer as ArrayBuffer], { type: 'image/jpeg' });
}

// ── Post-export verification ──────────────────────────────────────────────────
export interface VerifyResult {
  clean: boolean;
  residualFields: number;
  trailingBytes: number;
  // Active-content / threat tokens still present (PDF only); always empty for images.
  threats: string[];
}

export async function verifyClean(blob: Blob): Promise<VerifyResult> {
  let residualFields = 0;
  try {
    const parsed = await exifr.parse(blob, { tiff: true, exif: true, gps: true, iptc: true, xmp: true, icc: true });
    residualFields = parsed ? Object.keys(parsed).length : 0;
  } catch { residualFields = 0; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const trailingBytes = computeTrailing(bytes, blob.type || 'image/jpeg');
  return { clean: residualFields === 0 && trailingBytes <= 2, residualFields, trailingBytes, threats: [] };
}

// Active-content constructs that must never appear in a sanitised PDF.
const PDF_THREAT_TOKENS = ['/JavaScript', '/JS', '/OpenAction', '/AA', '/Launch', '/EmbeddedFile', '/RichMedia', '/AcroForm', '/GoToR'];
// Info-dictionary fields that would carry user-identifying text.
const PDF_META_RE = /\/(Author|Title|Subject|Keywords|Creator)\s*\(([^)]*)\)/g;

// Token-level verification of the Scrub-generated PDF: confirms the produced
// bytes carry no scripts, embedded files, forms, user metadata, XMP packet, or
// trailing junk. This is a byte-pattern scan, not a full PDF parse — it is
// reliable here because Scrub writes the output itself (uncompressed via jsPDF),
// so forbidden constructs aren't hidden inside compressed object streams.
// (Producer / CreationDate written by the generator carry no user data and are
// not treated as leaks.)
export async function verifyCleanPdf(blob: Blob): Promise<VerifyResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = bytesToLatin1(bytes);

  const threats = PDF_THREAT_TOKENS.filter((t) => text.includes(t));

  let residualFields = 0;
  for (const m of text.matchAll(PDF_META_RE)) {
    if ((m[2] ?? '').trim().length > 0) residualFields++;
  }
  if (text.includes('<?xpacket') || text.includes('<x:xmpmeta')) residualFields++;

  // Anything after the final %%EOF is appended/trailing data.
  const eofSeq = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
  const eof = lastIndexOfSeq(bytes, eofSeq);
  const trailingBytes = eof >= 0 ? Math.max(0, bytes.length - (eof + eofSeq.length) - 2) : bytes.length;

  return {
    clean: threats.length === 0 && residualFields === 0 && trailingBytes <= 4,
    residualFields,
    trailingBytes: Math.max(0, trailingBytes),
    threats,
  };
}
