import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { Store } from "../../src/store.mjs";
import { makeServer } from "../../src/server.mjs";
import { startAutomation } from "../../src/automation.mjs";

const execute = promisify(execFile);
const cli = resolve("src/cli.mjs");
const read = file => JSON.parse(readFileSync(file, "utf8"));
const write = (file, value) => writeFileSync(file, JSON.stringify(value));

async function command(data, args, interrupt = false) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [cli, ...args, "--data", data], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", interrupted = false;
    child.stdout.on("data", bytes => { stdout += bytes; });
    child.stderr.on("data", bytes => {
      stderr += bytes;
      if (interrupt && !interrupted && stderr.includes('"type":"capture.completed"')) {
        interrupted = true;
        child.kill("SIGINT");
      }
    });
    child.on("error", reject);
    child.on("close", code => {
      try { resolveResult({ code, stdout, stderr, value: stdout.trim() ? JSON.parse(stdout) : null, interrupted }); }
      catch (error) { reject(Error(`${error.message}\n${stdout}\n${stderr}`)); }
    });
  });
}

test("automatic CLI drafts, captures, resets fixtures, resumes failures and interruption, and opens review", async ({ page }, info) => {
  const temp = mkdtempSync(join(tmpdir(), "screens-auto-e2e-"));
  const app = join(temp, "app"), data = join(temp, "registry"), planFile = join(temp, "plan.json");
  const gateFile = join(temp, "gate.json");
  let store, server, automation;
  try {
    mkdirSync(join(app, "src"), { recursive: true });
    write(join(app, "package.json"), { name: "automatic-fixture", type: "module", dependencies: { react: "19.3.1" }, scripts: { dev: "node server.mjs", "mock-server": "node api.mjs" } });
    writeFileSync(join(app, "src/routes.jsx"), `import { createBrowserRouter } from "react-router-dom";
const HomePage = () => <main>Home</main>;
export const router = createBrowserRouter([{ path: "/", element: <HomePage /> }, { path: "/projects/:projectId", element: <HomePage /> }, { path: "/blocked", element: <HomePage /> }]);`);
    writeFileSync(join(app, "src/ReusableView.jsx"), 'export function ReusableView() { return <section>Reusable layout</section>; }');
    writeFileSync(join(app, "api.mjs"), `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
let count = 0;
createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/health") return res.end("{}");
  if (req.url === "/login") return res.end(JSON.stringify({ token: "fixture-session" }));
  if (req.headers.authorization !== "Bearer fixture-session") { res.writeHead(401); return res.end("{}"); }
  if (req.url === "/reset") count = 0;
  if (req.url === "/increment") count++;
  if (req.url === "/records") return res.end(JSON.stringify({ items: [{ id: "record-7" }] }));
  res.end(JSON.stringify({ count, block: JSON.parse(readFileSync(process.env.GATE_FILE)).block }));
}).listen(Number(process.env.PORT), "127.0.0.1");`);
    writeFileSync(join(app, "server.mjs"), `import { createServer } from "node:http";
if (!process.env.CAPTURE_REQUIRED) throw Error("CAPTURE_REQUIRED is required");
createServer(async (req, res) => {
  if (req.url === "/health") return res.end("ready");
  if (req.headers.authorization !== "Bearer fixture-session") { res.writeHead(401); return res.end("Login required"); }
  const endpoint = req.url === "/increment" ? "/increment" : "/state";
  const response = await fetch(process.env.API_URL + endpoint, { headers: { authorization: req.headers.authorization } });
  const state = await response.json();
  if (endpoint === "/increment") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(state)); }
  res.setHeader("content-type", "text/html");
  res.end('<!doctype html><html lang="en"><head><title>Automatic fixture</title></head><body><main><h1>' + req.url + '</h1><p id="count">Count ' + state.count + '</p><button id="increment">Increment</button></main><script>const request = window.__SCREENS_CAPTURE_REQUEST__; function ready() { window.__SCREENS_CAPTURE__ = {...request, state: "ready", pending: 0}; } if (!' + (req.url === "/blocked" && state.block) + ') ready(); document.querySelector("button").onclick = async () => { window.__SCREENS_CAPTURE__ = {...request, state: "loading", pending: 1}; const value = await (await fetch("/increment")).json(); document.querySelector("#count").textContent = "Count " + value.count; ready(); }; </script></body></html>');
}).listen(Number(process.env.PORT), "127.0.0.1");`);
    write(join(app, "capture-scenarios.json"), [
      { key: "home", title: "Home", path: "/" },
      { key: "changed", title: "Changed record", path: "/", steps: [{ action: "click", selector: "#increment" }], ready: { text: "Count 1" } },
      { key: "project", title: "Project", path: "/projects/:projectId", fixtureSource: "projects" },
      { key: "blocked", title: "Blocked screen", path: "/blocked" },
    ]);
    write(gateFile, { block: true });
    await execute("git", ["init", "--quiet", app]);
    const draftResult = await command(data, ["capture-draft", app, "--output", planFile]);
    expect(draftResult.code, draftResult.stderr).toBe(0);
    const plan = read(planFile);
    expect(plan.decisions.some(item => item.blocking && item.kind === "startup")).toBe(true);
    expect(plan.decisions.some(item => item.blocking && item.kind === "service")).toBe(true);
    expect(plan.discovery.backlog.some(item => item.name === "ReusableView")).toBe(true);
    plan.configuration.env = { GATE_FILE: gateFile };
    plan.configuration.services[0].ready.url = "{services.service-1.url}/health";
    const recipe = plan.configuration.applications[0];
    Object.assign(recipe, {
      fixture: "auto-fixture-v1", serve: [process.execPath, "server.mjs"], readyPath: "/health",
      env: { API_URL: "{services.service-1.url}" },
      auth: { request: { url: "{services.service-1.url}/login" }, token: { path: "token" } },
      ready: { contract: { required: true }, timeoutMs: 600 },
      scenarioImports: [{ file: "capture-scenarios.json" }],
      fixtureSources: [{ name: "projects", url: "{services.service-1.url}/records", records: "items", params: { projectId: "id" } }],
      fixtures: { version: "auto-fixture-v1", scope: "scenario", reset: [[process.execPath, "-e", 'const r=await fetch(process.env.API_URL+"/reset",{headers:{authorization:"Bearer fixture-session"}});if(!r.ok)process.exit(1)']] },
      variants: [
        { device: "desktop", width: 1280, height: 900, browser: "chromium" },
        { device: "tablet", width: 820, height: 1180, browser: "firefox" },
        { device: "phone", width: 390, height: 844, browser: "webkit" },
      ],
      evidence: { dom: true, console: true, network: true },
    });
    write(planFile, plan);
    const missing = await command(data, ["capture-auto", app, "--plan", planFile, "--format", "json"]);
    expect(missing.code).toBe(1);
    expect(missing.value, missing.stderr).not.toBeNull();
    expect(missing.value.error).toContain("CAPTURE_REQUIRED");
    expect(missing.value.environment.services).toHaveLength(0);
    plan.configuration.env.CAPTURE_REQUIRED = "fixture-only";
    write(planFile, plan);
    const initial = await command(data, ["capture-auto", app, "--plan", planFile, "--format", "json"]);
    expect(initial.code, initial.stderr).toBe(1);
    expect(initial.value.status).toBe("partial");
    expect(initial.value.run.captureIds).toHaveLength(12);
    expect(initial.value.scenarios.filter(item => item.readiness.status === "failed")).toHaveLength(3);
    write(gateFile, { block: false });
    const resumed = await command(data, ["capture-auto", "--resume", initial.value.job, "--format", "json"]);
    expect(resumed.code, JSON.stringify(resumed.value)).toBe(0);
    const report = resumed.value;
    expect(report.summary.reused).toBe(9);
    expect(report.coverage.complete).toBe(true);
    expect(report.coverage.metrics.variants).toMatchObject({ total: 12, captured: 12, ready: 12 });
    expect(report.coverage.backlog.some(item => item.name === "ReusableView" && item.required === false)).toBe(true);
    expect(report.decisions.some(item => item.blocking)).toBe(false);
    expect(report.scenarios.every(item => item.readiness.status === "passed")).toBe(true);
    expect(report.scenarios.some(item => item.key.startsWith("scenario-") && item.captureId)).toBe(true);
    expect(report.applications[0].fixtureEvents.filter(item => item.phase === "reset")).toHaveLength(12);
    expect(new Set(report.coverage.requirements.filter(item => item.kind === "recipe").map(item => item.variant.browser))).toEqual(new Set(["chromium", "firefox", "webkit"]));
    for (const service of report.environment.services) {
      expect(service.stopped).toBe(true);
      await expect(fetch(service.url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    }
    store = new Store(data);
    const captures = report.run.captureIds.map(id => store.getCapture(id));
    expect(captures.some(item => item.screen.endsWith("/home"))).toBe(true);
    for (const capture of captures) {
      const rows = store.db.prepare("SELECT data FROM derived_evidence WHERE capture=?").all(capture.id).map(row => JSON.parse(row.data));
      const dom = rows.find(row => row.kind === "dom");
      expect(dom).toBeDefined();
      expect(dom.data.html).toContain(capture.screen.endsWith("/changed") ? "Count 1" : "Count 0");
      if (capture.screen.includes("/scenario-")) expect(dom.data.url).toContain("/projects/record-7");
    }
    server = makeServer(store);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await page.goto(`http://127.0.0.1:${server.address().port}/?project=${report.project.id}&run=${report.run.id}`);
    await expect(page.locator("#title")).toBeVisible();
    await expect(page.locator(".capture-image").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("automatic-review.png"), fullPage: true });
    const interrupted = await command(data, ["capture-auto", app, "--plan", planFile, "--format", "json"], true);
    expect(interrupted.interrupted).toBe(true);
    expect(interrupted.code).not.toBe(0);
    const job = await command(data, ["jobs-get", "--id", interrupted.value.job]);
    expect(job.value.status).toBe("cancelled");
    const recovered = await command(data, ["capture-auto", "--resume", interrupted.value.job, "--format", "json"]);
    expect(recovered.code, JSON.stringify(recovered.value)).toBe(0);
    expect(recovered.value.summary.reused).toBeGreaterThan(0);
    expect(recovered.value.run.captureIds).toHaveLength(12);
    const queued = await command(data, ["capture-auto", app, "--plan", planFile, "--screens", '["home"]', "--queue", "yes", "--format", "json"]);
    expect(queued.code, queued.stderr).toBe(0);
    expect(queued.value.status).toBe("queued");
    automation = startAutomation(store, {});
    let queuedJob;
    await expect.poll(async () => {
      const response = await page.request.post(`http://127.0.0.1:${server.address().port}/api/automation/jobs-get`, { data: { id: queued.value.job } });
      expect(response.status()).toBe(200);
      queuedJob = await response.json();
      return queuedJob.status;
    }, { timeout: 30000 }).toBe("completed");
    expect(queuedJob.captures).toHaveLength(3);
    expect(queuedJob.captures.every(id => store.getCapture(id).screen.endsWith("/home"))).toBe(true);
    await automation.stop(); automation = null;
    writeFileSync(info.outputPath("automatic-proof.json"), JSON.stringify({
      status: "passed", initial: initial.value, resumed: report, interrupted: interrupted.value,
      recovered: recovered.value, queued: queuedJob,
      scope: "Local browser fixture: actual CLI, managed service, auth, reset, dynamic routes, three engines and devices, failure/cancellation resume, registry and review UI. No native or live-account claim.",
    }, null, 2));
  } finally {
    await automation?.stop();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    store?.close();
    rmSync(temp, { recursive: true, force: true });
  }
});
