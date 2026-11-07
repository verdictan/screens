import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.execPath, [join(root, "node_modules/vite/bin/vite.js"), "build"], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const sourceLock = join(root, "package-lock.json");
if (existsSync(sourceLock)) copyFileSync(sourceLock, join(root, "npm-shrinkwrap.json"));
