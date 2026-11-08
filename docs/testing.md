# Testing

Run checks only when requested or required by the repository workflow.
From the Screens checkout:

```sh
npm ci
npm run test:all
```

Installation supplies the managed browsers and supported Linux system libraries.

## Commands

| Command | Scope |
| --- | --- |
| `npm run test:all` | Syntax checks, coverage gate, and browser tests |
| `npm test` | Unit/DOM tests; builds the UI first |
| `npm run test:integration` | All integration suites: automatic capture, live HTTP/MCP, browser jobs, OCR, storage, signing, scheduling |
| `npm run test:coverage` | Coverage and browser tests without the separate syntax check |
| `npm run test:e2e` | Playwright suite |
| `npm run check` | Repository checks |
| `npm run build` | Normal production UI build |

Live integration needs permission to listen on loopback. For Docker restart and
capture-to-review evidence, use the [standalone proof](standalone-proof.md).
A command's documented scope does not mean the latest code has passed it.

## Coverage

The configured gate requires 100% lines, statements, functions, and branches per
included JavaScript/JSX file, including files without tests. Scope includes
`src/`, `ui/`, `scripts/`, the bundled skill helper, root JavaScript configuration,
and the example app server. Dependencies, tests, and generated reports are excluded. CSS has browser assertions, not a coverage percentage.

Local outputs are `coverage/index.html`, `coverage/coverage-summary.json`, and
`coverage/coverage-final.json`. They stay ignored by Git.

The coverage build preserves source maps. DOM tests collect UI coverage before
closing. VM tests retain their contexts until the final coverage flush. Mapped
paths resolve to original UI files. Playwright runs after the coverage gate. Its transformed module offsets are not merged into Node coverage.
Both stages must pass. The Docker deployment spec requires the separate proof
fixture and is skipped without it. Run `npm run build` to restore the normal
production build.

## Evidence limits

Unit tests use temporary files/databases and controlled substitutes for GitHub,
Docker, platform behavior, and failures. Browser workflows use real Chromium and
temporary local services. Coverage and fixture tests do not prove native apps,
live accounts, every runtime environment, or full AI-client sessions.
Historical results are in [Recorded validation](validation.md).
