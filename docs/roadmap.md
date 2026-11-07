# Delivery roadmap

## Milestone 1 — local registry and review foundation

Implemented: SQLite persistence, immutable image and run IDs, four manifest
adapters, Current/Target/PR picker, comparison overlay, feedback, approval
history, CLI, direct stdio MCP and HTTP MCP, client skill installer/packages,
Docker Compose, pixel diffs/masks and capture-linked semantic evidence.

Completed release checks: live HTTP integration, deterministic browser workflow,
responsive layouts, and production-container restart persistence. See the
[standalone proof](standalone-proof.md) for scope and evidence.

Remaining release checks: real Claude/Codex client sessions and live-account workflows.

## Milestone 2 — reproducible project loading and PR capture

Implemented for browser projects: versioned configuration, isolated exact-commit
capture, explicit execution, PR metadata and stale-head detection.

Remaining:
- Native capture adapters for Electron and iOS Simulator.
- Native and web fixture consistency checks.

## Milestone 3 — agent collaboration and coverage

- Expiring issue claims and collision handling.
- Screen metadata revision updates and rename/move lineage.
- Pagination and scoped retrieval for large screen libraries.
- Broader route/state coverage discovery (registered screens with no captures are already reported).
- Carry-forward feedback with explicit reconfirmation on changed screenshots.
- Legacy note migration and exported review JSON.
- Additional perceptual metrics and richer motion playback, preserving manual acceptance.

## Milestone 4 — shared hosting

- Authenticated people and agent identities with project-scoped access.
- Enforced reviewer-only approvals and signed capture provenance.
- Remote asset uploads, object storage and retention policy.
- Background job dispatch, audit views and CI integration.
- Signed releases and registry distribution for client packages.
