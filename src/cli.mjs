#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { Store } from "./store.mjs";
import { makeServer } from "./server.mjs";
import { protocol } from "./mcp.mjs";
import { discover, importManifest, combineRuns } from "./import.mjs";
import { createDiff } from "./diff.mjs";
import {
  captureRevision,
  captureComparison,
  resolvePullRequest,
} from "./capture.mjs";

function args(values) {
  const options = {},
    positionals = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i].startsWith("--")) {
      const name = values[i].slice(2);
      if (!values[i + 1] || values[i + 1].startsWith("--"))
        throw new Error(`--${name} needs a value`);
      options[name] = values[++i];
    } else positionals.push(values[i]);
  }
  return { options, positionals };
}
const print = (value) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const help = `Screens — central screen evidence and review

  screens serve [--port 4800] [--data DIR] [--host 127.0.0.1]
  screens diff --left CAPTURE --right CAPTURE [--threshold 0] [--masks FILE]
  screens evidence add FILE
  screens evidence list --capture CAPTURE
  screens load PATH --project ID [--name NAME] [--title TITLE]
  screens projects
  screens list --project ID
  screens compare --project ID --current RUN --target RUN --pr RUN
  screens pr-context OWNER/REPO NUMBER [--output FILE]
  screens capture --repo PATH --ref SHA --config FILE --output DIR --role current|target|pr --execute yes
  screens capture-pr OWNER/REPO NUMBER --repo PATH --config FILE --output DIR --execute yes [--target RUN]
  screens capture-refs --repo PATH --base REF --head REF --config FILE --output DIR --execute yes [--target RUN]
  screens mcp [--data DIR] [--url http://127.0.0.1:4800]

All storage commands accept --data DIR or SCREENS_HOME.
Default storage: ~/.local/share/verdictan-screens
load accepts a supported JSON manifest or discovers manifests in a project directory.
compare accepts imported run IDs, not GitHub PR numbers. pr-context resolves GitHub
metadata only. capture-pr runs explicitly authorized browser recipes in isolated Git checkouts.
MCP uses stdio with the shared database by default, or bridges to --url.
The running review service also exposes a Streamable HTTP endpoint at /mcp.
`;

async function main() {
  const { options: o, positionals: p } = args(process.argv.slice(2)),
    command = p[0];
  if (!command || ["help", "-h"].includes(command))
    return process.stdout.write(help);
  if (command === "mcp") {
    if (!o.url && !process.env.SCREENS_URL) {
      const store = new Store(
          resolve(
            o.data ||
              process.env.SCREENS_HOME ||
              join(homedir(), ".local/share/verdictan-screens"),
          ),
        ),
        handle = protocol(store);
      try {
        for await (const line of createInterface({
          input: process.stdin,
          crlfDelay: Infinity,
        })) {
          if (!line.trim()) continue;
          let result;
          try {
            if (Buffer.byteLength(line) > 36 * 1024 * 1024)
              throw new Error("Message too large");
            result = await handle(JSON.parse(line));
          } catch {
            result = {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            };
          }
          if (result !== null)
            process.stdout.write(JSON.stringify(result) + "\n");
        }
      } finally {
        store.close();
      }
      return;
    }
    const url = new URL(
      "/mcp",
      o.url || process.env.SCREENS_URL || "http://127.0.0.1:4800",
    );
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.protocol !== "http:"
    )
      throw new Error(
        "v0.1 MCP bridge connects to a loopback HTTP service only",
      );
    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let input;
      try {
        if (Buffer.byteLength(line) > 36 * 1024 * 1024)
          throw new Error("Message too large");
        input = JSON.parse(line);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30000),
        });
        if (response.status === 202) continue;
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error?.message || result.error || `HTTP ${response.status}`,
          );
        process.stdout.write(JSON.stringify(result) + "\n");
      } catch (e) {
        if (input?.id !== undefined || !input)
          process.stdout.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: input?.id ?? null,
              error: { code: input ? -32603 : -32700, message: e.message },
            }) + "\n",
          );
        else process.stderr.write(e.message + "\n");
      }
    }
    return;
  }
  if (command === "pr-context") {
    const context = resolvePullRequest(p[1], p[2]);
    if (o.output)
      writeFileSync(
        resolve(o.output),
        JSON.stringify(context, null, 2) + "\n",
        { flag: "wx" },
      );
    return print(context);
  }
  const store = new Store(
    resolve(
      o.data ||
        process.env.SCREENS_HOME ||
        join(homedir(), ".local/share/verdictan-screens"),
    ),
  );
  let serving = false;
  try {
    if (command === "serve") {
      const port = Number(o.port || process.env.PORT || 4800);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("Invalid port");
      const host = o.host || process.env.SCREENS_HOST || "127.0.0.1";
      if (!["127.0.0.1", "0.0.0.0"].includes(host))
        throw new Error("Host must be 127.0.0.1 or 0.0.0.0 (container use)");
      const server = makeServer(store);
      server.on("error", (e) => {
        console.error(e.message);
        store.close();
        process.exitCode = 1;
      });
      server.listen(port, host, () =>
        console.log(
          `Screens: http://127.0.0.1:${server.address().port}\nMCP: http://127.0.0.1:${server.address().port}/mcp`,
        ),
      );
      serving = true;
      for (const signal of ["SIGINT", "SIGTERM"])
        process.once(signal, () =>
          server.close(() => {
            store.close();
            process.exit(0);
          }),
        );
    } else if (command === "capture") {
      print(await captureRevision(store, o));
    } else if (["capture-pr", "capture-refs"].includes(command)) {
      print(
        await captureComparison(store, {
          ...o,
          verifyPR: command === "capture-pr",
          context:
            command === "capture-pr"
              ? resolvePullRequest(p[1], p[2])
              : o.context
                ? JSON.parse(readFileSync(resolve(o.context), "utf8"))
                : undefined,
        }),
      );
    } else if (command === "diff") {
      print(
        await createDiff(store, {
          left: o.left,
          right: o.right,
          threshold: o.threshold === undefined ? 0 : Number(o.threshold),
          masks: o.masks
            ? JSON.parse(readFileSync(resolve(o.masks), "utf8"))
            : [],
        }),
      );
    } else if (command === "evidence") {
      if (p[1] === "add" && p[2])
        print(
          store.addEvidence(JSON.parse(readFileSync(resolve(p[2]), "utf8"))),
        );
      else if (p[1] === "list")
        print(store.listEvidence({ capture: o.capture, screen: o.screen }));
      else
        throw new Error("Use evidence add FILE or evidence list --capture ID");
    } else if (command === "projects") print(store.projects());
    else if (command === "list")
      print(store.search({ project: o.project, query: o.query || "" }));
    else if (command === "load") {
      if (!p[1] || !o.project) throw new Error("Use load PATH --project ID");
      const paths = p[1].endsWith(".json") ? [resolve(p[1])] : discover(p[1]);
      if (!paths.length)
        throw new Error(
          "No supported manifest found. Create screens.json from examples/screens.json.",
        );
      for (const file of paths) {
        const result = importManifest(store, file, o);
        print({
          ...result,
          url: result.run
            ? `http://127.0.0.1:${o.port || process.env.PORT || 4800}/?project=${encodeURIComponent(result.project.id)}&run=${result.run.id}`
            : null,
        });
      }
    } else if (command === "compare") {
      let source = null;
      if (o.context)
        source = JSON.parse(readFileSync(resolve(o.context), "utf8"));
      const run = combineRuns(store, {
        project: o.project,
        current: o.current,
        target: o.target,
        pr: o.pr,
        title: o.title,
        source,
      });
      print({
        ...run,
        url: `http://127.0.0.1:${o.port || process.env.PORT || 4800}/?project=${encodeURIComponent(run.project)}&run=${run.id}`,
      });
    } else throw new Error(`Unknown command ${command}\n${help}`);
  } finally {
    if (!serving) store.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
