# Architecture

Screens uses one local SQLite registry for the UI, CLI, and MCP. WAL and a busy
timeout coordinate writers. Mutable records use transactions and expected
revisions; stale updates return HTTP 409.

## Modules

| Area | Owner |
| --- | --- |
| Domain rules and persistence | `src/store.mjs` |
| Loopback HTTP and static UI | `src/server.mjs` |
| MCP transport and registry tools | `src/mcp.mjs` |
| Manifest adapters | `src/import.mjs` |
| Local commands | `src/cli.mjs` |
| Shared action catalog | `src/headless.mjs` |
| Jobs, schedules, and task claims | `src/automation.mjs` |
| Derived evidence and CI reports | `src/evidence-tools.mjs` |
| Bundles, backups, retention, and signing | `src/storage-tools.mjs` |
| Package-local Git and browser engines | `src/runtime.mjs` |
| React UI and shadcn controls | `ui/` |

Vite builds `dist/ui/`; the HTTP server serves that build. Standard controls use
shadcn, Radix, cmdk, and Vaul. Screenshot rendering and annotation geometry use
custom React components.

## Data model

| Record | Identity and behavior |
| --- | --- |
| Project | Stable key, name, optional repository identity |
| Screen | Stable external key within a project; represents a UI state |
| Variant | Device, viewport, browser, theme, locale, text scale |
| Capture | Immutable image and metadata, including role, revision, fixture, provenance |
| Run | Immutable capture set with at most one role per screen/variant |
| Note | Original capture anchor, normalized point/region, text, status, revision, fix evidence |
| Target approval | Capture/variant decision with revision and append-only history |
| Review set | Ordered screen/variant entries from one immutable run; edits require a revision |

Roles are `current`, `target`, and `pr`. Importing a target does not approve it.
Approvals and feedback changes preserve earlier evidence. Cross-platform logical
screen grouping remains planned work.

## Comparison and feedback

Comparisons match stable screen identity and exact variants. Missing sides stay
missing. Pixel measurements decode oriented sRGB RGBA through Sharp, record
thresholds and masks, and require equal dimensions. A hash difference is not a
visual measurement. See [Evidence contracts](evidence.md).

Area coordinates use normalized `x`, `y`, `width`, and `height`. Comments remain
on their original captures. Agents submit fresh evidence for the same screen and
variant; people verify fixes and approve targets.

Region measurements round the start down and the end up to decoded pixel
boundaries. Masks remain in original-image coordinates; counts and artifacts
cover the crop. Full-image and region measurements have distinct immutable IDs.

## Capture execution

Import and discovery do not execute projects. Working-tree and exact-commit
capture share one version 1 `applications[].scenarios` recipe and runtime:

| Module | Responsibility |
| --- | --- |
| `capture-recipe.mjs` | Normalize recipes, profiles, selections, and matrices |
| `discovery.mjs`, `capture-assets.mjs` | Read application markers, environment requirements, scenarios, and fixtures |
| `source-graph.mjs` | Parse supported routes, imports, and component relationships |
| `automatic-plan.mjs` | Draft settings with evidence; recompute configuration decisions |
| `auto-capture.mjs` | Execute browser, Apple, and command adapters |
| `capture.mjs` | Prepare exact Git checkouts and compare revisions |
| `capture-process.mjs` | Start commands and clean up process groups |
| `capture-environment.mjs` | Resolve settings, order services, wait for readiness, clean up |
| `capture-scenarios.mjs` | Resolve scenarios, fixtures, login, Storybook, and browser readiness |
| `fixture-boundaries.mjs` | Setup, reset, and teardown per run, scenario, or group |
| `native-contract.mjs` | Map declared Apple screens and request-specific readiness |
| `screen-inventory.mjs` | Bind source findings to evidence and required coverage |
| `capture-summary.mjs` | Group failures and next actions |

Browser contexts are isolated per scenario/variant. Backend fixture resets are
separate. Apple capture uses native windows or disposable simulators; command
adapters emit canonical evidence manifests. Working-tree capture does not prove
an isolated commit. Fixture capture does not prove live-account behavior.

Source confidence is `declared`, `referenced`, or `possible`. Uncertain components
stay in an optional backlog. Declared scope, configured scenarios, and explicit
required IDs determine completion. Capture creation and readiness are separate
results; diagnostic images remain evidence. Reports expose screens, scenarios,
variants, and candidates separately. See [Automatic capture](automatic-capture.md).

## Jobs and resume

The server runs the local scheduler and worker during `screens serve`. Jobs use
leases, heartbeats, ownership checks, events, and scenario/variant checkpoints.
Expired leases permit replacement workers; cancellation aborts the old worker.
Automatic attempts use a fresh worker context and module cache.

Checkpoints bind immutable captures and readiness to source, recipe, environment,
engine, and toolchain identities. Reuse requires unchanged inputs, passing
readiness, a fixture identity, and independent or reset state. Shared-state groups
and command batches rerun. Each attempt writes new artifacts and a new run.
See [resume rules](automatic-capture.md#automatic-capture-jobs-and-resume).

## Evidence and storage

Captures, diffs, and evidence are immutable; assets are content-addressed.
Measurements retain exact input IDs, hashes, algorithms, dimensions, and counts.
Evidence retains reporter-supplied assertions, observations, outcomes, and optional
attachments. Neither measurements nor CI reports change human decisions.

Schema additions cover diffs/evidence (v2), previews/idempotency (v3), review sets
(v4), and headless services (v5). Previews and ThumbHashes are derived by image
hash. Decode limits are 16 million pixels. Runs snapshot registered screens with
no captures as `uncoveredScreens`. Comparisons expose all `measurements`; the
older `pixelComparison` summary is limited to its `pixelComparisonPair`.

Backups use SQLite's online backup API and copy referenced assets. Retention
coordinates with asset writers in transactions. Managed Ed25519 signatures
identify a key and protect bytes; receiving registries explicitly trust signers.
See [Storage](storage-tools.md).

## UI state and writes

HTTP mutations accept an `Idempotency-Key` UUID v4; MCP uses `idempotencyKey`.
The service stores input fingerprints and results atomically. Reusing a key for
different input returns 409.

The UI caches reads and refreshes on focus, reconnect, and writes. Feedback
reopening has a seven-second Undo delay; failures restore server state. Approval
and verification wait for the server. Collapsible forms stay mounted to preserve
drafts, but closed content is hidden from view and keyboard navigation.

## Local trust boundary

Screens is a trusted single-user service. Host/Origin checks protect browser
requests; they are not account authentication. Local processes can reach the
human review API. MCP omits approval and verification as a workflow boundary.
Do not expose the service publicly.

MCP uses protocol `2025-03-26`, newline-delimited stdio, and stateless Streamable
HTTP. `GET /mcp` returns 405; SSE is not implemented. Image responses contain
actual image content. File access, project execution, and storage administration
remain CLI-only. PR metadata uses GitHub REST.

Installation supplies pinned platform Git, browser engines, English OCR, and
axe-core. Capture and OCR do not download dependencies at runtime. App build
commands still need the project's toolchain. Hosted authentication and other
remaining work are in the [Roadmap](roadmap.md).
