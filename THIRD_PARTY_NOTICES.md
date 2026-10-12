# Third-party notices

Scrub is MIT licensed. Third-party components retain their own licenses. Full license texts in public/licenses/ are copied into the static build. The table records locked package notices, including optional jsPDF components; it does not imply every component runs for every file.

| Component | Version | License | Text |
|---|---|---|---|
| @babel/runtime | 7.29.10 | MIT | [notice](public/licenses/babel-runtime-LICENSE) |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 | [notice](public/licenses/fontsource-jetbrains-mono-LICENSE) |
| @fontsource/plus-jakarta-sans | 5.3.0 | OFL-1.1 | [notice](public/licenses/fontsource-plus-jakarta-sans-LICENSE) |
| @types/pako | 2.0.4 | MIT | [notice](public/licenses/types-pako-LICENSE) |
| @types/raf | 3.4.3 | MIT | [notice](public/licenses/types-raf-LICENSE) |
| @types/trusted-types | 2.0.7 | MIT | [notice](public/licenses/types-trusted-types-LICENSE) |
| base64-arraybuffer | 1.0.2 | MIT | [notice](public/licenses/base64-arraybuffer-LICENSE) |
| bmp-js | 0.1.0 | MIT | [notice](public/licenses/bmp-js-LICENSE) |
| canvg | 3.0.11 | MIT | [notice](public/licenses/canvg-LICENSE) |
| core-js | 3.50.0 | MIT | [notice](public/licenses/core-js-LICENSE) |
| css-line-break | 2.1.0 | MIT | [notice](public/licenses/css-line-break-LICENSE) |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) | [notice](public/licenses/dompurify-LICENSE) |
| dompurify | 3.4.16 | (MPL-2.0 OR Apache-2.0) | [notice](public/licenses/dompurify-LICENSE-MPL) |
| exifr | 7.1.3 | MIT | [notice](public/licenses/exifr-LICENSE) |
| fast-png | 6.4.0 | MIT | [notice](public/licenses/fast-png-LICENSE) |
| fflate | 0.8.3 | MIT | [notice](public/licenses/fflate-LICENSE) |
| html2canvas | 1.4.1 | MIT | [notice](public/licenses/html2canvas-LICENSE) |
| idb-keyval | 6.3.0 | Apache-2.0 | [notice](public/licenses/idb-keyval-LICENCE) |
| iobuffer | 5.4.0 | MIT | [notice](public/licenses/iobuffer-LICENSE) |
| is-url | 1.2.4 | MIT | [notice](public/licenses/is-url-LICENSE-MIT) |
| jspdf | 4.2.1 | MIT | [notice](public/licenses/jspdf-LICENSE) |
| node-fetch | 2.7.0 | MIT | [notice](public/licenses/node-fetch-LICENSE.md) |
| opencollective-postinstall | 2.0.3 | MIT | [notice](public/licenses/opencollective-postinstall-LICENSE) |
| pako | 2.2.0 | (MIT AND Zlib) | [notice](public/licenses/pako-LICENSE) |
| pdfjs-dist | 6.4.299 | Apache-2.0 | [notice](public/licenses/pdfjs-dist-LICENSE) |
| performance-now | 2.1.0 | MIT | [notice](public/licenses/performance-now-license.txt) |
| raf | 3.4.1 | MIT | [notice](public/licenses/raf-LICENSE) |
| regenerator-runtime | 0.13.11 | MIT | [notice](public/licenses/regenerator-runtime-LICENSE) |
| rgbcolor | 1.0.1 | MIT OR SEE LICENSE IN FEEL-FREE.md | [notice](public/licenses/rgbcolor-LICENSE.md) |
| stackblur-canvas | 2.7.0 | MIT | [notice](public/licenses/stackblur-canvas-LICENSE-MIT.txt) |
| svg-pathdata | 6.0.3 | MIT | [notice](public/licenses/svg-pathdata-LICENSE) |
| tesseract.js | 7.0.0 | Apache-2.0 | [notice](public/licenses/tesseract.js-core-LICENSE) |
| tesseract.js | 7.0.0 | Apache-2.0 | [notice](public/licenses/tesseract.js-LICENSE.md) |
| tesseract.js-core | 7.0.0 | Apache-2.0 | [notice](public/licenses/tesseract.js-core-LICENSE) |
| text-segmentation | 1.0.3 | MIT | [notice](public/licenses/text-segmentation-LICENSE) |
| utrie | 1.0.2 | MIT | [notice](public/licenses/utrie-LICENSE) |
| wasm-feature-detect | 1.9.0 | Apache-2.0 | [notice](public/licenses/wasm-feature-detect-LICENSE) |
| webidl-conversions | 3.0.1 | BSD-2-Clause | [notice](public/licenses/webidl-conversions-LICENSE.md) |
| whatwg-url | 5.0.0 | MIT | [notice](public/licenses/whatwg-url-LICENSE.txt) |
| zlibjs | 0.3.1 | MIT | [notice](public/licenses/zlibjs-LICENSE) |
| MediaPipe WASM and face model | 0.10.35 / model 1 | Apache-2.0 | [notice](public/licenses/mediapipe-APACHE-2.0.txt) |
| Tesseract English trained data | 4.0.0 | Apache-2.0 | [notice](public/licenses/tessdata-APACHE-2.0.txt) |

## Models, fonts and imagery

- MediaPipe BlazeFace short-range float16 model version 1 matches the [official model](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite). SHA-256: `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`. MediaPipe Apache-2.0 terms apply.
- English OCR data matches [Tesseract tessdata 4.0.0](https://github.com/tesseract-ocr/tessdata/tree/4.0.0). Decompressed SHA-256: `daa0c97d651c19fba3b25e81317cd697e9908c8208090c94c3905381c23fc047`. The tessdata repository is Apache-2.0 licensed.
- Vendored MediaPipe WASM matches the locked 0.10.35 package; JavaScript wrappers differ only in line endings. Keep the license when updating these assets.
- Fontsource bundles Plus Jakarta Sans and JetBrains Mono under SIL Open Font License 1.1. Copied notices include upstream copyrights. Fonts load locally.
- The NASA Eileen Collins portrait is a public-domain fixture, without endorsement. Sources and annotations are in [fixtures/README.md](fixtures/README.md). Other test rasters contain synthetic colors/text.
- Unused starter graphics and generated photographic audit evidence are not included in the release tree or build.

Review notices and vendored bytes when changing dependencies. Installed development tools and Node-only optional native canvas packages are not browser assets; their packages retain their own licenses.
