import { execFileSync } from "node:child_process";
import { setupEnvironment, resolveEmbeddedGitDir, resolveGitExecPath } from "dugite";

process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
const directory = resolveEmbeddedGitDir();
export const bundledGit = setupEnvironment({ LOCAL_GIT_DIRECTORY: directory, GIT_EXEC_PATH: resolveGitExecPath(directory, "") });

export function gitOutput(repo, args, options = {}) {
  return execFileSync(bundledGit.gitLocation, ["-c", `safe.directory=${repo}`, "-C", repo, ...args], {
    encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    ...options, env: { ...bundledGit.env, ...options.env },
  }).trim();
}
export async function captureBrowser(name = "chromium") {
  const engines = await import("playwright");
  return engines[name];
}
