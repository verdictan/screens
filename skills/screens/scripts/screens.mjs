#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const configFile = fileURLToPath(
  new URL("../screens-config.json", import.meta.url),
);
const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : {};
const args = process.argv.slice(2);
const cli = config.cli || process.env.SCREENS_CLI;
if (!cli || !existsSync(cli)) {
  console.error(
    "Screens runtime not found. Run skills:install from the Screens checkout, or set SCREENS_CLI to its absolute src/cli.mjs path.",
  );
  process.exit(1);
}
let command = process.execPath,
  parameters;
if (config.runtime === "docker") {
  command = "docker";
  const prefix = [
    "compose",
    "--project-directory",
    dirname(dirname(cli)),
    "-f",
    join(dirname(dirname(cli)), "compose.yaml"),
  ];
  if (args.includes("--data"))
    throw Error(
      "Docker skills always use the compose registry volume; omit --data",
    );
  if (args[0] === "pr-context") {
    command = process.execPath;
    parameters = [cli, ...args];
  } else if (args[0] === "serve")
    parameters = [...prefix, "up", "-d", "--build"];
  else {
    const mounts = [];
    const mapFile = (index, isDirectory = false) => {
      if (!args[index]) throw Error("Missing input path");
      const source = resolve(args[index]),
        mount = isDirectory ? source : dirname(source),
        target = `/input${mounts.length}`;
      mounts.push("--volume", `${mount}:${target}:ro`);
      args[index] = isDirectory ? target : `${target}/${basename(source)}`;
    };
    if (args[0] === "load") mapFile(1, !args[1]?.endsWith(".json"));
    if (args[0] === "evidence" && args[1] === "add") mapFile(2);
    for (const flag of ["--context", "--masks"]) {
      const i = args.indexOf(flag);
      if (i >= 0) mapFile(i + 1);
    }
    parameters = [
      ...prefix,
      "run",
      "--rm",
      "--no-deps",
      "-T",
      ...mounts,
      "screens",
      "node",
      "src/cli.mjs",
      ...args,
    ];
  }
} else
  parameters = [
    cli,
    ...args,
    ...(config.data && !args.includes("--data") ? ["--data", config.data] : []),
  ];
const result = spawnSync(command, parameters, {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
