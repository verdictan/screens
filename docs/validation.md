# Recorded validation

## Coverage — 9 November 2026

`npm run test:all` passed with strict 100% thresholds for every included
JavaScript and JSX file. All 84 source files were present in the coverage report.

| Metric | Covered | Result |
| --- | --- | --- |
| Lines and statements | 8,952 / 8,952 | 100% |
| Functions | 608 / 608 | 100% |
| Branches | 5,803 / 5,803 | 100% |
| Node unit, DOM, and integration tests | 204 / 204 | Passed |
| Playwright end-to-end tests | 4 passed; 1 Docker-only test skipped | Passed within local scope |

The suite covers discovery, draft plans, capture recipes, managed services,
authentication, readiness, fixture resets, cancellation, capture reuse, job
leases, scheduling, API/MCP mutations, storage, reports, installers, and UI
interactions. Browser integration uses real local Chromium. The automatic CLI
end-to-end test also captures with Firefox and WebKit.

Coverage includes the application, UI components, scripts, bundled skill helper,
build/test configuration, and example app server. CSS has browser assertions,
not a numeric coverage score. Native, GitHub, installer, and process failure
paths use controlled substitutes where required. These results do not establish
live native-device behavior, installed Homebrew upgrades, or live accounts.
Docker's daemon was unavailable; container deployment and restart were not run.

Reports remain local: `coverage/index.html`, `coverage/coverage-summary.json`,
`coverage/coverage-final.json`, `playwright-report/index.html`, and
`test-results/e2e-results.json`. See [Testing](testing.md) for commands and scope.

## Automatic capture — 8 November 2026

Local browser fixture checks passed after correcting screen identities,
automatic-job execution authorization, service-script discovery, imported-route
deduplication, and browser-specific coverage accounting.

| Command | Result |
| --- | --- |
| `npm run build` | Passed |
| `node --experimental-vm-modules --test test/*.test.mjs` | 73 passed |
| `npm run test:integration` | 6 passed |
| `npm run test:e2e` | 4 passed; Docker-only deployment test skipped |

The automatic CLI test covers draft generation, configuration-derived blockers,
missing environment settings before startup, a managed API, token login, fixture
resets, imported scenarios, fixture-backed route parameters, app readiness,
optional discovery findings, cleanup, failed/cancelled job resume, queued
scenario selection, registry persistence, and the review UI.

Four scenarios across Chromium/desktop, Firefox/tablet, and WebKit/phone produced
12 ready captures. Retry reused 9 captures; cancellation resume reused a saved
capture. The queued selection produced 3 captures. This is three browser/device
pairs, not every browser/device combination.

The review workflow also passed capture-to-feedback, installed client helpers,
MCP fix submission, human-facing verification controls, and restart persistence.
Local artifacts: `playwright-report/index.html`, `test-results/e2e-results.json`,
and the automatic test's `automatic-proof.json`, `automatic-review.png`, and
`trace.zip` under `test-results/browser/`.

Scope: local browser fixtures. These checks do not establish Docker release,
Homebrew installation, native-app capture, live-account behavior, or full
language-model sessions. Runtime artifacts stay excluded from Git.

## Historical Docker proof

Historical standalone proof: **7 November 2026, 09:35 UTC**. Run
`20261107T093348Z-85433` used Node 22.23.4 and Chromium in Docker over SSH, without
GitHub Actions. This result applies to that source snapshot, not later changes.

| Check | Recorded result |
| --- | --- |
| Production and proof images | Built |
| Unit tests | 37 passed |
| HTTP/stdio bridge | Passed |
| Syntax and skill packages | Passed; both 0.3.0 client archives built |
| Workflow, deployment, restart browser phases | Passed with no skipped, unexpected, or flaky results |
| Pixel difference | 4,392 changed pixels reduced to 0 of 1,152,000; no masks, zero tolerance |
| Responsive screenshots | 912px and 390px inspected |
| Restart persistence | Feedback, approval, attachment, measurement, and four capture hashes retained |

The run corrected a missing project argument, proof-client reconnection after
restart, and JSON attachment byte handling. Test containers and their disposable
volume were removed; the existing deployed service was not updated.

Source archive SHA-256:
`a6207b9e96cc56bf6099ca8a8b837b0f6c22b499d01b804a4372ee192895b297`.
Local artifacts remain excluded from Git under
`test-results/docker-proof-20261107T093348Z-85433/`: `summary.json` and each
`workflow/`, `deployment/`, and `restart/` report.

Scope and rerun instructions: [Standalone proof](standalone-proof.md).
Remaining verification: [Roadmap](roadmap.md).
