# Validation — v0.3 standalone proof

Observed on 7 November 2026 at 10:35 Europe/Madrid using Node 22.23.4 and Chromium
inside Docker on the SSH host. No GitHub Actions were used.

- Production and proof images built successfully.
- All 37 unit tests and the live HTTP/stdio bridge test passed.
- Syntax and bundled skill checks passed. Both 0.3.0 client packages built.
- All three browser phases passed: fixture workflow, production-container review,
  and browser/API persistence after container restart. None were skipped or flaky.
- Fresh captures covered baseline, deliberate regression, target and fixed revisions.
  Installed Claude and Codex helpers loaded captures and used stdio MCP. The production
  replay used HTTP MCP for registration, fix submission and evidence attachment.
- Feedback stayed anchored to the original capture. The UI exercised target approval,
  stale-revision rejection and fix verification in the disposable project.
- The difference fell from 4,392 pixels to zero out of 1,152,000 compared pixels,
  with zero tolerance and no masks.
- Dialog keyboard behavior and responsive layouts passed. The 912px and 390px
  screenshots were inspected.
- Feedback, target approval, evidence, JSON attachment, pixel measurement and four
  capture hashes persisted through the production-container restart.

The run exposed and corrected a missing project argument in the workflow test,
the proof client's network reconnection after restart, and JSON attachment downloads
that serialized a Buffer instead of returning the original bytes. A focused HTTP
regression test covers exact JSON attachment contents. Proof archives now exclude
extended file attributes to avoid macOS-to-Linux extraction warnings.

See [standalone proof](standalone-proof.md) for run `20261107T093348Z-85433`, the
source archive hash and local reports. The existing deployed service was not updated;
the proof used a separate production container and disposable volume.

This proves the deterministic web fixture and installed helpers, not Claude/Codex
language-model sessions, an actual GitHub PR, native runtime behavior, live-account
behavior, multi-user hosting or a person's design approval.
