import { test, expect } from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { Store } from "../../src/store.mjs";
import { makeServer } from "../../src/server.mjs";
import { captureRevision, captureComparison } from "../../src/capture.mjs";

const root = resolve(".");
function node(args, input) {
  return execFileSync(process.execPath, args, {
    cwd: root,
    input,
    encoding: "utf8",
    timeout: 120000,
  });
}
function rpc(helper, method, params) {
  const response = JSON.parse(
    node(
      [helper, "mcp"],
      JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n",
    ),
  );
  expect(response.error).toBeUndefined();
  expect(response.result.isError).not.toBe(true);
  return response.result;
}
function call(helper, name, args) {
  return JSON.parse(
    rpc(helper, "tools/call", { name, arguments: args }).content[0].text,
  );
}

test("capture → skill load → compare → feedback → MCP fix → human verification → restart", async ({
  page,
}, info) => {
  const temp = mkdtempSync(join(tmpdir(), "screens-e2e-")),
    repo = join(temp, "application"),
    data = join(temp, "registry");
  mkdirSync(join(repo, "examples"), { recursive: true });
  cpSync("examples/proof-app", join(repo, "examples/proof-app"), {
    recursive: true,
  });
  const git = (...args) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init");
  git("config", "user.name", "Screens workflow fixture");
  git("config", "user.email", "fixture@example.invalid");
  const source = join(repo, "examples/proof-app/index.html"),
    good = readFileSync(source, "utf8");
  git("add", ".");
  git("commit", "-m", "Expected fixture");
  const base = git("rev-parse", "HEAD");
  writeFileSync(source, good.replace("padding:12px 20px", "padding:12px 70px"));
  git("add", ".");
  git("commit", "-m", "Deliberate button regression");
  const head = git("rev-parse", "HEAD");
  let store = new Store(data),
    server,
    port;
  const start = async () => {
    server = makeServer(store);
    server.listen(port || 0, "127.0.0.1");
    await once(server, "listening");
    port = server.address().port;
    return `http://127.0.0.1:${port}`;
  };
  const stop = async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      server = null;
    }
    store.close();
  };
  try {
    const options = {
      repo,
      config: resolve("examples/proof.capture.json"),
      execute: "yes",
    };
    const target = await captureRevision(store, {
      ...options,
      ref: base,
      role: "target",
      output: join(temp, "target"),
    });
    const captured = await captureComparison(store, {
      ...options,
      base,
      head,
      target: target.run.id,
      output: join(temp, "comparison"),
    });
    expect(git("status", "--porcelain")).toBe("");
    expect(git("rev-parse", "HEAD")).toBe(head);
    node([
      "scripts/install-skills.mjs",
      "--project",
      repo,
      "--client",
      "both",
      "--data",
      data,
    ]);
    const claude = join(repo, ".claude/skills/screens/scripts/screens.mjs"),
      codex = join(repo, ".agents/skills/screens/scripts/screens.mjs");
    for (const helper of [claude, codex]) {
      const loaded = JSON.parse(node([
        helper, "load", captured.pr.manifest, "--project", "workflow-proof",
      ]));
      expect(loaded.run.captureIds).toEqual(captured.pr.run.captureIds);
      expect(
        rpc(helper, "initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "e2e-protocol-client", version: "1" },
        }).serverInfo.name,
      ).toBe("verdictan-screens");
      const names = rpc(helper, "tools/list").tools.map((t) => t.name);
      expect(names).toContain("reviews_submit_fix");
      expect(names.some((n) => /approve|verify/.test(n))).toBe(false);
    }
    const entry = store.compare(captured.run.id).entries[0],
      bad = entry.captures.pr,
      expected = entry.captures.target;
    const baseUrl = await start(),
      url = `${baseUrl}/?project=workflow-proof&run=${captured.run.id}`;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await expect(page.locator("#title")).toHaveText("Project overview");
    await expect(
      page.getByRole("img", {
        name: "Project overview — Update",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Inspect pixel differences/ }).click();
    await page.getByRole("button", { name: "Measure changes", exact: true }).click();
    await expect(page.locator("#diff-result")).toContainText("% changed");
    const initial = store.compare(captured.run.id).entries[0].measurements[0];
    expect(initial.changedPixels).toBeGreaterThan(0);
    await page.getByText("Overlay", { exact: true }).click();
    await expect(page.getByRole("slider", { name: "Blend" })).toBeVisible();
    await page.getByRole("slider", { name: "Blend" }).press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Blend" })).toHaveAttribute("aria-valuenow", "51");
    await page.getByText("Side by side", { exact: true }).click();
    await page.screenshot({
      path: info.outputPath("desktop-comparison.png"),
      fullPage: true,
    });
    const image = page.getByRole("img", {
      name: "Project overview — Update",
      exact: true,
    });
    await image.click({ position: { x: 40, y: 50 } });
    await page
      .getByLabel("What should change?", { exact: true })
      .fill("Restore the button width to the approved design.");
    await page
      .getByRole("button", { name: "Add note", exact: true })
      .click();
    await expect(page.locator("#notes")).toContainText(
      "Restore the button width",
    );
    const note = store.getScreen("workflow-proof/overview").notes[0];
    expect(note.capture).toBe(bad.id);
    expect(note.point.x).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: "Approve design" }).click();
    await expect(
      page.getByText("This is the approved reference for this screen.", { exact: true }),
    ).toBeVisible();
    const conflict = await page.request.post(baseUrl + "/api/targets/approve", {
      data: { capture: expected.id, expectedRevision: 0 },
    });
    expect(conflict.status()).toBe(409);
    writeFileSync(source, good);
    git("add", ".");
    git("commit", "-m", "Restore approved button width");
    const fixedSha = git("rev-parse", "HEAD");
    const fixed = await captureRevision(store, {
      ...options,
      ref: fixedSha,
      role: "pr",
      output: join(temp, "fixed"),
    });
    const fresh = store.getCapture(fixed.run.captureIds[0]);
    expect(fresh.id).not.toBe(bad.id);
    const submitted = call(codex, "reviews_submit_fix", {
      id: note.id,
      expectedRevision: note.revision,
      evidence: fresh.id,
      resolution:
        "Restored the approved horizontal button padding and captured the new Git commit.",
    });
    expect(submitted.status).toBe("submitted");
    const fixedRun = store.run({
      project: "workflow-proof",
      title: "Fresh fix review",
      captureIds: [entry.captures.current.id, expected.id, fresh.id],
    });
    expect(store.compare(fixedRun.id).entries[0].openNotes).toBe(1);
    await page.goto(`${baseUrl}/?project=workflow-proof&run=${fixedRun.id}`);
    await page.getByRole("tab", { name: /Feedback/ }).click();
    await expect(
      page.getByRole("link", { name: /Earlier screenshot/ }),
    ).toHaveAttribute("href", `/api/captures/${bad.id}/image`);
    await page.getByRole("button", { name: "Verify fix" }).click();
    await expect(page.locator("#notes")).toContainText("Verified");
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    await page.getByRole("button", { name: /Inspect pixel differences/ }).click();
    await page.getByRole("button", { name: "Measure changes", exact: true }).click();
    await expect(page.locator("#diff-result")).toContainText("0.000% changed");
    const fixture = await page.context().newPage();
    await fixture.goto("file://" + source);
    await fixture.getByRole("button", { name: "View details" }).click();
    await expect(fixture.getByRole("dialog")).toBeVisible();
    await fixture.keyboard.press("Escape");
    await expect(fixture.getByRole("dialog")).not.toBeVisible();
    await expect(
      fixture.getByRole("button", { name: "View details" }),
    ).toBeFocused();
    await fixture.close();
    const report = {
      check: "Native dialog keyboard interaction",
      steps: [
        "Open View details",
        "Press Escape",
        "Assert dialog hidden",
        "Assert trigger focused",
      ],
      outcome: "pass",
      revision: fixedSha,
    };
    const evidence = call(claude, "evidence_add", {
      capture: fresh.id,
      kind: "behavior",
      method: "automated",
      outcome: "pass",
      assertion: "Escape closes the dialog and restores focus",
      procedure:
        "Playwright opens the fixture dialog, presses Escape, then asserts visibility and trigger focus.",
      observation: "All four assertions passed on the fixed fixture revision.",
      author: "Screens E2E",
      artifactType: "application/json",
      artifactBase64: Buffer.from(JSON.stringify(report)).toString("base64"),
    });
    expect(evidence.sourceRevision).toBe(fixedSha);
    await page.reload();
    await page.getByRole("tab", { name: /Evidence/ }).click();
    await expect(
      page.getByText("Escape closes the dialog and restores focus", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Review", exact: true }).click();
    for (const width of [912, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator("#title")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 912) {
        const boxes = await page
          .locator("#comparison > figure")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x, y: r.y };
            }),
          );
        expect(boxes[0].y).toBe(boxes[1].y);
        expect(boxes[1].x).toBeGreaterThan(boxes[0].x);
      }
      await page.screenshot({
        path: info.outputPath(`review-${width}.png`),
        fullPage: true,
      });
    }
    await stop();
    store = new Store(data);
    await start();
    await page.reload();
    await page.getByRole("tab", { name: /Feedback/ }).click();
    await expect(page.locator("#notes")).toContainText("Verified");
    expect(store.getScreen("workflow-proof/overview").targets[0].capture).toBe(
      expected.id,
    );
    expect(store.listEvidence({ capture: fresh.id })).toHaveLength(1);
    expect(errors).toEqual([]);
    const proof = {
      base,
      head,
      fixedSha,
      comparison: captured.run.id,
      fixedRun: fixedRun.id,
      originalCapture: bad.id,
      fixedCapture: fresh.id,
      note: store.getScreen("workflow-proof/overview").notes[0],
      evidence: evidence.id,
      initialChangedPixels: initial.changedPixels,
      finalChangedPixels: store.compare(fixedRun.id).entries[0].measurements[0]
        .changedPixels,
      clients: [
        "installed Claude helper + stdio MCP",
        "installed Codex helper + stdio MCP",
      ],
      restartPersistence: true,
      scope:
        "Deterministic browser fixture; no claim of native application or full language-model execution.",
    };
    await info.attach("workflow-proof", {
      body: JSON.stringify(proof, null, 2),
      contentType: "application/json",
    });
    writeFileSync(
      info.outputPath("workflow-proof.json"),
      JSON.stringify(proof, null, 2),
    );
    // Export only deterministic fixture evidence for replay against the built
    // production container. Never copy the user's registry or installed skills.
    if (process.env.SCREENS_PROOF_EXPORT) {
      const captures = [entry.captures.current, expected, bad, fresh].map((capture) => ({
        ...capture,
        imageBase64: store.image(capture.id).bytes.toString("base64"),
      }));
      writeFileSync(process.env.SCREENS_PROOF_EXPORT, JSON.stringify({
        proof, captures, report,
        evidence: {
          kind: evidence.kind, method: evidence.method, outcome: evidence.outcome,
          assertion: evidence.assertion, procedure: evidence.procedure,
          observation: evidence.observation, author: evidence.author,
          artifactType: "application/json",
          artifactBase64: Buffer.from(JSON.stringify(report)).toString("base64"),
        },
      }, null, 2));
    }
  } finally {
    await stop();
    rmSync(temp, { recursive: true, force: true });
  }
});
