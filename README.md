# Scrub

Remove faces, private text, and hidden metadata from images and PDFs — in your browser, nothing uploaded.

[![MIT License](https://img.shields.io/badge/license-MIT-6667AB.svg)](./LICENSE)

**Live version:** [scrub.learner0422.workers.dev](https://scrub.learner0422.workers.dev)

> The live version runs the exact same code as this repo, entirely in your browser. Your files are never sent anywhere — not to a server, not to me, not anywhere. You can verify this by running it locally.

---

## What it does

Photos carry more than what's visible. GPS coordinates, device model and serial, timestamps, sometimes a thumbnail of the original before you cropped it. Files can also carry hidden archives, scripts, or text designed to trick AI tools.

Scrub finds all of it, shows you what was found (categories only — never the actual values), lets you choose what to remove, then exports a re-encoded file with zero metadata.

Detects and removes:
- Faces (MediaPipe BlazeFace)
- Emails, phone numbers, card numbers, names (Tesseract OCR)
- Hidden metadata — GPS, device info, timestamps, color profiles, embedded thumbnails
- Threat payloads — hidden ZIPs, scripts, executables, AI prompt-injection text

After export, re-parses the output and confirms zero metadata remains before download.

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
