# Screens

A local screen registry for people, Claude Code and Codex. Keep current captures,
design targets, PR results and review feedback in one place.

## Implemented in v0.1

- SQLite registry shared by the CLI, web picker and MCP tools.
- Immutable, SHA-256-addressed PNG/JPEG/WebP images and immutable comparison runs.
- Current / Target / PR comparisons, side-by-side and equal-dimension overlays.
- Project and screen search, pinned feedback, source image history and target approval.
- Revision checks on feedback and approvals; proposed fixes require new evidence.
- Importers for canonical `screens.json`, Kalkidan picks, Verdictan capture manifests
  and the console routing comparison manifest.
- Direct stdio MCP, a stdio-to-HTTP bridge and a stateless Streamable HTTP endpoint.
- A reusable Screens skill source for Claude Code and Codex.
- GitHub PR metadata resolution with pinned head, base and merge-base SHAs.

This is an implementation starter, not a hosted multi-user service. Automated PR
build/capture, issue leases, pixel-difference scoring, authentication and historical
annotation migration are tracked in [the roadmap](docs/roadmap.md).

## Run

Requires Node 22.13 or newer with `node:sqlite`. Node 22 reports an experimental
SQLite warning on stderr. There are no npm runtime dependencies or build step.

```sh
node src/cli.mjs serve
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

For a new project, copy [examples/screens.json](examples/screens.json), replace
the example paths with real captures, and import it. Capture files must resolve
inside the manifest directory, including through symlinks. Put external captures
in an adjacent assets directory before importing. Missing files produce warnings.

## Compare a PR

Resolve metadata using an authenticated GitHub CLI:

```sh
node src/cli.mjs pr-context verdictan/example 123 --output pr-context.json
```

This resolves refs only. It does not build a PR or generate screenshots. Capture
the merge base and exact PR head using the project's supported tools and identical
fixtures. Keep the original working tree intact. Import each capture manifest,
then combine their run IDs:

```sh
node src/cli.mjs compare --project example \
  --current BASELINE_RUN_ID --target TARGET_RUN_ID --pr PR_RUN_ID \
  --context pr-context.json --title 'PR 123'
```

Each input run should contain the corresponding role, or a single capture per
screen/variant. Ambiguous role selection fails instead of choosing silently.
Source metadata is recorded as supplied; v0.1 does not attest that a screenshot
actually came from that build. Re-import after PR changes to create a new run.

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
`runs_compare`, `reviews_add_note`, `reviews_submit_fix`.

`captures_view` returns actual image content, capped at 10 MB per tool response.
Larger images remain viewable in the picker. Agents can propose a fix with
evidence; target approval and fix verification are available only in the review
API/UI, not exposed as MCP tools. This is a workflow separation, not identity-based
authorization: all local processes able to reach the API are trusted in v0.1.

## Skills

The repository contains the distributable workflow at `skills/screens/SKILL.md`.
It is not installed globally by cloning this repository.

For repository-local Claude Code use, copy that directory into
`.claude/skills/screens`; for Codex use, copy it into `.agents/skills/screens`.
Use `/screens load .` in Claude Code, or `$screens load .` in Codex.
The skill calls the CLI and/or MCP tools; it does not implement storage itself.
Set `SCREENS_CLI` to the absolute path of `src/cli.mjs` before using its shell
examples. Skill source changes belong in this repository.

## Verification

```sh
npm test
npm run check
npm run test:integration
```

The main suite tests persistence, capture identity, annotation binding, concurrent
edits, approvals, imports, HTTP request handling and direct stdio MCP. The separate
integration suite needs permission to listen on loopback sockets. Browser QA is
also required before treating the picker as release-ready.

## Data and boundaries

The web server binds to `127.0.0.1` only. It validates Host and Origin, requires
JSON mutations and serves only known static files and registered image IDs.
Do not expose v0.1 through a public proxy. There is no account authentication.
Imports and agent-supplied content are displayed as text. SVG and HTML uploads
are rejected. Raster validation checks signatures, not full decoding.

Back up the entire data directory while all writers are stopped, including the
database and `assets/`. Screenshots and databases are excluded from Git.

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md) and
[project setup](docs/github-setup.md).
