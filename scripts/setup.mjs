import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const options = { runtime: "local" };
const flags = new Set(["start"]);
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  if (["--help", "-h"].includes(name)) {
    console.log(`Install Screens and agent workflows.

  node scripts/setup.mjs [options]

  --project DIR       Application repository (omit for user-wide setup)
  --client LIST       auto, all, both, or agent names (user default: auto)
  --data DIR          Local registry directory
  --port NUMBER       Picker and MCP port (default: 4800)
  --start             Start the picker for source installs
  --replace yes       Update existing Screens workflow files

Clients: generic, claude, codex, cursor, copilot, gemini, opencode.
Other agents can use the generated MCP settings or CLI guide.
Local setup uses Homebrew and starts its service when brew is available.
Otherwise, local setup requires Node 22.22.2+ and npm.
Chromium, Firefox, WebKit, and their supported Linux libraries install with Screens.
No tests or capture recipes run during installation.`);
    process.exit(0);
  }
  const key = name.slice(2);
  if (!name.startsWith("--") || ![...flags, "project", "client", "data", "port", "replace"].includes(key))
    throw Error(`Unknown option ${name}. Use --help.`);
  if (flags.has(key)) options[key] = true;
  else {
    if (!process.argv[i + 1] || process.argv[i + 1].startsWith("--"))
      throw Error(`${name} needs a value`);
    options[key] = process.argv[++i];
  }
}
if (options.project) options.project = resolve(options.project);
if (options.data) options.data = resolve(options.data);
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const brew = process.platform !== "win32"
  && spawnSync("brew", ["--prefix"], { stdio: "ignore" }).status === 0;
let runtimeRoot = root;
let runtimeNode = process.execPath;
function brewPrefix(formula) {
  const result = spawnSync("brew", ["--prefix", formula], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(result.stderr || `Cannot locate ${formula}`);
  return result.stdout.trim();
}
if (brew) {
  const installed = spawnSync("brew", ["list", "--versions", "screens"], { stdio: "ignore" }).status === 0;
  run("brew", [installed ? "upgrade" : "install", "verdictan/tap/screens"]);
  runtimeRoot = join(brewPrefix("screens"), "libexec/lib/node_modules/@verdictan/screens");
  runtimeNode = join(brewPrefix("node"), "bin/node");
  options.data = resolve(options.data || process.env.SCREENS_HOME || join(homedir(), ".local/share/verdictan-screens"));
  options.port = String(options.port || process.env.SCREENS_PORT || process.env.PORT || 4800);
} else {
  const windows = process.platform === "win32";
  run(windows ? "npm.cmd" : "npm", ["ci", "--include=dev"], { shell: windows });
  run(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"]);
}
if (brew) run(runtimeNode, [join(runtimeRoot, "scripts/bundle-runtime.mjs")]);
const installArgs = [join(runtimeRoot, "scripts/install-skills.mjs")];
for (const key of ["project", "client", "runtime", "data", "port", "replace"])
  if (options[key] !== undefined) installArgs.push(`--${key}`, options[key]);
run(runtimeNode, installArgs);
const connectionDirectory = options.project ? join(options.project, ".screens") : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "screens");
const helper = join(connectionDirectory, "scripts/screens.mjs");
console.log(`\nScreens is installed. Agent setup: ${connectionDirectory}`);
if (brew) {
  const configDirectory = join(process.env.HOMEBREW_USER_CONFIG_HOME || join(homedir(), ".homebrew"), "services");
  mkdirSync(configDirectory, { recursive: true });
  const configFile = join(configDirectory, "screens.env");
  const previous = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
  const lines = previous.split(/\r?\n/).filter(line => line && !/^\s*(SCREENS_HOME|PORT)\s*=/.test(line));
  lines.push(`SCREENS_HOME=${options.data}`, `PORT=${options.port}`);
  writeFileSync(configFile, lines.join("\n") + "\n", { mode: 0o600 });
  chmodSync(configFile, 0o600);
  run("brew", ["services", "stop", "screens"]);
  run("brew", ["services", "start", "screens"]);
  console.log(`Screens is running at http://127.0.0.1:${options.port}. Stop it with: brew services stop screens`);
} else {
  console.log(`Start the picker: node ${JSON.stringify(helper)} serve`);
  if (options.start) run(process.execPath, [helper, "serve"]);
}
