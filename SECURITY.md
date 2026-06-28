# Security

Scrub is a privacy tool. This document describes the threat model and the protections in place.

## Core guarantee

**No file data leaves your device.** There is no server, no upload, no analytics, and no account. Every operation — face detection, OCR, metadata parsing, redaction, export — runs locally in your browser.

The app does make a small number of outbound requests for **its own assets**, never for your files:

- the MediaPipe face model + WASM (jsDelivr / Google Storage),
- the Tesseract OCR core and English language data (jsDelivr / Project Naptha),
- web fonts (Google Fonts),
- an optional read of the public GitHub star count (GitHub API).

None of these carry any byte of your file. They are listed honestly because a privacy tool should not claim "zero network activity" while loading remote runtime assets. A future hardening step is to self-host all of them and tighten `connect-src` to `'self'` — see *Known limitations* below.

---

## Threat model

### Malicious or malformed files

| Threat | Mitigation |
|---|---|
| Files over 40 MB | Refused before any byte is decoded |
| Wrong or spoofed MIME type | The real format is decided by the file's **leading magic bytes** (JPEG `FF D8 FF`, PNG, GIF, BMP, `RIFF…WEBP`, `%PDF-`), not the browser-supplied `file.type`. Anything that doesn't match a supported signature is refused |
| Decompression bombs | Images over 12,000 px on a side or 40 MP are downscaled to a bounded size before processing |
| Corrupt files | All decode paths are wrapped with error handling and timeouts; a bad file shows a message and stops cleanly |
| PDF page floods | Render loop is capped at 50 pages |

### Code injection and active content

- **No `innerHTML` with dynamic data.** The DOM is built with `createElement`/`textContent`; the codebase contains no `innerHTML` assignments. OCR'd text is used only to locate PII coordinates and is then discarded — it is never rendered into the DOM.
- **SVG is rejected.** SVG is an active document format that can embed scripts.
- **PDFs run no code.** `pdfjs-dist` is initialized with `isEvalSupported: false` and network fetching disabled. Embedded JavaScript actions never execute.
- **Detected payloads are not run.** Hidden archives, scripts, and executables are identified by byte signature and reported. On export the file is re-encoded from the canvas bitmap — none of the original byte payload survives.

### PDF handling

- **Every page is sanitised on export, not just the ones you opened.** When you export a multi-page PDF, any page you didn't manually redact is rendered, run through face + text detection, redacted, and only then written into the output. No page can be exported carrying its original visible faces or text.
- **The page cap is enforced end to end.** Processing stops at 50 pages (`LIMITS.maxPdfPages`); the export loop never iterates beyond it regardless of the source document's page count.
- **The exported PDF is structurally verified before download.** `verifyCleanPdf()` scans the produced bytes for active-content tokens (`/JavaScript`, `/OpenAction`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/AcroForm`, …), user-identifying Info-dictionary fields, an XMP packet, and trailing data after `%%EOF`. The "verified clean" badge reflects that actual check — not an assumption.

### Verify-before-download

The pipeline is **generate → verify → present result → download**. The exported bytes are produced and verified *before* the success dialog appears, so the "verified clean" message describes the real output. Images are verified by re-parsing for residual EXIF/metadata and trailing bytes; PDFs by the structural scan above.

### Data leakage

- **Content-Security-Policy** (`public/_headers`) restricts scripts and network connections to a small set of known origins (`cdn.jsdelivr.net`, `storage.googleapis.com`, `tessdata.projectnaptha.com`, `fonts.gstatic.com`, `api.github.com`). `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. This sharply limits where anything could go, but it is **not** an absolute guarantee: those origins are allow-listed because the app loads runtime assets from them, so a compromise of one of those dependencies would still have a permitted network destination. Self-hosting every asset and reducing `connect-src` to `'self'` is the planned hardening step.
- **The scanner is value-blind by design.** `inspectFile()` in `src/forensics.ts` collapses every metadata value to a boolean immediately on read and returns only a category label plus a fixed risk description. The actual values (GPS coordinates, device serials, author names, comment text) are never assigned to a returned field, rendered, written to storage, placed on a global, or logged. Changing this behavior requires rewriting the parser — it is not a hidden mode.
- **Error handlers log generic strings only.** No file content, filenames, or metadata values appear in console output.
- **Additional headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` disabling camera/microphone/geolocation, HSTS.

### Spam and race conditions

- Only one file is processed at a time. Additional uploads while a scan is running are ignored.
- A monotonic generation token tags each upload. Results from a superseded upload are discarded, preventing stale-result corruption.

---

## What Scrub does not claim

**Not an antivirus.** Scrub detects known hidden-payload signatures by pattern and destroys them on export. It is not a substitute for a dedicated malware scanner.

**Steganography in pixel LSBs.** Data hidden in the low bits of pixels is destroyed by re-encoding, but is not separately detected. No client-side tool can reliably detect arbitrary LSB steganography.

**OS filesystem properties.** Fields like *Owner*, *Computer*, and *Date created* shown in Windows' file Properties are stored by the OS on your disk, not inside the image file. They do not travel when you share a file — the recipient's OS assigns its own. Scrub removes everything embedded in the file; OS-level properties are not readable by a browser and are not a privacy leak in the shared copy. (To remove them locally on Windows: right-click → Properties → Details → "Remove Properties and Personal Information".)

---

## Known limitations

Honesty matters more than marketing for a privacy tool. Current limits:

- **Detectors are not perfect.** No face detector or OCR engine has perfect recall. Always review the boxes, and use **Draw redaction box** to cover anything the scan missed. This is why manual redaction exists.
- **OCR is English-only.** Text detection uses the English Tesseract model. Text in other scripts (Cyrillic, Arabic, CJK, …) is not reliably read and may not be flagged — redact it manually.
- **Name detection is narrow.** Automatic name detection currently matches titled names (e.g. *Mr Smith*, *Dr Brown*). Plain full names like *John Smith* are not detected automatically — use manual redaction.
- **Remote runtime assets.** As noted above, models, WASM, OCR data, and fonts are loaded from public CDNs today. They never receive your files, but self-hosting is the planned hardening step.
- **Not an antivirus / not steganography-proof** — see below.

---

## Reporting a vulnerability

Open a private report via [GitHub Security Advisories](https://github.com/JalolbekJR/scrub/security/advisories/new) or email the maintainer directly. Please describe the impact without including a public exploit. Thank you.
