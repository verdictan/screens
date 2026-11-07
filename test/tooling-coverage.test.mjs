import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { moduleUnderTest } from "./support/module.mjs";

test("GitHub bootstrap creates or reuses resources without resetting linked statuses", async () => {
  for (const mode of [
    "new",
    "existing",
    "unlinked",
    "no-status",
    "no-options",
    "no-match",
    "denied",
  ]) {
    const calls = [],
      writes = [];
    const backlog = [{ title: "Feature", body: "Description", status: "Todo" }];
    const gh = (...args) => {
      const argv = args[1];
      calls.push(argv);
      if (mode === "denied") throw Error("Access denied");
      const pair = argv.slice(0, 2).join(" ");
      const project = {
        id: "project",
        number: 1,
        title: "screens",
        url: "https://example.invalid/project",
      };
      const values = {
        "auth status": "",
        "repo list":
          mode === "new"
            ? []
            : [{ name: "screens", url: "https://example.invalid/repo" }],
        "project list": { projects: mode === "new" ? [] : [project] },
        "repo create": "",
        "project create": project,
        "project link": "",
        "project field-list": {
          fields:
            mode === "no-status"
              ? []
              : [
                  {
                    id: "status",
                    name: "Status",
                    ...(mode === "no-options"
                      ? {}
                      : {
                          options: [
                            {
                              id: "todo",
                              name: mode === "no-match" ? "Done" : "Todo",
                            },
                          ],
                        }),
                  },
                ],
        },
        "issue list":
          mode === "new"
            ? []
            : [{ title: "Feature", url: "https://example.invalid/issue/1" }],
        "project item-list": {
          items:
            mode === "existing"
              ? [
                  {
                    id: "item",
                    content: { url: "https://example.invalid/issue/1" },
                  },
                ]
              : [{ id: "other" }],
        },
        "issue create": "https://example.invalid/issue/1\n",
        "project item-add": { id: "item" },
        "project item-edit": "",
      };
      assert.ok(pair in values, pair);
      const value = values[pair];
      return typeof value === "string" ? value : JSON.stringify(value);
    };
    const r = await moduleUnderTest("scripts/bootstrap-github.mjs", {
      mocks: {
        "node:child_process": { execFileSync: gh },
        "node:fs": {
          ...fs,
          readFileSync: (p, ...args) =>
            String(p).endsWith("project-backlog.json")
              ? JSON.stringify(backlog)
              : fs.readFileSync(p, ...args),
          writeFileSync: (p, data, ...args) =>
            String(p).endsWith("github-links.json")
              ? writes.push(JSON.parse(data))
              : fs.writeFileSync(p, data, ...args),
        },
      },
    });
    assert.equal(r.error, undefined);
    if (mode === "denied") {
      assert.equal(r.process.exitCode, 1);
      assert.equal(writes.length, 0);
    } else {
      assert.equal(writes[0].issues.length, 1);
      assert.equal(
        calls.some((c) => c[1] === "item-edit"),
        ["new", "unlinked"].includes(mode),
      );
    }
  }
});
test("PR proof records measured pairs and refuses changed heads", async () => {
  for (const mode of ["stable", "changed"]) {
    let closed = false,
      lookups = 0;
    const files = [];
    const store = {
      compare: () => ({
        entries: [{ captures: { current: { id: "a" }, pr: { id: "b" } } }],
      }),
      close: () => {
        closed = true;
      },
    };
    const r = await moduleUnderTest("scripts/prove-pr.mjs", {
      env: {
        GITHUB_REPOSITORY: "owner/repo",
        SCREENS_PR_NUMBER: "1",
        GH_TOKEN: "fixture-token",
      },
      mocks: {
        "../src/store.mjs": {
          Store: class {
            constructor() {
              return store;
            }
          },
        },
        "../src/capture.mjs": {
          resolvePullRequest: () => ({
            repository: "owner/repo",
            number: 1,
            head: mode === "changed" && lookups++ ? "new" : "head",
            mergeBase: "base",
          }),
          captureComparison: async () => ({ run: { id: "run" } }),
        },
        "../src/diff.mjs": {
          createDiff: async (s, input) => ({
            id: "diff",
            status: "measured",
            changedRatio: 0,
            ...input,
          }),
        },
        "node:fs": {
          writeFileSync: (file, data) => files.push(JSON.parse(data)),
        },
      },
    });
    assert.equal(closed, true);
    if (mode === "changed") assert.match(r.error.message, /PR changed/);
    else {
      assert.equal(r.error, undefined);
      assert.equal(files[0].measurements[0].changedRatio, 0);
    }
  }
});
test("default skill packaging emits one archive per client", async () => {
  const writes = [],
    commands = [];
  const r = await moduleUnderTest("scripts/package-skills.mjs", {
    mocks: {
      "node:fs": {
        ...fs,
        mkdirSync() {},
        writeFileSync: (path, data) => writes.push([path, data]),
        readFileSync: (path, ...args) =>
          String(path).endsWith(".tar.gz")
            ? Buffer.from("archive")
            : fs.readFileSync(path, ...args),
      },
      "node:child_process": { execFileSync: (...args) => commands.push(args) },
    },
  });
  assert.equal(r.error, undefined);
  assert.equal(commands.length, 7);
  assert.equal(JSON.parse(writes[0][1]).artifacts.length, 7);
});
test("proof summary handles absent runner errors and rejects missing archive identity", async (t) => {
  const directory = fs.mkdtempSync(join(tmpdir(), "screens-proof-coverage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = {
    "captured-fixture.json": {
      proof: {
        initialChangedPixels: 1,
        finalChangedPixels: 0,
        restartPersistence: true,
      },
    },
    "deployment-proof.json": {
      passed: true,
      note: { id: "n", status: "verified" },
      finalDiff: { id: "d", changedPixels: 0 },
      evidence: { id: "e" },
    },
    "restart-proof.json": { passed: true, note: "n", diff: "d", evidence: "e" },
  };
  for (const hash of ["a".repeat(64), ""]) {
    const r = await moduleUnderTest("scripts/proof-phase.mjs", {
      argv: ["summarize"],
      env: { SCREENS_PROOF_SOURCE_HASH: hash },
      mocks: {
        "node:fs": {
          ...fs,
          readFileSync: (path) =>
            JSON.stringify(
              String(path).endsWith("e2e-results.json")
                ? {
                    stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
                  }
                : files[String(path).split("/").pop()],
            ),
          writeFileSync: (path, data) =>
            fs.writeFileSync(join(directory, "summary.json"), data),
        },
      },
    });
    if (hash) assert.equal(r.error, undefined);
    else assert.ok(r.error);
  }
});
