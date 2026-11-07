import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { fixture } from "./support/registry.mjs";
import * as v from "../src/validation.mjs";
import { Store } from "../src/store.mjs";
import { discover, importManifest, combineRuns } from "../src/import.mjs";
import { createDiff } from "../src/diff.mjs";
import { protocol } from "../src/mcp.mjs";

test("validation accepts boundaries and rejects malformed input", async (t) => {
  const { bytes } = await fixture(t);
  assert.equal(v.text(" x ", "name"), "x");
  for (const input of [null, 4, "", " ", "abcd"])
    assert.throws(() => v.text(input, "name", 3), /Invalid name/);
  assert.equal(v.key("A/b:c-d_1.2"), "A/b:c-d_1.2");
  assert.throws(() => v.key("bad id"), /Invalid ID/);
  assert.equal(v.choice("yes", ["yes"], "choice"), "yes");
  assert.throws(() => v.choice("no", ["yes"], "choice"), /expected yes/);
  assert.equal(v.point(), null);
  assert.equal(v.point(null), null);
  assert.deepEqual(v.point({ x: 0, y: 1 }), { x: 0, y: 1 });
  for (const point of [4, { x: NaN, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 2 }])
    assert.throws(() => v.point(point), /coordinates/);
  for (const input of [
    "bad",
    Buffer.alloc(12),
    Buffer.alloc(25 * 1024 * 1024 + 1),
  ])
    assert.throws(() => v.raster(input), /Image must/);
  assert.equal(v.raster(bytes), "image/png");
  assert.equal(v.raster(await sharp(bytes).jpeg().toBuffer()), "image/jpeg");
  assert.equal(v.raster(await sharp(bytes).webp().toBuffer()), "image/webp");
  const wrong = Buffer.alloc(16);
  wrong.write("RIFF");
  assert.throws(() => v.raster(wrong), /Only PNG/);
  const jpeg = Buffer.alloc(16);
  jpeg[0] = 255;
  assert.throws(() => v.raster(jpeg), /Only PNG/);
  jpeg[1] = 216;
  assert.throws(() => v.raster(jpeg), /Only PNG/);
  assert.equal(v.variant().device, "desktop");
  assert.deepEqual(
    v.variant({
      device: "phone",
      theme: "dark",
      viewport: "1x1",
      locale: "es",
      textScale: "large",
    }),
    {
      device: "phone",
      theme: "dark",
      viewport: "1x1",
      locale: "es",
      textScale: "large",
    },
  );
});

test("registry errors leave stored captures and revisions intact", async (t) => {
  const { store, dir, bytes, capture } = await fixture(t);
  assert.equal(store.project({ id: "demo", name: "Ignored" }).name, "Demo");
  assert.equal(store.search().length, 1);
  assert.throws(() => store.search({ query: 4 }), /Invalid query/);
  assert.throws(
    () => store.screen({ project: "missing", key: "home", title: "Home" }),
    /not found/,
  );
  for (const fn of [
    () => store.getScreen("missing"),
    () => store.getCapture("missing"),
    () => store.getRun("missing"),
    () => store.getDiff("missing"),
    () => store.getEvidence("missing"),
  ])
    assert.throws(fn, /not found/);
  const a = capture(),
    b = capture({
      role: "pr",
      bytes: undefined,
      imageBase64: bytes.toString("base64"),
    });
  assert.equal(b.hash, a.hash);
  const run = store.run({
    project: "demo",
    title: "Test",
    captureIds: [a.id, b.id, a.id],
  });
  assert.equal(run.captureIds.length, 2);
  assert.equal(
    store.compare(run.id).entries[0].pixelComparison,
    "identical-bytes",
  );
  const old = { ...run };
  delete old.uncoveredScreens;
  store.db
    .prepare("UPDATE runs SET data=? WHERE id=?")
    .run(JSON.stringify(old), run.id);
  assert.deepEqual(store.compare(run.id).uncoveredScreens, []);
  for (const captureIds of [null, [], Array(10001).fill(a.id)])
    assert.throws(
      () => store.run({ project: "demo", title: "Test", captureIds }),
      /1–10000/,
    );
  const n = store.addNote({ capture: a.id, text: "Old" });
  const updated = store.updateNote(
    {
      id: n.id,
      expectedRevision: 1,
      status: "wont-fix",
      resolution: "By design",
      text: "New",
    },
    { human: true },
  );
  assert.equal(updated.text, "New");
  assert.equal(updated.resolution, "By design");
  assert.throws(
    () =>
      store.updateNote({ id: "missing", status: "open", expectedRevision: 1 }),
    /not found/,
  );
  assert.throws(
    () => store.approveTarget({ capture: a.id, expectedRevision: 0 }),
    /Only target/,
  );
  assert.throws(() => store.listEvidence(), /Supply capture/);
  const e = store.addEvidence({
    capture: a.id,
    kind: "visual",
    method: "screenshot",
    outcome: "not-run",
    assertion: "Color",
    observation: "Pending",
    procedure: "Inspect",
    author: "Tester",
  });
  assert.equal(store.listEvidence({ capture: a.id })[0].id, e.id);
  assert.throws(() => store.evidenceArtifact(e.id), /No artifact/);
  store.saveAsset(a.hash, bytes);
  const assets = join(dir, "assets");
  renameSync(assets, assets + "-saved");
  writeFileSync(assets, "not a directory");
  try {
    assert.throws(() => capture({ revision: "disk-failure" }), /ENOTDIR/);
    assert.throws(() => store.saveAsset("other", bytes), /ENOTDIR/);
  } finally {
    rmSync(assets);
    renameSync(assets + "-saved", assets);
  }
  const future = join(dir, "future");
  mkdirSync(future);
  const db = new DatabaseSync(join(future, "screens.sqlite"));
  db.exec("PRAGMA user_version=3");
  db.close();
  assert.throws(() => new Store(future), /newer Screens/);
});

test("all manifest formats preserve roles, identity, provenance and missing files", async (t) => {
  const { store, dir, bytes, capture } = await fixture(t);
  writeFileSync(join(dir, "a.png"), bytes);
  const load = (data, options = {}) => {
    writeFileSync(join(dir, "screens.json"), JSON.stringify(data));
    return importManifest(store, join(dir, "screens.json"), options);
  };
  const pages = load({
    package: "pages",
    pages: [
      {
        id: "first",
        title: "First",
        route: "/",
        desktop: "a.png",
        mobile: "a.png",
        beforeDesktop: "a.png",
        beforeMobile: "a.png",
      },
      { route: "/hashed", desktop: "a.png" },
    ],
    states: [{ id: "modal", route: "/modal", state: "open", desktop: "a.png" }],
    mode: "fixture",
  });
  assert.equal(pages.importedScreens, 3);
  assert.equal(pages.run.captureIds.length, 6);
  assert.equal(
    store.search({ project: "pages" }).some((s) => s.key === "state/modal"),
    true,
  );
  const plain = load({
    pages: [{ id: "plain", route: "/plain", desktop: "a.png" }],
  });
  assert.equal(plain.project.name, "Imported screens");
  const routes = load(
    [
      {
        route: "/",
        state: "default",
        page: "Routing",
        template_or_story: "index",
        current_1440: "a.png",
        target_1440: "a.png",
        after_1440: "a.png",
        after_390: "a.png",
        notes: "Route fixture",
      },
      { route: "/two", state: "default", page: "Second", current_390: "a.png" },
    ],
    {
      project: "routes",
      name: "Routes",
      title: "Routing review",
      revision: "r1",
      fixture: "seed",
    },
  );
  assert.equal(routes.run.captureIds.length, 5);
  assert.equal(routes.run.title, "Routing review");
  mkdirSync(join(dir, "mac/should"), { recursive: true });
  mkdirSync(join(dir, "mac/have"), { recursive: true });
  writeFileSync(join(dir, "mac/should/home.jpg"), bytes);
  writeFileSync(join(dir, "mac/have/home.jpg"), bytes);
  const legacy = load(
    {
      devices: {
        mac: {
          groups: [
            {
              name: "Main",
              screens: [{ id: "home", title: "Home", have: true }],
            },
          ],
        },
      },
      rounds: [],
      current: "one",
    },
    { project: "legacy" },
  );
  assert.equal(legacy.run.captureIds.length, 2);
  const empty = load({
    schemaVersion: 1,
    screens: [
      {
        key: "empty",
        title: "Empty",
        captures: [
          { role: "current" },
          { role: "target", file: "https://example.invalid/a.png" },
        ],
      },
    ],
  });
  assert.equal(empty.run, null);
  assert.match(empty.warnings[0], /local files/);
  assert.throws(
    () => load({ schemaVersion: 1, screens: [{ key: "bad", title: "Bad" }] }),
    /needs captures/,
  );
  assert.throws(() => load({}), /Unsupported manifest/);
  assert.equal(discover(dir).length, 1);
  const a = capture(),
    b = capture({ role: "target" });
  const single = store.run({
    project: "demo",
    title: "Single",
    captureIds: [a.id],
  });
  const combined = combineRuns(store, {
    project: "demo",
    pr: single.id,
    title: "Remapped",
  });
  assert.equal(store.getCapture(combined.captureIds[0]).role, "pr");
  const multi = store.run({
    project: "demo",
    title: "Multi",
    captureIds: [a.id, b.id],
  });
  assert.throws(
    () => combineRuns(store, { project: "demo", pr: multi.id }),
    /multiple candidates/,
  );
  assert.throws(
    () => combineRuns(store, { project: "other", current: single.id }),
    /same project/,
  );
});

test("diff input boundaries and fixture uncertainty are explicit", async (t) => {
  const { store, capture, bytes } = await fixture(t);
  const a = capture(),
    b = capture({ role: "pr" });
  const input = { left: a.id, right: b.id };
  const diff = await createDiff(store, input);
  assert.equal(diff.fixtureStatus, "unknown");
  for (const threshold of [-1, 256, 0.5, "0"])
    await assert.rejects(
      createDiff(store, { ...input, threshold }),
      /Threshold/,
    );
  for (const masks of [
    null,
    {},
    [null],
    [{ x: 0, y: 0, width: 0, height: 1 }],
    Array(101).fill({ x: 0, y: 0, width: 1, height: 1 }),
  ])
    await assert.rejects(createDiff(store, { ...input, masks }), /Masks|masks/);
  const tall = capture({
    role: "pr",
    bytes: await sharp(bytes).resize(2, 3).png().toBuffer(),
  });
  const mismatch = await createDiff(store, { left: a.id, right: tall.id });
  assert.equal(mismatch.status, "dimension-mismatch");
  assert.throws(() => store.diffImage(mismatch.id), /no image/);
  const rpc = protocol(store);
  const result = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "diffs_view", arguments: { id: mismatch.id } },
  });
  assert.equal(result.result.content.length, 1);
  const animated = await sharp(
    Buffer.concat([Buffer.alloc(2 * 2 * 4, 255), Buffer.alloc(2 * 2 * 4, 0)]),
    { raw: { width: 2, height: 4, channels: 4, pageHeight: 2 } },
  )
    .webp({ loop: 0 })
    .toBuffer();
  const anim = capture({ role: "pr", bytes: animated });
  await assert.rejects(
    createDiff(store, { left: a.id, right: anim.id }),
    /Animated/,
  );
});

test("MCP batches, all service tools, malformed requests and failures", async (t) => {
  const { store, capture, bytes } = await fixture(t);
  const a = capture(),
    b = capture({ role: "pr" });
  const run = store.run({
    project: "demo",
    title: "Test",
    captureIds: [a.id, b.id],
  });
  const rpc = protocol(store),
    call = async (name, args) =>
      rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      });
  assert.equal((await rpc([])).error.code, -32600);
  for (const msg of [null, {}, { jsonrpc: "2.0", id: 3, method: 4 }])
    assert.equal((await rpc(msg)).error.code, -32600);
  assert.equal(await rpc([{ jsonrpc: "2.0", method: "notice" }]), null);
  assert.equal(
    (
      await rpc([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notice" },
      ])
    ).length,
    1,
  );
  assert.equal(
    (await rpc({ jsonrpc: "2.0", id: 1, method: "missing" })).error.code,
    -32601,
  );
  assert.equal(
    (await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call" })).error.code,
    -32602,
  );
  for (const args of [4, [], { unexpected: 1 }])
    assert.equal((await call("projects_list", args)).error.code, -32602);
  assert.equal((await call("projects_list")).result.isError, undefined);
  for (const [name, args] of [
    ["screens_search", { project: "demo", query: "Home" }],
    ["screens_get", { id: a.screen }],
    ["screens_register", { project: "demo", key: "two", title: "Two" }],
    [
      "captures_register",
      {
        screen: a.screen,
        role: "pr",
        imageBase64: bytes.toString("base64"),
        revision: "mcp",
        fixture: "seed",
        provenance: "test",
      },
    ],
    ["runs_list", { project: "demo" }],
    ["runs_compare", { id: run.id }],
  ])
    assert.equal((await call(name, args)).result.isError, undefined, name);
  const note = JSON.parse(
    (await call("reviews_add_note", { capture: a.id, text: "Fix" })).result
      .content[0].text,
  );
  assert.equal(
    JSON.parse(
      (
        await call("reviews_submit_fix", {
          id: note.id,
          expectedRevision: 1,
          evidence: b.id,
          resolution: "Changed",
        })
      ).result.content[0].text,
    ).status,
    "submitted",
  );
  const e = {
    capture: a.id,
    kind: "visual",
    method: "manual",
    outcome: "not-run",
    assertion: "Inspect",
    procedure: "Look",
    observation: "Pending",
    author: "Tester",
  };
  assert.equal((await call("evidence_add", e)).result.isError, undefined);
  assert.equal(
    JSON.parse(
      (await call("evidence_list", { capture: a.id })).result.content[0].text,
    ).length,
    1,
  );
  assert.equal(
    (await call("screens_get", { id: "missing" })).result.isError,
    true,
  );
  const huge = { ...a, bytes: Buffer.alloc(10 * 1024 * 1024 + 1) };
  store.image = () => ({ capture: a, bytes: huge.bytes });
  assert.equal(
    (await call("captures_view", { id: a.id })).result.isError,
    true,
  );
  store.getDiff = () => ({ image: "hash" });
  store.diffImage = () => huge.bytes;
  assert.equal((await call("diffs_view", { id: "test" })).result.isError, true);
});
