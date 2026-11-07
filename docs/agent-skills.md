# AI agent setup

Screens uses the same registry and service layer through Agent Skills, MCP, and
the CLI. An agent needs at least one of these capabilities. A chat client with no
tools or command execution cannot operate a local registry.

## Install

From the Screens checkout:

```sh
bash install.sh --project /path/to/application
```

This installs the runtime and the supported project workflows. Use
`--runtime docker` for a Compose registry, `--data DIR` for a local registry,
`--port 4900` for another port, and `--client NAME,NAME` to select agents.
Add `--start` to start the picker after setup. Local mode runs in the foreground;
Docker mode runs in the background.

If the runtime is already installed, install only the workflows and connection files:

```sh
npm run skills:install -- --project /path/to/application --client all
```

Use `--replace yes` to update installed Screens files. Existing skill directories
are not overwritten without that option. Unrelated files in those directories stay
in place. The installer appends one relative link to the project's `AGENTS.md` and
preserves existing instructions. It does not change global agent settings.

## Agent Skills

| Client option | Workflow location | How to use it |
| --- | --- | --- |
| `claude` | `.claude/skills/screens/` | Ask for Screens or use `/screens` |
| `codex` | `.agents/skills/screens/` | Ask for Screens or use `$screens` |
| `cursor` | `.agents/skills/screens/` | Ask the agent to use Screens |
| `copilot` | `.github/skills/screens/` | Ask the agent to use Screens |
| `gemini` | `.agents/skills/screens/` | Ask Gemini CLI to use Screens |
| `opencode` | `.agents/skills/screens/` | Ask the agent to use Screens |
| `generic` | `.agents/skills/screens/` | Use an Agent Skills client or read the workflow directly |

`all` selects every profile and writes shared directories once. `both` selects
Claude and Codex. Reload your client after installation. Its workspace trust,
skill activation, and command permissions still apply.

The shared paths are documented by [Cursor](https://cursor.com/docs/skills),
[Gemini CLI](https://geminicli.com/docs/cli/skills/), and
[OpenCode](https://opencode.ai/docs/skills/). Copilot's project location is documented
in [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills).
These are installation profiles, not claims that full model sessions have been tested
in every client. See [recorded validation](validation.md) for the scope of earlier proof.

## Any agent with command execution

The installer creates `.screens/AGENTS.md` with the configured workflow and a
helper at `.screens/scripts/screens.mjs`. Tell an agent without skill discovery
to read that guide. From the application directory:

```sh
node .screens/scripts/screens.mjs projects
node .screens/scripts/screens.mjs load . --project my-app
node .screens/scripts/screens.mjs compare --project my-app --current BASE_RUN --target TARGET_RUN --pr PR_RUN
node .screens/scripts/screens.mjs diff --left CAPTURE_ID --right CAPTURE_ID
```

The helper uses the saved registry, runtime, and port. Docker helpers mount input
files read-only and use the Compose volume. They resolve GitHub PR metadata on the
host; use `capture-refs` for Docker captures. Import never executes capture recipes.

## Any compatible MCP client

Register the command and argument array in `.screens/connection.json` as a stdio
MCP server named `screens`. The command uses the installed Node executable and
configured helper. Stdio local mode does not need a running web server. Docker
mode needs the image built and Docker running.

The installer also generates ready-to-merge settings:

| Generated file | Configuration shape |
| --- | --- |
| `.screens/mcp.json` | `mcpServers.screens` with `command` and `args`, for clients such as Claude Desktop, Cursor and Gemini CLI |
| `.screens/mcp.vscode.json` | `servers.screens` with `type: stdio`, for VS Code |
| `.screens/mcp.opencode.json` | `mcp.servers.screens` with `type: local`, for OpenCode v2 |
| `.screens/mcp.codex.toml` | `[mcp_servers.screens]`, for Codex |

Merge the `screens` entry into your client's MCP settings, then reload the client.
The installer generates these files rather than replacing existing MCP settings.
Client connection formats are documented by
[VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers),
[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/), and
[OpenCode](https://opencode.ai/docs/mcp-servers/), and
[Codex](https://developers.openai.com/codex/mcp/).

For clients that use Streamable HTTP, start the picker and register
`http://127.0.0.1:4800/mcp`, using your configured port. The exact URL is in
`.screens/connection.json`. Screens implements MCP protocol `2025-03-26`, stdio,
and stateless Streamable HTTP; it does not implement a legacy SSE endpoint.
Clients must support a matching transport and protocol. The server's `tools/list`
response provides the available tools and their schemas.

Cloud agents cannot reach your machine's loopback address. Install Screens in the
agent's environment or use an explicit SSH tunnel. Do not expose this local service
publicly. Clients can submit fixes; approval and verification remain human review
operations in the picker.

## Files and packages

Generated `.screens/` connections and each skill's `screens-config.json` contain
machine paths and are ignored by Git. Configure the workflow again after cloning
an application to another machine. All agents reviewing a project must use the
same registry or Docker volume.

`npm run skills:package` creates an archive for each client profile, including a
generic Agent Skills archive, plus a SHA-256 manifest in `dist/`. Packages contain
the shared skill and executable helper, not credentials, registries, or screenshots.
Use the installer to configure an extracted workflow, or set `SCREENS_CLI` and
`SCREENS_HOME` explicitly. The runtime requires Node 22.22.2+.
