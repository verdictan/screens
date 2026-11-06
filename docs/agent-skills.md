# Claude Code and Codex skills

Install repository-local workflows from the Screens checkout after `npm ci`:

```sh
npm run skills:install -- --project /absolute/application --client both
```

`--client claude` writes `.claude/skills/screens`; `--client codex` writes
`.agents/skills/screens`. `both` installs both. Existing directories are never
overwritten. To update, review/remove the old installation explicitly, then run the
installer again. Skills are not globally installed just by cloning Screens.

The installer creates an ignored `screens-config.json` containing the runtime path
and shared registry directory. Use `--data /absolute/registry` to select a local
registry, or `--runtime docker` to use the Compose volume. Do not check machine
paths into Git. Cloning an application with the skill source requires configuring
its helper again (or setting SCREENS_CLI and SCREENS_HOME).

| Client | Invoke | Installed directory |
| --- | --- | --- |
| Claude Code | `/screens load .` | `.claude/skills/screens` |
| Codex | `$screens load .` or select Screens in the skill picker | `.agents/skills/screens` |

These locations follow the [Claude Code skill documentation](https://code.claude.com/docs/en/skills)
and [Codex skill documentation](https://developers.openai.com/codex/skills/).

`load`, `compare`, and `fix` are agent workflows, not three separate slash commands.
The agent reads the shared skill and invokes the bundled helper or MCP tools.
For `compare PR 123`, it resolves exact revisions, obtains/imports available
captures, then constructs the comparison. There is no automatic PR build runner.

## MCP connection

For local storage, use the exact CLI path and data directory printed by the
installer when adding the server:

```sh
claude mcp add --scope user screens -- node /absolute/screens/src/cli.mjs mcp --data /absolute/registry
codex mcp add screens -- node /absolute/screens/src/cli.mjs mcp --data /absolute/registry
```

For Docker use HTTP as described in [deployment](deployment.md). Skill installation
does not overwrite either client's MCP configuration. Clients sharing a registry
see the same immutable captures, notes and submitted evidence.

## Distributable packages and checks

```sh
npm run skills:validate
npm run skills:package
```

`dist/` contains Claude and Codex tar.gz archives with their respective directory
layouts, a shared SKILL.md, a Node helper and Codex display metadata. A manifest
records SHA-256 for both archives. Extract an archive at an application's root;
set SCREENS_CLI to the Screens CLI and SCREENS_HOME to the shared registry, or use
the installer instead. Packages contain no database, screenshots, machine paths
or credentials. They require an installed Screens runtime and Node 22.13+.

Automated tests install both packages in a temporary repository, load a manifest
through one helper, compare it through the other, read images via MCP and submit
capture-bound feedback. Package integrity and Docker argument routing are tested
separately. These tests do not substitute for a live model/client session; see
[validation](validation.md) for observed checks and environment limitations.
