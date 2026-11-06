# Architecture

## Ownership

`src/store.mjs` owns domain rules and SQLite persistence. `src/server.mjs` owns
loopback HTTP and static serving. `src/mcp.mjs` exposes a deliberately small MCP
surface. `src/import.mjs` adapts project evidence. `src/cli.mjs` composes these
operations. `public/` contains the browser review interface with no build step.

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
- Note: immutable capture anchor, optional normalized point, text, status,
  revision, resolution and submitted evidence ID.
- Target approval: current approved capture per screen/variant and revision.
  An append-only event log records approval and feedback transitions.

Capture roles are current, target and pr. A proposed target is not automatically
approved. A PR result is not automatically the target. Approval changes do not
erase past events or images.

## Comparison semantics

Align on stable screen identity and exact variant fields. Never match by fuzzy
title alone. Missing sides remain missing. Identical file hashes mean identical
bytes; different file hashes do not prove a visual difference. The picker does
not compute pixel scores. Overlay requires identical decoded dimensions and does
not resize mismatched screenshots to manufacture alignment.

## Feedback semantics

Notes retain their original capture. Earlier notes are visible with a link to the
original evidence but are not drawn on newer images. Agents submit a fresh
implementation capture of the same screen and variant plus an explanation.
Human-facing UI offers verification and reopening. A stale expected revision
returns HTTP 409 rather than overwriting another edit.

## MCP

v0.1 targets protocol 2025-03-26, with initialize, ping, tools/list and tools/call.
It supports newline-delimited stdio and stateless JSON responses over Streamable
HTTP. GET /mcp returns 405; server-initiated SSE is not implemented. No tool exposes
arbitrary filesystem reads or shell execution. The explicit local CLI handles
manifest reads, import and GitHub CLI invocations. Image tool responses are actual
MCP image content blocks rather than filenames.

## Trust boundary

v0.1 is single-user and local. Host/Origin checks protect against cross-origin
browser requests. They are not multi-user authentication. Local scripts can reach
the human review API, so omitted MCP approval tools are a workflow convention,
not a security claim. Hosted operation needs authenticated actors, authorization,
transport security and enforced evidence provenance before enabling remote access.

## Capture execution

Import never executes a repository. PR metadata comes from gh, with exact head,
base and merge-base identifiers. Capture adapters are the next milestone. Native
applications must use native capture. Web screenshots must use fixture-controlled
browser sessions. Existing evidence can be imported without being falsely
presented as freshly verified runtime evidence.
