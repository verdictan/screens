import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import * as fs from "node:fs";
import { fixture } from "./support/registry.mjs";
import { requestHandler } from "../src/server.mjs";
import { moduleUnderTest } from "./support/module.mjs";
function requests(handler) {
  return async (url, body, headers = {}) => {
    const req = Readable.from([
      Buffer.isBuffer(body)
        ? body
        : Buffer.from(
            typeof body === "string"
              ? body
              : body === undefined
                ? ""
                : JSON.stringify(body),
          ),
    ]);
    Object.assign(req, {
      url,
      method: body === undefined ? "GET" : "POST",
      headers: {
        host: "localhost:4800",
        "content-type": "application/json",
        origin: "http://localhost:4800",
        ...headers,
      },
    });
    const res = {
      status: 0,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      writeHead(s, h) {
        this.status = s;
        Object.assign(this.headers, h);
      },
      end(body) {
        this.body = body;
      },
    };
    await handler(req, res);
    return res;
  };
}
test("HTTP exposes every registry route, assets, errors and body limits", async (t) => {
  const { store, bytes, capture } = await fixture(t);
  const request = requests(requestHandler(store, () => 4800));
  let r = await request("/");
  const html = r.body.toString();
  for (const asset of [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]) {
    r = await request(asset[1]);
    assert.equal(r.status, 200);
    assert.match(r.headers["content-type"], /javascript|css/);
  }
  assert.equal((await request("/assets/missing.js")).status, 404);
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/api/screens")).status, 200);
  assert.equal(
    JSON.parse((await request("/api/screens?project=demo&q=Home")).body).length,
    1,
  );
  assert.equal(
    (
      await request("/api/screens", {
        project: "demo",
        key: "other",
        title: "Other",
      })
    ).status,
    201,
  );
  const a = capture();
  const b = JSON.parse(
    (
      await request("/api/captures", {
        screen: a.screen,
        role: "pr",
        imageBase64: bytes.toString("base64"),
      })
    ).body,
  );
  r = await request("/api/runs", {
    project: "demo",
    title: "HTTP",
    captureIds: [a.id, b.id],
  });
  assert.equal(r.status, 201);
  const run = JSON.parse(r.body);
  assert.equal((await request("/api/runs?project=demo")).status, 200);
  assert.equal((await request("/api/compare?run=" + run.id)).status, 200);
  assert.equal((await request("/api/screen?id=demo%2Fhome")).status, 200);
  assert.equal((await request(a.url)).status, 200);
  const diff = JSON.parse(
    (await request("/api/diffs", { left: a.id, right: b.id })).body,
  );
  assert.equal((await request("/api/diffs/" + diff.id)).status, 200);
  assert.equal((await request(diff.url)).status, 200);
  assert.deepEqual(
    JSON.parse((await request("/api/evidence?capture=" + a.id)).body),
    [],
  );
  assert.deepEqual(
    JSON.parse((await request("/api/evidence?screen=demo%2Fhome")).body),
    [],
  );
  assert.equal((await request("/api/projects", "{")).status, 400);
  assert.equal(
    (
      await request("/api/notes/update", {
        id: "missing",
        expectedRevision: 1,
        status: "open",
      })
    ).status,
    404,
  );
  assert.equal((await request("/api/unknown", {})).status, 404);
  assert.equal(
    (await request("/mcp", {}, { "content-type": undefined })).status,
    415,
  );
  assert.equal(
    (await request("/api/projects", {}, { "content-type": undefined })).status,
    415,
  );
  const large = Buffer.alloc(36 * 1024 * 1024 + 1);
  for (const path of ["/mcp", "/api/projects"])
    assert.equal((await request(path, large)).status, 413);
  const original = console.error;
  t.mock.method(console, "error", () => {});
  store.projects = () => {
    throw Error("private database failure");
  };
  r = await request("/api/projects");
  assert.equal(r.status, 500);
  assert.equal(JSON.parse(r.body).error, "Internal error");
});
test("HTTP reports missing production bundle without serving a substitute", async (t) => {
  const { store } = await fixture(t);
  const r = await moduleUnderTest("src/server.mjs", {
    mocks: { "node:fs": { ...fs, existsSync: () => false } },
  });
  const response = await requests(r.exports.requestHandler(store, () => 4800))(
    "/",
  );
  assert.equal(response.status, 503);
  assert.match(JSON.parse(response.body).error, /Frontend is not built/);
});
