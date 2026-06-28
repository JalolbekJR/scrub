# Security

Scrub is a privacy tool. This document describes the threat model and the protections in place.

## Core guarantee

**No file data leaves your device.** There is no server, no upload, no analytics, and no account. Every operation — face detection, OCR, metadata parsing, redaction, export — runs locally in your browser. The only outbound network requests are to fetch the ML model and OCR data from public CDNs (neither request includes any file data), and an optional read of the public GitHub star count.

---

## Threat model

### Malicious or malformed files

| Threat | Mitigation |
|---|---|
| Files over 40 MB | Refused before any byte is decoded |
| Wrong or spoofed MIME type | Allow-list of JPEG, PNG, WEBP, GIF, BMP, PDF only |
| Decompression bombs | Images over 12,000 px on a side or 40 MP are downscaled to a bounded size before processing |
| Corrupt files | All decode paths are wrapped with error handling and timeouts; a bad file shows a message and stops cleanly |
| PDF page floods | Render loop is capped at 50 pages |

### Code injection and active content

- **No `innerHTML`.** Every piece of file-derived text is written with `textContent`. OCR'd text is used only to locate PII coordinates and is then discarded — it is never rendered into the DOM.
- **SVG is rejected.** SVG is an active document format that can embed scripts.
- **PDFs run no code.** `pdfjs-dist` is initialized with `isEvalSupported: false` and network fetching disabled. Embedded JavaScript actions never execute.
- **Detected payloads are not run.** Hidden archives, scripts, and executables are identified by byte signature and reported. On export the file is re-encoded from the canvas bitmap — none of the original byte payload survives.

### Data leakage

- **Content-Security-Policy** (`vercel.json` / `public/_headers`) restricts scripts and network connections to known origins (`cdn.jsdelivr.net`, `storage.googleapis.com`, `tessdata.projectnaptha.com`, `api.github.com`). `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. Even if an injection flaw existed, there is nowhere for data to be sent.
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

## Reporting a vulnerability

Open a private report via [GitHub Security Advisories](https://github.com/JalolbekJR/scrub/security/advisories/new) or email the maintainer directly. Please describe the impact without including a public exploit. Thank you.
