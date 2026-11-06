# Validation — v0.3 work in progress

Observed locally on 7 November 2026 using Node 22.23.4.

- Production React/shadcn/Tailwind build passed.
- 25 service/registry/skill tests passed. The migrated production-bundle DOM test
  passed after correcting its asynchronous event sequencing (26 tests total).
- Syntax and bundled skill validation passed. Both 0.3.0 client packages built.
- Live browser inspection confirmed the running Kalkidan registry renders the new
  sidebar and side-by-side comparison at a 912px browser width.
- The automated browser suite was attempted locally. Chromium startup was denied
  by the execution sandbox before any test ran. This is not an E2E pass.
- SSH to the requested Docker host was attempted with noninteractive authentication.
  The session denied the TCP connection with Operation not permitted before contact
  with the host. Remote Docker deployment is not verified.

CI now includes the real browser capture/review/MCP/restart scenario, saved screenshots,
trace/video, actual PR base/head picker captures and Docker persistence checks.
CI results must be checked before reporting those stages as passed.

The E2E workflow uses a deterministic web fixture. It exercises installed Claude and
Codex helpers and the real stdio MCP protocol; it does not execute either language
model. Native runtime behavior, live-account behavior and multi-user hosting remain
outside this proof. Previous client-discovery observations are documented in the
v0.2 commit history.
