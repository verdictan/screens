# Tests and coverage

Run the complete test suite from the Screens folder:

```sh
npm ci
npm run test:all
```

Installation supplies the package-local Chromium, Firefox, and WebKit engines,
including their required system libraries on supported Linux systems.

To run the integration checks, including the managed three-browser capture job,
OCR, signing, backups, and local scheduling:

```sh
npm run test:integration
```

To run coverage and browser tests without the separate syntax check:

```sh
npm run test:coverage
```

The command fails if any included file has less than **100% line, statement,
function, or branch coverage**. Files with no tests are included. The report
covers all JavaScript and JSX in `src/`, `ui/`, `scripts/`, and the bundled
`skills/screens/scripts/` helper. Dependencies, test files, and generated
reports are outside that scope.

Open `coverage/index.html` for the readable report. `coverage/coverage-summary.json`
and `coverage/coverage-final.json` contain the measured results. These files
stay local and are ignored by Git.

## What the tests exercise

- Registry storage, immutable captures, feedback revisions, approvals, and persistence.
- Manifest imports, comparisons, pixel differences, and evidence attachments.
- HTTP, stdio MCP, and the HTTP bridge, including invalid requests and errors.
- Capture configuration, process cleanup, browser failures, and changed PR heads.
- Agent installation, command routing, packages, and setup failures.
- UI navigation, filters, pins, uploads, approvals, image failures, and stale responses.
- Verdictan colors, hover and focus states, and desktop and mobile layouts.
- A browser workflow from fresh fixture captures through feedback, a submitted fix,
  verification, and registry restart.

Unit tests use temporary databases and files. They replace GitHub calls, Docker
commands, Windows process behavior, and deliberate failure conditions with
controlled test substitutes. They do not create GitHub issues or change a live
registry. The browser workflow runs real Chromium against a temporary application
and local Screens service. It does not prove native-app behavior or execution
inside every AI assistant.

The 100% figure measures executable JavaScript and JSX. CSS colors and layout
have browser assertions; CSS does not have a line or branch percentage here.
Coverage is not a guarantee that every possible input or environment works.

## How coverage is collected

The coverage build preserves source maps and readable generated code. The UI tests
execute that build in a browser-like DOM and record coverage before closing it.
Source map paths resolve to the original UI files so UI branches are measured.

Browser tests run after the coverage gate. Playwright transforms server modules,
so its transformed offsets must not be merged with Node's original-source coverage.
Both stages must pass for the command to succeed. No GitHub Actions run is needed.

`npm run build` restores the normal production build after a coverage run.
The separate Docker deployment and container-restart proof remains available
through `scripts/prove-workflow.sh` as described in the deployment guide.
