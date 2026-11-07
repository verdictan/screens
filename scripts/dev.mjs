import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.all(children.map(({ closed }) => closed));
}

function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
  const closed = new Promise((resolve) => child.once("close", resolve));
  children.push({ child, closed });
  child.once("error", (error) => {
    console.error(`${name}: ${error.message}`);
    void stop(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.log(`${name} stopped${signal ? ` (${signal})` : ""}.`);
      void stop(code ?? 1);
    }
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void stop());
process.once("exit", () => {
  for (const { child } of children) child.kill("SIGTERM");
});

start("API", [
  "--watch", "--watch-preserve-output", join(root, "src/cli.mjs"), "serve",
  "--host", "127.0.0.1", "--port", process.env.SCREENS_API_PORT || "4801",
]);
start("UI", [join(root, "node_modules/vite/bin/vite.js")]);
