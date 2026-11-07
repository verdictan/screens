import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { once } from "node:events";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { Store } from "../src/store.mjs";
import { requestHandler } from "../src/server.mjs";

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "screens-http-")),
    store = new Store(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const handler = requestHandler(store, () => 4800);
  const request = async (
    url,
    { method = "GET", body = "", headers = {} } = {},
  ) => {
    const req = Readable.from([Buffer.from(body)]);
    Object.assign(req, {
      url,
      method,
      headers: { host: "127.0.0.1:4800", ...headers },
    });
    const res = {
      status: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      writeHead(status, hs = {}) {
        this.status = status;
        Object.assign(this.headers, hs);
      },
      end(data) {
        this.body = data ? data.toString() : "";
      },
    };
    await handler(req, res);
    return res;
  };
  return { store, dir, request };
}
test("HTTP routes, origin and host checks, static delivery and mutations", async (t) => {
  const { request } = setup(t),
    html = await request("/");
  assert.match(html.body, /id="root"/);
  assert.match(
    html.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.equal(
    (
      await request("/api/projects", {
        headers: { origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/projects", { headers: { host: "evil.example:4800" } }))
      .status,
    403,
  );
  assert.equal(
    (
      await request("/api/projects", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await request("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "test", name: "Test" }),
      })
    ).status,
    201,
  );
  assert.equal(JSON.parse((await request("/api/projects")).body)[0].id, "test");
  assert.equal((await request("/missing")).status, 404);
});
test("JSON evidence downloads preserve the original file bytes", async (t) => {
  const { store, request } = setup(t);
  store.project({ id: "download", name: "Download" });
  store.screen({ project: "download", key: "home", title: "Home" });
  const bytes = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  }).png().toBuffer();
  const capture = store.capture({ screen: "download/home", role: "pr", bytes });
  const report = '{\n  "outcome": "pass", "observation": "Focus restored"\n}\n';
  const evidence = store.addEvidence({
    capture: capture.id,
    kind: "behavior",
    method: "automated",
    outcome: "pass",
    assertion: "Closing the dialog restores focus",
    procedure: "Close the dialog and inspect focus",
    observation: "Focus restored",
    author: "HTTP test",
    artifactType: "application/json",
    artifactBase64: Buffer.from(report).toString("base64"),
  });
  const response = await request(evidence.artifact.url);
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.match(response.headers["content-disposition"], /^attachment;/);
  assert.equal(response.body, report);
});
test("HTTP MCP initializes, accepts notifications and rejects malformed JSON", async (t) => {
  const { request } = setup(t),
    send = (message) =>
      request("/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
      });
  assert.equal(
    JSON.parse(
      (
        await send({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        })
      ).body,
    ).result.serverInfo.name,
    "verdictan-screens",
  );
  assert.equal(
    (await send({ jsonrpc: "2.0", method: "notifications/initialized" }))
      .status,
    202,
  );
  assert.equal((await request("/mcp")).status, 405);
  const bad = await request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).error.code, -32700);
});
test("direct stdio MCP works without a web server and shares persistent storage", async (t) => {
  const { dir } = setup(t);
  const child = spawn(process.execPath, ["src/cli.mjs", "mcp", "--data", dir], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let out = "",
    err = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (err += c));
  child.stdin.end(
    JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }) + "\n",
  );
  const [code] = await once(child, "close");
  assert.equal(code, 0, err);
  const reply = JSON.parse(out);
  assert.equal(reply.id, 7);
  assert.ok(reply.result.tools.length >= 8);
});
