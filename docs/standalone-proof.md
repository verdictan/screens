# End-to-end proof without GitHub Actions

Run from a checkout on a machine with Docker and Compose v2:

```sh
bash scripts/prove-workflow.sh
```

Or send the source snapshot to the Docker host and retrieve the results:

```sh
bash scripts/prove-workflow.sh dennisotugo@192.168.1.142
```

The SSH form requires SSH/scp access from the calling terminal; it cannot bypass
the assistant session's network restrictions. The host requires Docker, Compose,
Bash, tar and sha256sum. Node and Chromium are installed inside the proof image.
The first build needs package-network access. No GitHub account or Actions runner
is used. The source archive contains only the explicitly listed implementation,
tests and fixture directories, not local registries, dependencies or credentials.

## What runs

1. Build the unchanged production Dockerfile and a separate browser-test image.
2. Run syntax checks, unit/DOM/skill tests and the live HTTP/stdio bridge test.
3. Create a temporary Git fixture with baseline, regression and fixed commits.
   Capture each revision in a real Chromium browser, install both client helpers,
   load captures, annotate the regression, approve a test target, submit a fix via
   MCP, verify it in the picker and assert the pixel difference falls to zero.
4. Check keyboard dialog behavior, record the evidence artifact, test responsive
   layouts, and restart the in-process registry.
5. Replay the captured images through HTTP MCP into an empty production container.
   Exercise comparison, pinned feedback, approval, conflict rejection, fix
   submission, UI verification, behavioral evidence and a zero final difference.
6. Restart the production container and check the persisted note, approval,
   evidence attachment, diff, and original/fixed image SHA-256 hashes via the UI/API.

Each run uses a unique Compose project, a disposable volume, and no published
ports. The proof client shares only the isolated registry's network namespace.
The existing `screens` service, its volume and port 4900 remain untouched. Cleanup
removes only the uniquely named test containers and test volume after collecting
evidence. Images remain cached for later runs.

## Inspect results

Results are copied to `test-results/docker-proof-<timestamp>-<pid>/`, including on
test failure. The SSH variant copies that directory back to the calling checkout.

- `summary.json`: `passed` only after every required stage succeeds; failures exit
  nonzero. Missing, skipped, flaky or failed browser tests cannot produce a pass.
- `runner.log`, `containers.log`: commands, test output and production-server logs.
- `source-archive.sha256`, `production-image.json`, `proof-image.json`: source and
  image identifiers for the tested snapshot.
- `workflow/`, `deployment/`, `restart/`: separate HTML/JSON reports, screenshots,
  Playwright traces and videos so later phases cannot overwrite earlier evidence.
- `captured-fixture.json`, `deployment-proof.json`, `restart-proof.json`: exact
  captures, revisions, review records, difference measurements and persistence checks.
- `skills/`: generated Claude and Codex archives with checksums.

Open any phase's `report/index.html` to inspect the result. These are deterministic
web fixture tests. They prove the installed skill helpers and MCP transports, not
full Claude/Codex language-model sessions, an actual GitHub PR, native application
correctness, live customer data or a person's design approval. UI approval actions
are automated assertions in a disposable test project.

## Current execution status

The assistant session attempted live HTTP and browser tests on 7 November 2026.
Listening sockets were denied (`listen EPERM`) and Chromium startup was denied by
the macOS sandbox. SSH to the requested host was also denied before connection.
The user separately reported a successful Docker deployment and HTTP/MCP/restart
smoke check. That is deployment evidence, not a completed browser proof.

The standalone runner must finish and its results must be inspected before the
full workflow is reported as passed.
