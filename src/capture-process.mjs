import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { bundledGit } from "./runtime.mjs";

export async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const kill = signal => { try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const closed = once(child, "close"); kill("SIGTERM");
  const timer = setTimeout(() => kill("SIGKILL"), 3000);
  try { await closed; } finally { clearTimeout(timer); }
}
export function launch(command, cwd, env, log) {
  if (!Array.isArray(command) || !command.length || !command.every(arg => typeof arg === "string" && arg)) throw Error("Commands must be nonempty argument arrays");
  const args = command.map(arg => arg.replaceAll("{runtime}", fileURLToPath(new URL("../", import.meta.url))));
  const git = args[0] === "git";
  const child = spawn(git ? bundledGit.gitLocation : args[0], args.slice(1), { cwd, env: { ...process.env, ...env, ...(git ? bundledGit.env : {}) }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.output = ""; child.stdoutText = "";
  child.stdout.on("data", bytes => { child.stdoutText += bytes.toString(); });
  child.on("error", error => { child.failure = error; });
  for (const pipe of [child.stdout, child.stderr]) pipe.on("data", bytes => { const text = bytes.toString(); child.output = (child.output + text).slice(-8 * 1024 * 1024); log(text); });
  return child;
}
export async function command(args, context, timeout = 600000) {
  context.signal?.throwIfAborted();
  const child = launch(args, context.cwd, context.env, context.log);
  const abort = () => { void stop(child); };
  context.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const [code] = await once(child, "close"); context.signal?.throwIfAborted();
    if (code !== 0) throw Error(`${args[0]} failed (${code}): ${child.output.slice(-2000)}`);
    return child.stdoutText;
  } finally { clearTimeout(timer); context.signal?.removeEventListener("abort", abort); await stop(child); }
}
