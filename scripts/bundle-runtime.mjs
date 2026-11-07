import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const playwright = dirname(require.resolve("playwright/package.json"));
const arguments_ = [join(playwright, "cli.js"), "install", "chromium", "firefox", "webkit"];
if (process.platform === "linux") arguments_.push("--with-deps");
const result = spawnSync(process.execPath, arguments_, {
  stdio: "inherit",
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: "0" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
