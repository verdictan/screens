# Standalone workflow proof

Run the fixture capture-to-review workflow and production restart checks without
GitHub Actions. Requires Docker and Compose v2:

```sh
bash scripts/prove-workflow.sh
```

To run on an SSH host and retrieve results:

```sh
bash scripts/prove-workflow.sh user@example.com
```

Replace the example destination. The remote host needs Docker, Compose, Bash,
tar, and sha256sum; the caller needs SSH/scp access. The proof image supplies
Node and Chromium. The first build needs package-network access.

## What runs

1. Build the production image and a separate browser-test image.
2. Run syntax, unit/DOM/skill, and live HTTP/stdio bridge checks.
3. Capture baseline, regression, and fixed commits from a temporary Git fixture.
4. Install client helpers, compare captures, add feedback, submit a fix through
   MCP, verify it in the UI, and measure the final difference.
5. Exercise keyboard controls, responsive layouts, evidence attachments, and
   in-process restart persistence.
6. Replay evidence through HTTP MCP into an empty production container, restart
   it, reconnect the proof client, and check persisted records and image hashes.

Each run uses a unique Compose project and disposable volume with no published
ports. It leaves the existing Screens service and volume untouched. Cleanup
removes test containers and their volume after reports are collected.

## Results

Artifacts stay under `test-results/docker-proof-<timestamp>-<pid>/`, including on
failure. SSH execution copies them back to the calling checkout.

| Artifact | Contents |
| --- | --- |
| `summary.json` | Overall status; only passes when every required stage passes |
| `runner.log`, `containers.log` | Commands, test output, server logs |
| `source-archive.sha256`, `*-image.json` | Tested source and image identities |
| `workflow/`, `deployment/`, `restart/` | Separate reports, screenshots, traces, videos |
| `captured-fixture.json`, `deployment-proof.json`, `restart-proof.json` | Exact captures and persisted review evidence |
| `skills/` | Client archives and checksums |

Open each phase's `report/index.html`. Missing, skipped, flaky, or failed required
browser tests cannot produce a pass.

This proves a deterministic web fixture, installed helpers, MCP transports, and
persistence. It does not prove full model sessions, live-account behavior, native
correctness, or human design acceptance. Automated approval actions belong only
to the disposable fixture. See [Recorded validation](validation.md) for the dated
run and source identity; that result predates later implementation changes.
