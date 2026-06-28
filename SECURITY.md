# Security

Scrub is a privacy tool. This document describes the threat model and the protections in place.

## Core guarantee

**No file data leaves your device.** There is no server, no upload, no analytics, and no account. Every operation — face detection, OCR, metadata parsing, redaction, export — runs locally in your browser.

**All runtime assets are self-hosted.** The MediaPipe face model + WASM, the Tesseract OCR core, the English language data, and the web fonts are served from the app's own origin (`/vendor/...` and the bundled assets) — there are no third-party CDN requests. `connect-src` is locked to `'self'`.

The **only** optional outbound request is a read of the public GitHub star count (`api.github.com`) for the support dialog. It carries no file data and the app works fully without it.

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

- **Unopened pages are auto-redacted on export.** When you export a multi-page PDF, any page you didn't manually redact is rendered, run through face + text detection, and detected items are redacted. If a detector fails (model unavailable, OCR timeout), the export is **blocked** — you cannot export a page whose cleanliness is uncertain.
- **Manual review is the fail-safe.** For any PDF page, you can click to open it, review the detections, manually redact what was missed, and confirm it before export. Unopened pages are only auto-redacted if the detectors succeed.
- **The page cap is enforced end to end.** Processing stops at 50 pages on desktop (`LIMITS.maxPdfPages`) and 15 on small screens (`LIMITS.maxPdfPagesMobile`); the export loop never iterates beyond it regardless of the source document's page count. When a PDF exceeds the cap, the UI warns that later pages won't be included. The export runs page-by-page with a progress bar and a **Cancel** button.
- **The exported PDF is token-verified before download.** `verifyCleanPdf()` scans the produced bytes for active-content tokens (`/JavaScript`, `/OpenAction`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/AcroForm`, …), user-identifying Info-dictionary fields, an XMP packet, and trailing data after `%%EOF`. This is a byte-pattern scan rather than a full PDF parse — reliable here because Scrub generates the output itself (uncompressed, via jsPDF), so forbidden constructs cannot hide inside compressed object streams. It checks for *embedded malware and metadata*; detector failure is caught earlier, at build time (see below).

### Verify-before-download

The pipeline is **generate → verify → present result → download**. The exported bytes are produced and verified *before* the success dialog appears, so the "verified clean" message describes the real output. Images are verified by re-parsing for residual EXIF/metadata and trailing bytes; PDFs by the token scan above.

### Fail-closed visual redaction

The metadata/token verification above proves the output carries no *embedded* scripts or metadata. It does **not** prove every face or piece of text was visually covered — that depends on the detectors running successfully. So:

- **A failed detector blocks the export.** When an unopened PDF page is auto-redacted, a face-model load failure or an OCR timeout/crash throws and the export is blocked with the page number, rather than emitting a page that was never actually scanned. The detectors signal failure distinctly from "ran and found nothing" (`runOcr` returns a `failed` flag; `detectFaces` throws on model-load failure).
- **Single images surface the failure to the user.** If a detector fails while scanning an image you can see, the result panel warns that *face* or *text detection did not run* and prompts you to cover anything sensitive with **Draw redaction box**. "Nothing found" is never silently shown when the scanner actually failed.
- **You stay in control.** For any page, opening it, reviewing the boxes, and drawing your own is always the authoritative path; auto-redaction of unopened pages is a backstop, not a substitute for review.

### Data leakage

- **Content-Security-Policy** (`public/_headers`) is locked down: `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'none'`. Scripts, styles, fonts, workers, and images load only from `'self'` (plus `blob:`/`data:` for in-memory canvas work and `'wasm-unsafe-eval'` for the on-device ML). `connect-src` is `'self'` plus a single optional endpoint, `api.github.com`, used only for the public star count. There is no third-party script or asset origin in the policy.
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
- **Not an antivirus / not steganography-proof** — see below.

---

## Reporting a vulnerability

Open a private report via [GitHub Security Advisories](https://github.com/JalolbekJR/scrub/security/advisories/new) or email the maintainer directly. Please describe the impact without including a public exploit. Thank you.
