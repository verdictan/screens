# Evidence contracts

Measurements and checks bind to exact captures. They never approve targets or
verify fixes. See [Evidence tools](headless-evidence.md) for collectors and CI.

## Pixel comparison

POST `/api/diffs` or call MCP `diffs_create`:

```json
{
  "left": "LEFT_CAPTURE_ID",
  "right": "RIGHT_CAPTURE_ID",
  "threshold": 0,
  "masks": [{"x": 0, "y": 0, "width": 100, "height": 40}]
}
```

Captures must have the same stable screen and variant. Sharp decodes PNG/JPEG/WebP
into oriented sRGB RGBA, up to 16 million pixels. Multi-frame and corrupt images
are rejected. Unequal dimensions produce `dimension-mismatch`, with no rescaling,
score or image. Fixture mismatch or unknown fixture remains explicit in the result.

A pixel changes if the maximum absolute RGBA channel difference exceeds threshold
(integer 0–255). Alpha and even RGB values under transparency participate. There
is no perceptual/anti-aliasing forgiveness beyond the explicit threshold. Masks
are integer rectangles in decoded image pixels, must fit the image and cannot
exclude all pixels. Overlapping masks count once. Ratio is changed / unmasked pixels.

The persisted record includes exact capture IDs, input hashes, algorithm/decoder
versions, threshold, masks, dimensions, counts and timestamp. A SHA-256 ID covers
the measurement inputs. `GET /api/diffs/ID/image` returns its lossless PNG; pink is
changed, blue excluded and pale grayscale unchanged. `diffs_view` returns both the
metadata and MCP image content. A zero result records a measurement only.

Optional `region` uses normalized `x`, `y`, `width`, and `height`. Counts and the
difference artifact cover that crop; masks stay in original-image pixels.

## Semantic checks

POST `/api/evidence`, call `evidence_add`, or save this shape as a JSON file for
`screens evidence add FILE`:

```json
{
  "capture": "IMPLEMENTATION_CAPTURE_ID",
  "kind": "behavior",
  "method": "manual",
  "outcome": "pass",
  "assertion": "Escape closes the dialog and restores focus",
  "procedure": "Open the dialog with the keyboard; press Escape; inspect focus",
  "observation": "Dialog closed; focus returned to its trigger",
  "author": "Reviewer"
}
```

Only record that result after performing the procedure. When blocked, use
`outcome: "not-run"` and explain why in observation. Supported kinds are visual,
behavior, accessibility and motion; methods are manual, automated and screenshot.
Screenshot evidence supports visual checks only. Outcomes are pass, fail or not-run.

For automated pass/fail, attach the actual report as `artifactBase64` and
`artifactType`. Accepted types are text/plain, application/json, video/mp4 and
video/webm, with a 20 MB decoded limit. Manual checks can also attach recordings.
The bytes are hashed and kept unchanged. A claimed media type is reporter-supplied;
the service stores evidence, it does not validate the truth of report contents.

Records capture the original image hash, supplied source revision/fixture,
reporter and time. They are append-only: corrections create another record and
retain the original. `GET /api/evidence?capture=ID` and MCP `evidence_list` retrieve
them. Artifact URLs return attachment downloads. Earlier capture evidence stays
with that capture and is available through its evidence query; the picker shows
checks for the currently selected run's exact captures.

`acceptance: "not-assessed"` and `provenance: "reporter-supplied"` make the boundary
explicit. Evidence is not signed execution attestation and never silently verifies
feedback. Reviewers can inspect it alongside submitted images before deciding.
