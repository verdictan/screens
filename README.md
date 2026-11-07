# Screens

A local screen registry for people, Claude Code and Codex. Keep current captures,
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
- Packaged Claude Code and Codex workflows, installer and shared registry helper.
- Lossless pixel diff artifacts, explicit masks, channel tolerance and provenance.
- Capture-linked visual, behavior, accessibility and motion evidence with report attachments.
- Docker Compose with persistent storage, health checks and loopback publishing.
- GitHub PR metadata resolution with pinned head, base and merge-base SHAs.

This is an implementation starter, not a hosted multi-user service. Issue leases, authentication and change-to-screen mapping are tracked in [the roadmap](docs/roadmap.md).

## Run

Requires Node 22.22.2 or newer with `node:sqlite`. Node 22 reports an experimental
SQLite warning on stderr. Sharp decodes raster images for pixel differences. The React picker uses shadcn components and Tailwind CSS; Vite produces the bundled interface.

```sh
npm ci
npm start
```

Or run `docker compose up -d --build --wait`; see [Docker deployment](docs/deployment.md) for importing into its persistent volume.

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

For a new project, copy [examples/screens.json](examples/screens.json), replace
the example paths with real captures, and import it. Capture files must resolve
inside the manifest directory, including through symlinks. Put external captures
in an adjacent assets directory before importing. Missing files produce warnings.

## Compare a PR

Resolve metadata using an authenticated GitHub CLI:

```sh
node src/cli.mjs pr-context verdictan/example 123 --output pr-context.json
```

For browser projects, copy `examples/proof.capture.json` and specify deterministic routes,
viewports, fixture identity, preparation commands and a server command that uses `PORT`.
Review these commands before permitting execution:

```sh
npx playwright install chromium
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
`diffs_view`, `evidence_add`, `evidence_list`.

`captures_view` returns actual image content, capped at 10 MB per tool response.
Larger images remain viewable in the picker. Agents can propose a fix with
evidence; target approval and fix verification are available only in the review
API/UI, not exposed as MCP tools. This is a workflow separation, not identity-based
authorization: all local processes able to reach the API are trusted in v0.2.

## Skills

Install into an application repository:

```sh
npm run skills:install -- --project /absolute/application --client both
```

Use `/screens load .` in Claude Code, or `$screens load .` in Codex. Add
`--runtime docker` when using Compose. Existing skill folders are not overwritten.
See [agent skills](docs/agent-skills.md) for packaging, shared data and MCP setup.

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
human review decides acceptance. See [evidence format](docs/evidence.md).

## Verification

For the complete browser workflow and production-container restart proof without
GitHub Actions, run `bash scripts/prove-workflow.sh`, or
`bash scripts/prove-workflow.sh dennisotugo@192.168.1.142` to run on the Docker host
and copy reports back. See [standalone proof](docs/standalone-proof.md) for the exact
scope, isolation, screenshots, traces and pass criteria.

```sh
npm test
npm run check
npm run test:integration
npx playwright install chromium
npm run test:e2e
```

The main suite tests persistence, capture identity, annotation binding, concurrent
edits, approvals, imports, HTTP request handling and direct stdio MCP. The separate
integration suite needs permission to listen on loopback sockets. Browser QA is
also required before treating the picker as release-ready.

## Data and boundaries

The web server defaults to `127.0.0.1`. Compose binds inside the container on
`0.0.0.0`, with only the host loopback port published. It validates Host and Origin, requires
JSON mutations and serves only known static files and registered image IDs.
Do not expose v0.2 through a public proxy. There is no account authentication.
Imports and agent-supplied content are displayed as text. SVG and HTML uploads
are rejected. Raster validation checks signatures, not full decoding.

Back up the entire data directory while all writers are stopped, including the
database and `assets/`. Screenshots and databases are excluded from Git.

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md) and
[project setup](docs/github-setup.md).
