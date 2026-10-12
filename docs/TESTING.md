# Testing

Use Node 24 LTS and `npm ci --ignore-scripts`. Unit tests cover format validation, inspection, export verification, coordinate mapping, mask rendering, editor history and revision invalidation. Browser tests generate synthetic documents and inspect actual JPEG pixels, PDF structure/page counts and ZIP entries. The public-domain portrait's provenance is in fixtures/README.md.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium firefox webkit
npm run e2e -- --project=chromium --workers=1
npm run e2e -- --project=firefox --workers=1
npm run e2e -- --project=webkit --workers=1
npm run test:production
git diff --check
```

The production smoke test serves the built static assets locally with the configured security headers and checks downloads. It does not verify Cloudflare's deployed responses. Chrome CDP touch-drag/cancel injection is skipped in other engines; ordinary pointer, keyboard, layout and export checks still run. Keep logs and downloaded evidence local. Do not use private fixtures in public reports.

## Manual release checks

- Actual iPhone/Safari and Android/Chrome: upload through the native picker, scroll without moving masks, edit each tool, navigate PDFs, preview and save JPEG/PDF/ZIP. Check safe-area controls and browser download behavior.
- NVDA with Firefox/Chrome and VoiceOver with Safari: read upload guidance and errors, navigate region include/exclude controls, disclose styles/geometry, adjust using keyboard, operate comparison, trap/dismiss dialogs and confirm focus restoration.
- Browser zoom at 200% and 400%: check overflow, focus visibility, warning readability and access to download/support dismissal. Check reduced motion in system settings.
- Native save picker: cancel, retry, edit while a save dialog is pending and confirm stale output cannot be written. Test fallback downloads where the picker is unavailable.
- Low-memory devices: use progressively larger supported files, repeated scans/navigation/brush edits and cancellation. Record failures, responsiveness and useful memory proxies; never infer native/GPU peak memory from JS heap alone.
- First-time participants: observe Quick Clean and Custom Edit without instructions, including restoring an excluded face, covering a missed area, returning from preview, retrying a failed scan and declining support. Record assistance needed; automated tests do not establish novice usability.

Do not claim real-device coverage, complete WCAG compliance, universal OCR/face recall or perfect threat detection without separate evidence.
