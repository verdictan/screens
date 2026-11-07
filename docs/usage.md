# Screens usage reference

A local screen registry for people and AI agents. Keep current captures,
design targets, PR results and review feedback in one place.

## Implemented

- SQLite registry shared by the CLI, web picker and MCP tools.
- Immutable, SHA-256-addressed PNG/JPEG/WebP images and immutable comparison runs.
- Current / Target / PR comparisons, side-by-side and equal-dimension overlays.
- Project and screen search, pinned feedback, source image history and target approval.
- Revision checks on feedback and approvals; proposed fixes require new evidence.
- Importers for canonical `screens.json`, Kalkidan picks, Verdictan capture manifests
  and the console routing comparison manifest.
- Direct stdio MCP, a stdio-to-HTTP bridge and a stateless Streamable HTTP endpoint.
- Shared Agent Skills workflows, setup scripts, MCP connection settings and registry helper.
- Lossless pixel diff artifacts, explicit masks, channel tolerance and provenance.
- Capture-linked visual, behavior, accessibility and motion evidence with report attachments.
- GitHub PR metadata resolution with pinned head, base and merge-base SHAs.

The [headless guide](headless.md) covers capture automation, agent task leases,
change-to-screen mapping, evidence reports, backups, and local signing.
These tools use the local registry. Hosted authentication remains on
[the roadmap](roadmap.md).

## Install

Use `bash install.sh` on macOS/Linux, `powershell -File install.ps1` on Windows,
or `npm run setup` from the checkout. When Homebrew is available, local setup
installs or upgrades `verdictan/tap/screens`, connects the selected agents, and starts
it with `brew services start screens`. It applies `--data` and `--port` through
your Homebrew service settings. Rerunning setup restarts the service with those settings.

Without Homebrew, the source installer needs Node 22.22.2+ and npm, builds the UI,
and uses `--start` to start Screens. `install.sh` installs Node through Homebrew
when available. Normal installation includes Git, package-local Chromium, Firefox, and WebKit,
English OCR code and language data, and axe-core. Supported Linux installations
also install the browsers' system libraries through the OS package manager; that
installation step can require administrator rights. Users do not run a separate
browser or OCR installer, and Docker is not required.

Setup does not run tests. To update installed workflows after pulling source changes,
rerun setup with `--replace yes` and the same project, data and port options.
Use the generated `.screens/scripts/screens.mjs` helper to preserve those settings
when starting the picker or importing evidence.

## Run

Requires Node 22.22.2 or newer with `node:sqlite`. Node 22 reports an experimental
SQLite warning on stderr. Sharp decodes raster images for pixel differences. The React picker uses shadcn components and Tailwind CSS; Vite produces the bundled interface.

```sh
npm ci
npm start
```

Open <http://127.0.0.1:4800>. The default database is in
`~/.local/share/verdictan-screens`; all commands accept `--data DIR` or
`SCREENS_HOME`. Use the same directory for the web server, imports and agents.

```sh
node src/cli.mjs load /path/to/kalkidan --project kalkidan --name Kalkidan
node src/cli.mjs load /path/to/work/console/docs/routing-comparison/manifest.json \
  --project verdictan-console --name 'Verdictan Console'
```

The CLI prints a run ID and a picker URL. Import never runs application code,
changes the source project, or promotes imported designs to approved targets.
Legacy captures with no source SHA remain explicitly `unknown`.

For a new project, copy [examples/screens.json](../examples/screens.json), replace
the example paths with real captures, and import it. Capture files must resolve
inside the manifest directory, including through symlinks. Put external captures
in an adjacent assets directory before importing. Missing files produce warnings.

## Compare a PR

Screens reads PR metadata through the GitHub REST API. Set `GITHUB_TOKEN` for
private repositories or authenticated API access; the GitHub CLI is not required:

```sh
node src/cli.mjs pr-context verdictan/example 123 --output pr-context.json
```

For browser projects, copy `examples/proof.capture.json` and specify deterministic routes,
viewports, fixture identity, preparation commands and a server command that uses `PORT`.
Review these commands before permitting execution:

```sh
node src/cli.mjs capture-pr OWNER/REPO 123 --repo /path/to/project \
  --config /path/to/capture.json --output /path/to/new-evidence --execute yes
```

The runner resolves exact refs, clones into an isolated temporary checkout, prepares
and starts each revision, waits for readiness, and captures matching variants. It
records the SHA, configuration hash, browser version and image hash. It refuses to
publish a comparison if the PR head changes during capture. Fetch the PR commits into
the local repository first. Native applications still require native capture tools.

Use `capture-refs --base SHA --head SHA` for locally available revisions, or `capture
--ref SHA --role target` for a separate target. Add `--target TARGET_RUN_ID` to a PR
comparison when an existing design target is available. Targets are never invented
or approved automatically. Existing manifests can still be combined:

```sh
node src/cli.mjs compare --project example \
  --current BASELINE_RUN_ID --target TARGET_RUN_ID --pr PR_RUN_ID \
  --context pr-context.json --title 'PR 123'
```

Each input run must have an unambiguous capture per screen, role and variant.
The browser adapter records execution provenance; it does not provide cryptographic
attestation or prove live-account behavior.

## Connect agents

Direct stdio works without the web server. Substitute the absolute checkout path:

```sh
claude mcp add --scope user screens -- node /absolute/path/screens/src/cli.mjs mcp
codex mcp add screens -- node /absolute/path/screens/src/cli.mjs mcp
```

Or connect to the running server:

```sh
claude mcp add --transport http --scope user screens http://127.0.0.1:4800/mcp
codex mcp add screens --url http://127.0.0.1:4800/mcp
```

Available tools: `projects_list`, `screens_search`, `screens_get`,
`screens_register`, `captures_register`, `captures_view`, `runs_list`,
`runs_compare`, `reviews_add_note`, `reviews_submit_fix`, `diffs_create`,
`diffs_view`, `evidence_add`, `evidence_list`, plus the headless actions exposed by
`tools/list`. `screens headless-help` lists the action schemas and marks CLI-only
operations. Commands that read arbitrary paths or execute project code remain
outside MCP. Bundled OCR operates on registered captures through CLI or MCP.

`captures_view` returns actual image content, capped at 10 MB per tool response.
Larger images remain viewable in the picker. Agents can propose a fix with
evidence; target approval and fix verification are available only in the review
API/UI, not exposed as MCP tools. This is a workflow separation, not identity-based
authorization: all local processes able to reach the API are trusted in v0.2.

## Skills

Install into an application repository:

```sh
npm run skills:install -- --project /absolute/application --client all
```

Use `/screens load .` in Claude Code, or `$screens load .` in Codex. Existing
skill folders are not overwritten.
See [agent skills](agent-skills.md) for packaging, shared data and MCP setup.

## Pixel and semantic evidence

Select a comparison pair in the picker, then **Measure selected pair**. The lossless
PNG marks changed pixels pink and excluded regions blue. Dimensions must match;
images are never resized. Threshold and explicit masks are part of immutable
measurement identity. Fixture differences remain visible. A score is not acceptance.

```sh
node src/cli.mjs diff --left CAPTURE_ID --right CAPTURE_ID --threshold 0
node src/cli.mjs evidence add evidence.json
node src/cli.mjs evidence list --capture CAPTURE_ID
```

The evidence form records an assertion, procedure, observation and reported result
on an exact capture. Attach text/JSON reports or MP4/WebM recordings (up to 20 MB).
Automated pass/fail requires a report artifact. Screenshots cannot stand in for
behavior, accessibility or motion checks. Evidence stays reporter-supplied; only
human review decides acceptance. See [evidence format](evidence.md).

## Verification

For the complete browser workflow and production-container restart proof without
GitHub Actions, run `bash scripts/prove-workflow.sh`, or
`bash scripts/prove-workflow.sh dennisotugo@192.168.1.142` to run on the Docker host
and copy reports back. See [standalone proof](standalone-proof.md) for the exact
scope, isolation, screenshots, traces and pass criteria.

```sh
npm test
npm run check
npm run test:integration
npm run test:e2e
```

The main suite tests persistence, capture identity, annotation binding, concurrent
edits, approvals, imports, HTTP request handling and direct stdio MCP. The separate
integration suite needs permission to listen on loopback sockets. Browser QA is
also required before treating the picker as release-ready.

## Data and boundaries

The web server defaults to `127.0.0.1`. It validates Host and Origin, requires
JSON mutations and serves only known static files and registered image IDs.
Do not expose v0.2 through a public proxy. There is no account authentication.
Imports and agent-supplied content are displayed as text. SVG and HTML uploads
are rejected. Raster validation checks signatures, not full decoding.

Use `screens registry-backup --output NEW_DIRECTORY` for a consistent online
snapshot of the database and its referenced assets. Restore with
`screens registry-restore --source BACKUP_DIRECTORY --output NEW_DIRECTORY`.
See [storage tools](storage-tools.md) for portable bundles, signatures, integrity
reports, retention plans, and managed signing keys. Screenshots and databases are
excluded from Git.

See [architecture](architecture.md), [roadmap](roadmap.md) and
[project setup](github-setup.md).

Without `--project`, setup installs user-wide skills and MCP settings for detected agents. Pass `--project DIR` for project-only setup. Restart agents after installation.
