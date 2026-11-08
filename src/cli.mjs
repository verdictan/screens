#!/usr/bin/env node
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { draftAutomaticPlan } from "./automatic-plan.mjs";
import { captureSummary, formatCaptureSummary } from "./capture-summary.mjs";
import { detectProject } from "./discovery.mjs";
import { Store } from "./store.mjs";
import { startAutomation, runAutomaticJob } from "./automation.mjs";
import { makeServer } from "./server.mjs";
import { protocol } from "./mcp.mjs";
import { importManifest, combineRuns } from "./import.mjs";
import { headlessActions, actionCatalog, runHeadless } from "./headless.mjs";
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
function actionInput(command, o) {
  const descriptor = headlessActions[command];
  const input = o.input ? JSON.parse(readFileSync(resolve(o.input), "utf8")) : {};
  for (const [flag, raw] of Object.entries(o)) {
        if (["input", "data"].includes(flag)) continue;
        const key = flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        const property = descriptor.inputSchema.properties[key];
        if (!property) throw Error(`Unknown option --${flag} for ${command}`);
        if (["object", "array", "boolean"].includes(property.type) || Array.isArray(property.type)) input[key] = JSON.parse(raw);
        else if (["number", "integer"].includes(property.type)) input[key] = Number(raw);
        else input[key] = raw;
      }
  return input;
}
const print = (value) =>
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const help = `Screens — central screen evidence and review

  screens headless-help [ACTION]
  screens ACTION --input FILE [--data DIR]
  screens jobs-enqueue --repo PATH --config FILE --ref SHA --execute yes
  screens serve [--port 4800] [--data DIR] [--host 127.0.0.1]
  screens diff --left CAPTURE --right CAPTURE [--threshold 0] [--masks FILE]
  screens evidence add FILE
  screens evidence list --capture CAPTURE
  screens capture-draft PATH [--output plan.json]
  screens capture-auto PATH [--project ID] [--config screens.capture.json | --plan plan.json]
  screens capture-auto PATH --queue yes
  screens capture-auto --resume JOB [--format json]
  screens detect PATH
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
  if (command === "capture-draft") {
    const plan = draftAutomaticPlan(p[1] || ".", o);
    if (o.output) writeFileSync(resolve(o.output), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
    return print(o.output ? { output: resolve(o.output), choices: plan.choices.length, backlog: plan.discovery.backlog.length, decisions: plan.decisions.length, blockers: plan.decisions.filter(decision => decision.blocking).length } : plan);
  }
  if (command === "detect") return print(detectProject(p[1] || "."));
  if (command === "headless-help") {
    const actions = actionCatalog(true);
    return print(p[1] ? actions.find((action) => action.name === p[1]) || { error: "Unknown action" } : actions);
  }
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
      o.url || process.env.SCREENS_URL,
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
    const context = await resolvePullRequest(p[1], p[2]);
    if (o.output)
      writeFileSync(
        resolve(o.output),
        JSON.stringify(context, null, 2) + "\n",
        { flag: "wx" },
      );
    return print(context);
  }
  if (command === "doctor") {
    const directory = resolve(o.data || process.env.SCREENS_HOME || join(homedir(), ".local/share/verdictan-screens"));
    return print(await headlessActions.doctor.run({ directory }, actionInput(command, o), { cli: true }));
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
    if (headlessActions[command]) {
      const input = actionInput(command, o);
      const controller = new AbortController();
      const stop = () => controller.abort(Error("Stopped"));
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      const stream = ["jobs-watch", "events-watch", "capture-run", "capture-changed", "capture-repeatability", "capture-bisect", "capture-merge"].includes(command);
      try {
        const result = await runHeadless(store, command, input, { cli: true, signal: controller.signal,
          emit: (event) => process.stdout.write(JSON.stringify(event) + "\n") });
        if (stream) process.stdout.write(JSON.stringify({ type: "result", result }) + "\n");
        else print(result);
        if (Number.isInteger(result?.exitCode)) process.exitCode = result.exitCode;
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        process.exitCode = 130;
      } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    } else if (command === "capture-auto" || (command === "load" && o.capture === "yes")) {
      const controller = new AbortController();
      const stop = () => controller.abort(Error("Capture interrupted"));
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
      try {
        const result = await runAutomaticJob(store, { ...o, screens: o.screens ? JSON.parse(o.screens) : undefined, path: p[1] || (o.resume ? undefined : "."), signal: controller.signal,
          onEvent: event => process.stderr.write(JSON.stringify(event) + "\n") });
        if (o.format === "json") print(result);
        else process.stdout.write(formatCaptureSummary(result.summary || captureSummary(result)));
        process.exitCode = result.exitCode;
      } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
    } else if (command === "serve") {
      const port = Number(o.port || process.env.PORT || 4800);
      if (!Number.isInteger(port) || port < 0 || port > 65535)
        throw new Error("Invalid port");
      const host = o.host || process.env.SCREENS_HOST || "127.0.0.1";
      if (!["127.0.0.1", "0.0.0.0"].includes(host))
        throw new Error("Host must be 127.0.0.1 or 0.0.0.0 (container use)");
      const server = makeServer(store);
      let automation, stopping = false;
      const stop = async (exitCode = 0) => {
        if (stopping) return; stopping = true;
        const closed = new Promise((done) => server.close(done));
        await automation?.stop(); await closed;
        store.close(); process.exitCode = exitCode;
      };
      server.on("error", (error) => { console.error(error.message); void stop(1); });
      server.listen(port, host, () => {
        automation = startAutomation(store, { runAction: (name, input) => runHeadless(store, name, input, { cli: true }) });
        console.log(`Screens: http://127.0.0.1:${server.address().port}\nMCP: http://127.0.0.1:${server.address().port}/mcp`);
      });
      serving = true;
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop(); });
    } else if (command === "capture") {
      print(await captureRevision(store, o));
    } else if (["capture-pr", "capture-refs"].includes(command)) {
      print(
        await captureComparison(store, {
          ...o,
          verifyPR: command === "capture-pr",
          context:
            command === "capture-pr"
              ? await resolvePullRequest(p[1], p[2])
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
          ...(o.region ? { region: JSON.parse(o.region) } : {}),
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
      const detection = p[1].endsWith(".json") ? null : detectProject(p[1]);
      const paths = detection ? detection.manifests.map(file => resolve(p[1], file)) : [resolve(p[1])];
      if (!paths.length) return print({ detection, importedScreens: 0, run: null, url: null,
        warnings: ["No supported manifest found. Prepare captures and screens.json before importing."] });
      for (const file of paths) {
        const result = importManifest(store, file, o);
        print({
          ...result,
          ...(detection ? { detection } : {}),
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
