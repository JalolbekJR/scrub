# Scrub

Scrub is a browser-local privacy editor for people preparing photos and PDFs to share. It suggests faces and supported private text, lets you choose what to cover, inspects supported hidden structures, and verifies reconstructed exports.

[Public website](https://scrub.learner0422.workers.dev) · [MIT license](LICENSE) · [Security policy](SECURITY.md)

The public website may run an older build. This repository does not establish which commit is deployed.

## Three steps

1. **Drop a file.** Choose a photo or PDF; processing stays in your browser.
2. **Review what's found.** Include, exclude or restore suggestions. Use Customize to cover missed content and adjust masks.
3. **Download clean.** Choose Download protected copy. Scrub verifies the current revision, starts a normal browser download and returns home. A short-lived retry is available in the optional completion window.

Advanced controls are optional. You can select individual regions, draw rectangles or ellipses, paint with a brush, erase brush coverage, change styles, undo/redo and return from preview to editing. PDF edits belong to their pages. Mixed batches produce a ZIP with distinct filenames.

## Files and exports

Inputs: JPEG, PNG, WebP, GIF, BMP and PDF. All image inputs export as JPEG; transparency and animation are not preserved. PDFs export as raster-only PDFs with the accepted page count. Searchable text, forms, links, attachments, document structure and vector detail are not preserved. Generated PDFs can contain technical producer/date fields; these are not copied personal metadata. Large images can be downscaled; files over the processing limits are rejected rather than silently truncating pages.

Secure Solid, Secure Gradient and Soft Conceal replace selected pixels opaquely. Review the full mask and its edges: an unselected area remains visible. Soft Conceal uses generated colors and texture, not source-derived facial detail, but hair, clothing and context may still identify a person. **Blur and Mosaic are cosmetic effects that retain source information.** Use an opaque style for private text or reliable selected-pixel replacement.

## Inspection and privacy

Face detection uses MediaPipe; English OCR uses Tesseract with four quarter-turn passes. Recognition can miss faces or text, and automatic name matching is limited. Always review manually.

The Security & Privacy Findings section checks supported metadata, image containers, appended data, PDF actions/attachments, suspicious links and possible AI-directed instructions. Findings distinguish parsed structures from heuristic indicators and incomplete checks. Unusual text or a URL is not proof of malware. Scrub never executes attachments or visits extracted links.

Export reconstruction removes supported embedded structures independently of whether inspection detected them. Verification checks exported structure and metadata; it does not certify complete visual redaction, malware absence, universal metadata coverage or anonymity. Required processing or verification failure blocks a verified download. Editing invalidates older verification and output.

Files and extracted content stay in browser memory. There are no file uploads, telemetry, accounts or remote OCR/reputation services. Models, English OCR data and fonts load from the app's own origin. Optional support/share links open external sites only when chosen. The host receives ordinary asset requests; external sites have their own privacy policies. Offline use requires assets to be available; there is no guaranteed offline installation.

## Development

Use Node.js 24 LTS (Node 22.13 or later in the 22.x line is also permitted).

```sh
npm ci --ignore-scripts
npm run dev
```

Open the URL Vite prints. Dependencies are locked; do not use a forced audit upgrade.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run e2e -- --workers=1
npm run test:production
```

On Linux, Playwright may need `install --with-deps`. `SCRUB_PORT` selects the browser-test server port. `SCRUB_BROWSER_EXECUTABLE` optionally selects installed Chrome for the Chromium project and production smoke checks. Run engines sequentially on memory-constrained machines. See [testing](docs/TESTING.md).

The stack is TypeScript/Vite, PDF.js/jsPDF, MediaPipe, Tesseract, exifr and fflate. Browser code has no application server. `npm run build` produces static `dist/` assets; source maps are disabled. [Third-party notices](THIRD_PARTY_NOTICES.md) cover redistributed assets and licenses.

## Browser support and limits

Automated regression coverage targets desktop Chromium, Firefox and WebKit, including narrow viewports and keyboard controls. Desktop WebKit emulation is not real iPhone testing. Native save dialogs, screen readers, actual mobile devices and low-memory behavior require manual verification. Complex documents, tiny faces, handwriting, mixed orientations and non-English text can fail recognition. Resource caps reduce risk but do not prove a universal memory bound for native decoders or GPU allocation.

## Reports, attribution and support

Report reproducible bugs through [GitHub issues](https://github.com/JalolbekJR/scrub/issues), using synthetic files rather than private documents. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Designed and engineered by [Jalolbek JR](https://github.com/JalolbekJR). Scrub is MIT licensed. [Boosty support](https://boosty.to/unusual_one/donate), starring and sharing are optional and never required to download.
