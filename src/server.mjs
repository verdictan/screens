import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { protocol } from "./mcp.mjs";
import { Fault, requireThat } from "./validation.mjs";
import { createDiff } from "./diff.mjs";

async function body(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    requireThat(length <= 36 * 1024 * 1024, "Request too large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new Fault(400, "Invalid JSON");
  }
}
const publicFiles = new Map([
  ["/", "index.html"],
  ["/app.js", "app.js"],
  ["/style.css", "style.css"],
]);
export function requestHandler(store, getPort) {
  const rpc = protocol(store);
  return async (req, res) => {
    const send = (status, data, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      const port = getPort();
      requireThat(
        [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host),
        "Invalid Host",
        403,
      );
      const origin = req.headers.origin;
      requireThat(
        !origin ||
          [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(
            origin,
          ),
        "Origin not allowed",
        403,
      );
      const url = new URL(req.url, `http://${req.headers.host}`),
        path = url.pathname;
      if (path === "/mcp") {
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return send(405, {
            error: "Use POST; server-initiated SSE is not supported",
          });
        }
        requireThat(
          req.headers["content-type"]?.startsWith("application/json"),
          "Expected application/json",
          415,
        );
        let input;
        try {
          input = await body(req);
        } catch (e) {
          if (e.status === 400)
            return send(400, {
              jsonrpc: "2.0",
              id: null,
              error: { code: -32700, message: "Parse error" },
            });
          throw e;
        }
        const result = await rpc(input);
        if (result === null) {
          res.writeHead(202);
          return res.end();
        }
        return send(200, result);
      }
      if (req.method === "GET") {
        if (publicFiles.has(path)) {
          const filename = publicFiles.get(path),
            bytes = readFileSync(
              fileURLToPath(new URL(`../public/${filename}`, import.meta.url)),
            );
          return send(
            200,
            bytes,
            filename.endsWith(".html")
              ? "text/html; charset=utf-8"
              : filename.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "text/css; charset=utf-8",
          );
        }
        if (path === "/api/health")
          return send(200, { ok: true, version: "0.2.0" });
        if (path === "/api/projects") return send(200, store.projects());
        if (path === "/api/screens")
          return send(
            200,
            store.search({
              project: url.searchParams.get("project") || undefined,
              query: url.searchParams.get("q") || "",
            }),
          );
        if (path === "/api/screen")
          return send(200, store.getScreen(url.searchParams.get("id")));
        if (path === "/api/runs")
          return send(200, store.runs(url.searchParams.get("project")));
        if (path === "/api/compare")
          return send(200, store.compare(url.searchParams.get("run")));
        if (path === "/api/evidence")
          return send(
            200,
            store.listEvidence({
              capture: url.searchParams.get("capture"),
              screen: url.searchParams.get("screen"),
            }),
          );
        const diff = path.match(/^\/api\/diffs\/([a-f0-9]{64})(\/image)?$/);
        if (diff)
          return diff[2]
            ? send(200, store.diffImage(diff[1]), "image/png")
            : send(200, store.getDiff(diff[1]));
        const artifact = path.match(
          /^\/api\/evidence\/([a-f0-9-]{36})\/artifact$/,
        );
        if (artifact) {
          const result = store.evidenceArtifact(artifact[1]);
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="evidence"',
          );
          return send(200, result.bytes, result.artifact.mimeType);
        }
        const match = path.match(/^\/api\/captures\/([a-f0-9]{64})\/image$/);
        if (match) {
          const { capture, bytes } = store.image(match[1]);
          return send(200, bytes, capture.mimeType);
        }
      }
      if (req.method === "POST" && path.startsWith("/api/")) {
        requireThat(
          req.headers["content-type"]?.startsWith("application/json"),
          "Expected application/json",
          415,
        );
        const input = await body(req);
        if (path === "/api/diffs")
          return send(201, await createDiff(store, input));
        if (path === "/api/evidence")
          return send(201, store.addEvidence(input));
        if (path === "/api/notes") return send(201, store.addNote(input));
        if (path === "/api/notes/update")
          return send(200, store.updateNote(input, { human: true }));
        if (path === "/api/targets/approve")
          return send(200, store.approveTarget(input));
        if (path === "/api/projects") return send(201, store.project(input));
        if (path === "/api/screens") return send(201, store.screen(input));
        if (path === "/api/captures") return send(201, store.capture(input));
        if (path === "/api/runs") return send(201, store.run(input));
      }
      send(404, { error: "Not found" });
    } catch (e) {
      send(e.status || 500, { error: e.status ? e.message : "Internal error" });
      if (!e.status) console.error(e);
    }
  };
}
export function makeServer(store) {
  const server = createServer(
    requestHandler(store, () => server.address()?.port),
  );
  server.requestTimeout = 30000;
  return server;
}
