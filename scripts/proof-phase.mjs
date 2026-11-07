import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const phase = process.argv[2];
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const run = (...args) => execFileSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    SCREENS_PROOF_PHASE: phase,
    SCREENS_PROOF_EXPORT: "test-results/captured-fixture.json",
  },
});

if (phase === "workflow") {
  run("scripts/check.mjs");
  run("--test", ...readdirSync("test").filter((p) => p.endsWith(".test.mjs")).map((p) => `test/${p}`));
  run("--test", "test/network.integration.mjs");
  run("scripts/validate-skills.mjs");
  run("scripts/package-skills.mjs", "test-results/skills");
  run("node_modules/@playwright/test/cli.js", "test", "test/e2e/workflow.spec.mjs");
} else if (["deployment", "restart"].includes(phase)) {
  run("node_modules/@playwright/test/cli.js", "test", "test/e2e/deployment.spec.mjs");
} else if (phase === "summarize") {
  const phases = {};
  for (const name of ["workflow", "deployment", "restart"]) {
    const report = read(`test-results/${name}/e2e-results.json`);
    assert.equal(report.stats.expected, 1, `${name}: expected one passing browser test`);
    for (const key of ["unexpected", "skipped", "flaky"])
      assert.equal(report.stats[key], 0, `${name}: ${key} tests cannot prove completion`);
    assert.equal((report.errors || []).length, 0, `${name}: runner errors`);
    phases[name] = report.stats;
  }
  const fixture = read("test-results/captured-fixture.json").proof;
  const deployment = read("test-results/deployment-proof.json");
  const restart = read("test-results/restart-proof.json");
  assert.ok(fixture.initialChangedPixels > 0);
  assert.equal(fixture.finalChangedPixels, 0);
  assert.equal(fixture.restartPersistence, true);
  assert.equal(deployment.passed, true);
  assert.equal(deployment.note.status, "verified");
  assert.equal(deployment.finalDiff.changedPixels, 0);
  assert.equal(restart.passed, true);
  assert.equal(restart.note, deployment.note.id);
  assert.equal(restart.diff, deployment.finalDiff.id);
  assert.equal(restart.evidence, deployment.evidence.id);
  const result = {
    status: "passed", completedAt: new Date().toISOString(),
    sourceArchiveSha256: process.env.SCREENS_PROOF_SOURCE_HASH,
    phases, fixture, deployment, restart,
    scope: "Deterministic web fixture, installed Claude/Codex helpers, stdio and HTTP MCP, production Docker image and restart. No language-model session, native-app correctness, user approval or live customer data is claimed.",
  };
  assert.match(result.sourceArchiveSha256 || "", /^[a-f0-9]{64}$/);
  writeFileSync("test-results/summary.json", JSON.stringify(result, null, 2));
  console.log("Full fixture workflow and production-container restart proof passed.");
} else {
  throw Error("Use workflow, deployment, restart or summarize");
}
