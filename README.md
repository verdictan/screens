# Screens

A local workspace for design targets, implementation screenshots, and review feedback.
Compare captures, pin feedback, and let your AI agent submit fixes with new evidence.

## Quick start

Requires **Node.js 22.22.2+ and npm**.

```sh
git clone https://github.com/verdictan/screens.git
cd screens
bash install.sh --start
```

Open **http://127.0.0.1:4800**. Keep the terminal open; press Ctrl+C to stop.
The installer installs dependencies, builds the picker, downloads Chromium, and
sets up agent workflows. It does not run tests or capture your application.

On Windows, use `powershell -File install.ps1 --start`. You can also run
`npm run setup -- --start` on any platform with Node and npm.

## Use it with your project

```sh
bash install.sh --project /path/to/your-app
```

Restart your agent, then ask:

> Use Screens to load this project and show missing screen evidence.

Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, and OpenCode can discover
the installed workflow. Other agents can read `.screens/AGENTS.md` in your app.
Any agent with command execution can use the helper; MCP clients can use the
connection files generated in `.screens/`. See [agent setup](docs/agent-skills.md).

To import existing screenshots yourself, run this from your app:

```sh
node .screens/scripts/screens.mjs load . --project my-app
```

Start with [screens.json](examples/screens.json) if your app has no manifest.
Replace its example paths with real captures. Import never runs application code.

## Docker

With Node and Docker Compose installed:

```sh
bash install.sh --runtime docker --start
```

Docker keeps the service running in the background and stores evidence in a named
volume. Use the generated helper for imports so they reach that same volume.
See [Docker and SSH deployment](docs/deployment.md).

## Useful options

```sh
bash install.sh --project /path/to/app --client cursor,copilot
bash install.sh --data /path/to/registry --port 4900 --start
bash install.sh --skip-browser
bash install.sh --project /path/to/app --replace yes
```

Run `bash install.sh --help` for all options. To start an installed project later:

```sh
node /path/to/app/.screens/scripts/screens.mjs serve
```

Screens is a trusted local service. Keep it on loopback. Agents submit evidence;
humans approve targets and verify fixes. A zero pixel difference is not acceptance.

[Usage and PR capture](docs/usage.md) · [Evidence](docs/evidence.md) ·
[Standalone proof](docs/standalone-proof.md) · [Roadmap](docs/roadmap.md)
