# Architecture

## Ownership

`src/store.mjs` owns domain rules and SQLite persistence. `src/server.mjs` owns
loopback HTTP and static serving. `src/mcp.mjs` exposes a deliberately small MCP
surface. `src/import.mjs` adapts project evidence. `src/cli.mjs` composes these
operations. `ui/` contains the React review interface, shadcn primitives and Tailwind styling. Vite builds `dist/ui/`, which the same HTTP server serves.

There is one database, not one JSON review file per browser. Direct stdio clients
open the same database. WAL and a busy timeout coordinate writers across processes.
Feedback and target changes use transactions plus explicit expected revisions.

## Data model

- Project: stable key, display name, optional repository identity.
- Screen: project plus stable external key; a screen entry represents a state.
  Platform-specific legacy keys are preserved. Cross-platform logical grouping is
  future work rather than an inferred mapping.
- Variant: device, theme, viewport, locale, text scale and browser.
- Capture: screen, variant, role, source revision, fixture, provenance and hash.
  Metadata and image bytes determine the ID. Captures cannot be overwritten.
- Run: a frozen set of capture IDs, with at most one role per screen/variant.
- Note: immutable capture anchor, optional normalized point or rectangular region, text, status,
  revision, resolution and submitted evidence ID.
- Target approval: current approved capture per screen/variant and revision.
  An append-only event log records approval and feedback transitions.

Capture roles are current, target and pr. A proposed target is not automatically
approved. A PR result is not automatically the target. Approval changes do not
erase past events or images.

## Comparison semantics

Align on stable screen identity and exact variant fields. Never match by fuzzy
title alone. Missing sides remain missing. Identical file hashes mean identical
bytes; different file hashes do not prove a visual difference. Pixel comparisons decode through Sharp to oriented sRGB RGBA and compare the
maximum absolute channel difference against a recorded integer tolerance.
Lossless PNG artifacts mark changes and explicit excluded regions. Overlay requires identical decoded dimensions and does
not resize mismatched screenshots to manufacture alignment.

## Feedback semantics

Notes retain their original capture. Area comments store a region with normalized
`x`, `y`, `width`, and `height`, so the mark scales with the preview. Earlier notes are visible with a link to the
original evidence but are not drawn on newer images. Agents submit a fresh
implementation capture of the same screen and variant plus an explanation.
Human-facing UI offers verification and reopening. A stale expected revision
returns HTTP 409 rather than overwriting another edit.

## MCP

v0.2 targets protocol 2025-03-26, with initialize, ping, tools/list and tools/call.
It supports newline-delimited stdio and stateless JSON responses over Streamable
HTTP. GET /mcp returns 405; server-initiated SSE is not implemented. Registry tools do not expose
arbitrary filesystem reads or shell execution. Headless file and execution actions
are available only through the explicit local CLI. The explicit local CLI handles
manifest reads and import. PR metadata uses the GitHub REST API. Image tool responses are actual
MCP image content blocks rather than filenames.

## Trust boundary

v0.2 is single-user and local. Host/Origin checks protect against cross-origin
browser requests. They are not multi-user authentication. Local scripts can reach
the human review API, so omitted MCP approval tools are a workflow convention,
not a security claim. Hosted operation needs authenticated actors, authorization,
transport security and enforced evidence provenance before enabling remote access.

## Capture execution

Import never executes a repository. PR metadata comes from GitHub REST, with exact head,
base and merge-base identifiers. The explicit browser adapter clones exact commits into temporary checkouts, runs reviewed argument-array commands, captures matching variants, records provenance and removes temporary checkouts. Native
applications must use native capture. Web screenshots must use fixture-controlled
browser sessions. Existing evidence can be imported without being falsely
presented as freshly verified runtime evidence.

## Evidence storage (schema v2)

`diffs` records immutable left/right capture IDs, original byte hashes, algorithm
and decoder versions, tolerance, masks, dimensions, fixture status and measured
counts. Size mismatches produce a stored not-measured result with no image. The
same inputs reuse the same record. Images are capped at 16 million decoded pixels.

`evidence` records immutable capture-bound assertions, procedures, observations,
reporter identity, method and reported outcomes. Optional text/JSON/video artifacts
are content-addressed in assets. Neither a pass nor a zero diff promotes targets
or verifies feedback. Evidence provenance is explicitly reporter-supplied. Optional bundle signatures
identify the signing key and protect exported bytes; they do not attest execution. Downloads are attachments.

New runs snapshot registered screens with no captures as uncoveredScreens. This
preserves known coverage gaps without manufacturing evidence or changing old runs.
Schema v2 adds tables and an evidence index; it retains all v1 rows and assets.

Run comparisons expose `measurements` for all measured pairs of exact captures.
The older `pixelComparison` byte-level summary is explicitly scoped by
`pixelComparisonPair` to current/pr; it is not a summary of target comparisons.

## Workspace responsiveness

Schema v3 adds derived image previews and idempotency records. Preview dimensions
and ThumbHashes are stored by image hash, separately from immutable captures.
Uploads prepare previews before returning; imported images prepare them when first
opened in the review service. Preview decoding has the same 16-million-pixel limit
as comparisons.

HTTP mutations accept an `Idempotency-Key` UUID v4. MCP mutation tools accept
`idempotencyKey`. The shared operation service persists the request fingerprint
and result with the write. Reusing a key with different input returns 409. Pixel
diffs remain content-addressed, including when concurrent requests compute them.

The browser caches reads in memory and refreshes active queries on focus, reconnect,
and writes. Revision checks remain authoritative. Reopening feedback is optimistic
with a seven-second Undo window before sending the update; failures restore the
server state. Approvals and verification wait for the server.

## UI components

Standard interactions use local shadcn components in `ui/components/ui/`.
Command uses cmdk inside a Radix Dialog on desktop and a Vaul Drawer on phones.
The mobile library also uses Drawer. Forms compose Field, FieldLabel, FieldSet,
Input, Textarea, and NativeSelect; disclosures use Collapsible and the image
blend uses Slider. ToggleGroup owns exclusive view and filter choices. Alerts
and Sonner provide notices and notifications. The seven-second Undo delay stays
in the application service.

Collapsible content remains mounted to preserve form drafts and to let command
search reveal nested controls. Closed content is hidden from view and keyboard
navigation. Screenshot rendering and annotation geometry remain custom React
components. Shared styles apply the Verdictan palette to the primitives.

## Review sets and selected areas

Schema v4 adds review sets. Each set belongs to one immutable run and stores an
ordered list of exact screen/variant entry keys. Changes to its name, membership,
or order require the expected revision. Updates append an event and never change
run captures. The library and previous/next controls follow the selected set's
order. HTTP and MCP use the same review-set operation and store methods.

Area selection uses normalized capture coordinates. A selection can become a
capture-bound comment or select the region to compare. Existing area comments
are selectable only when their original capture belongs to the displayed pair.
Both previews show that region; source images remain unchanged.

Pixel diffs include the normalized region in their immutable identity. Measurement
uses the same rectangle on equal-sized decoded captures, rounds its start down
and end up to pixel boundaries, and records the resulting `regionPixels`.
Excluded masks remain in original image coordinates. Counts cover only the crop,
and the difference artifact contains only the crop. Full-image results and region
results are distinct records. Size mismatches remain unmeasured.

## Headless services (schema v5)

`src/headless.mjs` publishes one action catalog shared by the CLI, MCP, and HTTP.
Descriptors include input schemas and CLI-only access for file paths, capture
execution and storage administration. OCR uses bundled WASM code and English
language data for registered captures, and is available through MCP.
The CLI reads a JSON input file or typed flags. MCP uses underscore action names;
HTTP exposes registry actions under `/api/automation/`.

`src/automation.mjs` persists capture jobs, leases, checkpoints, progress events,
schedules and agent claims. A queued capture freezes its
expanded recipe and resolved commit. Workers renew leases and save each capture
before recording its checkpoint. Expired leases allow a replacement worker to
resume; cancellation invalidates ownership and aborts the old worker. The server
starts and stops the local scheduler and worker with its own lifetime.

Schedules run while `screens serve` is active. Creating a capture job or schedule
requires explicit execution authorization. Import and discovery never enqueue
captures. The local event log supports cursor reads and `events-watch` streams;
there are no external webhook endpoints or distributed-worker connections.

`src/evidence-tools.mjs` stores immutable derived evidence and source links apart
from captures. Browser collectors record DOM, accessibility, console, network,
fonts, fixtures, and selector bounds when configured. OCR uses a packaged Tesseract.js worker, WASM core, and English model without
runtime downloads or an external executable. Perceptual scores retain exact dimensions and algorithm identity.
CI reports have their own immutable table and can include job-only failures.
A CI result never changes a target approval or feedback verification.

`src/storage-tools.mjs` implements portable bundles, online SQLite backups,
restore, integrity reports, usage accounting, retention plans, and signatures.
Capture and artifact insertion transactions coordinate with explicit unreferenced
asset removal. Assets stay in the local registry. Screens creates and manages a
local Ed25519 signing key. Public keys can be exported and explicitly trusted
by another registry; signatures never establish their own trust.

`src/runtime.mjs` supplies the bundled Git executable and package-local Chromium, Firefox, and WebKit.
Normal package installation downloads their pinned platform binaries. The
installer also installs required browser system libraries on supported Linux.
Capture and OCR do not download dependencies at runtime. Application-specific
build commands still use the application project's own toolchain.

See [headless features](headless.md) for command contracts and operating limits.
