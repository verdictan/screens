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

Replace `/path/to/your-app` with your app's folder. With Homebrew, the script
installs the package and starts its background service automatically. Otherwise,
it builds from source; keep the terminal open while Screens runs. On Windows,
use `powershell -File install.ps1 --project "/path/to/your-app" --start`.
Open [localhost:4800](http://127.0.0.1:4800) and restart your AI assistant in your
app's project to load the Screens tools.

## Review a screen

1. **Compare** the current screenshot with the design.
2. **Click the screenshot** to leave feedback.
3. **Ask your assistant** to fix the issue and add a new screenshot.
4. **Review the result** and accept it when you are satisfied.

Screens keeps earlier screenshots and their comments. Setup does not take
screenshots automatically; ask your assistant to prepare any that are missing.

## More help

- [Setup, imports, and commands](docs/usage.md)
- [Connect your AI assistant](docs/agent-skills.md)
- [Run with Docker](docs/deployment.md)
- [Review evidence](docs/evidence.md)
- [Tests and coverage](docs/testing.md)
- [Planned features](docs/roadmap.md)

Screens runs on your computer and has no account sign-in. Keep it local.
