// Run separately on a host that permits loopback sockets: npm run test:integration.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { Store } from "../src/store.mjs";
import { makeServer } from "../src/server.mjs";
test("live HTTP server and stdio HTTP bridge", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "screens-network-")),
    store = new Store(dir),
    server = makeServer(store);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + "/api/health")).json()).ok, true);
  const child = spawn(process.execPath, ["src/cli.mjs", "mcp", "--url", base]);
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stdin.end(
    JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }) + "\n",
  );
  const [code] = await once(child, "close");
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).id, 9);
});
