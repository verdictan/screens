import { JSDOM } from "jsdom";
import { Script } from "node:vm";
import { takeCoverage } from "node:v8";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { fixture } from "./registry.mjs";
import { requestHandler } from "../../src/server.mjs";
export function browserDOM(w) {
  w.matchMedia = (media) => ({ media, matches: media.includes("prefers-reduced-motion"), addEventListener() {}, removeEventListener() {} });
  w.Element.prototype.scrollIntoView = () => {};
  w.Element.prototype.checkVisibility = function () { return !this.closest('[hidden], [inert], [data-state="closed"], [data-state="inactive"]'); };
  w.HTMLCanvasElement.prototype.getContext = () => ({ putImageData() {} });
  w.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
}
export async function until(fn, message = "UI did not settle") {
  for (let i = 0; i < 5000; i++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw Error(message);
}
export async function ui(
  t,
  { seed, respond, configure, url = "http://127.0.0.1:4800" } = {},
) {
  const f = await fixture(t);
  const state = seed ? await seed(f) : {};
  const html = readFileSync("dist/ui/index.html", "utf8");
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window,
    doc = w.document,
    handler = requestHandler(f.store, () => 4800),
    requests = [];
  const response = async (path, options = {}) => {
    const req = Readable.from([Buffer.from(options.body || "")]);
    Object.assign(req, {
      url: path,
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
  w.fetch = async (path, options = {}) => {
    requests.push([path, options]);
    return respond ? respond(path, options, response) : response(path, options);
  };
  browserDOM(w);
  w.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  configure?.(w);
  const path = "dist/ui" + html.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  new Script(readFileSync(path, "utf8"), {
    filename: resolve(path),
  }).runInContext(dom.getInternalVMContext());
  t.after(() => {
    takeCoverage();
    dom.window.close();
  });
  const $ = (selector) => doc.querySelector(selector),
    all = (selector) => [...doc.querySelectorAll(selector)];
  const button = (text) =>
    all("button").find(
      (x) =>
        x.textContent.trim() === text || x.getAttribute("aria-label") === text,
    );
  const change = async (selector, value) => {
    const e = typeof selector === "string" ? $(selector) : selector;
    assert.ok(e, `Missing ${selector}`);
    const prototype =
      e.tagName === "SELECT"
        ? w.HTMLSelectElement.prototype
        : e.tagName === "TEXTAREA"
          ? w.HTMLTextAreaElement.prototype
          : w.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(
      e,
      String(value),
    );
    e.dispatchEvent(
      new w.Event(e.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
  };
  const tab = async (name) => {
    const node = all("[role=tab]").find((e) => e.textContent.startsWith(name));
    assert.ok(node);
    node.dispatchEvent(
      new w.MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    node.click();
    await until(() => node.dataset.state === "active");
  };
  const click = async (text) => {
    const b = button(text);
    assert.ok(b, `Missing button ${text}`);
    b.click();
    await new Promise((r) => setTimeout(r, 5));
  };
  const submit = (selector) =>
    $(selector).dispatchEvent(
      new w.SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
  const image = (img, width = 200, height = 200) => {
    Object.defineProperties(img, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
    img.dispatchEvent(new w.Event("load"));
  };
  return {
    ...f,
    ...state,
    w,
    doc,
    $,
    all,
    button,
    change,
    tab,
    click,
    submit,
    image,
    requests,
  };
}
export async function seedReview(
  f,
  {
    roles = ["current", "target", "pr"],
    fixture = "seed",
    notes = true,
    extra = true,
  } = {},
) {
  const captures = Object.fromEntries(
    roles.map((role) => [role, f.capture({ role, fixture, revision: role })]),
  );
  if (extra) {
    f.store.screen({
      project: "demo",
      key: "second",
      title: "Second",
      group: "Other",
    });
    f.store.screen({ project: "demo", key: "uncovered", title: "Uncovered" });
  }
  const second = extra
    ? f.store.capture({ screen: "demo/second", role: "target", bytes: f.bytes })
    : null;
  if (notes) {
    const first = Object.values(captures)[0];
    f.store.addNote({
      capture: first.id,
      text: "Pinned feedback",
      point: { x: 0.25, y: 0.5 },
    });
  }
  const run = f.store.run({
    project: "demo",
    title: "Review",
    captureIds: [
      ...Object.values(captures).map((c) => c.id),
      ...(second ? [second.id] : []),
    ],
    warnings: ["Imported fixture"],
    source: { number: 123 },
  });
  return { captures, run };
}
