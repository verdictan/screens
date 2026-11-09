# Headless evidence and reports

These operations use the existing registry. They do not approve targets or verify
feedback. Derived records bind to an exact capture and remain immutable.

Commands below use `screens ACTION --input FILE`. Direct scalar options are also
available. Capture settings are part of an explicitly executed browser recipe;
importing a manifest does not run collectors.

## Browser evidence

Add `evidence` inside a browser application in `screens.capture.json`:

```json
{
  "evidence": {
    "dom": true,
    "console": true,
    "network": true,
    "fonts": true,
    "accessibility": {"options": {"runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa"]}}},
    "selectors": [
      "[data-testid=checkout-total]",
      {
        "selector": "[data-testid=pay-button]",
        "text": "Review the placement of the payment button",
        "author": "Capture recipe"
      }
    ]
  }
}
```

Collectors run before the screenshot and bind their data to its capture ID.
Fonts are enabled by default; other optional collectors need explicit settings:

- `dom`: URL, title, and serialized HTML. HTML remains evidence data; Screens does
  not serve it as an application page.
- `console`: browser console messages and uncaught exceptions from that screen's
  navigation and capture session.
- `network`: failed requests and HTTP responses with status 400 or greater. The
  collector does not retain response bodies or request headers.
- `fonts`: declared font faces and computed font use on visible text elements.
  Chromium also records platform font families and glyph counts through CDP.
  Firefox and WebKit report that platform font inspection is unavailable.
- `accessibility`: the actual axe-core report. Capture options control the rules
  and context. The report also becomes capture-bound accessibility evidence.
  Incomplete results need human review. A clean scan does not prove complete
  accessibility.
- `selectors`: the bounds of each configured selector, normalized to the screenshot.
  Each selector must match one element. An optional `text` creates an area comment.
- `environment`: browser and runtime metadata supplied by the capture runner.
- `fixture`: structured fixture metadata supplied by the capture runner.

The collector moves from listening to collecting, then back to listening.
Disposal is terminal. One page has one active collection at a time. Reset or
main-frame navigation invalidates an in-progress observation. The capture runner
checks the same observation identity after screenshot creation, before registering
the image. This detects navigation between observation and capture; it does not
freeze all dynamic page content. Derived records, generated area comments and
accessibility evidence attach in one registry transaction.

Read a collector result without opening the UI:

```sh
screens derived_list --capture CAPTURE_ID --kind console
screens derived_get --id DERIVED_ID
```

`derived_list` supports `kind`, text `query`, `limit` (up to 200), and the numeric
`cursor` returned as `nextCursor`. The same read operations are exposed over MCP.

## Select regions by selector

Record a selector during capture, then create a comment from its stored geometry:

```sh
screens selector_annotate --capture CAPTURE_ID \
  --selector '[data-testid=checkout-total]' \
  --text 'Increase contrast on this total' --author Reviewer
```

The operation uses geometry from the original capture. It does not locate the
selector on a newer page and attach that position to an older screenshot. Supply
`geometry` with a derived record ID to choose a particular geometry record.
Viewport screenshots clip the selected region to the viewport; full-page
screenshots use document coordinates. Off-screen regions cannot become comments.

## OCR and copy changes

OCR uses the bundled English model locally through CLI, MCP, or HTTP:

```sh
screens ocr_extract --capture CAPTURE_ID --language eng --psm 3
screens ocr_search --query 'Create account' --project PROJECT_ID
screens text_compare --left BEFORE_CAPTURE --right AFTER_CAPTURE
```

Sharp decodes the registered image. A package-local worker runs OCR and stops
after the operation, with no CDN access or model cache.

Segmentation modes 3–11 and 13 are available. Modes that need a separate orientation
model are excluded. Records contain the engine version, model, segmentation mode,
recognized lines and words, confidence values, pixel bounds, and normalized word
regions.

`ocr_search` searches saved OCR, returns matching lines and coordinates, and
supports a numeric cursor and limit. It does not run OCR implicitly.
`text_compare` uses saved OCR for both captures and records added and removed
line groups. Supply `leftOcr` and `rightOcr` to pin the exact extraction records.
OCR changes can include recognition errors; the originals remain available.

## Source links

Link feedback or evidence to a repository-relative source location:

```json
{
  "capture": "CAPTURE_ID",
  "note": "NOTE_ID",
  "file": "ui/Checkout.jsx",
  "symbol": "CheckoutSummary",
  "line": 42,
  "revision": "CAPTURE_SOURCE_REVISION"
}
```

```sh
screens source_link --input source-link.json
screens source_links --capture CAPTURE_ID
```

`note` and `evidence` are optional. If supplied, they must belong to that capture.
The source revision must equal the capture revision. Links are append-only,
reporter-supplied metadata; the operation does not read source files or claim that
it has verified the symbol. MCP can add and retrieve these links.

## Perceptual measurements

```sh
screens perceptual_compare --left BEFORE_CAPTURE --right AFTER_CAPTURE
```

The measurement records mean SSIM over non-overlapping 8 × 8 luminance blocks,
normalized RGB root mean square error, and PSNR. It uses oriented sRGB images
composited on white, keeps original dimensions, and records the algorithm and
Sharp version. Unequal dimensions produce an unmeasured result. Identical images
have `identical: true`; their infinite PSNR is represented by `null`.
These measurements supplement the existing pixel diff and do not decide acceptance.

## Fixture contracts

A contract checks the capture's fixture name and its recorded fixture metadata:

```json
{
  "capture": "AFTER_CAPTURE",
  "other": "BEFORE_CAPTURE",
  "contract": {
    "name": "checkout-fixture",
    "version": "2026-11",
    "required": ["customer.id", "cart.items"],
    "equals": {"currency": "EUR", "cart.items": 3}
  }
}
```

```sh
screens fixture_check --input fixture-contract.json
```

Fields use dot-separated paths. `equals` compares JSON values. `other` also
compares the fixture names and recorded versions. Missing fields and differences
are recorded as issues. The operation does not change the fixtures or run a
project to obtain missing data.

## CI policies

Save a policy invocation as JSON:

```json
{
  "run": "COMPARISON_RUN_ID",
  "policy": {
    "pair": ["current", "pr"],
    "maxChangedRatio": 0.01,
    "maxChangedPixels": 1000,
    "threshold": 4,
    "requireMatchingFixture": true,
    "maxAccessibilityViolations": 0,
    "failOnConsoleErrors": true,
    "failOnNetworkErrors": true,
    "requireEvidence": ["dom", "environment"]
  }
}
```

```sh
screens ci_evaluate --input ci-policy.json
```

To report capture jobs, supply `jobs` with job IDs. A `run` is optional for a
job-only report. Failed and cancelled jobs become failed checks; queued and
running jobs become skipped checks. Completed jobs pass the capture execution
check without approving their resulting images.

The result includes `status`, `exitCode`, `passed`, `complete`, individual checks,
and a stored report ID. The CLI uses the returned exit code. Policies run only
when invoked.

| Status | Meaning | Exit code |
| --- | --- | --- |
| `passed` | No failed or unfinished required checks | 0 |
| `failed` | At least one check failed; other work can still be pending | 1 |
| `pending` | Capture jobs have not finished and no check has failed | 2 |
| `incomplete` | Required observations need review and no check has failed | 2 |

`complete` is false while jobs or required observations remain unfinished, even
when a separate check has already failed. For an accessibility threshold, an axe
report with incomplete results is not a pass when its violation count is within
the threshold. Exceeding the threshold is a failure. Inspect unresolved results
and obtain conclusive evidence or explicitly change the policy scope.

`workflow.nextActions` identifies failures to resolve, jobs to wait for, or
observations to complete. `workflow.recheck` supplies the `ci_evaluate` action
and its original arguments. Re-evaluation remains explicit and writes a new
immutable result when the observations change. These reports use `ci-policy-v2`;
existing reports are not rewritten.
Missing required evidence fails the corresponding check. Missing capture pairs
and uncovered screens fail unless `failOnMissing` is `false`, which reports them
as not run. Pixel checks create or reuse immutable pixel measurements.

Optional policy fields are `minSsim`, `fixtureContract`, `region`, and `masks`.
The region uses normalized coordinates; masks use original image pixels.
A policy must select at least one check. Policy results do not update approvals
or feedback status.

## SARIF, JUnit, and Markdown

Read a formatted report through CLI or MCP:

```sh
screens ci_report --report REPORT_ID --format sarif
```

Write a new file through the CLI:

```sh
screens report_export --report REPORT_ID --format sarif --output result.sarif
screens report_export --report REPORT_ID --format junit --output result.xml
screens report_export --report REPORT_ID --format markdown --output result.md
```

Supported formats are `sarif`, `junit`, `markdown`, and `json`. SARIF uses version
2.1.0 and includes source links when recorded. JUnit includes failed and skipped
checks plus the derived policy status. Markdown distinguishes pending and
incomplete results from failures. SARIF marks unfinished policy execution as
incomplete through its invocation result and records the policy status. File export creates a new file and does not overwrite an existing report.

## Pull-request review package

```sh
screens review_report --run RUN_ID --output new-review-directory
```

The directory contains `review.md`, `report.json`, and an `assets` directory with
original captures, difference maps, and attached evidence. The JSON includes
capture-bound notes, measurements, source links, derived records, run metadata,
and decision state. The Markdown uses relative image links so the directory can
be attached as an artifact. The command does not post to a remote service.

## Implementation references

- [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/v7.0.0/docs/api.md)
- [Packaged Tesseract language data](https://github.com/naptha/tessdata/blob/gh-pages/README.md)
- [axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
- [Chromium platform font inspection](https://chromedevtools.github.io/devtools-protocol/tot/CSS/#method-getPlatformFontsForNode)
