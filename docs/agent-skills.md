# Agent setup

Agents use the same registry through skills, MCP, or commands. A client needs
local tools or command execution to operate Screens.

## User-wide setup

From the Screens checkout:

```sh
node scripts/install-skills.mjs
```

For Homebrew, use the installed script:

```sh
node "$(brew --prefix screens)/libexec/lib/node_modules/@verdictan/screens/scripts/install-skills.mjs"
```

Setup detects agents through PATH or existing MCP configuration. Select clients
with `--client NAME,NAME`; `--client all` includes all supported profiles. Restart
the agents afterward. Setup does not import projects or change approval policies.

Connections live in `$XDG_CONFIG_HOME/screens` (default `~/.config/screens`).
Reruns update Screens entries and preserve other settings. JSON comments remain;
Codex TOML is reserialized without comments. Generic clients get a shared skill
and connection file; VS Code Copilot needs manual MCP registration.

## Project-only setup

```sh
bash install.sh --project /path/to/app
```

If Screens is installed, add only workflows and connection files:

```sh
npm run skills:install -- --project /path/to/app --client all
```

Select `--runtime docker`, `--data DIR`, or `--port 4900` when needed. Use
`--replace yes` to update existing Screens files. Unrelated files and project
instructions stay in place. Setup adds a relative link to `.screens/AGENTS.md`.
Project-only setup generates MCP settings for manual registration.

| Client | Skill directory | Invocation |
| --- | --- | --- |
| `claude` | `.claude/skills/screens/` | `/screens` |
| `codex` | `.agents/skills/screens/` | `$screens` |
| `cursor`, `gemini`, `opencode` | `.agents/skills/screens/` | Ask the agent to use Screens |
| `copilot` | `.github/skills/screens/` | Ask the agent to use Screens |
| `generic` | `.agents/skills/screens/` | Read the workflow directly |

`both` selects Claude and Codex. `all` writes shared directories once. Client
workspace trust and command permissions still apply. These profiles do not imply
that full model sessions have been tested in each client.

## Command access

Tell agents without skill discovery to read `.screens/AGENTS.md`. The generated
helper retains your registry, runtime, and port:

```sh
node .screens/scripts/screens.mjs load . --project my-app
node .screens/scripts/screens.mjs compare --project my-app --current BASE_RUN --target TARGET_RUN --pr PR_RUN
node .screens/scripts/screens.mjs diff --left CAPTURE_ID --right CAPTURE_ID
```

Docker helpers use the Compose volume and read-only import mounts. Build the
image first. Import does not execute capture recipes.

## MCP connections

Use `.screens/connection.json` for the command and argument array, or merge the
Screens entry from a generated client file:

| File | Shape |
| --- | --- |
| `.screens/mcp.json` | `mcpServers.screens` |
| `.screens/mcp.vscode.json` | `servers.screens`, `type: stdio` |
| `.screens/mcp.opencode.json` | `mcp.servers.screens`, `type: local` |
| `.screens/mcp.codex.toml` | `[mcp_servers.screens]` |

Direct local stdio does not need the web server. For Streamable HTTP, start
Screens and register its configured URL:

```sh
claude mcp add --transport http --scope user screens http://127.0.0.1:4800/mcp
codex mcp add screens --url http://127.0.0.1:4800/mcp
```

Screens uses MCP protocol `2025-03-26`; no legacy SSE endpoint is provided.
`tools/list` returns available tools and schemas. `captures_view` returns image
content up to 10 MB per response; larger images remain viewable in the UI.
Agents submit fixes; people approve targets and verify fixes.

Cloud agents cannot reach your machine's loopback address. Install Screens in
their environment or use an explicit SSH tunnel. Keep the service private.

## Portable setup

Generated connection files contain machine paths and stay ignored by Git.
Configure again after cloning to another machine. All clients must use the same
registry or Docker volume.

`npm run skills:package` writes client archives and SHA-256 checksums to `dist/`.
Archives contain the shared skill and helper, with no credentials or evidence.
Configure extracted workflows with the installer, or set `SCREENS_CLI` and
`SCREENS_HOME`. The runtime requires Node 22.22.2+.
