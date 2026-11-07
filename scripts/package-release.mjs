import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { output: { type: "string", default: "release" } } });
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const output = resolve(root, values.output);
const archive = join(output, `screens-${manifest.version}.tgz`);
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${command} exited with ${result.status}`);
}

run(process.execPath, [join(root, "scripts/prepare-release.mjs")]);
const staging = mkdtempSync(join(tmpdir(), "screens-release-"));
try {
  for (const file of new Set(["package.json", ...manifest.files])) {
    const destination = join(staging, "package", file);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, file), destination, { recursive: true });
  }
  mkdirSync(output, { recursive: true });
  run("tar", ["-czf", archive, "-C", staging, "package"], { ...process.env, COPYFILE_DISABLE: "1" });
  console.log(JSON.stringify({ version: manifest.version, archive }));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
