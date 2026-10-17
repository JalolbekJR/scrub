# Test fixtures

`astronaut.png` is the 512 × 512 NASA photograph of Eileen Collins distributed
by scikit-image v0.25.2. Download source:
https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png

Scikit-image identifies it as public domain with no known copyright restrictions:
https://scikit-image.org/docs/stable/api/skimage.data#skimage.data.astronaut
The photograph is used solely as a detector regression fixture, without implying
endorsement. The manually annotated face rectangle is `(175,65,100,115)`;
browser tests derive scaled and rotated annotations from those coordinates.
Matching requires intersection-over-union ≥ 0.3 with one-to-one assignment.
Repeated copies measure placement, not demographic diversity.

`black.jpg`, `black.png`, and `with-exif.jpg` are synthetic 2 × 2 images created
with Pillow. The EXIF variant contains the synthetic author `PRIVATE AUTHOR`.
OCR documents and PDF fixtures are generated in tests from invented text.
`orientation-6.jpg` is a synthetic 120 × 80 red image with a green 20 × 20
upper-left corner and EXIF orientation 6, created with Pillow. Its decoded
display is 80 × 120 with the green corner at the upper right.
There are no private documents or user photographs in this set.

`ocr-quarter-turns.png` is a synthetic 1000 × 360 raster for cross-browser OCR.
It contains invented email, phone, card and prefixed-name fields, plus negative
date and order examples. It was rasterized in Chrome with 28px monospace at
`(30,45 + 50 * line)` in `#202060` on white. Tests rotate these fixed pixels
rather than resolving a different platform monospace font in each engine.
All four fields and their downloaded pixel coverage remain required at every
quarter turn. This does not establish accuracy for arbitrary fonts.

Run `npm run e2e -- e2e/accuracy.spec.ts e2e/geometry.spec.ts` to measure the
fixture set and inspect actual encoded pixels. Set `SCRUB_BROWSER_EXECUTABLE`
to an installed Chrome path if Playwright Chromium is unavailable. The accuracy
test attaches JSON measurements to its report. This small set does not establish
accuracy across different people, scripts, lighting, handwriting, or layouts.

`ocr-small-text.png` is a deterministic synthetic 500 × 180 raster containing the
same six invented OCR lines. It was drawn at 1000 × 360 with 28px DejaVu Sans
Mono (black on white), then reduced by half with Canvas interpolation. DejaVu's
additions are public domain; the base typeface is licensed under the Bitstream
Vera license. This asset contains rendered text only, not redistributed font
software. The original pixels reproduce the small `@` glyph being read as `g`.
The four sensitive fields remain mandatory at every quarter turn, with actual
downloaded JPEG ink coverage checked independently from OCR bounding boxes.
