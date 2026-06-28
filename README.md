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
npm run build    # production build → ./dist
npm run lint     # type check
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
