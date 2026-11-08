import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as cp from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { moduleUnderTest, Exit } from "./support/module.mjs";
import { agentClients, selectClients } from "../scripts/agent-clients.mjs";
import { Store } from "../src/store.mjs";
const temp = (t) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "screens-setup-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("client selection covers every profile and rejects unknown names", () => {
  assert.deepEqual(selectClients(), Object.keys(agentClients));
  assert.deepEqual(selectClients("both"), ["claude", "codex"]);
  assert.deepEqual(selectClients("cursor,cursor"), ["cursor"]);
  assert.throws(() => selectClients("unknown"), /Unknown client/);
});
test("setup installs the managed runtime through source or Homebrew", async (t) => {
  for (const [platform, brew, installed] of [
    ["darwin", false, false], ["win32", false, false],
    ["darwin", true, false], ["darwin", true, true],
  ]) {
    const dir = temp(t), calls = [];
    const result = await moduleUnderTest("scripts/setup.mjs", {
      argv: ["--project", join(dir, "app"), "--data", join(dir, "registry"), "--port", "4900", "--start"],
      platform,
      env: { HOMEBREW_USER_CONFIG_HOME: join(dir, "brew-config") },
      mocks: {
        "node:child_process": {
          spawnSync: (command, args, options) => {
            calls.push([command, args, options]);
            if (command === "brew" && args[0] === "--prefix") return {
              status: brew ? 0 : 1, stdout: join(dir, args[1] || "brew") + "\n",
            };
            if (command === "brew" && args[0] === "list") return { status: installed ? 0 : 1 };
            return { status: 0 };
          },
        },
      },
    });
    assert.equal(result.error, undefined);
    assert.match(result.logs.join("\n"), /Screens is installed/);
    if (brew) {
      assert.ok(calls.some(([command, args]) => command === "brew" && args[0] === (installed ? "upgrade" : "install")));
      assert.ok(calls.some(([, args]) => args[0].endsWith("bundle-runtime.mjs")));
      assert.match(fs.readFileSync(join(dir, "brew-config/services/screens.env"), "utf8"), /PORT=4900/);
      assert.ok(calls.some(([command, args]) => command === "brew" && args.join(" ") === "services start screens"));
    } else {
      assert.ok(calls.some(([command, args]) => command === (platform === "win32" ? "npm.cmd" : "npm") && args.join(" ") === "ci --include=dev"));
      assert.ok(calls.some(([, args]) => args[0].endsWith("scripts/screens.mjs") && args[1] === "serve"));
    }
  }
  for (const argv of [["--help"], ["-h"]]) {
    const r = await moduleUnderTest("scripts/setup.mjs", { argv });
    assert.equal(r.error.code, 0);
    assert.match(r.logs[0], /Install Screens/);
  }
  for (const argv of [
    ["bad"],
    ["--unknown"],
    ["--port"],
    ["--port", "--start"],
    ["--runtime", "docker"],
    ["--skip-browser"],
  ]) {
    const r = await moduleUnderTest("scripts/setup.mjs", { argv });
    assert.match(r.error.message, /Unknown|needs a value|runtime/);
  }
  for (const result of [
    { error: Error("cannot spawn") },
    { status: 2 },
    { status: null },
  ]) {
    const r = await moduleUnderTest("scripts/setup.mjs", {
      mocks: { "node:child_process": { spawnSync: () => result } },
    });
    assert.ok(r.error);
    assert.match(r.error.message, /cannot spawn|exit/);
  }
});
test("installer writes all client connections and preserves existing project instructions", async (t) => {
  const dir = temp(t);
  const run = (argv) =>
    moduleUnderTest("scripts/install-skills.mjs", {
      argv,
      env: { SCREENS_HOME: "", PORT: "", SCREENS_PORT: "" },
    });
  const project = join(dir, "app");
  fs.mkdirSync(project);
  fs.writeFileSync(join(project, "AGENTS.md"), "Existing instructions");
  let r = await run(["--project", project, "--port", "4900"]);
  assert.equal(r.error, undefined);
  assert.match(
    fs.readFileSync(join(project, "AGENTS.md"), "utf8"),
    /^Existing instructions\n/,
  );
  for (const folder of [".agents", ".claude", ".github"])
    assert.equal(
      fs.existsSync(join(project, folder, "skills/screens/SKILL.md")),
      true,
    );
  const config = JSON.parse(
    fs.readFileSync(join(project, ".screens/mcp.opencode.json")),
  );
  assert.equal(config.mcp.servers.screens.type, "local");
  fs.writeFileSync(join(project, ".screens/.gitignore"), "existing");
  r = await run(["--project", project, "--replace", "yes"]);
  assert.equal(r.error, undefined);
  assert.equal(
    fs
      .readFileSync(join(project, "AGENTS.md"), "utf8")
      .match(/## Screens review/g).length,
    1,
  );
  assert.equal(
    fs.readFileSync(join(project, ".screens/.gitignore"), "utf8"),
    "existing\n*\n",
  );
  r = await run(["--project", project, "--replace", "yes"]);
  assert.equal(r.error, undefined);
  for (const argv of [
    ["project"],
    ["--project"],
    ["--project", project, "--runtime", "bad"],
    ["--project", project, "--runtime", "docker", "--data", "x"],
    ["--project", project],
  ])
    assert.ok((await run(argv)).error);
  for (const env of [
    { SCREENS_PORT: "4901", PORT: "4902", SCREENS_HOME: join(dir, "registry") },
    { SCREENS_PORT: "", PORT: "4902" },
  ]) {
    const environmentProject = join(dir, `app-${env.PORT}-${env.SCREENS_PORT}`);
    fs.mkdirSync(environmentProject);
    r = await moduleUnderTest("scripts/install-skills.mjs", {
      argv: ["--project", environmentProject],
      env,
    });
    assert.equal(r.error, undefined);
  }
});
test("agent helper builds local and Docker commands without executing external services", async (t) => {
  const dir = temp(t),
    cli = resolve("src/cli.mjs");
  async function run(config, argv = [], result = { status: 0 }) {
    const calls = [];
    const r = await moduleUnderTest("skills/screens/scripts/screens.mjs", {
      argv,
      env: { SCREENS_CLI: cli },
      mocks: {
        "node:fs": {
          ...fs,
          existsSync: (p) =>
            String(p).endsWith("screens-config.json")
              ? config !== null
              : fs.existsSync(p),
          readFileSync: (p, ...a) =>
            String(p).endsWith("screens-config.json")
              ? JSON.stringify(config)
              : fs.readFileSync(p, ...a),
        },
        "node:child_process": {
          spawnSync: (...a) => {
            calls.push(a);
            return result;
          },
        },
      },
    });
    return { ...r, calls };
  }
  let r = await run(null, ["help"]);
  assert.equal(r.error.code, 0);
  assert.equal(r.calls[0][0], process.execPath);
  r = await run({ cli: "/missing" }, []);
  assert.equal(r.error.code, 1);
  assert.match(r.errors[0], /runtime not found/);
  r = await run({ cli, data: dir, port: 4900 }, ["projects"]);
  assert.ok(r.calls[0][1].includes(dir));
  r = await run({ cli, data: dir, port: 4900 }, [
    "projects",
    "--data",
    "other",
    "--port",
    "4901",
  ]);
  assert.equal(r.calls[0][1].filter((x) => x === "--data").length, 1);
  for (const argv of [
    ["serve"],
    ["pr-context", "owner/repo", "1"],
    ["load", dir],
    ["load", join(dir, "screens.json")],
    ["evidence", "add", join(dir, "report.json")],
    [
      "capture-refs",
      "--repo",
      dir,
      "--output",
      join(dir, "out/screens.json"),
      "--context",
      join(dir, "context.json"),
      "--masks",
      join(dir, "masks.json"),
      "--config",
      join(dir, "capture.json"),
    ],
  ]) {
    r = await run({ cli, runtime: "docker", port: 4900 }, argv);
    assert.equal(r.error.code, 0);
    assert.equal(r.calls.length, 1);
    if (argv[0] === "serve") assert.ok(r.calls[0][1].includes("--build"));
    if (argv[0] === "capture-refs")
      assert.ok(r.calls[0][1].some((a) => a.endsWith(":rw")));
  }
  for (const argv of [["projects", "--data", "x"], ["load"], ["capture-pr"]]) {
    r = await run({ cli, runtime: "docker" }, argv);
    assert.match(
      r.error.message,
      /omit --data|Missing input path|resolve pr-context/,
    );
  }
  for (const result of [
    { error: Error("spawn failed") },
    { status: null },
    { status: 3 },
  ]) {
    r = await run({ cli }, [], result);
    assert.ok(r.error.code > 0);
  }
});
test("skill validation and syntax check reject incomplete packages", async () => {
  for (const file of ["scripts/validate-skills.mjs", "scripts/check.mjs"]) {
    const calls = [];
    let r = await moduleUnderTest(file, {
      mocks: {
        "node:child_process": { execFileSync: (...a) => calls.push(a) },
      },
    });
    assert.equal(r.error, undefined);
    assert.ok(calls.length > 0);
    for (const text of [
      "bad",
      "---\nname: screens\ndescription: Test\n---\nTODO",
      "---\nname: screens\ndescription: Test\n---\nFIXME",
    ]) {
      r = await moduleUnderTest(file, {
        mocks: {
          "node:fs": {
            ...fs,
            readFileSync: (p, ...a) =>
              String(p).endsWith("SKILL.md") ? text : fs.readFileSync(p, ...a),
          },
          "node:child_process": { execFileSync() {} },
        },
      });
      if (file.includes("validate") || !text.includes("FIXME"))
        assert.ok(r.error);
    }
  }
  const r = await moduleUnderTest("scripts/validate-skills.mjs", {
    mocks: { "node:fs": { ...fs, existsSync: () => false } },
  });
  assert.match(r.error.message, /Missing/);
});
test("deployment smoke checks reject HTTP, health, persistence and MCP failures", async () => {
  for (const kind of ["http", "health", "missing", "mcp", "mode"]) {
    const r = await moduleUnderTest("scripts/smoke-deployment.mjs", {
      argv: [kind === "mode" ? "bad" : "read"],
      globals: {
        fetch: async (url) => ({
          ok: kind !== "http",
          status: 503,
          json: async () =>
            url.endsWith("/health")
              ? { ok: kind !== "health" }
              : url.endsWith("/projects")
                ? kind === "missing"
                  ? []
                  : [{ id: "deployment-check" }]
                : {
                    result: {
                      tools: kind === "mcp" ? [] : [{ name: "diffs_create" }],
                    },
                  },
        }),
      },
    });
    assert.match(r.error.message, /HTTP 503|Unhealthy|missing|Use write/);
  }
});
test("proof phases dispatch only the requested checks", async () => {
  for (const phase of ["workflow", "deployment", "restart", "bad"]) {
    const calls = [];
    const r = await moduleUnderTest("scripts/proof-phase.mjs", {
      argv: [phase],
      mocks: {
        "node:child_process": { execFileSync: (...a) => calls.push(a) },
      },
    });
    if (phase === "bad") assert.match(r.error.message, /Use workflow/);
    else {
      assert.equal(r.error, undefined);
      assert.equal(calls.length, phase === "workflow" ? 6 : 1);
    }
  }
});
test("proof seed creates three immutable fixture roles", async (t) => {
  const dir = temp(t);
  const r = await moduleUnderTest("scripts/seed-proof.mjs", {
    env: { SCREENS_HOME: dir },
  });
  assert.equal(r.error, undefined);
  const store = new Store(dir);
  try {
    assert.equal(store.getScreen("proof-fixture/overview").captures.length, 3);
    assert.equal(store.runs("proof-fixture").length, 1);
  } finally {
    store.close();
  }
});
