import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { agentClients, selectClients } from "./agent-clients.mjs";

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || !process.argv[i + 1])
    throw Error("Use --project DIR [--client all|NAME,NAME] [--runtime local|docker] [--data DIR] [--port 4800] [--replace yes]");
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
const root = fileURLToPath(new URL("../", import.meta.url));
const clients = selectClients(options.client);
const runtime = options.runtime || "local";
if (!options.project || !["local", "docker"].includes(runtime))
  throw Error("Use --project DIR --runtime local|docker");
if (runtime === "docker" && options.data)
  throw Error("Docker uses the Compose registry volume; omit --data");
const project = resolve(options.project);
const targets = [...new Set(clients.map((client) => agentClients[client].folder))].map((folder) => ({
  clients: clients.filter((client) => agentClients[client].folder === folder),
  directory: join(project, folder, "skills", "screens"),
}));
for (const target of targets) {
  if (existsSync(target.directory) && options.replace !== "yes")
    throw Error(`${target.directory} already exists. Use --replace yes to update the installed Screens files.`);
}
const config = {
  runtime,
  cli: join(root, "src/cli.mjs"),
  port: Number(options.port || process.env.SCREENS_PORT || process.env.PORT || 4800),
  ...(runtime === "local" ? {
    data: resolve(options.data || process.env.SCREENS_HOME || join(homedir(), ".local/share/verdictan-screens")),
  } : {}),
};
const json = (value) => JSON.stringify(value, null, 2) + "\n";
function ignore(directory, entry) {
  const file = join(directory, ".gitignore");
  const content = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!content.split(/\r?\n/).includes(entry))
    writeFileSync(file, content + (content && !content.endsWith("\n") ? "\n" : "") + entry + "\n");
}
for (const target of targets) {
  mkdirSync(target.directory, { recursive: true });
  cpSync(join(root, "skills/screens"), target.directory, { recursive: true });
  writeFileSync(join(target.directory, "screens-config.json"), json(config));
  ignore(target.directory, "screens-config.json");
}
const connectionDirectory = join(project, ".screens");
mkdirSync(join(connectionDirectory, "scripts"), { recursive: true });
ignore(connectionDirectory, "*");
const helper = join(connectionDirectory, "scripts/screens.mjs");
cpSync(join(root, "skills/screens/scripts/screens.mjs"), helper);
writeFileSync(join(connectionDirectory, "screens-config.json"), json(config));
const server = { command: process.execPath, args: [helper, "mcp"] };
const url = `http://127.0.0.1:${config.port}`;
writeFileSync(join(connectionDirectory, "mcp.json"), json({ mcpServers: { screens: server } }));
writeFileSync(join(connectionDirectory, "mcp.vscode.json"), json({ servers: { screens: { type: "stdio", ...server } } }));
writeFileSync(join(connectionDirectory, "mcp.opencode.json"), json({ mcp: { servers: { screens: {
  type: "local", command: [server.command, ...server.args],
} } } }));
writeFileSync(join(connectionDirectory, "mcp.codex.toml"),
  `[mcp_servers.screens]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}\n`);
writeFileSync(join(connectionDirectory, "connection.json"), json({
  stdio: server,
  http: { transport: "streamable-http", url: `${url}/mcp` },
  cli: { command: process.execPath, args: [helper] },
  registry: config.data || "screens Compose volume",
}));
writeFileSync(join(connectionDirectory, "AGENTS.md"), `# Screens project connection

Use Screens for capture comparison and capture-bound review work.
Read the shared workflow at ${JSON.stringify(join(root, "skills/screens/SKILL.md"))}.
Run commands from this project directory:

\`\`\`sh
node .screens/scripts/screens.mjs help
node .screens/scripts/screens.mjs serve
node .screens/scripts/screens.mjs load . --project PROJECT_ID
\`\`\`

Find an existing project ID with the helper's projects command before importing.
The helper uses the configured ${runtime === "docker" ? "Docker volume" : "local registry"}.
Picker: ${url}. Streamable HTTP MCP: ${url}/mcp (requires the service).
For an MCP client, register the command and argument array in connection.json.
Clients using mcpServers can copy the screens entry from mcp.json. VS Code uses
mcp.vscode.json; OpenCode uses mcp.opencode.json; Codex uses mcp.codex.toml.
Merge only the screens entry into the client's configuration, then reload it.
These generated files contain machine paths and are ignored by Git.

Any agent with local command execution can use the helper without MCP or skills.
An agent with only MCP access can use the registered tools. A remote agent needs
Screens in its own environment or an explicit tunnel to this loopback service.
Do not expose this unauthenticated service publicly.

Keep targets, implementation captures, and decisions distinct. Import does not
execute capture commands. Run capture recipes only when the user authorizes them.
Submit fixes with new capture evidence and the latest expected revision. Leave
target approval and fix verification to a human reviewer. Do not infer acceptance
from a zero pixel difference. Do not run tests unless the user or project requires them.
`);
const instructionsFile = join(project, "AGENTS.md");
const instructions = existsSync(instructionsFile) ? readFileSync(instructionsFile, "utf8") : "";
const reference = "For Screens capture and review tasks, read [.screens/AGENTS.md](.screens/AGENTS.md).";
if (!instructions.includes(reference))
  writeFileSync(instructionsFile, instructions + (instructions.endsWith("\n") || !instructions ? "" : "\n") + `\n## Screens review\n\n${reference}\n`);
console.log(json({
  installed: targets, runtime, registry: config.data || "screens Compose volume",
  mcp: server, http: `${url}/mcp`, connections: connectionDirectory,
  guide: join(connectionDirectory, "AGENTS.md"),
}));
