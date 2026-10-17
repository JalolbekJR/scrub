# Security

## Scope

Scrub processes files locally in the browser. It has no upload endpoint, analytics, cloud OCR or remote reputation lookup. Runtime assets are served from the app's own origin. Optional GitHub, share and support links open only after a user action; there is no background GitHub API request.

The application depends on a trustworthy browser, operating system and served build. A malicious extension, compromised device or compromised application origin is outside these protections. This document is not a certification or external security audit.

## Processing and verification

Input signatures, file size, source dimensions, batch size and PDF page count are checked. Image inspection runs in a disposable worker with a deadline. PDF scripts and attachments are inspected as data, never executed. Extracted URLs are never visited. PDF evaluation is disabled. Malformed, unsupported, incomplete or over-limit input can fail closed; accepted PDF exports retain every page.

Opaque covers replace selected pixels. Blur and Mosaic preserve information and are cosmetic. Inspect every mask: detection and selected-pixel replacement do not guarantee anonymity or removal of all visible private content.

Exports are reconstructed JPEG images or raster PDFs, not edited originals. Supported original metadata, thumbnails, attachments, links, active content and selectable PDF text are omitted. Generated PDFs may include technical producer/date fields; verification does not promise a literally metadata-free file. Output verification checks structure, metadata and trailing data. Edits invalidate older output and verification. A verified export means these checks passed, not that every threat or sensitive region was detected.

The inspector uses bounded format parsing and contextual heuristics. A structural finding establishes presence, not malicious behavior. Prompt-injection text and suspicious link indicators need review. Compressed text, arbitrary embedded formats, encryption, steganography and exhaustive malware analysis are unsupported or limited. Re-encoding is not a guarantee against arbitrary steganography.

Native codecs, canvas, WebAssembly and GPU processing can still consume significant resources. Limits and cancellation reduce exposure but cannot establish a universal peak-memory bound. Browser filesystem properties are outside file-content inspection. Avoid opening untrusted files on devices without current browser/security updates.

## Supported versions and reporting

Security fixes target the current main branch; the public website may lag behind it. There is no promised response time or guaranteed support for older snapshots.

Use [GitHub private vulnerability reporting](https://github.com/JalolbekJR/scrub/security/advisories/new) if enabled. Otherwise contact the maintainer at the public address in package.json. Include affected version, impact and a minimal synthetic reproduction. Do not include private documents, credentials or extracted personal information. Avoid publishing exploit details before the maintainer has had an opportunity to assess and fix the issue. Private reporting settings have to be confirmed by the repository owner.
