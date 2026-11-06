import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url)),
  out = resolve(process.argv[2] || join(root, "dist"));
const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
mkdirSync(out, { recursive: true });
const artifacts = [];
for (const client of ["claude", "codex"]) {
  const dir = mkdtempSync(join(tmpdir(), "screens-package-"));
  try {
    const folder = client === "claude" ? ".claude" : ".agents";
    cpSync(join(root, "skills/screens"), join(dir, folder, "skills/screens"), {
      recursive: true,
    });
    const file = `screens-${client}-${version}.tar.gz`;
    execFileSync("tar", ["-czf", join(out, file), "-C", dir, folder]);
    artifacts.push({
      client,
      file,
      sha256: createHash("sha256")
        .update(readFileSync(join(out, file)))
        .digest("hex"),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
writeFileSync(
  join(out, "skills-manifest.json"),
  JSON.stringify({ version, artifacts }, null, 2) + "\n",
);
console.log(JSON.stringify({ output: out, artifacts }, null, 2));
