# Capture automation

All commands use the existing registry and accept `--data DIR`. Commands return
JSON. Supply structured arguments with `--input FILE`; scalar CLI flags use kebab
case, for example `--max-changed-ratio 0.01`.

Capture execution requires `--execute yes`. Import and discovery never start an
application. Each capture attempt uses a new output directory and an isolated Git
checkout. Captures remain immutable, and a measurement never approves a design.

## Profiles and device matrices

```json
{
  "schemaVersion": 1,
  "adapter": "browser",
  "project": { "id": "shop", "name": "Shop" },
  "fixture": "catalog-v3",
  "prepare": [["npm", "ci"]],
  "serve": ["npm", "run", "dev", "--", "--host", "127.0.0.1"],
  "matrix": {
    "devices": [
      { "device": "desktop", "width": 1280, "height": 900 },
      { "device": "phone", "width": 390, "height": 844 }
    ],
    "themes": ["light", "dark"],
    "locales": ["en", "fr"],
    "textScales": [1, 1.25]
  },
  "browsers": ["chromium", "firefox", "webkit"],
  "determinism": {
    "time": "2026-01-01T12:00:00Z",
    "seed": "catalog-seed-3",
    "timezone": "UTC"
  },
  "fixtureData": { "catalogVersion": 3, "customer": "sample" },
  "readiness": {
    "selector": "[data-app-ready]",
    "event": "shop:ready",
    "fonts": ["16px Inter"],
    "waitUntil": "domcontentloaded",
    "timeoutMs": 30000
  },
  "evidence": { "dom": true, "console": true, "network": true, "fonts": true },
  "screens": [
    { "key": "catalog", "title": "Catalog", "path": "/catalog", "source": "src/pages/Catalog.tsx" },
    { "key": "checkout", "title": "Checkout", "path": "/checkout", "source": "src/pages/Checkout.tsx" }
  ],
  "profiles": {
    "quick": {
      "matrix": {
        "devices": [{ "device": "desktop", "width": 1280, "height": 900 }],
        "themes": ["light"],
        "locales": ["en"],
        "textScales": [1]
      }
    }
  }
}
```

The application must use the supplied `PORT` environment variable. `env` can add
capture-specific string environment values. `directory` selects a working folder
inside the checkout. `SCREENS_FIXTURE_VERSION` is set for application commands.

A profile replaces fields in the base configuration. `readiness`, `determinism`,
`network`, and `evidence` merge by property. Matrix axes expand to concrete
variants. Explicit `variants` can be used instead. `browsers` selects the bundled
engines; individual variants can specify `browser`. Chromium is the default. The
Screens installer supplies Chromium, Firefox, WebKit, and their supported Linux
system libraries. Capture startup never downloads a browser. Git is also bundled.

```sh
screens capture-config-diagnose --config capture.json --profile quick
screens capture-plan --config capture.json --profile quick
screens capture-run --repo /path/to/app --ref COMMIT --config capture.json \
  --profile quick --role pr --output /path/to/new-capture --execute yes
```

Diagnostics return `file`, JSON field `path`, `message`, and `fix` for each issue.
Planning returns the expanded jobs, effective configuration, and configuration
hash without executing commands.

## Determinism and readiness

`determinism.time` fixes `Date.now()` and `new Date()` through Playwright's clock.
Timers continue to run. `determinism.seed` seeds `Math.random()`; cryptographic
randomness is unchanged. `determinism.timezone` controls the browser timezone.
The browser receives `window.__SCREENS_FIXTURE__` with the declared fixture version
and `fixtureData`. Applications must consume these values when creating sample
state; Screens does not invent or rewrite server data.

Readiness waits for the specified selector, a named event dispatched on `window`,
and requested fonts. Event listeners are installed before application scripts.
Screens also waits for `document.fonts.ready`. Each screen can override `readiness`.
An existing screen `ready` selector remains supported as a screen property.

`textScale` is a root-font-size multiplier. It affects layouts based on the root
font size; it is not an operating-system accessibility setting.

Set `animationTime` on the configuration or a screen to pause Web Animations API
animations at that time in milliseconds. Otherwise screenshots disable animations
and request reduced motion. Canvas animation and video need application-specific
fixture controls.

## Network replay

Set `network` to replay a committed HAR file:

```json
{
  "network": {
    "har": "fixtures/catalog.har",
    "origin": "https://fixture.example.test"
  }
}
```

`har` resolves inside the isolated repository checkout. `origin` must match the
origin recorded in the HAR; screenshot navigation uses it instead of the local
server origin. Requests absent from the HAR fail. Service workers are blocked for
replay. The application preparation and server commands still run locally.
The HAR hash and replay origin are stored in capture environment evidence.

Each new capture records the browser version, OS, Node version, viewport, locale,
text scale, motion settings, fixture metadata, and effective configuration hash.
Font collection is enabled by default and can be disabled with `evidence.fonts: false`.
Optional DOM, console, network, and accessibility collection uses the
[evidence tools](headless-evidence.md). Screen `annotations` can select elements
and attach region comments, for example:

```json
{ "annotations": [{ "selector": "#pay-button", "text": "Check the primary action", "author": "Review agent" }] }
```

## Route and change discovery

```sh
screens routes-discover --repo /path/to/app --ref HEAD --project shop --output proposed-screens.json
screens screens-affected --repo /path/to/app --config capture.json --base BASE --head HEAD
screens capture-changed --repo /path/to/app --config capture.json --base BASE --head HEAD \
  --output /path/to/new-changed-capture --execute yes
```

Route discovery reads tracked source at the selected revision. It supports Next.js
App Router page files, Next.js Pages Router files, SvelteKit page files, and
literal absolute paths in files named for routes or routers. It emits proposals;
it does not register them. Parameterized routes have `requiresParameters: true`
and need concrete capture paths. Runtime routes and nested relative router paths
are not inferred.

Changed-screen selection uses each screen's `source` or `sources` file patterns.
It follows static imports, local re-exports, literal dynamic imports, and
`require()` calls. It also reads `tsconfig.json`/`jsconfig.json` path aliases and
workspace package dependencies. Configure additional aliases with `sourceAliases`
and global triggers with `sharedSources`:

```json
{
  "sourceAliases": { "@/*": ["src/*"] },
  "sharedSources": ["src/theme/**", "package-lock.json"],
  "screens": [
    { "key": "catalog", "title": "Catalog", "path": "/catalog", "sources": ["src/pages/Catalog.*", "src/catalog/**"] }
  ]
}
```

Unmapped screens remain included. Computed imports, generated dependency graphs,
and runtime dependencies require explicit source mappings. Package dependency
changes include downstream workspace screens. No affected screens produces an
empty result without running capture commands.

## Repeatability and regression search

```sh
screens capture-repeatability --repo /path/to/app --ref COMMIT --config capture.json \
  --count 3 --output /path/to/new-repeatability --execute yes
screens capture-bisect --repo /path/to/app --base BASE --head HEAD --config capture.json \
  --mode scan --max-changed-ratio 0.01 --output /path/to/new-search --execute yes
```

Repeatability captures the same revision independently, compares every sample to
the first, and stores pixel diff IDs, changed-region bounds, and evidence reports.
Changing dimensions is reported as unmeasurable rather than a visual match.

Bisect compares selected revisions with the base capture. Default `bisect` mode
uses binary search and assumes a difference remains above the threshold after its
first crossing. Use `scan` to find the first crossing when changes may regress
and recover. History follows the head commit's first-parent chain, and the base
must belong to that chain. A ratio is a fraction from zero to one. The report
retains each sampled revision and measurement without making an acceptance decision.

## Merge queues and resumable jobs

```sh
screens capture-merge --repo /path/to/app --ref refs/heads/merge-queue-candidate \
  --config capture.json --output /path/to/new-merge-capture --execute yes
```

Fetch the merge queue's candidate into the local repository before invoking the
command. Screens resolves its exact commit, captures that tree, and records its
parent commits in `merge-candidate.json`. It does not create a merge or commit.

The Screens service manages local scheduling, jobs, cancellation, and persistent
progress while `screens serve` runs. No separate worker process is needed. See [headless commands](headless.md). The capture runner
accepts an abort signal and stops application process groups, closes the browser,
and removes its temporary checkout when interrupted. It stores each completed
capture and its derived evidence before notifying the job service. A retry uses
previous capture IDs only when the revision, variant, fixture, role, and effective
configuration hash match, and writes new output files in a new attempt directory.

Capture events have `type`, `at`, and `revision`, with screen, slot, capture, or run
fields where relevant. Event types are `capture.started`, `capture.preparing`,
`capture.navigating`, `capture.completed`, `capture.resumed`, and `capture.finished`.
The CLI/job service can emit these as newline-delimited JSON.
