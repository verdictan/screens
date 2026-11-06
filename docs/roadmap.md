# Delivery roadmap

## Milestone 1 — local registry and review foundation

Implemented: SQLite persistence, immutable image and run IDs, four manifest
adapters, Current/Target/PR picker, comparison overlay, feedback, approval
history, CLI, direct stdio MCP and HTTP MCP, distributable skill source.

Remaining release checks: live HTTP integration on an unrestricted loopback host,
browser functional and responsive verification, real Claude/Codex client sessions.

## Milestone 2 — reproducible project loading and PR capture

- Versioned project configuration and validated schema.
- Project-specific capture adapters for browser, Electron, and iOS Simulator.
- Isolated build directories; immutable merge-base and head capture provenance.
- Explicit execution policy for repository commands; no import-time execution.
- GitHub PR URL/number resolution, stale-head detection and precise status reporting.
- Native and web fixture consistency checks.

## Milestone 3 — agent collaboration and coverage

- Expiring issue claims and collision handling.
- Screen metadata revision updates and rename/move lineage.
- Pagination and scoped retrieval for large screen libraries.
- Missing-state coverage independent of successful captures.
- Carry-forward feedback with explicit reconfirmation on changed screenshots.
- Legacy note migration and exported review JSON.
- Optional image diff artifacts and masks; retain semantic/manual review.

## Milestone 4 — shared hosting

- Authenticated people and agent identities with project-scoped access.
- Enforced reviewer-only approvals and signed capture provenance.
- Remote asset uploads, object storage and retention policy.
- Background job dispatch, audit views and CI integration.
- Packaging and installation for Claude Code and Codex.
