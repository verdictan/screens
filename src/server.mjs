import { workflowCatalog } from "./workflows.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { protocol } from "./mcp.mjs";
import { Fault, requireThat } from "./validation.mjs";
import { actionCatalog, runHeadless } from "./headless.mjs";
import { mutate } from "./operations.mjs";
import { captureWorkspace, projectWorkspace, openWorkspace, captureProblems } from "./workspace.mjs";
import { prepareCaptures } from "./previews.mjs";

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
const uiRoot = fileURLToPath(new URL('../dist/ui/', import.meta.url));
export function requestHandler(store, getPort) {
  const rpc = protocol(store);
  const workspace = captureWorkspace(store);
  return async (req, res) => {
    const send = (status, data, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(
        (type === "application/json" || type === "application/speculationrules+json") && !Buffer.isBuffer(data)
          ? JSON.stringify(data)
          : data,
      );
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Speculation-Rules", '"/speculation-rules.json"');
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
        if (path === '/' || /^\/assets\/[a-zA-Z0-9_-]+\.(js|css)$/.test(path)) {
          const filename = path === '/' ? 'index.html' : path.slice(1);
          const file = `${uiRoot}${filename}`;
          requireThat(existsSync(file), path === '/' ? 'Frontend is not built. Run npm run build.' : 'Asset not found', path === '/' ? 503 : 404);
          return send(200, readFileSync(file), filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
        }
        if (path === "/speculation-rules.json")
          return send(200, { prerender: [{ source: "document", where: { and: [
            { href_matches: ["/", "/?*"] },
            { selector_matches: "a[data-review-link]" },
          ] }, eagerness: "moderate" }] }, "application/speculationrules+json");
        if (path === "/api/health")
          return send(200, { ok: true, version: "0.3.0" });
        if (path === "/api/workflows") return send(200, workflowCatalog());
        if (path === "/api/automation") return send(200, actionCatalog());
        if (path === "/api/workspace") return send(200, projectWorkspace(store, url.searchParams.get("project")));
        if (path === "/api/projects") return send(200, store.projects());
        if (path === "/api/screens")
          return send(
            200,
            store.search({
              project: url.searchParams.get("project") || undefined,
              query: url.searchParams.get("q") || "",
            }),
          );
        if (path === "/api/screen") {
          const id = url.searchParams.get("id");
          await prepareCaptures(store, store.getScreen(id).captures);
          return send(200, store.getScreen(id));
        }
        if (path === "/api/review-sets") return send(200, store.reviewSets(url.searchParams.get("run")));
        if (path === "/api/runs")
          return send(200, store.runs(url.searchParams.get("project")));
        if (path === "/api/compare") {
          const id = url.searchParams.get("run");
          await prepareCaptures(store, store.getRun(id).captureIds.map((capture) => store.getCapture(capture)));
          const comparison = store.compare(id);
          return send(200, { ...comparison, problems: captureProblems(comparison) });
        }
        if (path === "/api/evidence")
          return send(
            200,
            store.listEvidence({
              capture: url.searchParams.get("capture"),
              screen: url.searchParams.get("screen"),
            }),
          );
        const diff = path.match(/^\/api\/diffs\/([a-f0-9]{64})(\/image)?$/);
        if (diff) {
          return diff[2]
            ? send(200, store.diffImage(diff[1]), "image/png")
            : send(200, store.getDiff(diff[1]));
        }
        const artifact = path.match(
          /^\/api\/evidence\/([a-f0-9-]{36})\/artifact$/,
        );
        if (artifact) {
          const evidence = store.getEvidence(artifact[1]);
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
        if (path === "/api/workspace/upload") return send(201, await mutate(store, "capture.attach", input, req.headers["idempotency-key"]));
        if (path === "/api/workspace/prepare") return send(200, workspace.prepare(input));
        if (path === "/api/workspace/capture") return send(201, workspace.start(input, req.headers["idempotency-key"]));
        if (path === "/api/workspace/open") return send(200, store.once(req.headers["idempotency-key"], "workspace.open", input, () => openWorkspace(store, input)));
        const action = path.match(/^\/api\/automation\/([a-z0-9_-]+)$/);
        if (action) return send(200, await runHeadless(store, action[1], input));
        const operations = {
          "/api/diffs": ["diff", 201],
          "/api/review-sets": ["review-set", 200],
          "/api/evidence": ["evidence", 201],
          "/api/notes": ["note", 201],
          "/api/notes/update": ["note.update", 200],
          "/api/targets/approve": ["target", 200],
          "/api/projects": ["project", 201],
          "/api/screens": ["screen", 201],
          "/api/captures": ["capture", 201],
          "/api/runs": ["run", 201],
        };
        if (operations[path]) {
          const [operation, status] = operations[path];
          return send(status, await mutate(store, operation, input, req.headers["idempotency-key"]));
        }
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
