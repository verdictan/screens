import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { setImmediate as tick } from "node:timers/promises";
import { fixture } from "./support/registry.mjs";
import { moduleUnderTest } from "./support/module.mjs";
import * as captureModule from "../src/capture.mjs";
import * as automationModule from "../src/automation.mjs";
async function cli(
  t,
  argv,
  { env = {}, messages = "", mocks = {}, globals = {} } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "screens-cli-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let stdout = "",
    stderr = "";
  const events = {};
  const r = await moduleUnderTest("src/cli.mjs", {
    argv,
    env: { SCREENS_URL: "", SCREENS_HOME: join(dir, "registry"), ...env },
    mocks: { "node:os": { homedir: () => dir }, ...mocks },
    globals,
    processOverrides: {
      stdin: Readable.from([messages]),
      stdout: {
        write: (s) => {
          stdout += s;
        },
      },
      stderr: {
        write: (s) => {
          stderr += s;
        },
      },
      once: (name, fn) => {
        events[name] = fn;
      },
      exit: (code) => {
        events.exit = code;
      },
    },
  });
  for (
    let i = 0;
    i < 500 && !stdout && !r.errors.length && !r.logs.length && !events.SIGINT;
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 2));
  for (let i = 0; i < 5; i++) await tick();
  return {
    ...r,
    dir,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    events,
  };
}
test("CLI help, argument errors and storage paths", async (t) => {
  for (const argv of [[], ["help"], ["-h"]])
    assert.match((await cli(t, argv)).stdout, /Screens —/);
  for (const argv of [
    ["projects", "--data"],
    ["projects", "--data", "--port"],
    ["unknown"],
    ["load"],
    ["evidence"],
    ["serve", "--port", "-1"],
    ["serve", "--port", "65536"],
    ["serve", "--port", "1.5"],
    ["serve", "--host", "example.com"],
  ]) {
    const r = await cli(t, argv);
    assert.equal(r.process.exitCode, 1, argv.join(" "));
    assert.ok(r.errors.length);
  }
  const project = mkdtempSync(join(tmpdir(), "screens-empty-project-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const imported = await cli(t, ["load", project, "--project", "demo"]);
  assert.deepEqual({ run: JSON.parse(imported.stdout).run, importedScreens: JSON.parse(imported.stdout).importedScreens }, { run: null, importedScreens: 0 });
  for (const argv of [["projects"], ["list"]]) {
    const r = await cli(t, argv, { env: { SCREENS_HOME: "" } });
    assert.deepEqual(JSON.parse(r.stdout), []);
  }
});
test("CLI imports, comparisons, measurements and evidence use persisted storage", async (t) => {
  const { store, dir, bytes, capture } = await fixture(t);
  const a = capture(),
    b = capture({ role: "pr" });
  const run = store.run({
    project: "demo",
    title: "Test",
    captureIds: [a.id, b.id],
  });
  const invoke = (argv, env = {}) =>
    cli(t, argv, { env: { SCREENS_HOME: dir, ...env } });
  let r = await invoke(["list", "--project", "demo", "--query", "Home"]);
  assert.equal(JSON.parse(r.stdout).length, 1);
  const input = join(dir, "evidence.json");
  writeFileSync(
    input,
    JSON.stringify({
      capture: a.id,
      kind: "visual",
      method: "manual",
      outcome: "not-run",
      assertion: "Color",
      procedure: "Inspect",
      observation: "Pending",
      author: "Test",
    }),
  );
  r = await invoke(["evidence", "add", input]);
  assert.equal(JSON.parse(r.stdout).outcome, "not-run");
  r = await invoke(["evidence", "list", "--capture", a.id]);
  assert.equal(JSON.parse(r.stdout).length, 1);
  const masks = join(dir, "masks.json");
  writeFileSync(masks, "[]");
  for (const extra of [[], ["--threshold", "1", "--masks", masks]]) {
    r = await invoke(["diff", "--left", a.id, "--right", b.id, ...extra]);
    assert.equal(JSON.parse(r.stdout).changedPixels, 0);
  }
  const context = join(dir, "context.json");
  writeFileSync(context, '{"number":123}');
  for (const extra of [
    [],
    ["--context", context, "--port", "4900"],
    ["--title", "Default port"],
  ]) {
    r = await invoke(
      [
        "compare",
        "--project",
        "demo",
        "--current",
        run.id,
        "--pr",
        run.id,
        ...extra,
      ],
      { PORT: extra.length ? "" : "4901" },
    );
    assert.equal(JSON.parse(r.stdout).captureIds.length, 2);
  }
  const manifest = join(dir, "screens.json");
  writeFileSync(join(dir, "a.png"), bytes);
  writeFileSync(
    manifest,
    JSON.stringify({
      schemaVersion: 1,
      screens: [
        {
          key: "import",
          title: "Import",
          captures: [{ file: "a.png", role: "pr" }],
        },
      ],
    }),
  );
  for (const [path, extra, env] of [
    [manifest, [], { PORT: "" }],
    [dir, ["--port", "4902"], {}],
    [manifest, [], { PORT: "4901" }],
  ]) {
    r = await invoke(["load", path, "--project", "demo", ...extra], env);
    assert.ok(JSON.parse(r.stdout).run.id);
  }
  writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, screens: [] }));
  r = await invoke(["load", manifest, "--project", "demo"]);
  assert.equal(JSON.parse(r.stdout).url, null);
});
test("CLI direct and bridged MCP preserve replies and report errors", async (t) => {
  const ping = JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }),
    notice = JSON.stringify({ jsonrpc: "2.0", method: "notice" });
  let r = await cli(t, ["mcp"], {
    messages: "\n" + ping + "\n" + notice + "\n{\n",
    env: { SCREENS_HOME: "" },
  });
  assert.equal(JSON.parse(r.stdout.split("\n")[0]).id, 7);
  assert.match(r.stdout, /-32700/);
  r = await cli(t, ["mcp"], { messages: " ".repeat(36 * 1024 * 1024) + "x\n" });
  assert.match(r.stdout, /-32700/);
  for (const url of ["https://localhost:4800", "http://example.com"])
    assert.equal((await cli(t, ["mcp", "--url", url])).process.exitCode, 1);
  const response = (status, result) => ({
    status,
    ok: status < 400,
    json: async () => result,
  });
  for (const result of [
    response(200, { jsonrpc: "2.0", id: 7, result: {} }),
    response(202, {}),
    response(500, { error: { message: "Nested" } }),
    response(500, { error: "Plain" }),
    response(500, {}),
  ]) {
    r = await cli(t, ["mcp"], {
      env: { SCREENS_URL: "http://localhost:4800" },
      messages: "\n" + ping + "\n" + notice + "\n{\n",
      globals: { fetch: async () => result },
    });
    assert.equal(r.process.exitCode, 0);
    assert.ok(r.stdout.length);
  }
  r = await cli(t, ["mcp", "--url", "http://localhost:4800"], {
    messages: "x".repeat(36 * 1024 * 1024 + 1) + "\n",
    globals: {
      fetch: async () => {
        throw Error("unexpected");
      },
    },
  });
  assert.match(r.stdout, /-32700/);
});
test("CLI capture commands and PR metadata pass their exact options to the capture service", async (t) => {
  const calls = [];
  const mocks = {
    "./capture.mjs": {
      ...captureModule,
      resolvePullRequest: (repository, number) => ({
        repository,
        number,
        head: "head",
      }),
      captureRevision: async (store, options) => {
        calls.push(options);
        return { revision: "head" };
      },
      captureComparison: async (store, options) => {
        calls.push(options);
        return { run: { id: "run" } };
      },
    },
  };
  const dir = mkdtempSync(join(tmpdir(), "screens-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "context.json");
  writeFileSync(file, '{"head":"context"}');
  for (const argv of [
    ["capture"],
    ["capture-pr", "owner/repo", "1"],
    ["capture-refs"],
    ["capture-refs", "--context", file],
    ["pr-context", "owner/repo", "1"],
    ["pr-context", "owner/repo", "1", "--output", join(dir, "output.json")],
  ]) {
    const r = await cli(t, argv, { mocks });
    assert.equal(r.process.exitCode, 0);
    assert.ok(JSON.parse(r.stdout));
  }
  assert.equal(calls[1].verifyPR, true);
  assert.equal(calls[3].context.head, "context");
});
test("CLI server start, signals and listen errors close the registry", async (t) => {
  for (const env of [{ PORT: "4901" }, { PORT: "" }]) {
    let closed = 0, stopped = 0;
    const server = new EventEmitter();
    server.address = () => ({ port: 4901 });
    server.listen = (port, host, fn) => {
      assert.equal(host, "127.0.0.1");
      fn();
    };
    server.close = (fn) => {
      closed++;
      fn();
    };
    const r = await cli(t, ["serve"], {
      env,
      mocks: {
        "./server.mjs": { makeServer: () => server },
        "./automation.mjs": { ...automationModule, startAutomation: () => ({ stop: async () => { stopped++; } }) },
      },
    });
    assert.match(r.logs[0], /4901/);
    r.events[env.PORT ? "SIGINT" : "SIGTERM"]();
    r.events[env.PORT ? "SIGTERM" : "SIGINT"]();
    assert.equal(closed, 1);
    await tick();
    assert.equal(stopped, 1);
    assert.equal(r.process.exitCode, 0);
  }
  const server = new EventEmitter();
  server.listen = () => {};
  server.close = (fn) => fn();
  const r = await cli(t, ["serve", "--port", "0", "--host", "0.0.0.0"], {
    mocks: { "./server.mjs": { makeServer: () => server } },
  });
  server.emit("error", Error("address busy"));
  await tick();
  assert.equal(r.process.exitCode, 1);
  assert.equal(r.errors[0], "address busy");
});


test('CLI pixel region options reach the diff implementation',async t=>{
 const f=await fixture(t),left=f.capture(),right=f.capture({role:'pr'});const result=await cli(t,['diff','--data',f.dir,'--left',left.id,'--right',right.id,'--region','{"x":0,"y":0,"width":1,"height":1}']);assert.equal(JSON.parse(result.stdout).region.width,1);
});
