import { accessSync, constants, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { applyEdits, modify, parse as parseJson } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { selectClients } from "./agent-clients.mjs";

export const userConnectionDirectory = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "screens");
function executable(name) {
  return (process.env.PATH || "").split(delimiter).some(directory =>
    (process.platform === "win32" ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")] : [""]).some(extension => {
      try { accessSync(join(directory, name + extension), constants.X_OK); return true; } catch { return false; }
    }));
}
export function installUserAgents(root, options) {
  const home = homedir();
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const claude = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const copilot = process.env.COPILOT_HOME || join(home, ".copilot");
  const opencode = join(xdg, "opencode");
  const profiles = {
    generic: { skills: join(home, ".agents/skills") },
    claude: { skills: join(claude, "skills"), file: process.env.CLAUDE_CONFIG_DIR ? join(claude, ".claude.json") : join(home, ".claude.json") },
    codex: { skills: join(home, ".agents/skills"), file: join(process.env.CODEX_HOME || join(home, ".codex"), "config.toml") },
    cursor: { skills: join(home, ".cursor/skills"), file: join(home, ".cursor/mcp.json") },
    copilot: { skills: join(copilot, "skills"), file: join(copilot, "mcp-config.json") },
    gemini: { skills: join(home, ".gemini/skills"), file: join(home, ".gemini/settings.json") },
    opencode: { skills: join(opencode, "skills"), file: join(opencode, existsSync(join(opencode, "opencode.jsonc")) ? "opencode.jsonc" : "opencode.json") },
  };
  const clients = !options.client || options.client === "auto"
    ? Object.keys(profiles).filter(name => name !== "generic" && (executable(name) || existsSync(profiles[name].file)))
    : selectClients(options.client);
  const connectionDirectory = userConnectionDirectory();
  const helper = join(connectionDirectory, "scripts/screens.mjs");
  const runtime = options.runtime || "local";
  if (!["local", "docker"].includes(runtime)) throw Error("Use --runtime local or docker");
  if (runtime === "docker" && options.data) throw Error("Docker uses the Compose registry volume; omit --data");
  const config = { runtime, cli: join(root, "src/cli.mjs"),
    port: Number(options.port || process.env.SCREENS_PORT || process.env.PORT || 4800),
    ...(runtime === "local" ? { data: resolve(options.data || process.env.SCREENS_HOME || join(home, ".local/share/verdictan-screens")) } : {}) };
  const server = { command: process.execPath, args: [helper, "mcp"] };
  const json = value => JSON.stringify(value, null, 2) + "\n";
  mkdirSync(dirname(helper), { recursive: true });
  cpSync(join(root, "skills/screens/scripts/screens.mjs"), helper);
  writeFileSync(join(connectionDirectory, "screens-config.json"), json(config));
  writeFileSync(join(connectionDirectory, "mcp.json"), json({ mcpServers: { screens: server } }));
  const installed = [];
  for (const name of clients) {
    const profile = profiles[name];
    if (profile.file) {
      const previous = existsSync(profile.file) ? readFileSync(profile.file, "utf8") : "";
      let next;
      if (name === "codex") {
        const config = parseToml(previous);
        config.mcp_servers ??= {};
        config.mcp_servers.screens = server;
        next = stringifyToml(config);
      } else {
        const errors = [];
        parseJson(previous || "{}", errors, { allowTrailingComma: true });
        if (errors.length) throw Error(`Cannot read ${profile.file}: invalid JSON configuration`);
        const path = name === "opencode" ? ["mcp", "servers", "screens"] : ["mcpServers", "screens"];
        const value = name === "opencode" ? { type: "local", command: [server.command, ...server.args], enabled: true }
          : name === "copilot" ? { type: "local", ...server, tools: ["*"] } : server;
        next = applyEdits(previous || "{}\n", modify(previous || "{}\n", path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
      }
      mkdirSync(dirname(profile.file), { recursive: true });
      writeFileSync(profile.file, next, { mode: 0o600 });
    }
    const directory = join(profile.skills, "screens");
    mkdirSync(directory, { recursive: true });
    cpSync(join(root, "skills/screens"), directory, { recursive: true });
    writeFileSync(join(directory, "screens-config.json"), json(config));
    installed.push({ client: name, skills: directory, mcp: profile.file || null });
  }
  console.log(json({ scope: "user", installed, connections: connectionDirectory,
    message: clients.length ? "Restart your agents to load Screens. Keep their normal tool approval settings." : "No supported agents detected. Use --client NAME to select one, or use mcp.json with another client." }));
}
