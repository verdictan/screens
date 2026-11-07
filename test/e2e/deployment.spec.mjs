import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const base = process.env.SCREENS_DEPLOYMENT_URL;
const phase = process.env.SCREENS_PROOF_PHASE;
test.skip(!base || !["deployment", "restart"].includes(phase), "Run with scripts/prove-workflow.sh");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("production container: compare, annotate, MCP fix, review, evidence and persistence", async ({ page, request }, info) => {
  // This suite is intentionally restricted to the disposable registry created by
  // compose.proof.yaml. It never opens the user's deployed registry or database.
  expect(base).toBe("http://127.0.0.1:4900");
  const fixture = JSON.parse(readFileSync("test-results/captured-fixture.json", "utf8"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function api(path, data) {
    const response = data === undefined
      ? await request.get(base + path)
      : await request.post(base + path, { data });
    expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
    return response.json();
  }
  async function rpc(method, params) {
    const response = await api("/mcp", { jsonrpc: "2.0", id: 1, method, params });
    expect(response.error).toBeUndefined();
    expect(response.result.isError).not.toBe(true);
    return response.result;
  }
  async function call(name, args) {
    const result = await rpc("tools/call", { name, arguments: args });
    return JSON.parse(result.content[0].text);
  }
  const screenId = "workflow-proof/overview";
  const detail = () => api(`/api/screen?id=${encodeURIComponent(screenId)}`);
  const compare = (run) => api(`/api/compare?run=${run}`);
  const current = fixture.captures.find((c) => c.role === "current");
  const target = fixture.captures.find((c) => c.role === "target");
  const bad = fixture.captures.find((c) => c.id === fixture.proof.originalCapture);
  const fixed = fixture.captures.find((c) => c.id === fixture.proof.fixedCapture);
  expect(fixture.proof.initialChangedPixels).toBeGreaterThan(0);
  expect(fixture.proof.finalChangedPixels).toBe(0);

  if (phase === "restart") {
    const before = JSON.parse(readFileSync("test-results/deployment-proof.json", "utf8"));
    await page.goto(`${base}/?project=workflow-proof&run=${before.fixedRun}`);
    await expect(page.locator("#title")).toHaveText("Project overview");
    await expect(page.getByText("Target approved", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: /Feedback/ }).click();
    await expect(page.locator("#notes")).toContainText("verified");
    await expect(page.getByRole("link", { name: /Earlier capture/ }))
      .toHaveAttribute("href", `/api/captures/${bad.id}/image`);
    const persisted = await detail();
    expect(persisted.notes.find((n) => n.id === before.note.id)).toEqual(before.note);
    expect(persisted.targets.find((t) => t.capture === target.id)).toBeTruthy();
    expect(persisted.evidence.find((e) => e.id === before.evidence.id)).toEqual(before.evidence);
    const measurements = (await compare(before.fixedRun)).entries[0].measurements;
    expect(measurements.find((m) => m.id === before.finalDiff.id)).toEqual(before.finalDiff);
    for (const capture of fixture.captures) {
      const response = await request.get(base + capture.url);
      expect(response.ok()).toBe(true);
      expect(hash(await response.body())).toBe(capture.hash);
    }
    const artifact = await request.get(`${base}/api/evidence/${before.evidence.id}/artifact`);
    expect(artifact.ok()).toBe(true);
    expect(await artifact.json()).toEqual(fixture.report);
    await page.getByRole("tab", { name: /Evidence/ }).click();
    await expect(page.getByText(fixture.evidence.assertion, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("evidence-after-container-restart.png"), fullPage: true });
    expect(errors).toEqual([]);
    writeFileSync("test-results/restart-proof.json", JSON.stringify({
      passed: true, testedAt: new Date().toISOString(),
      note: before.note.id, target: target.id, evidence: before.evidence.id,
      capturesVerifiedByHash: fixture.captures.map((c) => c.id),
      diff: before.finalDiff.id,
      scope: "Browser/API verification after the production container was restarted by the proof runner.",
    }, null, 2));
    return;
  }

  // Refuse to exercise the mutation/approval test against a populated service.
  expect(await api("/api/projects")).toEqual([]);
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-03-26", capabilities: {},
    clientInfo: { name: "screens-docker-proof", version: "1" },
  });
  expect(initialized.serverInfo.name).toBe("verdictan-screens");
  const names = (await rpc("tools/list")).tools.map((t) => t.name);
  expect(names).toContain("reviews_submit_fix");
  expect(names.some((name) => /verify|approve/.test(name))).toBe(false);
  await api("/api/projects", { id: "workflow-proof", name: "Docker workflow proof" });
  await call("screens_register", { project: "workflow-proof", key: "overview", title: "Project overview" });
  for (const capture of fixture.captures) {
    const registered = await call("captures_register", {
      screen: screenId, role: capture.role, variant: capture.variant,
      revision: capture.revision, fixture: capture.fixture,
      provenance: capture.provenance, imageBase64: capture.imageBase64,
    });
    expect(registered.id).toBe(capture.id);
  }
  const run = await api("/api/runs", {
    project: "workflow-proof", title: "Production container regression review",
    captureIds: [current.id, target.id, bad.id],
  });
  await page.goto(`${base}/?project=workflow-proof&run=${run.id}`);
  await expect(page.locator("#title")).toHaveText("Project overview");
  const image = page.getByRole("img", { name: "Project overview — PR result", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Measure selected pair" }).click();
  await expect(page.locator("#diff-result")).toContainText("% changed");
  const initialDiff = (await compare(run.id)).entries[0].measurements[0];
  expect(initialDiff.changedPixels).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath("production-regression.png"), fullPage: true });
  await image.click({ position: { x: 40, y: 50 } });
  await page.getByLabel("Feedback", { exact: true }).fill("Restore the button width to the approved design.");
  await page.getByRole("button", { name: "Add feedback", exact: true }).click();
  await expect(page.locator("#notes")).toContainText("Restore the button width");
  const note = (await detail()).notes[0];
  expect(note.capture).toBe(bad.id);
  expect(note.point.x).toBeGreaterThan(0);
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await page.getByRole("button", { name: "Approve this target" }).click();
  await expect(page.getByText("Target approved", { exact: true })).toBeVisible();
  const conflict = await request.post(base + "/api/targets/approve", {
    data: { capture: target.id, expectedRevision: 0 },
  });
  expect(conflict.status()).toBe(409);
  const submitted = await call("reviews_submit_fix", {
    id: note.id, expectedRevision: note.revision, evidence: fixed.id,
    resolution: "Restored button padding; attached a fresh capture of the fixed Git revision.",
  });
  expect(submitted.status).toBe("submitted");
  const fixedRun = await api("/api/runs", {
    project: "workflow-proof", title: "Production container fixed result",
    captureIds: [current.id, target.id, fixed.id],
  });
  await page.goto(`${base}/?project=workflow-proof&run=${fixedRun.id}`);
  await page.getByRole("tab", { name: /Feedback/ }).click();
  await expect(page.getByRole("link", { name: /Earlier capture/ }))
    .toHaveAttribute("href", `/api/captures/${bad.id}/image`);
  await page.getByRole("button", { name: "Verify fix" }).click();
  await expect(page.locator("#notes")).toContainText("verified");
  const evidence = await call("evidence_add", { ...fixture.evidence, capture: fixed.id });
  expect(evidence.sourceRevision).toBe(fixture.proof.fixedSha);
  await page.reload();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText(fixture.evidence.assertion, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Compare", exact: true }).click();
  await page.getByRole("button", { name: "Measure selected pair" }).click();
  await expect(page.locator("#diff-result")).toContainText("0.000% changed");
  const finalDiff = (await compare(fixedRun.id)).entries[0].measurements[0];
  expect(finalDiff.changedPixels).toBe(0);
  await page.screenshot({ path: info.outputPath("production-fixed.png"), fullPage: true });
  expect(errors).toEqual([]);
  writeFileSync("test-results/deployment-proof.json", JSON.stringify({
    passed: true, testedAt: new Date().toISOString(),
    run: run.id, fixedRun: fixedRun.id, note: (await detail()).notes[0],
    target: target.id, evidence, initialDiff, finalDiff,
    scope: "Real production image and HTTP MCP; fixture captures generated by the earlier workflow phase. UI approval is automated test behavior, not user acceptance.",
  }, null, 2));
});
