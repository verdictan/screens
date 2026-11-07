# Screens

**Compare screenshots. Leave feedback. Review the fix.**

Screens is a local review board for your app. Compare the current screen with
its design, click to leave feedback, and ask your AI coding assistant to fix it.
You decide when the result is ready.

![Screens demo: compare designs, overlay images, pin feedback, and review a proposed fix.](docs/assets/product-demo.gif)

*Actual Screens interface with sample data.*

## Get started

Open your app's project in your AI coding assistant and ask:

> Install Screens from https://github.com/verdictan/screens, connect it to this
> project, and open the review page. Load any existing screenshots.

Your assistant needs access to local files and commands.

### Install with Homebrew

On macOS or Linux with Homebrew installed, run:

```sh
brew install verdictan/tap/screens
screens serve
```

Screens includes Git, Chromium, Firefox, WebKit, English OCR, and accessibility scanning.
No Docker, cloud account, or separate OCR/browser setup is needed. The installer
handles browser system libraries on supported Linux systems.

Open [localhost:4800](http://127.0.0.1:4800). Keep the terminal open;
press **Ctrl+C** to stop Screens. Your screenshots and comments remain saved.

To register Screens skills and MCP for detected user-wide AI agents, run:

```sh
node "$(brew --prefix screens)/libexec/lib/node_modules/@verdictan/screens/scripts/install-skills.mjs"
```

Restart your AI agents afterward. Add `--project "/path/to/your-app"` for project-only setup.
Use `--client claude,codex,cursor,copilot,gemini,opencode` to select clients explicitly.

#### Run in the background

Stop any foreground `screens serve` process with **Ctrl+C**, then run:

```sh
brew services start screens
```

Run this as your normal user, without `sudo`. Screens starts in the background
and at login, serves [localhost:4800](http://127.0.0.1:4800), and uses the same
saved data in `~/.local/share/verdictan-screens` as the foreground command.

Manage the service with:

```sh
brew services info screens
brew services restart screens
brew services stop screens
```

Logs are in `$(brew --prefix)/var/log/screens.log` and
`$(brew --prefix)/var/log/screens-error.log`.

#### Update Screens

```sh
brew update
brew upgrade screens
brew services restart screens
```

If you run Screens in a terminal instead, stop it before upgrading and run
`screens serve` again afterward.

Pushes to `main` trigger Jenkins to publish a new
[GitHub release](https://github.com/verdictan/screens/releases) and update the
[Homebrew formula](https://github.com/verdictan/homebrew-tap/blob/main/Formula/screens.rb).

### Install with the setup script

Install **Git** and either **Homebrew** or **Node.js 22.22.2+**, then run:

```sh
git clone https://github.com/verdictan/screens.git
cd screens
bash install.sh --start
```

With Homebrew, the script installs the package and starts its background service automatically. Otherwise,
it builds from source; keep the terminal open while Screens runs. On Windows,
use `powershell -File install.ps1 --project "/path/to/your-app" --start`.
Open [localhost:4800](http://127.0.0.1:4800) and restart your AI assistant in your
app's project to load the Screens tools.

## Develop Screens

```sh
npm run dev
```

Open [localhost:5173](http://127.0.0.1:5173). React and CSS edits update through
Vite hot reload. Changes to the API source restart the backend automatically.
The API runs on port 4801; Vite forwards API and MCP requests to it.
Press **Ctrl+C** to stop both servers. No production build is needed.

Development uses your existing local registry. To use separate data or ports:

```sh
SCREENS_HOME=.screens/dev SCREENS_DEV_PORT=5174 SCREENS_API_PORT=4802 npm run dev
```

Use different ports for the UI and API. Both servers bind to this computer only.

## Review a screen

1. **Compare** the current screenshot with the design.
2. **Click a point or choose Select area** and drag over part of the screenshot to leave a comment.
3. **Ask your assistant** to fix the issue and add a new screenshot.
4. **Review the result** and accept it when you are satisfied.

### Review a flow

Choose **New set** in the library, name the flow, and add screens from the current
run. Move screens up or down to set their order, then save. Select the set to
review it with the previous and next controls. **Edit set** changes its name,
screens, or order. The page link includes the selected set.

### Compare an area

Choose **Select area** and drag over a screenshot. Choose **Compare selected
area** to see both crops, then expand **Inspect pixel differences** and choose
**Measure selected area**. Only pixels inside that region count. Pixel measurement
requires equal image dimensions; screenshots are never resized to force a match.

Use **Comment on area** to attach feedback, or **Use an area comment** to select
an existing annotation. Keyboard users can focus the selection surface, press
Enter, move with arrow keys, resize with Shift and arrows, and press Enter again.
Choose **Show full screenshots** to leave the cropped view.

Screens keeps earlier screenshots and their comments. Setup does not take
screenshots automatically; ask your assistant to prepare any that are missing.

## Use Screens without the UI

```sh
screens headless-help
screens capture-plan --config capture.json
screens tasks-list --project PROJECT_ID
screens storage-report
```

Capture jobs, agent task claims, CI reports, portable review bundles, backups,
and signing work through the CLI. Screens runs queued jobs and enabled schedules
while its server is running. Registry operations are also available
through MCP and the local HTTP API. See the [headless feature guide](docs/headless.md)
for the included commands and configuration.

## More help

- [Setup, imports, and commands](docs/usage.md)
- [Connect your AI assistant](docs/agent-skills.md)
- [Review evidence](docs/evidence.md)
- [Tests and coverage](docs/testing.md)
- [Planned features](docs/roadmap.md)

The optional [Docker distribution](docs/deployment.md) includes the same features
and managed runtimes as the Homebrew package.

Screens runs on your computer and has no account sign-in. Keep it local.
