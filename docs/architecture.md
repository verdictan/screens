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
- Variant: device, theme, viewport, locale and text scale.
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
HTTP. GET /mcp returns 405; server-initiated SSE is not implemented. No tool exposes
arbitrary filesystem reads or shell execution. The explicit local CLI handles
manifest reads, import and GitHub CLI invocations. Image tool responses are actual
MCP image content blocks rather than filenames.

## Trust boundary

v0.2 is single-user and local. Host/Origin checks protect against cross-origin
browser requests. They are not multi-user authentication. Local scripts can reach
the human review API, so omitted MCP approval tools are a workflow convention,
not a security claim. Hosted operation needs authenticated actors, authorization,
transport security and enforced evidence provenance before enabling remote access.

## Capture execution

Import never executes a repository. PR metadata comes from gh, with exact head,
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
or verifies feedback. Evidence provenance is explicitly reporter-supplied; no
cryptographic attestation of execution is claimed. Downloads are attachments.

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
