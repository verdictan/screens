import test from "node:test";
import assert from "node:assert/strict";
import { ui, until, seedReview } from "./support/ui.mjs";
const ready = async (u) => until(() => u.$('#review[aria-busy="false"] #title'));

test("UI empty states, project and run switching, filtering and keyboard navigation", async (t) => {
  const u = await ui(t, {
    url: "http://127.0.0.1:4800/#%ZZ",
    seed: async (f) => {
      const r = await seedReview(f);
      f.store.project({ id: "empty", name: "Empty" });
      f.store.run({
        project: "demo",
        title: "Earlier review",
        captureIds: [r.captures.target.id],
      });
      return r;
    },
  });
  await ready(u);
  await u.change('[aria-label="Review run"]', u.run.id);
  await until(() => u.$("#count").textContent === "2");
  await u.click("Hide screen library");
  assert.ok(u.$(".library-collapsed"));
  await u.click("Show screen library");
  assert.equal(u.$(".library-collapsed"), null);
  await u.click("Feedback");
  assert.equal(u.all(".screen-item").length, 1);
  await u.click("Missing");
  assert.equal(u.all(".screen-item").length, 1);
  await u.click("All");
  await u.change("#search", "no matching screen");
  assert.match(u.$("#screens").textContent, /No matching screens/);
  await u.change("#search", "");
  for (const key of ["ArrowRight", "ArrowLeft", "Escape", "ArrowLeft"]) {
    u.doc.body.dispatchEvent(
      new u.w.KeyboardEvent("keydown", { key, bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(u.$("#title").textContent, "Home");
  u.$("#search").dispatchEvent(
    new u.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.equal(u.$("#title").textContent, "Home");
  u.all(".screen-item")[1].click();
  await until(() => u.$("#title")?.textContent === "Second");
  await u.click("Previous screen");
  await until(() => u.$("#title")?.textContent === "Home");
  await u.tab("History");
  assert.match(
    u.$("[data-state=active][role=tabpanel]").textContent,
    /Screenshot history/,
  );
  await u.change('[aria-label="Project"]', "empty");
  await until(() => u.doc.body.textContent.includes("Add screenshots to Empty"));
  assert.equal(new URL(u.w.location.href).searchParams.has("run"), false);
});
test("UI errors show server messages and allow failed actions to be dismissed", async (t) => {
  for (const failed of [
    "/api/projects",
    "/api/runs",
    "/api/compare",
    "/api/screen",
  ]) {
    const u = await ui(t, {
      seed: seedReview,
      respond: async (path, options, next) =>
        path.startsWith(failed)
          ? {
              ok: false,
              status: 503,
              json: async () => ({ error: "Registry unavailable" }),
            }
          : next(path, options),
    });
    await until(() => u.doc.body.textContent.includes("Registry unavailable"));
    assert.ok(u.$("[role=status]"));
  }
  const empty = await ui(t, {
    respond: async () => ({ ok: true, json: async () => [] }),
  });
  await until(() =>
    empty.doc.body.textContent.includes("Add your first screenshots"),
  );
  assert.equal(empty.$("select"), null);
  const u = await ui(t, {
    seed: seedReview,
    respond: async (path, options, next) =>
      options.method === "POST"
        ? { ok: false, status: 409, json: async () => ({}) }
        : next(path, options),
  });
  await ready(u);
  await u.click("Approve design");
  await until(() => u.doc.body.textContent.includes("HTTP 409"));
  await u.click("Dismiss");
  assert.equal(u.doc.body.textContent.includes("HTTP 409"), false);
});
test("comparison views, image pins, dimension mismatch and image failures remain visible", async (t) => {
  const u = await ui(t, { seed: seedReview });
  await ready(u);
  for (const img of u.all(".capture-image")) u.image(img);
  await until(() => u.doc.body.textContent.includes("200 × 200"));
  for (const img of u.all(".capture-image")) u.image(img);
  await u.click("Single");
  await u.change('[aria-label="Single screenshot"]', "left");
  assert.equal(u.all("#comparison > figure").length, 1);
  await u.change('[aria-label="Single screenshot"]', "right");
  assert.equal(u.all("#comparison > figure").length, 1);
  await u.click("Overlay");
  assert.ok(u.$("[aria-label=Blend]"));
  for (const img of u.all("#comparison img")) u.image(img);
  u.$("[aria-label=Blend]").dispatchEvent(new u.w.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  await until(() => u.$(".overlay-image").style.opacity === "1");
  assert.equal(u.$(".overlay-image").style.opacity, "1");
  u.image(u.all("#comparison img")[1], 200, 201);
  await until(() =>
    u.doc.body.textContent.includes("Overlay requires equal pixel dimensions"),
  );
  await u.change('[aria-label="Comparison pair"]', "current,pr");
  assert.equal(u.doc.body.textContent.includes("Overlay requires"), false);
  const image = u.$("#comparison .capture-image");
  image.dispatchEvent(new u.w.Event("error"));
  await until(() => u.doc.body.textContent.includes("could not be loaded"));
  image.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 200,
    height: 200,
  });
  image.dispatchEvent(
    new u.w.MouseEvent("click", { bubbles: true, clientX: 50, clientY: 100 }),
  );
  await until(() => u.doc.body.textContent.includes("Pinned at 25%, 50%"));
  assert.match(u.doc.body.textContent, /Pinned at 25%, 50%/);
  await u.click("Remove selection");
  assert.equal(u.$(".pin-context"), null);
  await u.tab("Review");
  await u.change('[aria-label="Comparison pair"]', "current,pr");
  await u.click("Open feedback 1: Pinned feedback");
  await until(() => u.doc.activeElement.id.startsWith("note-"));
  assert.equal(u.doc.activeElement.id.startsWith("note-"), true);
  await u.change("#note-text", "Pinned submission");
  u.submit("#note-form");
  await until(() => u.$("#notes").textContent.includes("Pinned submission"));
  await u.change("#note-capture", u.captures.pr.id);
  assert.equal(u.$(".pin-context"), null);
});
test("comparison distinguishes missing, unknown, mismatched and changed captures", async (t) => {
  for (const roles of [
    ["target"],
    ["current"],
    ["current", "pr"],
    ["current", "target"],
  ]) {
    const u = await ui(t, {
      seed: (f) =>
        seedReview(f, {
          roles,
          fixture: "unknown",
          notes: false,
          extra: false,
        }),
    });
    await ready(u);
    await u.tab("Feedback");
    assert.ok(u.$("#note-capture").value);
    await u.tab("Evidence");
    assert.ok(u.$("#evidence-capture").value);
    await u.tab("Review");
    await u.click("Overlay");
    assert.match(
      u.doc.body.textContent,
      roles.length === 1
        ? /A screenshot is missing/
        : /screenshot data source is unspecified/,
    );
  }
  for (const mode of ["mismatch", "changed", "dimensions"]) {
    const u = await ui(t, {
      seed: seedReview,
      respond: async (path, options, next) => {
        const r = await next(path, options);
        if (path.startsWith("/api/compare")) {
          const data = await r.json();
          const e = data.entries[0];
          e.captures.pr = {
            ...e.captures.pr,
            fixture: mode === "mismatch" ? "other" : "seed",
            hash: "different",
            revision: "unknown",
          };
          if (mode === "dimensions")
            e.measurements = [
              {
                left: e.captures.target.id,
                right: e.captures.pr.id,
                threshold: 0,
                masks: [],
                status: "dimension-mismatch",
                fixtureStatus: "same-reported-fixture",
              },
            ];
          return { ...r, json: async () => data };
        }
        return r;
      },
    });
    await ready(u);
    assert.match(
      u.doc.body.textContent,
      mode === "mismatch" ? /different sample data/ : /Click to comment/,
    );
    if (mode === "dimensions")
      assert.match(u.$("#diff-result").textContent, /dimensions differ/);
  }
});
test("pixel measurement tolerances, rectangle boundaries, clear and stale responses", async (t) => {
  let finish;
  const u = await ui(t, {
    seed: seedReview,
    respond: async (path, options, next) =>
      path === "/api/diffs"
        ? new Promise((resolve) => {
            finish = async () => resolve(await next(path, options));
          })
        : next(path, options),
  });
  await ready(u);
  await u.change("#diff-threshold", 5);
  await u.click("Measure changes");
  assert.equal(u.$("#measure").disabled, true);
  await u.change('[aria-label="Comparison pair"]', "current,pr");
  await finish();
  await until(() => !u.$("#measure").disabled);
  assert.match(u.$("#diff-result").textContent, /Not measured/);
  await u.click("Measure changes");
  await finish();
  await until(() => u.$("#diff-result").textContent.includes("% changed"));
  for (const [field, value] of [
    ["x", -1],
    ["y", -1],
    ["width", 0],
    ["height", 0],
    ["width", 1.5],
  ]) {
    await u.change("#mask-" + field, value);
    await u.click("Add region");
    await until(() => u.doc.body.textContent.includes("valid pixel rectangle"));
    await u.click("Dismiss");
    await u.change("#mask-" + field, field === "x" || field === "y" ? 0 : 1);
  }
  for (const field of ["x", "y", "width", "height"])
    await u.change("#mask-" + field, field === "x" || field === "y" ? 0 : 1);
  await u.click("Add region");
  assert.match(u.doc.body.textContent, /0, 0/);
  await u.click("Clear");
  assert.match(u.doc.body.textContent, /No excluded regions/);
  await until(() => !u.button("Add region").disabled);
  for (let i = 0; i < 100; i++) await u.click("Add region");
  await u.click("Add region");
  await until(() => u.doc.body.textContent.includes("valid pixel rectangle"));
});
test("feedback submissions, verification, reopening and original capture links", async (t) => {
  const u = await ui(t, {
    seed: async (f) => {
      const r = await seedReview(f);
      const note = f.store.getScreen("demo/home").notes[0];
      f.store.updateNote({
        id: note.id,
        expectedRevision: 1,
        status: "submitted",
        evidence: r.captures.pr.id,
        resolution: "Updated",
      });
      const earlier = f.capture({ role: "current", revision: "old" });
      f.store.addNote({ capture: earlier.id, text: "Earlier feedback" });
      const old = f.capture({
        role: "pr",
        revision: "earlier",
        variant: { device: "phone" },
      });
      f.store.addNote({ capture: old.id, text: "Phone only" });
      return r;
    },
  });
  await ready(u);
  await u.tab("Feedback");
  assert.equal(u.$("#notes").textContent.includes("Phone only"), false);
  await u.click("Verify fix");
  await until(() => u.$("#notes").textContent.includes("Verified"));
  await u.click("Reopen");
  await until(() => u.store.getScreen("demo/home").notes.find((note) => note.text === "Pinned feedback").status === "open");
  await u.change("#note-text", "New feedback");
  u.submit("#note-form");
  await until(() => u.$("#notes").textContent.includes("New feedback"));
  assert.equal(
    u.store
      .getScreen("demo/home")
      .notes.filter((n) => n.text === "New feedback").length,
    1,
  );
  await u.tab("Review");
  await u.click("Approve design");
  await until(() => u.doc.body.textContent.includes("Design approved"));
});
test("evidence uploads persist reports and reject unsupported, oversized or unreadable files", async (t) => {
  const u = await ui(t, { seed: seedReview });
  await ready(u);
  await u.tab("Evidence");
  const fill = async () => {
    for (const [id, value] of [
      ["assertion", "Color inspected"],
      ["procedure", "Inspect button"],
      ["observation", "Matches design"],
    ])
      await u.change("#evidence-" + id, value);
  };
  const file = (name, bytes = "report", size) => {
    const f = new u.w.File([bytes], name);
    if (size) Object.defineProperty(f, "size", { value: size });
    Object.defineProperty(u.$("#evidence-file"), "files", {
      configurable: true,
      value: [f],
    });
  };
  await fill();
  file("report.json", '{"pass":true}');
  u.submit("#evidence-form");
  await until(() =>
    u.$("#evidence-list").textContent.includes("Color inspected"),
  );
  assert.match(u.$("#evidence-list").textContent, /Download application\/json/);
  for (const [name, size, message] of [
    ["bad.exe", 0, "Use a text/JSON"],
    ["big.txt", 20 * 1024 * 1024 + 1, "exceeds 20 MB"],
  ]) {
    await fill();
    file(name, "a", size);
    u.submit("#evidence-form");
    await until(() => u.doc.body.textContent.includes(message));
    await u.click("Dismiss");
  }
  const Original = u.w.FileReader;
  u.w.FileReader = class {
    readAsDataURL() {
      this.onerror();
    }
  };
  await fill();
  file("report.txt");
  u.submit("#evidence-form");
  await until(() =>
    u.doc.body.textContent.includes("Could not read the attachment"),
  );
  u.w.FileReader = Original;
});

test("review updates the approved target when optional run metadata is absent", async (t) => {
  const u = await ui(t, {
    seed: async (f) => {
      const originalCapture = f.capture;
      f.capture = (extra) =>
        originalCapture({ variant: { viewport: "200x200" }, ...extra });
      const old = f.capture({ role: "target", revision: "old-target" });
      f.store.approveTarget({ capture: old.id, expectedRevision: 0 });
      return seedReview(f, { extra: false });
    },
    respond: async (path, options, next) => {
      const response = await next(path, options);
      if (!path.startsWith("/api/compare")) return response;
      const data = await response.json();
      delete data.warnings;
      delete data.uncoveredScreens;
      data.entries[0].group = "";
      data.entries[0].state = "";
      data.entries[0].variant.viewport = "200x200";
      return { ...response, json: async () => data };
    },
  });
  await ready(u);
  assert.match(u.doc.body.textContent, /200x200/);
  assert.equal(u.$("#title").textContent, "Home");
  await u.click("Approve design");
  await until(() => u.doc.body.textContent.includes("Design approved"));
  assert.equal(u.store.getScreen("demo/home").targets[0].revision, 2);
});
