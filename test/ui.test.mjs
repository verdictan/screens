import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Script } from "node:vm";
import { Readable } from "node:stream";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store } from "../src/store.mjs";
import { requestHandler } from "../src/server.mjs";

async function until(fn) {
  for (let i = 0; i < 1000; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw Error("UI did not settle");
}
test("picker navigation, persisted diff, masks, evidence, feedback and approval use the real service layer", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "screens-ui-")),
    store = new Store(dir);
  const dom = new JSDOM(readFileSync("public/index.html", "utf8"), {
    url: "http://127.0.0.1:4800",
    runScripts: "outside-only",
  });
  t.after(() => {
    dom.window.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.project({ id: "ui", name: "UI" });
  store.screen({ project: "ui", key: "home", title: "Home" });
  store.screen({ project: "ui", key: "missing", title: "Missing" });
  const white = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const black = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "black" },
  })
    .png()
    .toBuffer();
  const capture = (screen, role, bytes) =>
    store.capture({ screen, role, bytes, revision: role, fixture: "ui-seed" });
  const target = capture("ui/home", "target", white),
    pr = capture("ui/home", "pr", black),
    missing = capture("ui/missing", "target", white);
  store.run({
    project: "ui",
    title: "UI review",
    captureIds: [target.id, pr.id, missing.id],
  });
  const handler = requestHandler(store, () => 4800);
  dom.window.fetch = async (url, options = {}) => {
    const req = Readable.from([Buffer.from(options.body || "")]);
    Object.assign(req, {
      url,
      method: options.method || "GET",
      headers: { host: "127.0.0.1:4800", "content-type": "application/json" },
    });
    const res = {
      status: 200,
      setHeader() {},
      writeHead(s) {
        this.status = s;
      },
      end(body) {
        this.body = body;
      },
    };
    await handler(req, res);
    return {
      ok: res.status < 400,
      status: res.status,
      json: async () => JSON.parse(res.body),
    };
  };
  await new Script(
    `(async()=>{${readFileSync("public/app.js", "utf8")}\n})()`,
  ).runInContext(dom.getInternalVMContext());
  const $ = (id) => dom.window.document.getElementById(id),
    event = (type) =>
      new dom.window.Event(type, { bubbles: true, cancelable: true });
  const submit = (id) =>
    $(id).dispatchEvent(
      new dom.window.SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: $(id).querySelector('[type="submit"]'),
      }),
    );
  assert.equal($("title").textContent, "Home");
  assert.equal($("review").hidden, false);
  $("measure").click();
  await until(() => $("diff-result").textContent.includes("100.000% changed"));
  $("mask-width").value = "1";
  $("mask-height").value = "1";
  $("add-mask").click();
  $("measure").click();
  await until(() => $("diff-result").textContent.includes("1 masked"));
  $("evidence-kind").value = "behavior";
  $("evidence-outcome").value = "pass";
  $("evidence-assertion").value = "Escape closes dialog";
  $("evidence-procedure").value = "Press Escape";
  $("evidence-observation").value = "Dialog closed";
  submit("evidence-form");
  await until(() =>
    $("evidence-list").textContent.includes("Escape closes dialog"),
  );
  assert.match($("evidence-list").textContent, /Reported pass/);
  assert.match($("evidence-list").textContent, /not been assessed/);
  $("note-capture").value = pr.id;
  $("note-text").value = "Align title";
  submit("note-form");
  await until(() => $("notes").textContent.includes("Align title"));
  $("approve").click();
  await until(() => $("approve").hidden);
  assert.equal(store.getScreen("ui/home").targets[0].capture, target.id);
  $("next").click();
  await until(() => $("title").textContent === "Missing");
  assert.equal($("measure").disabled, true);
  assert.match($("comparison").textContent, /No pr capture/);
  $("previous").click();
  await until(() => $("title").textContent === "Home");
  assert.match($("diff-result").textContent, /100.000% changed/);
  $("search").value = "Missing";
  $("search").dispatchEvent(event("input"));
  assert.equal($("screens").querySelectorAll("button").length, 1);
  assert.equal(store.listEvidence({ screen: "ui/home" }).length, 1);
});
