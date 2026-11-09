# Automatic capture

Detect an app, review its capture plan, and create evidence in the local registry.
For exact Git revisions, see [Capture recipes](capture-automation.md).

## Detect applications

```sh
screens detect /path/to/project
```

Detection reports applications, frameworks, device families, scripts, manifests,
source candidates, and scan limits. It reads files without executing app code.
Project setup also writes `.screens/detection.json`.

Supported markers include major web frameworks, static HTML, Expo/React Native,
Electron, Tauri, Flutter, Android, Swift executables, and Xcode projects. A library
or Swift executable marker does not establish that a runnable UI exists. Dynamic
build settings and unsupported syntax need explicit configuration.

Scanning stays in the selected directory, skips symlinks and common generated,
dependency, test, fixture, example, and runtime folders, and honors Git ignore
rules inside a repository. Detection cannot enumerate every
runtime state or establish that a capture command works.

## Capture from the app

Select **Capture screens**, enter the app folder on the computer running Screens,
and select **Prepare capture plan**. Screens reads the project without running it.
Review the detected commands and capture limits. Use **Capture settings** to fill
in missing URLs, environment files, readiness conditions, services or sample data.
Select **Start capture** to authorize execution. The persistent worker continues
when the dialog closes. The project overview shows progress, stop, resume and the
resulting review. Resume requires unchanged inputs; prepare a new job after edits.

Use **Add design reference** on a screen to upload an image or capture a running
design. Uploaded images keep their original size. Design approval remains a
separate human decision. Captures from a new job join the selected session while
older captures and comments remain available.

The project overview gathers the latest capture of each role and device across
sessions. It lists submitted fixes, open comments, proposed designs and missing
captures first. Opening a queue item creates an immutable comparison when the
latest images do not already share a session. Capture problems show grouped
causes and next actions. A clear review queue does not prove complete discovery
or passing readiness; capture problems remain separate.

## Run captures

```sh
screens capture-auto /path/to/project --project my-app
screens load /path/to/project --project my-app --capture yes
node scripts/setup.mjs --project /path/to/project --capture yes
```

These commands authorize execution of the project's app and capture commands.
Plain `detect` and `load` remain read-only with respect to application execution.
The runner saves a new output directory under `.screens/captures/`, imports new
captures into the shared registry, and returns a review URL. Use `--output NEW_DIR`
to choose a different location. `report.json` lists each application's captures,
errors, and coverage limits. Partial or failed runs exit with status 1 and retain
completed captures. Project source is the current working tree, not an isolated
Git commit. Install the project's dependencies and toolchain before capture.

For detected Next.js, Vite, Astro, Nuxt, Angular and react-scripts frontends,
Screens starts the dev/start script on a local port. It captures concrete
file-based routes for Next.js, SvelteKit, Nuxt and Astro. Other browser apps start
with `/`. The default widths are 1440, 820 and 390 pixels. Static HTML at the project
root uses Screens' local file server. Use `--url http://127.0.0.1:3000` for one
already-running web application. Redirects and HTTP errors fail scenario readiness. A diagnostic image is retained
when possible. Routes without concrete parameters remain unresolved. Screens does
not invent authentication or fixture data. Configured steps can submit forms.

Xcode applications build with the selected scheme on macOS. Screens creates and
removes its own iPhone and iPad simulators, and captures native Mac windows with
`screencapture`. Xcode, simulator runtimes and Mac screen-recording access must be
available. If a project has multiple schemes or app products, select `scheme` or
`target` in the configuration. The default is one launch screen per platform.
Use `scenarios` to launch additional screens supported by the app. Desktop app
launches use the app's normal data settings unless its launch arguments or environment
select an isolated profile. Screens does not create native sample data automatically.

Add `screens.capture.json` at the project root, or select it with `--config FILE`.
Its `applications` list selects execution recipes. See [One capture recipe](#one-capture-recipe) for the browser format. For Xcode,
set `adapter: "apple"`, `path` to the project/workspace, `scheme`, and `platforms`
to `iphone`, `ipad`, or `macos`. Define `scenarios` with stable `key`, launch
`args`, fixture identity, and readiness. The app must implement those arguments.

Browser entries can set `baseUrl`, `storageState`
(relative to the app directory), `prepare` (argument arrays), `env`, `readyPath`,
`ready`, `settleMs`, and `variants` (device, width, height, theme, locale). Native
entries can set `env`, `target` and `settleMs`. Process logs stay local and can contain project output. Keep credentials and
runtime artifacts out of Git.

For an existing native capture workflow, use the command adapter:

```json
{"applications": [{"path": ".", "adapter": "command", "command": ["npm", "run", "capture:all"]}]}
```

The command receives `SCREENS_OUTPUT_DIR`, `SCREENS_MANIFEST` and
`SCREENS_PROJECT_ID`. It must write a canonical `screens.json` manifest and images
inside that output directory. It also receives `SCREENS_FIXTURE_VERSION` when
configured. Command arguments can use `{output}` and `{project}`.
An optional `manifest` selects a different output filename. A root package script
named `screens:capture` opts into this contract and runs automatically without an
extra configuration file. This supports Electron, Tauri, Flutter, Android and
custom native capture tools without substituting browser images for native UI.
Existing scripts with arbitrary names or output conventions are not guessed.

Docker supports browser and compatible command recipes. Apple captures require
the macOS host. The project helper mounts capture inputs writable for output.

## Draft a capture plan

```sh
screens capture-draft /path/to/project --output capture-plan.json
screens capture-auto /path/to/project --plan capture-plan.json
```

`capture-draft` reads the project without executing it. The version 1 document
contains `configuration`, `choices` with source evidence and confidence, unresolved
`decisions`, source relationships, and a source fingerprint. It combines detected
startup scripts, required environment names, scenario exports, fixture parameters,
Storybook candidates and a native manifest. Service commands with unknown port or
health interfaces remain blocking decisions. It never invents a login endpoint or
credentials. Conflicting fixture values and possible components stay visible.

Edit `configuration` to supply the missing settings or remove unneeded service
candidates. Screens recomputes blockers from the configuration and source each
time the plan is read. There is no manual `resolved` flag. Advisory findings do
not block execution. Uncertain components appear in `discovery.backlog` instead
of a list of mandatory decisions. The configuration uses the same version 1
recipe as `screens.capture.json`, exact-commit capture and capture jobs.
`--profile NAME` selects a recipe profile; `applications[].nativeProfile` selects
a profile declared by a native manifest. Keep credentials in environment files
or process variables.

## One capture recipe

```json
{
  "version": 1,
  "scope": "configured",
  "project": {"id": "my-app", "name": "My app"},
  "applications": [
    {
      "path": ".",
      "adapter": "browser",
      "fixture": "demo-v1",
      "serve": ["npm", "run", "dev", "--", "--port", "{port}"],
      "variants": [{"device": "desktop", "width": 1440, "height": 1000}],
      "scenarios": [{"key": "home", "title": "Home", "path": "/", "ready": "main"}]
    }
  ]
}
```

Use that same file with `capture-auto --config FILE` or
`capture-run --repo PATH --ref COMMIT --config FILE --output NEW_DIR --execute yes`.
Both modes share normalization, profiles, matrices, services, fixture boundaries,
authentication, scenario imports, readiness, browser engines, determinism, HAR
replay, evidence collection and cleanup. Exact-commit capture adds checkout and
revision selection. Both modes bind captures to the same application/scenario keys.

`scope: "configured"` captures declared/imported scenarios. `scope: "discovered"`
also adds declared source routes; it is the default for automatic discovery.
Profiles override matching applications by `path`. Root `defaults` supplies shared
application settings. A `matrix` and `browsers` expand into application variants;
explicit variants define the requested device set, rather than adding default sizes.
`--screens` selects scenario keys, or `application-path/key` for a qualified name.
Automatic capture accepts the JSON-array flag form, for example `--screens '["home"]'`.

Previous flat recipes must move their `screens`, startup, fixture, matrix and
browser settings into an application: `screens` becomes `scenarios`, `directory`
becomes `path`, and `readiness` becomes `ready`. Previous automatic recipes must
rename application `routes` and `states` to `scenarios`. The former flat and
per-adapter recipe formats are rejected; no compatibility reader is retained.
Screenshot evidence manifests still use `schemaVersion: 1` and `screens` because
they describe captured evidence rather than executable recipes.

## Fixture boundaries

Root or application `fixtures` defines a versioned fixture lifecycle:

```json
{
  "fixtures": {
    "version": "demo-v1",
    "scope": "scenario",
    "setup": [["node", "scripts/fixtures.mjs", "setup"]],
    "reset": [["node", "scripts/fixtures.mjs", "reset", "{scenario}", "{device}"]],
    "teardown": [["node", "scripts/fixtures.mjs", "close"]]
  }
}
```

Commands are project-owned argument arrays. `scope` is `run`, `scenario` or
`group`. Setup and reset execute at the beginning of the chosen boundary;
teardown executes when leaving it. Scenario boundaries reset before each
scenario/device combination. Group boundaries use the recipe's `group` and variant;
scenarios within a group deliberately share state and order. An ungrouped scenario
gets its own boundary. A failing reset prevents that scenario from capturing.

Application lifecycle commands can use `{baseUrl}` and run while the app server
is available. Root lifecycle commands should target managed services; the root
run can span several applications. `{scenario}`, `{group}` and `{device}` are
available in lifecycle arguments. Services remain alive through fixture cleanup.
Authentication runs after scenario reset, so a reset that clears sessions can be
followed by a fresh login. A reset command must restore the required backend data;
isolating browser contexts alone does not reset shared records. Commands that
capture an entire native batch use one fixture boundary for that batch.

## Discovery confidence and relationships

Inventory entries distinguish declared screens, referenced navigation destinations,
executable stories, and possible components or states. `confidence` is `declared`,
`referenced`, or `possible`; `classification` records the category. A pinned
TypeScript parser reads JS/TS/JSX/TSX syntax for React Router declarations,
Angular/Vue route objects, literal navigation calls, imports and default exports.
Next.js page files and the supported file routers supply declared route identities.
Vue/Svelte script blocks are parsed for supported JavaScript patterns; their full
template semantics and native Swift syntax are not compiler-resolved.

`inventory.relationships` connects routes to component sources and referenced
navigation destinations to known routes. Unambiguous direct route components and
matching destinations share route capture evidence. Destination coverage does not
prove that clicking a navigation control works; that needs an interaction scenario.
Computed paths and ambiguous imports remain unresolved. Parser diagnostics remain
visible in discovery results without blocking otherwise complete requested captures.

## App readiness contract

Screens sets `window.__SCREENS_CAPTURE_REQUEST__` before navigation with
`version`, `requestId`, `screen` and `fixture`. After its data and state settle, an
integrated app can publish:

```js
const request = window.__SCREENS_CAPTURE_REQUEST__;
if (request) {
  window.__SCREENS_CAPTURE__ = {
    ...request,
    state: "ready",
    pending: 0
  };
}
```

Publish `state: "loading"` while work remains, and `state: "error"` plus an
`error` message for an unexpected failure. A ready response must echo the current
request ID and screen, and its fixture when requested. Screens also waits for
loaded fonts and completed images. This contract is preferred when available;
`ready: { "contract": { "required": true } }` waits for it even before the app
publishes the object. Source detection proposes that setting when it sees the
contract in application code. `ready.contract: false` uses selector/text readiness
for a scenario that intentionally does not implement the signal.

Selector, text, URL and Storybook readiness remain available. A ready signal is an
app-provided assertion about state; it is not a target approval or a visual match.

## Automatic capture jobs and resume

Every `capture-auto` run creates a persistent capture job in the existing registry.
It runs immediately by default. To queue work for the running Screens worker:

```sh
screens capture-auto /path/to/project --config screens.capture.json --queue yes
screens jobs-get --id JOB_ID
screens jobs-events --id JOB_ID
screens capture-auto --resume JOB_ID
```

`jobs-enqueue-auto --path PATH --execute yes` is the CLI-only queue action.
The worker uses the same leases, heartbeats, cancellation and job events as other
capture jobs. Each automatic attempt runs in a fresh worker context so imported
scenario modules do not retain state from earlier attempts. Ctrl+C on an immediate run cancels that job and retains checkpoints;
resume is explicit. Stopping the background Screens worker returns its interrupted
work to the queue. Completed jobs remain immutable.

A checkpoint stores scenario/variant identity, capture ID, readiness and an input
fingerprint. A resumed job requires unchanged source, recipe, referenced environment
inputs, Screens implementation and runtime. Browser/native toolchain identities
must also match before an image is reused. Changed inputs require a new job.
Only passing readiness evidence is reusable. A missing registered asset causes a
fresh capture. Diagnostic and unverified images are retried.

Reuse requires a declared `fixture` identity or `fixtures.version`; uncontrolled
application data is recaptured. It also requires independent state: a scenario reset, `fixtures.independent: true`, or a recipe's explicit `readOnly: true` declaration. Shared-state groups and
run-scoped setup/reset batches rerun to preserve their action sequence. Custom
command adapters checkpoint imported images but rerun their command batch. Reused
captures keep their original immutable IDs and provenance in the new review run;
reports label them as reused.

Queued workers need access to the same repository paths, environment files,
credentials and native toolchains. Docker workers need persistent project mounts;
a path mounted only for a one-off CLI container is not available to the long-lived
worker. Apple jobs require the macOS host and native permissions.

## Terminal summary

Automatic capture prints an actionable summary by default. It separates images,
reused evidence, ready scenarios and unresolved candidates, and groups failures by
missing setting, login, fixture IDs, services, readiness or fixture lifecycle. Each
group lists affected examples and the next action. All details remain in
`report.json`; `summary.json` contains the grouped summary. Use `--format json`
for the complete machine-readable result on stdout. Progress events use stderr.

## Shared native capture contract

Place `screens.native.json` at the project root. It declares Xcode application
paths, schemes, supported platforms, fixture profiles and screen IDs. Copy the
structure in [examples/screens.native.json](../examples/screens.native.json) and
implement its launch arguments in the app. Manifest screens enter the inventory
as declared screens and map to the same state IDs across Mac, iPhone and iPad.
`screen.platforms` can limit a state to declared supported devices.

Profiles combine `fixture`, `args`, `env` and optional `readiness`. Application,
profile and screen arguments are combined in that order. `defaultProfile` selects
a profile; set application `nativeProfile` to select another. Recipe profiles can override
that property for all selected applications. Configuration can override
the app's execution settings while retaining the declared inventory.

For file readiness, the runner supplies `SCREENS_READY_FILE`, `SCREENS_REQUEST_ID`,
`SCREENS_SCREEN_ID`, `SCREENS_FIXTURE` and `SCREENS_FIXTURE_PROFILE` at launch.
The app writes JSON with the same version 1 request fields, `state: "ready"`, and
`pending: 0`. A matching `state: "error"` fails readiness. Writes should be atomic;
a response from an earlier request does not count. The default timeout is 15 seconds.

On iPhone/iPad Simulator, `readiness.file` is relative to the app's data container,
for example `Documents/screens-ready.json`. The app resolves that path under its
home directory. On Mac, a relative file is resolved inside the capture output;
the app receives its absolute path. Use a host path the Mac app can access, or a
`readiness.platforms.macos` override. Overrides for `iphone` and `ipad` are also
supported. Sandboxed Mac apps must have access
to the chosen location. The example uses a Documents path on Simulator and a capture-output override on
Mac; adapt the Mac path to the app's file permissions.

Alternatively, `readiness.command` declares an argument-array check using the
existing `{image}`, `{screen}` and `{device}` placeholders. Without a native
readiness declaration, screenshots remain unverified. Native evidence retains its
platform, scheme, fixture and working-tree provenance; it does not prove physical
device behavior or live-account correctness.

## Managed capture environment

Automatic capture checks detected environment requirements before starting services,
setup commands or applications. Discovery reads environment references, required-error
messages, required sections in Markdown documentation, and empty entries in
`.env.example`, `.env.sample` and `.env.template`. It reports names and source
locations, not values. Arbitrary code can compute requirements that static patterns
cannot identify. Add `requiredEnv` for those settings; use application `optionalEnv`
to correct an inferred requirement that does not apply to the capture profile.

Values come from `.env`, `.env.development`, `.env.local`,
`.env.development.local`, explicit `envFiles`, the process environment, root `env`,
and application `env`. Application files override root files; process and explicit
configuration override files. Env-file contents use dotenv syntax without shell
execution or variable expansion. Missing settings produce a failed `report.json`
with `environment` details before project commands run.

Use root `services` for mock APIs, fixture servers or Storybook. Each service has
`name`, an argument-array `command`, optional `cwd`, `env`, `requiredEnv`,
`prepare` commands, `dependsOn`, and a required HTTP `ready` condition. Services
start in dependency order. `ready.url` must return `ready.status` (default 200)
within `ready.timeoutMs` (default 60000). Root `setup` commands run after services
are ready. Screens stops its services in reverse order after completion, failure,
or interruption and writes `service-N.log` in the output directory.

Screens allocates local ports for service names and any root `ports` entries.
Configuration values can reference `{services.api.url}`, `{services.api.port}`,
`{ports.gateway}`, `{env.NAME}`, `{root}`, and `{output}`. A service must bind to
its supplied port. The allocator releases the reserved socket before startup;
if another process takes that port, service startup fails rather than silently
using a different endpoint. App server commands still use `{port}`.

This example assumes the project provides `scripts/mock-api.mjs` and `/health`:

```json
{
  "services": [
    {
      "name": "api",
      "command": ["node", "scripts/mock-api.mjs"],
      "env": {"PORT": "{services.api.port}"},
      "ready": {"url": "{services.api.url}/health"}
    }
  ],
  "applications": [
    {
      "path": ".",
      "adapter": "browser",
      "env": {"API_URL": "{services.api.url}", "PUBLIC_API_URL": "{services.api.url}"},
      "requiredEnv": ["API_URL", "PUBLIC_API_URL"],
      "auth": {
        "request": {
          "url": "{services.api.url}/login",
          "data": {"email": "{env.CAPTURE_EMAIL}", "password": "{env.CAPTURE_PASSWORD}"}
        }
      },
      "scenarios": [
        {
          "path": "/projects/[projectId]",
          "fixtureSource": "projects",
          "ready": {"selector": "main h1", "absent": ["[data-loading]", "[data-error]"]}
        }
      ],
      "fixtureSources": [
        {
          "name": "projects",
          "url": "{services.api.url}/projects",
          "records": "items",
          "params": {"projectId": "id"}
        }
      ]
    }
  ]
}
```

`auth.request` defaults to POST and expected status 200. Cookies remain in memory
and are copied to isolated scenario contexts. Bearer-token APIs can use
`auth.token: { "path": "access_token", "header": "Authorization", "prefix": "Bearer " }`.
Browser login uses `auth.url`, `auth.steps`, and a required `auth.ready` condition.
A route with `auth: false` gets a clean visitor context. Login can also begin with
`auth.storageState`. Credentials are not written to the report or a session file.
Project process logs remain raw local output and can contain what the project logs.

## Existing scenarios and fixture data

Discovery reports `assets`: environment requirements, literal scenarios, fixture
parameter declarations, fixture JSON, exported scenario functions, and Storybook
exports. It reads these before constructing capture scenarios. Detection does not
execute repository JavaScript. API and fixture files are classified separately
from UI candidates. Within a Git repository, Git's ignore rules apply, including
nested rules. Outside Git, built-in exclusions apply and a discovered `.gitignore`
produces a warning instead of a claim that those rules were honored.

Literal arrays of scenarios in capture/scenario/fixture source files are reused
when their values are strings, numbers, booleans, arrays or objects. Functions,
spreads and computed values require an explicit module import. Named literal
`dynamicSegmentDefaults`, `routeParams` and `fixtureParams` objects supply parameter
values. Conflicting values remain unresolved unless configuration selects a value.
JSON fixture files are listed as records; configure their field mapping to use them.

An application can import existing JSON or an explicit JavaScript export:

```json
{
  "scenarioImports": [
    {
      "file": "scripts/capture-scenarios.mjs",
      "export": "buildScenarios",
      "args": [{"projectRoot": "{root}"}],
      "path": "scenarios"
    }
  ]
}
```

`path` selects a nested result, using dot-separated keys. Import execution occurs only during an
explicit capture request. Imported `path`, `routePattern`, `slug`, `readyText`,
`requiresAuth`, `beforeGoto(page)` and `afterLoad(page)` are connected to the runner.
The callbacks run project code and can change data. Configured recipes take
precedence over inferred entries. Imports preserve source inventory mappings.

Dynamic routes support `[id]`, `[[id]]`, `[...slug]`, `:id`, and `$id` parameters.
Use application `fixtureParams`, route `params`, or route `records` for declared
values. Arrays of independent parameter values expand into combinations. To keep
fields from one record together, use route `records` or a named `fixtureSource`.
`fixtureSources` reads a JSON `file` or an authenticated API `url`, selects the
`records` array, and maps `params` to fields using dot-separated paths. Missing
parameters are retained as unresolved routes; Screens never invents IDs.

For Storybook, start it as a managed service and set application
`storybook: { "url": "{services.stories.url}" }`. Screens reads its live
`index.json`, captures story iframe URLs, and binds entries to matching source
exports when the mapping is unambiguous. `storybook.ids` selects explicit story
IDs. Unselected stories remain in the discovery backlog. The default readiness condition
requires visible story content and no Storybook error panel. For a project that
publishes `document.body.dataset.storyResult`, set `waitForStoryResult: true` to
require `<story-id>:success`; otherwise provide `storybook.ready` for the project's
own completion condition. The runner does not infer completion of arbitrary play
functions from the presence of rendered content.

## Scenario readiness

Each observation in `report.scenarios` records `capture: "created"`, the capture
ID and variant, and a separate `readiness` result: `passed`, `failed` or `unverified`.
No readiness condition or app contract means unverified, even if the PNG is valid. Failures keep
diagnostic screenshots when the browser can produce them.

A browser `ready` condition can be a selector string or an object with `selector`,
`state`, `text`, `exact`, `url`, `event`, `fonts`, `absent`, and `timeoutMs`. Use a
positive readiness condition or app contract; absent selectors alone do not count.
Expected error states can use their own text as readiness. `expectedStatus` and
`expectedPath` describe intentional HTTP errors or redirects. Uncaught page errors
fail readiness unless the recipe explicitly sets `allowPageErrors`.

Native states and command adapters can supply `readinessCommand`, an argument
array with `{image}`, `{screen}` and `{device}` placeholders. Exit zero records a
passing project-defined readiness check; other exits fail readiness. Native
images without a matching readiness signal or command remain unverified. Its result is project-reported evidence, not independent native proof.

## Measured screen coverage

`screens detect PATH` reads source files and returns `inventory.items`. Each item
has a stable ID, application, kind, source file and line. Supported patterns include
file-based routes, literal route declarations, named screen/page/view components,
web dialogs and sheets, Storybook exports, SwiftUI views and presentations,
UIKit/AppKit controllers, storyboard controllers, React Native screen names,
Compose routes, Flutter widget classes, and simple loading/error/empty-state
branches. Relative routes, computed route expressions and presentation candidates remain unresolved until mapped to a recipe.

These are static source patterns, not a compiler or a proof of reachability.
Reusable components can appear as candidates. Native ownership uses project
folders, not Xcode target membership. Runtime-generated UI and arbitrary combinations
of permissions, accounts, data, themes and locales cannot be enumerated from source.
The inventory includes source fingerprints, scan limits and discovery warnings.

Each automatic run writes `inventory.json` and `coverage.json` alongside
`report.json`. Coverage counts requirements per candidate and variant:

- `captured`: an image from this run is attached; inspect its separate `readiness` result.
- `missing`: a recipe exists, but no matching image was recorded.
- `failed`: capture did not complete and the app reported an error.
- `unresolved`: a source candidate has no matching capture recipe.
- `excluded`: an explicit exclusion records why the candidate is outside scope.

There is no combined coverage percentage. `coverage.metrics` reports:

- `screens`: detected routes and configured Apple screens, with captured and ready counts across their variants.
- `scenarios`: distinct executable recipes, with captured and ready counts.
- `variants`: scenario/device combinations, with captured, ready, failed and unverified counts.
- `candidates`: other source candidates and the number without recipes.
- `exclusions`: distinct explicitly excluded IDs.

A route and its recipe count as one screen. Required items need both an image
and passing readiness; empty scope is incomplete. Incomplete required coverage
returns exit status 1. The registry run stores the report with its capture IDs.

Configured scenarios are required. In discovered scope, declared routes and
native screens are also required. Other source findings stay in `coverage.backlog`.
Promote one with `coverage.required: ["screen-ID"]`. `discoveryComplete` reports
scan warnings separately; optional findings do not block capture completion.
Completeness applies only to the required scope and selected variants.

Map source IDs from `detect` to recipes using `covers`. For example, a browser
recipe can open a dialog and wait for it before taking the image:

```json
{
  "applications": [
    {
      "path": ".",
      "adapter": "browser",
      "scenarios": [
        {
          "key": "settings-dialog",
          "path": "/settings",
          "covers": ["screen-ID-FROM-DETECT"],
          "steps": [
            {"action": "click", "selector": "button[data-action=preferences]"},
            {"action": "wait", "selector": "[role=dialog]"}
          ],
          "ready": "[role=dialog]"
        }
      ]
    }
  ]
}
```

Supported steps are `click`, `fill` with `value`, `check` with `checked`, `select`
with `value`, `press` with `key`, and `wait` with optional `state`. Steps execute
only during an explicitly requested capture and can change application data.
Use a suitable fixture account. A mapping records the recipe author's claim;
it does not independently prove that a screenshot depicts the intended state.

Native and command `scenarios` accept the same `covers` array. A command scenario
uses the producer manifest screen key as its `key`. Selected producer images count toward the command scenario. Set command `variants` to the required device and
browser fields for native workflows without detected device families.

For source candidates that are outside scope, add a root configuration entry:

```json
{
  "coverage": {
    "exclude": [{"id": "screen-ID-FROM-DETECT", "reason": "Reusable layout component; not a separate screen"}]
  }
}
```

Unknown IDs and exclusions without a reason are rejected. Source changes can
change IDs; update mappings from the current detection output. Do not exclude a
screen merely because its capture is difficult or currently fails.
