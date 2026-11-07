import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { Store } from "../src/store.mjs";
import { runHeadless } from "../src/headless.mjs";
import { gitOutput } from "../src/runtime.mjs";
import { saveDerived } from "../src/evidence-tools.mjs";

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const run = (store, action, input = {}) => runHeadless(store, action, input, { cli: true });

function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), "screens-headless-"));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const open = (name) => {
    const store = new Store(join(directory, name));
    stores.push(store);
    return store;
  };
  return { directory, open };
}

async function until(read, accept, message, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accept(value)) return value;
    await delay(100);
  }
  assert.fail(`${message}: ${JSON.stringify(value)}`);
}

function repository(directory) {
  const repo = join(directory, "app");
  mkdirSync(repo);
  gitOutput(repo, ["init", "--quiet"]);
  gitOutput(repo, ["config", "user.name", "Screens test"]);
  gitOutput(repo, ["config", "user.email", "screens@example.test"]);
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Capture fixture</title><style>body{margin:24px;background:white;color:black;font:32px Arial,sans-serif}button{font:20px Arial,sans-serif;padding:12px}</style></head><body><main><h1>SCREENS READY</h1><button id="save">Save review</button></main></body></html>';
  writeFileSync(join(repo, "server.mjs"), `import { createServer } from "node:http";\ncreateServer((request,response)=>{response.setHeader("content-type","text/html");response.end(${JSON.stringify(html)});}).listen(Number(process.env.PORT),"127.0.0.1");\n`);
  gitOutput(repo, ["add", "."]);
  gitOutput(repo, ["commit", "--quiet", "-m", "Add fixture"]);
  return repo;
}

function recipe(directory, browsers = ["chromium"]) {
  const config = join(directory, "capture.json");
  writeFileSync(config, JSON.stringify({
    schemaVersion: 1, adapter: "browser", project: { id: "demo", name: "Demo" },
    fixture: "test-v1", serve: [process.execPath, "server.mjs"],
    browsers, variants: [{ device: "desktop", width: 800, height: 600 }],
    evidence: { dom: true, accessibility: true, console: true, network: true, fonts: true },
    screens: [{ key: "home", title: "Home", path: "/", source: "server.mjs",
      annotations: [{ selector: "#save", text: "Check the save action" }] }],
  }));
  return config;
}

async function startServer(directory) {
  const child = spawn(process.execPath, [cli, "serve", "--port", "0", "--data", directory], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exited = once(child, "exit");
  try {
    const url = await until(() => {
      assert.equal(child.exitCode, null, output);
      return output.match(/Screens: (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    }, Boolean, "Server did not start", 15000);
    return { url, async stop() {
      child.kill("SIGTERM");
      const result = await Promise.race([exited, delay(10000, null, { ref: false })]);
      if (!result) { child.kill("SIGKILL"); await exited; }
      assert.ok(result, `Server did not stop: ${output}`);
      assert.equal(result[0], 0, output);
    } };
  } catch (error) {
    child.kill("SIGKILL");
    await exited;
    throw error;
  }
}

async function sample(store) {
  store.project({ id: "demo", name: "Demo" });
  store.screen({ project: "demo", key: "home", title: "Home" });
  const bytes = await sharp({ create: { width: 32, height: 24, channels: 4, background: "white" } }).png().toBuffer();
  const left = store.capture({ screen: "demo/home", role: "current", revision: "before", fixture: "seed-v1", bytes });
  const right = store.capture({ screen: "demo/home", role: "pr", revision: "after", fixture: "seed-v1", bytes });
  const review = store.run({ project: "demo", title: "Review", captureIds: [left.id, right.id] });
  const entry = store.compare(review.id).entries[0];
  const set = store.saveReviewSet({ run: review.id, title: "Flow", expectedRevision: 0,
    entries: [`${entry.screen}|${JSON.stringify(entry.variant)}`] });
  return { left, right, review, set };
}

test("serve runs queued captures in all bundled browsers and schedules local backups", { timeout: 120000 }, async (t) => {
  const { directory, open } = workspace(t), store = open("registry");
  const repo = repository(directory), config = recipe(directory, ["chromium", "firefox", "webkit"]);
  const job = await run(store, "jobs-enqueue", { repo, config, execute: "yes" });
  const backupDirectory = join(directory, "backups");
  await run(store, "schedule-save", { kind: "backup", destination: backupDirectory,
    everySeconds: 60, expectedRevision: 0, execute: "yes" });
  const server = await startServer(store.directory);
  try {
    const completed = await until(() => run(store, "jobs-get", { id: job.id }),
      (value) => ["completed", "failed"].includes(value.status), "Capture job did not finish");
    assert.equal(completed.status, "completed", completed.error);
    assert.equal(completed.captures.length, 3);
    const captures = completed.captures.map((id) => store.getCapture(id));
    assert.deepEqual(captures.map((capture) => capture.variant.browser).sort(), ["chromium", "firefox", "webkit"]);
    for (const capture of captures) {
      const derived = await run(store, "derived_list", { capture: capture.id });
      for (const kind of ["dom", "accessibility", "console", "network", "fonts", "selectors", "environment", "fixture"])
        assert.ok(derived.items.some((item) => item.kind === kind), `Missing ${kind} for ${capture.variant.browser}`);
      assert.equal(store.getScreen(capture.screen).notes.filter((note) => note.capture === capture.id).length, 1);
      assert.ok(store.image(capture.id).bytes.length > 1000);
    }
    const response = await fetch(`${server.url}/api/automation/jobs-get`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: job.id }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "completed");
    const events = await run(store, "jobs-events", { id: job.id });
    assert.equal(events[0].type, "job.queued");
    assert.equal(events.at(-1).type, "job.completed");
    const backup = await until(() => readdirSync(backupDirectory).filter((name) => {
      try { return JSON.parse(readFileSync(join(backupDirectory, name, "backup.json"))).version === 2; }
      catch { return false; }
    }), (values) => values.length === 1, "Scheduled backup was not written");
    assert.equal(backup.length, 1);
    const chromium = captures.find((capture) => capture.variant.browser === "chromium");
    const ocr = await run(store, "ocr_extract", { capture: chromium.id, psm: 6 });
    assert.match(ocr.data.text, /SCREENS READY/);
    assert.ok(ocr.data.words.every((word) => word.region.x >= 0 && word.region.y >= 0 && word.region.width > 0 && word.region.height > 0));
    assert.equal((await run(store, "ocr_search", { query: "SCREENS READY" })).items[0].capture, chromium.id);
    const policy = await run(store, "ci_evaluate", { jobs: [job.id] });
    assert.equal(policy.exitCode, 0);
    assert.equal(policy.acceptance, "not-assessed");
  } finally { await server.stop(); }
});

test("signed review bundles require explicit trust and backups retain the signing identity", async (t) => {
  const { directory, open } = workspace(t), store = open("source"), destination = open("destination");
  const { right, review, set } = await sample(store);
  const note = store.addNote({ capture: right.id, text: "Review this region", region: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } });
  saveDerived(store, right.id, "fixture", { version: "seed-v1", sample: true });
  const file = join(directory, "review.screens.gz"), signature = join(directory, "review.signature.json"), key = join(directory, "public.pem");
  await run(store, "bundle-export", { reviewSet: set.id, output: file });
  const signed = await run(store, "bundle-sign", { file, output: signature });
  assert.equal(statSync(join(store.directory, "signing/private.pem")).mode & 0o777, 0o600);
  assert.equal((await run(store, "signature-verify", { file, signature })).valid, true);
  await assert.rejects(run(destination, "bundle-import", { file, signature }), /not trusted/);
  await run(store, "signing-key-export", { output: key });
  const trusted = await run(destination, "signing-key-trust", { file: key, label: "Fixture signer" });
  assert.equal(trusted.id, signed.keyFingerprint);
  const imported = await run(destination, "bundle-import", { file, signature });
  assert.equal(imported.reviewSet, set.id);
  assert.equal(destination.getRun(review.id).captureIds.length, 2);
  assert.equal(destination.getScreen(right.screen).notes[0].id, note.id);
  assert.equal((await run(destination, "bundle-import", { file, signature })).reused, true);
  assert.equal((await run(destination, "registry-integrity")).ok, true);
  const backup = join(directory, "backup"), restoredPath = join(directory, "restored");
  await run(store, "registry-backup", { output: backup });
  await run(store, "registry-restore", { source: backup, output: restoredPath });
  const restored = open("restored");
  assert.equal((await run(restored, "signature-verify", { file, signature })).keyFingerprint, signed.keyFingerprint);
  assert.deepEqual(restored.getRun(review.id), store.getRun(review.id));
  assert.equal((await run(restored, "registry-integrity")).ok, true);
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("changed")]));
  await assert.rejects(run(destination, "signature-verify", { file, signature }), /does not match/);
});

test("task claims, selected evidence, and cursor pages preserve capture identities", async (t) => {
  const { open } = workspace(t), store = open("registry");
  const { left, right, set } = await sample(store);
  const note = store.addNote({ capture: right.id, text: "Adjust spacing", region: { x: 0.1, y: 0.2, width: 0.3, height: 0.2 } });
  const claim = await run(store, "tasks-claim", { id: note.id, owner: "agent-one", expectedRevision: 0 });
  assert.equal(claim.owner, "agent-one");
  await assert.rejects(run(store, "tasks-claim", { id: note.id, owner: "agent-two", expectedRevision: claim.revision }), (error) => error.status === 409);
  await assert.rejects(run(store, "tasks-release", { id: note.id, owner: "agent-one", expectedRevision: 0 }), (error) => error.status === 409);
  const handoff = await run(store, "tasks-handoff", { id: note.id });
  assert.equal(handoff.captures[0].id, right.id);
  const scoped = await run(store, "evidence-scoped", { reviewSet: set.id, region: { x: 0, y: 0, width: 0.5, height: 0.5 } });
  assert.deepEqual(new Set(scoped.captures.map((capture) => capture.id)), new Set([left.id, right.id]));
  assert.equal(scoped.notes[0].id, note.id);
  assert.equal((await run(store, "tasks-release", { id: note.id, owner: "agent-one", expectedRevision: claim.revision })).owner, null);
  const first = await run(store, "registry-page", { collection: "captures", project: "demo", limit: 1 });
  const later = store.capture({ ...right, bytes: store.image(right.id).bytes, revision: "later" });
  const second = await run(store, "registry-page", { collection: "captures", project: "demo", limit: 1, cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.ok(![...first.items, ...second.items].some((capture) => capture.id === later.id));
  await assert.rejects(runHeadless(store, "bundle-export", { reviewSet: set.id, output: "unused" }), (error) => error.status === 403);
});

test("CI reports measure pixel changes and preserve human decisions", async (t) => {
  const { open } = workspace(t), store = open("registry");
  const { right, review } = await sample(store);
  const passing = await run(store, "ci_evaluate", { run: review.id, policy: { maxChangedPixels: 0, minSsim: 1, requireMatchingFixture: true } });
  assert.equal(passing.exitCode, 0);
  saveDerived(store, right.id, "console", { items: [{ type: "error", text: "Fixture error" }] });
  await run(store, "source_link", { capture: right.id, file: "src/home.jsx", line: 7 });
  const failing = await run(store, "ci_evaluate", { run: review.id, policy: { failOnConsoleErrors: true } });
  assert.equal(failing.exitCode, 1);
  assert.equal(store.getScreen(right.screen).target, undefined);
  const junit = await run(store, "ci_report", { report: failing.id, format: "junit" });
  assert.match(junit.content, /<failure/);
  const sarif = JSON.parse((await run(store, "ci_report", { report: failing.id, format: "sarif" })).content);
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, "src/home.jsx");
  assert.equal(sarif.runs[0].results[0].locations[0].physicalLocation.region.startLine, 7);
});

test("bundled Git powers route discovery and source dependency selection", async (t) => {
  const { directory, open } = workspace(t), store = open("registry"), repo = repository(directory);
  mkdirSync(join(repo, "src/app/account"), { recursive: true });
  writeFileSync(join(repo, "src/app/account/page.jsx"), 'import { label } from "../../label.js"; export default function Account() { return label; }\n');
  writeFileSync(join(repo, "src/label.js"), 'export const label = "before";\n');
  gitOutput(repo, ["add", "."]);
  gitOutput(repo, ["commit", "--quiet", "-m", "Add route"]);
  const base = gitOutput(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "src/label.js"), 'export const label = "after";\n');
  gitOutput(repo, ["add", "."]);
  gitOutput(repo, ["commit", "--quiet", "-m", "Change shared label"]);
  const discovered = await run(store, "routes-discover", { repo, project: "demo" });
  assert.equal(discovered.screens[0].path, "/account");
  const config = recipe(directory), value = JSON.parse(readFileSync(config));
  value.screens = [
    { key: "account", title: "Account", path: "/account", source: "src/app/account/page.jsx" },
    { key: "home", title: "Home", path: "/", source: "server.mjs" },
  ];
  writeFileSync(config, JSON.stringify(value));
  assert.deepEqual((await run(store, "screens-affected", { repo, config, base })).screenKeys, ["account"]);
  const plan = await run(store, "capture-plan", { config });
  assert.equal(plan.jobs.length, 2);
  assert.equal((await run(store, "jobs-list")).length, 0);
});
