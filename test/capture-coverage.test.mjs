import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { setImmediate as tick } from "node:timers/promises";
import { takeCoverage } from "node:v8";
import { fixture } from "./support/registry.mjs";
import { moduleUnderTest } from "./support/module.mjs";
import {
  captureConfig,
  resolvePullRequest,
  captureRevision,
} from "../src/capture.mjs";
const baseConfig = () => ({
  schemaVersion: 1,
  adapter: "browser",
  project: { id: "demo", name: "Demo" },
  fixture: "seed",
  screens: [{ key: "home", title: "Home", path: "/" }],
  variants: [{ device: "desktop", width: 200, height: 200 }],
  serve: ["node", "server.mjs"],
});
test("capture configuration validates identities, commands, routes and variants", async (t) => {
  const { dir } = await fixture(t),
    file = join(dir, "capture.json");
  const check = (value) => {
    fs.writeFileSync(file, JSON.stringify(value));
    return captureConfig(file);
  };
  assert.equal(check(baseConfig()).value.fixture, "seed");
  const custom = baseConfig();
  custom.screens[0].ready = "#ready";
  custom.variants[0].theme = "dark";
  custom.prepare = [["node", "prepare.mjs"]];
  assert.equal(check(custom).value.variants[0].theme, "dark");
  for (const patch of [
    { schemaVersion: 2 },
    { adapter: "native" },
    { project: {} },
    { screens: [] },
    { screens: Array(201).fill(baseConfig().screens[0]) },
    { screens: [{ key: "home", title: "Home", path: "//remote" }] },
    { screens: [{ key: "home", title: "Home", path: 5 }] },
    { screens: [...baseConfig().screens, ...baseConfig().screens] },
    { serve: "node" },
    { serve: [] },
    { serve: [1] },
    { variants: [] },
    { variants: Array(11).fill(baseConfig().variants[0]) },
    { variants: [{ device: "desktop", width: 199, height: 4001 }] },
    { variants: [...baseConfig().variants, ...baseConfig().variants] },
  ])
    assert.throws(() => check({ ...baseConfig(), ...patch }));
  await assert.rejects(resolvePullRequest("bad", "1"), /OWNER/);
  await assert.rejects(resolvePullRequest("owner/repo", 0), /number/);
  await assert.rejects(captureRevision({}, {}), /executes project commands/);
});
async function captureFixture(
  t,
  { mode = "ok", platform = process.platform, config = baseConfig() } = {},
) {
  const { store, dir, bytes } = await fixture(t);
  const repo = join(dir, "repo"),
    file = join(dir, "capture.json");
  fs.mkdirSync(repo);
  fs.writeFileSync(file, JSON.stringify(config));
  const calls = [],
    children = new Map();
  let pid = 100000;
  const gitOutput = (cwd, args) => {
    calls.push(["git", args]);
    return args.includes("rev-parse") ? args.at(-1).replace(/\^\{commit\}$/, "") : "";
  };
  const finish = (child, code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("close", code, signal);
  };
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.pid = ++pid;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = (signal) => {
      queueMicrotask(() => finish(child, null, signal));
      return true;
    };
    children.set(child.pid, child);
    queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("stdout"));
      child.stderr.emit("data", Buffer.from("stderr"));
      if (cmd === "bundled-git") {
        if (args[0] === "clone") fs.mkdirSync(args.at(-1));
        finish(child);
      } else if (cmd === "prepare") {
        if (mode === "prepare-fails") finish(child, 2);
        else if (mode === "prepare-spawn-error") {
          child.pid = undefined;
          child.emit("error", Error("prepare spawn error"));
        } else if (mode !== "prepare-timeout") finish(child);
      } else if (mode === "serve-exit") finish(child, 1);
      else if (mode === "serve-signal") finish(child, null, "SIGTERM");
      else if (mode === "serve-spawn-error") {
        child.pid = undefined;
        child.emit("error", Error("server spawn error"));
      }
    });
    return child;
  };
  let fetchCalls = 0;
  const browser = {
    version: () => "test-browser",
    close: async () => calls.push(["browser-close"]),
    newContext: async (options) => {
      calls.push(["context", options]);
      return {
        close: async () => calls.push(["context-close"]),
        newPage: async () => ({
          goto: async (url) => {
            calls.push(["goto", url]);
            if (mode === "page-fails") throw Error("page failed");
          },
          locator: (selector) => ({
            waitFor: async () => calls.push(["ready", selector]),
          }),
          addInitScript: async () => {},
          evaluate: async (fn, input) => fn(input),
          screenshot: async (options) => {
            fs.writeFileSync(options.path, bytes);
            return bytes;
          },
        }),
      };
    },
  };
  const globals = {
    document: { fonts: { ready: Promise.resolve() } },
    fetch: async (url) => {
      if (url.startsWith("https://api.github.com/")) return {
        ok: true,
        json: async () => url.includes("/compare/")
          ? { merge_base_commit: { sha: "base" } }
          : { html_url: "https://example.invalid/pr/1", title: "Test", base: { sha: "base" },
              head: { sha: mode === "changed" ? "changed" : "head",
                repo: mode === "no-head-repo" ? null : { full_name: "owner/repo" } } },
      };
      fetchCalls++;
      if (mode === "timeout") return { ok: false };
      if (fetchCalls === 1) throw Error("starting");
      return { ok: true };
    },
    setTimeout: (fn, ms) => {
      if (ms === 300000 && mode !== "prepare-timeout")
        return setTimeout(fn, 10000);
      return setTimeout(fn, ms === 3000 ? 1 : 0);
    },
    clearTimeout,
  };
  const result = await moduleUnderTest("src/capture.mjs", {
    platform,
    globals,
    mocks: {
      "node:child_process": { spawn },
      "./evidence-tools.mjs": {
        startBrowserEvidence: () => ({ reset() {}, collect: async () => ({}), dispose() {} }),
        attachBrowserEvidence: async () => {},
      },
      "./runtime.mjs": {
        bundledGit: { gitLocation: "bundled-git", env: {} },
        gitOutput,
        captureBrowser: async () => ({
          launch: async () => {
            if (mode === "browser-fails") throw Error("browser failed");
            return browser;
          },
        }),
      },
    },
    processOverrides: {
      kill: (pid, signal) => {
        const child = children.get(-pid);
        if (mode === "kill-esrch") {
          queueMicrotask(() => finish(child, null, signal));
          throw Object.assign(Error("gone"), { code: "ESRCH" });
        }
        if (mode === "kill-error")
          throw Object.assign(Error("kill failed"), { code: "EPERM" });
        if (mode === "kill-delay" && signal === "SIGTERM") return;
        queueMicrotask(() => finish(child, null, signal));
      },
    },
  });
  t.after(() => takeCoverage());
  return {
    ...result,
    store,
    dir,
    repo,
    file,
    calls,
    options: {
      repo,
      config: file,
      ref: "head",
      execute: "yes",
      output: join(dir, "capture"),
    },
  };
}
test("capture records exact revisions, browser options, files and command output", async (t) => {
  for (const platform of [process.platform, "win32"]) {
    const config = baseConfig();
    config.prepare = [["prepare", "{runtime}"]];
    config.screens[0].ready = "#ready";
    config.screens[0].fullPage = false;
    config.variants[0].theme = "dark";
    config.variants[0].locale = "es";
    config.directory = ".";
    config.readyPath = "/ready";
    const f = await captureFixture(t, { config, platform });
    const result = await f.exports.captureRevision(f.store, {
      ...f.options,
      role: "target",
      title: "Exact target",
    });
    assert.equal(result.revision, "head");
    assert.equal(result.run.title, "Exact target");
    assert.match(
      fs.readFileSync(join(f.options.output, "capture.log"), "utf8"),
      /stdoutstderr/,
    );
    assert.equal(
      f.calls.find((c) => c[0] === "context")[1].colorScheme,
      "dark",
    );
    assert.equal(f.calls.filter((c) => c[0] === "browser-close").length, 1);
    await assert.rejects(
      f.exports.captureRevision(f.store, f.options),
      /new directory/,
    );
  }
});
test("capture failures stop children and retain logs without publishing a run", async (t) => {
  for (const mode of [
    "prepare-fails",
    "prepare-spawn-error",
    "prepare-timeout",
    "serve-exit",
    "serve-signal",
    "serve-spawn-error",
    "timeout",
    "browser-fails",
    "page-fails",
    "kill-error",
  ]) {
    const config = baseConfig();
    if (mode.startsWith("prepare")) config.prepare = [["prepare"]];
    const f = await captureFixture(t, { mode, config });
    await assert.rejects(
      f.exports.captureRevision(f.store, f.options),
      /failed|error|exited|ready|Capture preparation/,
    );
    assert.equal(fs.existsSync(join(f.options.output, "capture.log")), true);
  }
  for (const mode of ["kill-delay", "kill-esrch"]) {
    const f = await captureFixture(t, { mode });
    assert.ok((await f.exports.captureRevision(f.store, f.options)).run.id);
  }
  const config = baseConfig();
  config.directory = "..";
  const f = await captureFixture(t, { config });
  await assert.rejects(
    f.exports.captureRevision(f.store, f.options),
    /inside checkout/,
  );
});
test("comparison resolves commits, host PR metadata and changed PR heads", async (t) => {
  for (const mode of ["ok", "no-head-repo", "changed"]) {
    const f = await captureFixture(t, { mode });
    const context = await f.exports.resolvePullRequest("owner/repo", 1);
    assert.equal(
      context.headRepository,
      mode === "no-head-repo" ? null : "owner/repo",
    );
    const options = {
      ...f.options,
      base: "base",
      head: "head",
      output: join(f.dir, "comparison"),
      context: { ...context, head: "head" },
      verifyPR: true,
    };
    if (mode === "changed")
      await assert.rejects(
        f.exports.captureComparison(f.store, options),
        /PR head changed/,
      );
    else {
      const r = await f.exports.captureComparison(f.store, options);
      assert.equal(r.run.source.captureStatus, "captured");
      assert.match(r.run.title, /PR 1/);
    }
  }
  const f = await captureFixture(t);
  const r = await f.exports.captureComparison(f.store, {
    ...f.options,
    base: "base",
    head: "head",
    port: 4901,
  });
  assert.match(r.url, /:4901/);
  assert.equal(r.run.title, "Git revision comparison");
});
