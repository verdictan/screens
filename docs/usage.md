# Using Screens

Capture or import your app, compare it with a target, and review fixes in the same
local registry. See the [documentation index](README.md) for detailed references.

## Install

With Homebrew:

```sh
brew install verdictan/tap/screens
screens serve
```

Open <http://127.0.0.1:4800>. For background operation, stop the foreground process
and run `brew services start screens`. Use `brew services info screens`,
`restart screens`, or `stop screens` to manage it. Run the service as your normal
user. Logs are in `$(brew --prefix)/var/log/screens.log` and `screens-error.log`.

Update with `brew update` and `brew upgrade screens`, then restart the service.
For a foreground service, stop it before upgrading and start it again afterward.

From source on macOS or Linux:

```sh
git clone https://github.com/verdictan/screens.git
cd screens
bash install.sh --start
```

On Windows, use `powershell -File install.ps1 --start`. Setup uses Homebrew when
available; otherwise it requires Node 22.22.2+ and npm and builds the UI. Without
Homebrew, `--start` runs the local service in the foreground. Node 22 can emit an
experimental SQLite warning.

Installation supplies Git, three browser engines, English OCR, and axe-core.
Supported Linux systems also need browser system libraries; the installer uses
the OS package manager and can require administrator rights. Setup does not run
tests. Docker is an [alternative distribution](deployment.md).

## Capture

```sh
screens capture-draft /path/to/app --output capture-plan.json
screens capture-auto /path/to/app --plan capture-plan.json
```

Review the draft configuration and supply missing settings before capture.
`capture-auto` authorizes project execution and returns a review URL. It captures
the working tree and retains partial results when a scenario fails.

Use `screens detect /path/to/app` to inspect the project without running it.
[Automatic capture](automatic-capture.md) covers recipes, services, authentication,
fixtures, native apps, coverage, and interrupted jobs.

## Import existing screenshots

```sh
screens load /path/to/app --project my-app --name 'My app'
screens load /path/to/screens.json --project my-app
```

Copy [examples/screens.json](../examples/screens.json) for the canonical evidence
manifest. Import also recognizes Kalkidan picks, Verdictan capture manifests,
and Console routing-comparison manifests. Images must resolve inside the manifest
directory, including through symlinks. Missing images produce warnings.

Import returns a run ID and review URL. It never executes application code or
approves a target. Unknown source revisions stay `unknown`. If a directory has
no manifest, `load` returns detection results and zero captures.

## Review

Compare Current, Target, and PR captures. Click to add a point comment, or choose
**Select area** and drag to add a rectangular comment. Ask your assistant to submit
a fresh capture for a fix, then inspect it before verification. Approval and
verification remain human decisions.

For a flow, choose **New set**, name it, add screens from the current run, and
order them. Previous/next controls follow that order. **Edit set** changes its
name, members, or order; the page URL retains the selected set.

For a region, choose **Compare selected area**, then **Inspect pixel differences**
and **Measure selected area**. **Use an area comment** selects an existing
annotation; **Show full screenshots** leaves the crop. Measurement requires equal
image dimensions. Source images remain unchanged.

Keyboard users can focus the selection surface, press Enter, move with arrow
keys, resize with Shift+arrows, and press Enter again. Earlier comments stay
bound to their original capture. See [Evidence contracts](evidence.md) for
measurement and semantic-check rules.

## Compare a PR

Fetch the PR commits into the local repository, then run:

```sh
screens capture-pr OWNER/REPO 123 --repo /path/to/app \
  --config /path/to/screens.capture.json --output /path/to/new-evidence --execute yes
```

Screens resolves the head and merge base, captures isolated checkouts, and
refuses to publish a comparison if the PR head changes. `GITHUB_TOKEN` enables
private-repository API access; GitHub CLI is not required for capture.

Use `capture-refs --base SHA --head SHA` for local revisions. Add
`--target TARGET_RUN_ID` to include an existing design target. To compare already
imported runs:

```sh
screens compare --project my-app --current BASE_RUN --target TARGET_RUN --pr PR_RUN
```

See [Capture recipes](capture-automation.md) for profiles and source selection.

## Connect agents

Follow [Agent setup](agent-skills.md) for user-wide or project-only installation.
All agents must use the same registry as the review interface. Use
`screens headless-help` to inspect CLI action schemas and CLI-only operations.

## Data

The default registry is `~/.local/share/verdictan-screens`. Select another with
`--data DIR` or `SCREENS_HOME`; use that directory for the service and all clients.
Keep screenshots, databases, credentials, and generated connection files out of Git.

Screens binds to loopback and checks Host and Origin. It has no account
authentication; do not expose it publicly. SVG and HTML uploads are rejected.
[Storage](storage-tools.md) covers backups, restore, exports, and signatures.

## Develop

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:5170>. Vite reloads UI changes and forwards API/MCP requests
to port 4801. API source changes restart the backend. Ctrl+C stops both processes.
Development uses the normal registry unless changed:

```sh
SCREENS_HOME=.screens/dev SCREENS_DEV_PORT=5174 SCREENS_API_PORT=4802 npm run dev
```

Keep the UI and API ports distinct. For a production source build, use `npm start`.
See [Testing](testing.md) for test commands and [Roadmap](roadmap.md) for remaining work.
