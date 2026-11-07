import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/proof-phase.mjs");
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "screens-proof-summary-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const save = (path, value) => writeFileSync(join(directory, "test-results", path), JSON.stringify(value));
  for (const phase of ["workflow", "deployment", "restart"]) {
    mkdirSync(join(directory, "test-results", phase), { recursive: true });
    save(`${phase}/e2e-results.json`, { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] });
  }
  save("captured-fixture.json", { proof: { initialChangedPixels: 100, finalChangedPixels: 0, restartPersistence: true } });
  save("deployment-proof.json", {
    passed: true, note: { id: "note", status: "verified" },
    finalDiff: { id: "diff", changedPixels: 0 }, evidence: { id: "evidence" },
  });
  save("restart-proof.json", { passed: true, note: "note", diff: "diff", evidence: "evidence" });
  return {
    save,
    result: join(directory, "test-results/summary.json"),
    run: () => spawnSync(process.execPath, [script, "summarize"], {
      cwd: directory, encoding: "utf8",
      env: { ...process.env, SCREENS_PROOF_SOURCE_HASH: "a".repeat(64) },
    }),
  };
}
test("proof summary requires successful browser phases and matching restart records", (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(f.result, "utf8")).status, "passed");
});
for (const problem of ["skipped", "unexpected", "flaky", "runner-error"]) {
  test(`proof cannot pass when a browser phase has ${problem}`, (t) => {
    const f = fixture(t);
    f.save("deployment/e2e-results.json", {
      stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0, ...(problem !== "runner-error" ? { [problem]: 1 } : {}) },
      errors: problem === "runner-error" ? [{ message: "Browser failed" }] : [],
    });
    assert.notEqual(f.run().status, 0);
    assert.equal(existsSync(f.result), false);
  });
}
test("proof rejects restart evidence from a different run", (t) => {
  const f = fixture(t);
  f.save("restart-proof.json", { passed: true, note: "other-note", diff: "diff", evidence: "evidence" });
  assert.notEqual(f.run().status, 0);
  assert.equal(existsSync(f.result), false);
});
