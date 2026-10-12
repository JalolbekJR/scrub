import exifr from 'exifr';
import { sniffKind, LIMITS } from './validate';
import { imageStructure, embeddedPayload } from './threat-structure';
import { inspectText } from './threat-text';
import type { ForensicReport, Finding, Severity, Category } from './forensics';

function present(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

async function metadataDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Metadata inspection timeout')), 5000); })]); }
  finally { clearTimeout(timer!); }
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
  'BitDepth', 'ColorType', 'Filter', 'Interlace',
  'JFIFVersion', 'ResolutionUnit', 'XResolution', 'YResolution', 'Orientation', 'ColorSpace',
  'ThumbnailWidth', 'ThumbnailHeight', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight',
  'BitsPerSample', 'SamplesPerPixel', 'PhotometricInterpretation', 'PlanarConfiguration', 'Compression',
  'ProfileCMMType', 'ProfileVersion', 'ProfileClass', 'ColorSpaceData', 'ProfileConnectionSpace',
  'ProfileDateTime', 'ProfileFileSignature', 'PrimaryPlatform', 'DeviceManufacturer', 'DeviceModel',
  'RenderingIntent', 'ProfileCreator', 'ProfileDescription', 'ProfileCopyright', 'MediaWhitePoint',
  'RedMatrixColumn', 'GreenMatrixColumn', 'BlueMatrixColumn', 'RedTRC', 'GreenTRC', 'BlueTRC',
  'ChromaticAdaptation', 'Technology',
]);

export async function inspectOriginalFile(file: File, inspectPdf?: (bytes: Uint8Array) => Promise<{ findings: Finding[]; incomplete: boolean; failure?: string }>): Promise<ForensicReport> {
  const findings: Finding[] = [];
  const limitations = ['Not a malware scanner or a guarantee of safety.', 'Compressed embedded text, arbitrary encodings and unrecognized private formats are not exhaustively inspected.'];
  const checks: string[] = [];
  if (!file.size || file.size > LIMITS.maxBytes) return { findings, metaFieldCount: 0, trailingBytes: 0, inspectionFailed: true, limitations: ['Scan failed: file size is outside supported limits.'] };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = sniffKind(bytes.subarray(0, 16)) === 'pdf';
  let inspectionFailed = false;
  let trailingBytes = 0;
  let format = isPdf ? 'pdf' : '';
  if (!isPdf) {
    try {
      const structure = imageStructure(bytes); format = structure.format; trailingBytes = bytes.length - structure.end;
      if (['webp', 'gif'].includes(format) && structure.regions.length) findings.push({ label: 'Embedded image metadata or comments', risk: 'The container has metadata or comment blocks. Presence is confirmed; detailed field interpretation may be unsupported. Reconstructed JPEG export omits these blocks.', category: 'other', severity: 'low', evidence: 'structural', source: 'Image container', sanitization: 'removed' });
      if (structure.animated) findings.push({ label: 'Animated image container', risk: 'Scrub exports the captured canvas as a still JPEG, not the original animation. Review the captured frame before downloading.', category: 'other', severity: 'medium', evidence: 'structural', source: 'Image container', sanitization: 'manual' });
      checks.push('Image container: structural checks completed');
      if (trailingBytes) structure.regions.push({ start: structure.end, end: bytes.length, source: 'Appended bytes', text: true });
      if (trailingBytes) findings.push({ label: 'Appended data', risk: 'Bytes occur after the container end. They may be benign or carry extra content; reconstructed export omits them.', severity: 'medium', category: 'embedded', evidence: 'structural', source: 'Image container', sanitization: 'removed' });
      let budget = 256 * 1024;
      for (const region of structure.regions) {
        if (budget <= 0) { limitations.push('Embedded-byte inspection incomplete: 256 KiB inspection budget reached.'); inspectionFailed = true; break; }
        const data = bytes.subarray(region.start, Math.min(region.end, region.start + budget)); budget -= data.length;
        if (data.length < region.end - region.start) { inspectionFailed = true; limitations.push('Embedded-byte inspection incomplete: region exceeded byte budget.'); }
        const payload = embeddedPayload(data);
        if (payload) findings.push({ label: payload === 'ZIP structure' ? 'Embedded ZIP container' : 'Embedded payload indicator', risk: payload === 'ZIP structure' ? 'A ZIP local header and consistent central/end directory were found outside image pixels. Members were not expanded; presence does not establish malware.' : 'An archive signature or executable header was found outside image pixels. This is an indicator, not proof of runnable or malicious code.', severity: 'medium', category: 'threat', evidence: payload === 'ZIP structure' ? 'structural' : 'indicator', source: region.source, sanitization: 'removed' });
        if (region.text) {
          const text = new TextDecoder().decode(data); findings.push(...inspectText(text, region.source.includes('metadata') ? 'Image metadata' : region.source));
          if (/<script\b|<\?php|javascript:|#!\/bin\//i.test(text)) findings.push({ label: 'Script-like embedded text', risk: 'Script-like wording occurs in a supported text region. It may be a harmless quote; this does not prove executable behavior.', severity: 'low', category: 'threat', evidence: 'indicator', source: region.source, sanitization: 'removed' });
        }
      }
    } catch { inspectionFailed = true; checks.push('Scan failed: image container malformed, unsupported or exceeds the 10,000-block inspection budget'); }
  } else {
    let eof = -1;
    for (let i = bytes.length - 5; i >= 0; i--) if (bytes[i] === 37 && bytes[i + 1] === 37 && bytes[i + 2] === 69 && bytes[i + 3] === 79 && bytes[i + 4] === 70) { eof = i + 5; break; }
    if (eof >= 0) {
      let start = eof; while (start < bytes.length && [9, 10, 13, 32].includes(bytes[start])) start++;
      trailingBytes = bytes.length - start;
      if (trailingBytes) findings.push({ label: 'Data after PDF end marker', risk: 'Non-whitespace bytes follow the last PDF end marker. This is a structural indicator, not proof of malware; reconstruction omits extra bytes.', category: 'embedded', severity: 'medium', evidence: 'indicator', source: 'PDF footer', sanitization: 'removed' });
    }
    try { if (!inspectPdf) throw new Error('PDF inspection unavailable'); const result = await inspectPdf(bytes); findings.push(...result.findings); inspectionFailed ||= result.incomplete; checks.push(result.failure ?? (result.incomplete ? 'PDF inspection incomplete: supported page/text limits reached' : 'PDF structure, actions, links and extracted text: checks completed')); }
    catch { inspectionFailed = true; checks.push('Scan failed: PDF parsing or inspection timeout'); }
    limitations.push('Unsupported check: exhaustive PDF Launch/RichMedia/remote-action and arbitrary object graph analysis.');
  }
  const expected = format === 'jpeg' ? /\.(?:jpg|jpeg)$/i : new RegExp('\\.' + format + '$', 'i');
  if (format && !expected.test(file.name)) findings.push({ label: 'Filename does not match file format', risk: 'The filename extension differs from the detected container. This does not establish malicious intent.', severity: 'low', category: 'other', evidence: 'structural', source: 'File header and name', sanitization: 'removed' });

  // Parse metadata, then immediately collapse every value to presence-only.
  let metaFieldCount = 0;
  if (!isPdf && !inspectionFailed && ['jpeg', 'png'].includes(format)) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = (await metadataDeadline(exifr.parse(bytes, {
        tiff: true, exif: true, gps: true, interop: true,
        iptc: true, xmp: true, icc: true, jfif: true,
        makerNote: true, userComment: true, mergeOutput: true,
      }))) || {};
    } catch { inspectionFailed = true; checks.push('Scan failed: supported image metadata parsing or timeout'); }

    metaFieldCount = Object.keys(parsed).length;
    for (const key of ['UserComment', 'ImageDescription', 'XPComment', 'XPTitle', 'XPSubject', 'XPKeywords']) { if (typeof parsed[key] === 'string') findings.push(...inspectText(parsed[key] as string, 'Image metadata')); }

    // GPS — presence only, coordinates are never read.
    if (present(parsed.latitude) && present(parsed.longitude)) {
      findings.push({
        label: 'GPS location',
        risk: 'Contains a precise capture location that may disclose a private place.',
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
      const thumb = await metadataDeadline(exifr.thumbnail(bytes));
      if (thumb && thumb.byteLength > 0) {
        findings.push({
          label: 'Embedded thumbnail',
          risk: 'A hidden preview that can reveal the original image before you cropped or edited it.',
          severity: 'high', category: 'embedded',
        });
      }
    } catch { limitations.push('Unsupported or failed check: embedded thumbnail extraction.'); }

    parsed = {}; // drop reference — nothing sensitive survives this function
  }

  if (!isPdf && !['jpeg', 'png'].includes(format)) limitations.push('Unsupported check: detailed EXIF metadata parsing for this image format. Container text regions are inspected where available.');
  const grouped = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.label}:${finding.source ?? ''}`;
    const previous = grouped.get(key);
    if (!previous) grouped.set(key, { ...finding, count: 1 });
    else {
      const count = (previous.count ?? 1) + 1;
      const priority = { low: 0, medium: 1, high: 2 };
      if (priority[finding.severity] > priority[previous.severity]) Object.assign(previous, finding);
      previous.count = count;
      if (!previous.location?.bbox && finding.location?.bbox) previous.location = finding.location;
    }
  }
  return Object.freeze({ findings: Object.freeze([...grouped.values()]), metaFieldCount, trailingBytes, inspectionFailed, limitations: Object.freeze(limitations), checks: Object.freeze(checks) });
}
