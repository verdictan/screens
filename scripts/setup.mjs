import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const options = { project: root, client: "all", runtime: "local" };
const flags = new Set(["start", "skip-browser"]);
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  if (["--help", "-h"].includes(name)) {
    console.log(`Install Screens and project agent workflows.

  node scripts/setup.mjs [options]

  --project DIR       Application repository (default: Screens checkout)
  --client LIST       all, both, or comma-separated agent names
  --runtime TYPE      local or docker (default: local)
  --data DIR          Local registry directory
  --port NUMBER       Picker and MCP port (default: 4800)
  --start             Start the picker after installation
  --skip-browser      Omit the local Chromium download
  --replace yes       Update existing Screens workflow files

Clients: generic, claude, codex, cursor, copilot, gemini, opencode.
Other agents can use the generated MCP settings or CLI guide.
Requires Node 22.22.2+ and npm; Docker mode also requires Compose.
No tests or capture recipes run during installation.`);
    process.exit(0);
  }
  const key = name.slice(2);
  if (!name.startsWith("--") || ![...flags, "project", "client", "runtime", "data", "port", "replace"].includes(key))
    throw Error(`Unknown option ${name}. Use --help.`);
  if (flags.has(key)) options[key] = true;
  else {
    if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
      throw Error(`${name} needs a value`);
    options[key] = process.argv[++i];
  }
}
if (!["local", "docker"].includes(options.runtime))
  throw Error("Use --runtime local or --runtime docker");
options.project = resolve(options.project);
if (options.data) options.data = resolve(options.data);
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
if (options.runtime === "local") {
  const windows = process.platform === "win32";
  run(windows ? "npm.cmd" : "npm", ["ci", "--include=dev"], { shell: windows });
  run(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"]);
  if (!options["skip-browser"])
    run(process.execPath, [join(root, "node_modules/playwright/cli.js"), "install", "chromium"]);
}
const installArgs = [join(root, "scripts/install-skills.mjs")];
for (const key of ["project", "client", "runtime", "data", "port", "replace"])
  if (options[key] !== undefined) installArgs.push(`--${key}`, options[key]);
run(process.execPath, installArgs);
const helper = join(options.project, ".screens/scripts/screens.mjs");
if (options.runtime === "docker" && !options.start) {
  run("docker", ["compose", "--project-directory", root, "-f", join(root, "compose.yaml"), "build"], {
    env: { ...process.env, ...(options.port ? { SCREENS_PORT: options.port } : {}) },
  });
}
console.log(`\nScreens is installed. Agent setup: ${join(options.project, ".screens/AGENTS.md")}`);
console.log(`Start the picker: node ${JSON.stringify(helper)} serve`);
if (options.start) run(process.execPath, [helper, "serve"]);
