# Scrub

Remove faces, private text, and hidden metadata from images and PDFs — in your browser, nothing uploaded.

[![MIT License](https://img.shields.io/badge/license-MIT-6667AB.svg)](./LICENSE)

**Live version:** [scrub.learner0422.workers.dev](https://scrub.learner0422.workers.dev)

> The live version runs the exact same code as this repo, entirely in your browser. Your files are never sent anywhere — not to a server, not to me, not anywhere. You can verify this by running it locally.

---

## What it does

Photos carry more than what's visible. GPS coordinates, device model and serial, timestamps, sometimes a thumbnail of the original before you cropped it. Files can also carry hidden archives, scripts, or text designed to trick AI tools.

Scrub finds it, shows you what was found (categories only — never the actual values), lets you choose what to remove, then exports a re-encoded file with the metadata stripped.

Detects:
- Faces (MediaPipe BlazeFace, tiled detection for crowded images)
- Emails, phone numbers, card numbers (Tesseract OCR, English)
- Titled names like "Dr Brown" (plain names need a manual box)
- Hidden metadata — GPS, device info, timestamps, color profiles, embedded thumbnails
- Threat payloads — hidden ZIPs, scripts, executables, AI prompt-injection text

No detector is perfect, so you can **draw your own redaction boxes** over anything the scan misses, and remove any box you don't want.

Before the download is offered, the exported file is **verified**: images are re-parsed for residual metadata and trailing bytes; PDFs are scanned for scripts, embedded files, leftover document metadata, and appended data. The "verified clean" badge reflects that real check.

All ML models, OCR data, and fonts are **self-hosted** — there are no third-party CDN requests, and the Content-Security-Policy locks `connect-src` to your own origin (the only optional external call is the public GitHub star count).

> **Status: beta.** It does what it says and verifies its own output, but treat it as a strong privacy aid, not a certified sanitizer. See [SECURITY.md](./SECURITY.md) for the threat model and honest limitations (English-only OCR, detector recall).

---

## What's detected 100% vs. best-effort

Not all detection is equal, so here is the honest split.

**Detected every time it's present — deterministic (byte-exact reads, not guesswork):**

- **All standard EXIF / IPTC / XMP metadata** that `exifr` can parse — **GPS** coordinates, camera/phone **make, model and serial number**, **owner / author / artist** names, **timestamps** (capture, create, modify), **software / editing tags**, **ICC colour profiles**, and **embedded thumbnails** (the small copy of the original that survives a crop). If the field is in the file, it is found — and anything not individually itemised is still caught by a catch-all so nothing parseable is missed.
- **Data appended after the file's real end** — trailing bytes / polyglot payloads bolted onto a JPEG, PNG, or after a PDF's `%%EOF`. Measured byte-for-byte.
- **Known threat signatures**, matched as exact byte strings anywhere in the file: `ZIP` / `RAR` / `7-Zip` archives, `ELF` (Linux) executables, `<script>`, `javascript:`, `<?php`, `powershell`, `#!/bin/…` shell scripts, embedded HTML/iframes, and the PDF action tokens `/JavaScript`, `/OpenAction`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/AcroForm`.
- **AI prompt-injection** — a fixed list of known phrases ("ignore previous instructions", "you are now", "jailbreak", …), matched case-insensitively.

**Best-effort — machine learning / OCR, _not_ guaranteed:**

- **Faces** (BlazeFace). Tiling improves recall on crowded photos, but extreme angles, heavy occlusion, or very small faces can be missed.
- **On-image text** — emails, phone numbers, card numbers, titled names — only found if OCR reads the pixels correctly. **English only**; low-resolution, stylised, rotated, or handwritten text may be missed. Plain untitled names aren't pattern-matched at all.

For anything in the best-effort bucket, **draw a manual box** — that redaction is exact and always applied.

**The real guarantee is on the _output_, not the detection.** Regardless of what was or wasn't flagged, the exported file is a fresh re-encode of the pixels only: **every** metadata segment and **every** appended byte is dropped — so even an *undetected* embedded archive, executable, or thumbnail is gone from what you download. Before the download unlocks, the output is re-scanned to confirm zero residual metadata and zero trailing data; that is what **"verified clean"** means. The one thing re-encoding can't remove is information still **visible in the pixels** — that's what the boxes are for.

---

## Run locally

Requires [Node.js](https://nodejs.org) (LTS).

```bash
git clone https://github.com/JalolbekJR/scrub.git
cd scrub
npm install
npm run dev
```

Open `http://localhost:5173`.

```bash
npm run typecheck   # TypeScript type checking (tsc --noEmit)
npm run lint        # ESLint
npm test            # unit tests (Vitest)
npm run e2e         # browser end-to-end tests (Playwright)
npm run build       # production build → ./dist
```

---

## Stack

- Vite + TypeScript, no framework
- `@mediapipe/tasks-vision` — face detection
- `tesseract.js` — OCR
- `exifr` — metadata parsing
- `pdfjs-dist` + `jspdf` — PDF read/write

---

## Support

[Support on Boosty](https://boosty.to/unusual_one/donate)

---

## License

MIT © 2026 [Jalolbek JR](https://github.com/JalolbekJR)
