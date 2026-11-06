# Validation — v0.2

Observed on 6 November 2026 using Node 22.23.4.

## Passed

- Clean `npm ci` from a prepared offline npm cache, with install scripts enabled.
  Sharp 0.35.5 and its native Darwin ARM64 binary loaded successfully. The lockfile
  retains Linux platform packages for Docker/CI; Linux installation is checked by CI.
- 25 application/skill tests passed; the subsequently added picker DOM integration
  test also passed. Targeted suites were rerun after the saved-diff reporting fix.
- Syntax and skill metadata/resource validation passed; both client archives were
  built, checked for required files, and matched their SHA-256 manifests.
- Diff tests cover exact changed counts, lossless output, thresholds, overlapping
  masks, full/out-of-bounds masks, equal pixels with different encoded bytes,
  dimension/fixture mismatch, corrupt data, variant mismatch and MCP image output.
- Evidence tests cover immutable original capture/revision binding, retained
  corrections, artifact bytes, missing automated reports and rejecting screenshot
  proof of behavior/accessibility/motion.
- Picker DOM integration uses the actual app script, HTTP handler and SQLite store
  without a TCP socket. Navigation, saved diff retrieval, masks, evidence, notes,
  target approval and search passed. This is functional DOM testing, not a rendered
  browser/responsive-layout test.
- Both client skill layouts were installed in a temporary project. One helper
  loaded a manifest; the other compared it and submitted capture-bound feedback
  through MCP using the same registry. Installer rejects accidental overwrites.
- Claude Code 2.1.314 discovered the Screens skill and `/screens` command. Its real
  MCP connection health check reported Connected using isolated test configuration.
- Codex CLI 0.167.0 accepted/read the exact stdio MCP configuration using command-line
  overrides; no global client configuration was changed.
- A fresh agent followed only the installed skill to import the real Kalkidan
  repository: 121 screens, 209 captures (121 targets, 88 current), 33 missing current
  captures, no PR captures. It inspected actual current/target images and the diff
  for mac/m01: 350,478 of 952,800 pixels (36.784005%) changed, threshold 0, no masks.
  The agent correctly preserved unknown source revisions/fixture fidelity and
  proposed-target status. Historical imports do not prove the current checkout.
- The earlier console import covered 11 stable screens and 66 captures, aligned
  into 22 screen/variant entries. No screenshots or registry files are committed.

## Blocked or pending

- Live HTTP/bridge integration was attempted: the workspace rejects loopback
  binding with `listen EPERM`. The separate test remains enabled in CI.
- Local Docker startup could not run: this host's Docker CLI has no Compose plugin
  and no reachable daemon socket. Compose config/build/health/persistence checks
  are included in GitHub Actions; do not treat them as passed until CI completes.
- A rendered browser check could not run. Browser policy rejected a local-file
  rendering fixture, and a local HTTP service is blocked as above. Responsive
  visual QA remains pending; the offline fixture is not a deployment.
- Codex app-server could not initialize its SQLite state under the protected user
  configuration directory, so live Codex tool discovery/model execution remains
  unverified. A Claude model turn with isolated configuration reported not logged
  in; slash-command discovery and MCP connection were verified separately.
- Docker-configured helper routing is exercised with a recording executable;
  it verifies mount/argument construction, not a running Docker engine.

## Release checks

GitHub Actions runs clean dependency installation, syntax, the application and live
HTTP suites, skill packaging, then Compose startup/MCP/HTTP and persistence across
restart. The deployment job keeps its database in an isolated CI Compose project.
Review CI and run a live picker session with both clients before calling this a
fully validated local release. These constraints do not imply hosted/multi-user
readiness; authentication and automatic PR capture are separate milestones.
