import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.mjs";
import { importManifest, combineRuns } from "../src/import.mjs";
import { protocol } from "../src/mcp.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "screens-test-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.project({ id: "demo", name: "Demo" });
  store.screen({ project: "demo", key: "home", title: "Home" });
  const capture = (extra = {}) =>
    store.capture({
      screen: "demo/home",
      role: "current",
      bytes: png,
      revision: "abc123",
      fixture: "sample",
      ...extra,
    });
  return { store, dir, capture };
}
test("captures deduplicate without replacing previous revisions", (t) => {
  const { store, capture } = setup(t),
    a = capture(),
    b = capture();
  assert.equal(a.id, b.id);
  const c = capture({ revision: "def456" });
  assert.notEqual(a.id, c.id);
  assert.equal(a.hash, c.hash);
  assert.equal(store.getScreen("demo/home").captures.length, 2);
  assert.deepEqual(store.image(a.id).bytes, png);
});
test("reject active image formats and invalid pins", (t) => {
  const { store, capture } = setup(t);
  assert.throws(
    () => capture({ bytes: Buffer.from('<svg onload="alert(1)"></svg>') }),
    /Only PNG/,
  );
  const c = capture();
  assert.throws(
    () => store.addNote({ capture: c.id, text: "bad", point: { x: 2, y: 0 } }),
    /coordinates/,
  );
});
test("feedback edits require the current revision and preserve capture anchors", (t) => {
  const { store, capture } = setup(t),
    c = capture(),
    n = store.addNote({
      capture: c.id,
      text: "Spacing",
      point: { x: 0.1, y: 0.2 },
    });
  const updated = store.updateNote({
    id: n.id,
    expectedRevision: 1,
    status: "in-progress",
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.capture, c.id);
  assert.throws(
    () => store.updateNote({ id: n.id, expectedRevision: 1, status: "open" }),
    (e) => e.status === 409,
  );
});
test("a submitted fix needs fresh evidence of the same screen and variant", (t) => {
  const { store, capture } = setup(t),
    c = capture(),
    n = store.addNote({ capture: c.id, text: "Spacing" });
  assert.throws(
    () =>
      store.updateNote({
        id: n.id,
        expectedRevision: 1,
        status: "submitted",
        evidence: c.id,
        resolution: "Fixed",
      }),
    /fresh/,
  );
  const wrong = capture({ role: "pr", variant: { device: "phone" } });
  assert.throws(
    () =>
      store.updateNote({
        id: n.id,
        expectedRevision: 1,
        status: "submitted",
        evidence: wrong.id,
        resolution: "Fixed",
      }),
    /same screen/,
  );
  const after = capture({ role: "pr", revision: "def456" });
  const submitted = store.updateNote({
    id: n.id,
    expectedRevision: 1,
    status: "submitted",
    evidence: after.id,
    resolution: "Adjusted gap",
  });
  assert.equal(submitted.status, "submitted");
  assert.throws(
    () =>
      store.updateNote({ id: n.id, expectedRevision: 2, status: "verified" }),
    (e) => e.status === 403,
  );
  assert.equal(
    store.updateNote(
      { id: n.id, expectedRevision: 2, status: "verified" },
      { human: true },
    ).status,
    "verified",
  );
});
test("target approval is pinned to an exact capture and checks concurrent edits", (t) => {
  const { store, capture } = setup(t),
    a = capture({ role: "target" }),
    b = capture({ role: "target", revision: "new" });
  store.approveTarget({ capture: a.id, expectedRevision: 0 });
  assert.throws(
    () => store.approveTarget({ capture: b.id, expectedRevision: 0 }),
    (e) => e.status === 409,
  );
  store.approveTarget({ capture: b.id, expectedRevision: 1 });
  assert.equal(store.getScreen(a.screen).targets[0].capture, b.id);
});
test("comparison rejects ambiguous slots and cross-project captures", (t) => {
  const { store, capture } = setup(t),
    a = capture(),
    b = capture({ revision: "new" });
  assert.throws(
    () =>
      store.run({ project: "demo", title: "bad", captureIds: [a.id, b.id] }),
    /one capture/,
  );
  assert.throws(
    () => store.run({ project: "other", title: "bad", captureIds: [a.id] }),
    /same project/,
  );
});
test("comparison represents missing evidence and fixture mismatch honestly", (t) => {
  const { store, capture } = setup(t),
    a = capture(),
    b = capture({ role: "pr", fixture: "different" });
  const run = store.run({
    project: "demo",
    title: "Compare",
    captureIds: [a.id, b.id],
  });
  const entry = store.compare(run.id).entries[0];
  assert.equal(entry.compatible, false);
  assert.equal(entry.targetApproval, null);
  assert.equal(entry.captures.target, undefined);
});
test("canonical import keeps original bytes and tolerates missing evidence", (t) => {
  const { store, dir } = setup(t);
  writeFileSync(join(dir, "actual.png"), png);
  writeFileSync(
    join(dir, "screens.json"),
    JSON.stringify({
      schemaVersion: 1,
      project: { id: "demo", name: "Demo" },
      screens: [
        {
          key: "home",
          title: "Home",
          captures: [
            { file: "actual.png", role: "current" },
            { file: "missing.png", role: "target" },
          ],
        },
      ],
    }),
  );
  const result = importManifest(store, join(dir, "screens.json"));
  assert.equal(result.run.captureIds.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.deepEqual(store.image(result.run.captureIds[0]).bytes, png);
});
test("import cannot read an image outside the manifest root", (t) => {
  const { store, dir } = setup(t);
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "private.png"), png);
  writeFileSync(
    join(dir, "nested/screens.json"),
    JSON.stringify({
      schemaVersion: 1,
      screens: [
        {
          key: "escape",
          title: "Escape",
          captures: [{ file: "../private.png", role: "current" }],
        },
      ],
    }),
  );
  const result = importManifest(store, join(dir, "nested/screens.json"), {
    project: "demo",
  });
  assert.equal(result.run, null);
  assert.match(result.warnings[0], /outside/);
});
test("Kalkidan import preserves device identities and imports proposals", (t) => {
  const { store, dir } = setup(t);
  mkdirSync(join(dir, "mac/should"), { recursive: true });
  writeFileSync(join(dir, "mac/should/m01.jpg"), png);
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      current: "round-1",
      rounds: [{ id: "round-1" }],
      devices: {
        mac: {
          groups: [
            {
              name: "Overview",
              screens: [{ id: "m01", title: "Home", have: false }],
            },
          ],
        },
      },
    }),
  );
  const result = importManifest(store, join(dir, "manifest.json"), {
    project: "demo",
  });
  const comparison = store.compare(result.run.id);
  assert.equal(comparison.entries[0].screen, "demo/mac/m01");
  assert.equal(comparison.entries[0].targetApproval, null);
  assert.equal(comparison.entries[0].captures.current, undefined);
});
test("runs can align separately imported baseline, target and PR captures", (t) => {
  const { store, capture } = setup(t);
  const a = capture(),
    b = capture({ role: "target" }),
    c = capture({ role: "pr" });
  const run = (x) =>
    store.run({ project: "demo", title: x.role, captureIds: [x.id] }).id;
  const result = combineRuns(store, {
    project: "demo",
    current: run(a),
    target: run(b),
    pr: run(c),
  });
  assert.deepEqual(
    Object.keys(store.compare(result.id).entries[0].captures).sort(),
    ["current", "pr", "target"],
  );
});
test("MCP negotiation, tool discovery and actual image responses", async (t) => {
  const { store, capture } = setup(t),
    c = capture(),
    rpc = protocol(store);
  const call = (method, params) =>
    rpc({ jsonrpc: "2.0", id: 1, method, params });
  assert.equal((await call("initialize")).result.protocolVersion, "2025-03-26");
  const tools = (await call("tools/list")).result.tools;
  assert.ok(tools.some((t) => t.name === "captures_view"));
  assert.ok(!tools.some((t) => /approve|verify/.test(t.name)));
  const image = (
    await call("tools/call", { name: "captures_view", arguments: { id: c.id } })
  ).result.content[1];
  assert.equal(image.type, "image");
  assert.equal(image.data, png.toString("base64"));
  assert.equal(
    (await call("tools/call", { name: "missing" })).error.code,
    -32602,
  );
  assert.equal(
    (await call("tools/call", { name: "screens_get", arguments: {} })).error
      .code,
    -32602,
  );
  assert.equal(
    await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
    null,
  );
});
test("data and capture-bound notes survive reopening the database", (t) => {
  const { store, dir, capture } = setup(t),
    c = capture();
  store.addNote({ capture: c.id, text: "Persist me" });
  const other = new Store(dir);
  assert.equal(other.getScreen(c.screen).notes[0].text, "Persist me");
  other.close();
});
