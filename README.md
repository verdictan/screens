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

To connect your AI assistant to an app, run this in another terminal:

```sh
node "$(brew --prefix screens)/libexec/lib/node_modules/@verdictan/screens/scripts/install-skills.mjs" --project "/path/to/your-app"
```

Replace `/path/to/your-app` with your app's folder, then restart your AI assistant
in that project.

To update Screens, stop it and run:

```sh
brew update
brew upgrade screens
screens serve
```

Pushes to `main` trigger Jenkins to publish a new
[GitHub release](https://github.com/verdictan/screens/releases) and update the
[Homebrew formula](https://github.com/verdictan/homebrew-tap/blob/main/Formula/screens.rb).

### Install from source

Install **Node.js 22.22.2+** and **Git**, then run:

```sh
git clone https://github.com/verdictan/screens.git
cd screens
node scripts/setup.mjs --project "/path/to/your-app" --start
```

Replace `/path/to/your-app` with your app's folder. Open
[localhost:4800](http://127.0.0.1:4800) and keep the terminal open.
Restart your AI assistant in your app's project to load the Screens tools.

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
