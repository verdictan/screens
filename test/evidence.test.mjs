import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store } from "../src/store.mjs";
import { createDiff } from "../src/diff.mjs";
import { protocol } from "../src/mcp.mjs";
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "screens-evidence-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.project({ id: "demo", name: "Demo" });
  store.screen({ project: "demo", key: "home", title: "Home" });
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const raw = Buffer.alloc(16, 255);
  raw[0] = 0;
  raw[1] = 0;
  raw[2] = 0;
  const changed = await sharp(raw, {
    raw: { width: 2, height: 2, channels: 4 },
  })
    .png()
    .toBuffer();
  const capture = (bytes, role = "pr", extra = {}) =>
    store.capture({
      screen: "demo/home",
      role,
      bytes,
      revision: role,
      fixture: "seed-1",
      ...extra,
    });
  return {
    store,
    capture,
    png,
    left: capture(png, "current"),
    right: capture(changed),
  };
}
test("lossless diff counts pixels, records provenance and caches immutable artifacts", async (t) => {
  const { store, left, right } = await setup(t);
  const diff = await createDiff(store, { left: left.id, right: right.id });
  assert.equal(diff.changedPixels, 1);
  assert.equal(diff.changedRatio, 0.25);
  assert.equal(diff.acceptance, "not-assessed");
  const image = await sharp(store.diffImage(diff.id)).raw().toBuffer();
  assert.deepEqual([...image.subarray(0, 4)], [230, 30, 100, 255]);
  assert.deepEqual(
    await createDiff(store, { left: left.id, right: right.id }),
    diff,
  );
  const run = store.run({
    project: "demo",
    title: "Measured",
    captureIds: [left.id, right.id],
  });
  assert.equal(store.compare(run.id).entries[0].measurements[0].id, diff.id);
  assert.equal(diff.leftHash, left.hash);
  assert.equal(diff.fixtureStatus, "same-reported-fixture");
});
test("explicit masks union pixels, threshold is reproducible, all-masked is rejected", async (t) => {
  const { store, left, right } = await setup(t);
  const masked = await createDiff(store, {
    left: left.id,
    right: right.id,
    masks: [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 0, width: 1, height: 1 },
    ],
  });
  assert.equal(masked.changedPixels, 0);
  assert.equal(masked.maskedPixels, 1);
  assert.equal(masked.comparedPixels, 3);
  assert.equal(
    (
      await createDiff(store, {
        left: left.id,
        right: right.id,
        threshold: 255,
      })
    ).changedPixels,
    0,
  );
  await assert.rejects(
    createDiff(store, {
      left: left.id,
      right: right.id,
      masks: [{ x: 0, y: 0, width: 2, height: 2 }],
    }),
    /every pixel/,
  );
  await assert.rejects(
    createDiff(store, {
      left: left.id,
      right: right.id,
      masks: [{ x: 1, y: 0, width: 2, height: 2 }],
    }),
    /outside/,
  );
});
test("equal decoded pixels differ from bytes; incompatible dimensions and fixtures remain explicit", async (t) => {
  const { store, left, capture, png } = await setup(t);
  const reencoded = capture(
    await sharp(png).png({ compressionLevel: 0 }).toBuffer(),
  );
  assert.notEqual(left.hash, reencoded.hash);
  assert.equal(
    (await createDiff(store, { left: left.id, right: reencoded.id }))
      .changedPixels,
    0,
  );
  const resized = capture(
    await sharp(png).resize(3, 2).png().toBuffer(),
    "pr",
    { fixture: "other" },
  );
  const diff = await createDiff(store, { left: left.id, right: resized.id });
  assert.equal(diff.status, "dimension-mismatch");
  assert.equal(diff.fixtureStatus, "mismatch");
  assert.equal(diff.image, null);
  const variant = capture(png, "pr", { variant: { theme: "dark" } });
  await assert.rejects(
    createDiff(store, { left: left.id, right: variant.id }),
    /same screen and variant/,
  );
  const truncated = capture(png.subarray(0, 20));
  await assert.rejects(
    createDiff(store, { left: left.id, right: truncated.id }),
    /Cannot decode/,
  );
});
test("semantic evidence is exact-capture, append-only and never screenshot proof of motion", async (t) => {
  const { store, right } = await setup(t);
  const input = {
    capture: right.id,
    kind: "motion",
    method: "manual",
    outcome: "pass",
    assertion: "Reduced motion disables transition",
    procedure: "Enable reduced motion and navigate",
    observation: "No animated transition observed",
    author: "Reviewer",
  };
  const first = store.addEvidence(input),
    second = store.addEvidence({
      ...input,
      outcome: "fail",
      observation: "Transition remains",
    });
  assert.notEqual(first.id, second.id);
  assert.equal(store.getEvidence(first.id).outcome, "pass");
  assert.equal(first.captureHash, right.hash);
  assert.equal(first.sourceRevision, right.revision);
  assert.equal(first.acceptance, "not-assessed");
  assert.equal(store.getScreen(right.screen).evidence.length, 2);
  assert.throws(
    () => store.addEvidence({ ...input, method: "screenshot" }),
    /Screenshots cannot/,
  );
  assert.throws(
    () => store.addEvidence({ ...input, method: "automated" }),
    /report artifact/,
  );
  const evidence = store.addEvidence({
    ...input,
    method: "automated",
    artifactBase64: Buffer.from('{"reducedMotion":true}').toString("base64"),
    artifactType: "application/json",
  });
  assert.equal(
    store.evidenceArtifact(evidence.id).bytes.toString(),
    '{"reducedMotion":true}',
  );
});
test("MCP returns real diff image content and cannot approve via evidence tools", async (t) => {
  const { store, left, right } = await setup(t),
    rpc = protocol(store);
  const created = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "diffs_create",
      arguments: { left: left.id, right: right.id },
    },
  });
  const diff = JSON.parse(created.result.content[0].text);
  const view = await rpc({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "diffs_view", arguments: { id: diff.id } },
  });
  assert.equal(view.result.content[1].type, "image");
  const list = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.equal(
    list.result.tools.some((t) => /approve|verify/.test(t.name)),
    false,
  );
});
test("run coverage snapshots missing registered screens", async (t) => {
  const { store, left } = await setup(t);
  store.screen({ project: "demo", key: "empty", title: "Empty state" });
  const run = store.run({
    project: "demo",
    title: "Coverage",
    captureIds: [left.id],
  });
  store.screen({ project: "demo", key: "later", title: "Later" });
  assert.deepEqual(
    store.compare(run.id).uncoveredScreens.map((s) => s.id),
    ["demo/empty"],
  );
});
