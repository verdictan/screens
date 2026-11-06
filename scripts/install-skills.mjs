import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith("--") || !process.argv[i + 1])
    throw Error(
      "Use --project DIR --client claude|codex|both [--runtime local|docker] [--data DIR]",
    );
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
const root = fileURLToPath(new URL("../", import.meta.url));
const client = options.client || "both",
  runtime = options.runtime || "local";
if (
  !options.project ||
  !["claude", "codex", "both"].includes(client) ||
  !["local", "docker"].includes(runtime)
)
  throw Error(
    "Use --project DIR --client claude|codex|both --runtime local|docker",
  );
const project = resolve(options.project);
const targets = (client === "both" ? ["claude", "codex"] : [client]).map(
  (c) => ({
    client: c,
    directory: join(
      project,
      c === "claude" ? ".claude" : ".agents",
      "skills",
      "screens",
    ),
  }),
);
for (const t of targets)
  if (existsSync(t.directory))
    throw Error(
      `${t.directory} already exists; review/remove the old installation explicitly before reinstalling`,
    );
const config = {
  runtime,
  cli: join(root, "src/cli.mjs"),
  ...(runtime === "local"
    ? {
        data: resolve(
          options.data ||
            process.env.SCREENS_HOME ||
            join(homedir(), ".local/share/verdictan-screens"),
        ),
      }
    : {}),
};
for (const t of targets) {
  mkdirSync(t.directory, { recursive: true });
  cpSync(join(root, "skills/screens"), t.directory, { recursive: true });
  writeFileSync(
    join(t.directory, "screens-config.json"),
    JSON.stringify(config, null, 2) + "\n",
    { flag: "wx" },
  );
  writeFileSync(join(t.directory, ".gitignore"), "screens-config.json\n", {
    flag: "wx",
  });
}
console.log(
  JSON.stringify(
    {
      installed: targets,
      runtime,
      registry: runtime === "docker" ? "screens compose volume" : config.data,
      mcp:
        runtime === "docker"
          ? "http://127.0.0.1:4800/mcp"
          : {
              command: process.execPath,
              args: [config.cli, "mcp", "--data", config.data],
            },
    },
    null,
    2,
  ),
);
