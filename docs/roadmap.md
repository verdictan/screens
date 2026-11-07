# Delivery roadmap

## Local registry and review

Implemented: SQLite persistence, immutable capture and run IDs, manifest import,
Current/Target/PR comparison, overlays, point and area feedback, review sets,
approval history, CLI, MCP, pixel differences, and capture-linked evidence.

Earlier release checks covered live HTTP integration, browser workflows,
responsive layouts, and restart persistence. See the [standalone proof](standalone-proof.md)
for the scope of that evidence. Those checks predate the latest headless and
bundling changes.

Remaining release checks include installed-package workflows, real agent-client
sessions, and live-account behavior.

## Capture automation

Implemented for browser projects: explicit capture recipes, isolated exact-commit
capture, profiles, browser/device/theme/locale matrices, managed Chromium, Firefox,
and WebKit, repeatable fixtures, source-change selection, static route discovery, resumable local jobs,
and exact merge-candidate capture. The Screens service processes authorized jobs
and saved schedules without separate worker or scheduler services.

Remaining:

- Native capture adapters for Electron and iOS Simulator.
- Native fixture adapters.
- Route and state discovery beyond supported static routes and source patterns.

## Evidence and agent collaboration

Implemented: expiring task claims, paginated and scoped retrieval, local event
streams, handoff packages, bundled English OCR, text reports, browser observations,
accessibility results, source-linked feedback, and supplementary perceptual
measurements. CI policies export machine-readable reports. Portable bundles
retain exact capture and decision records.

Remaining:

- Additional bundled OCR language models.
- Screen metadata revision updates and rename/move lineage.
- Carry-forward feedback with explicit reconfirmation on changed captures.
- Legacy note migration.
- Richer motion playback and additional perceptual algorithms.

## Local installation and storage

Implemented: local registry backups and restore, usage and integrity reports,
retention plans, and managed Ed25519 signatures. Screens creates its signing key
when first used. Git, Chromium, Firefox, WebKit, and the OCR runtime are managed
by the Screens installation. The local product has no remote storage or worker service to set up.

Remaining:

- Installed-package release coverage across supported operating systems.
- Additional installer recovery and upgrade scenarios.
- Signed releases and registry distribution for client packages.

The [headless guide](headless.md) documents the available commands. Implementation
is separate from release verification. The latest headless and bundling changes
have not been exercised by tests, builds, live captures, or browser checks during
this implementation task.
