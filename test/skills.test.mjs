import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), "screens-skills-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const node = (...args) =>
  execFileSync(process.execPath, args, { encoding: "utf8" });
test("both installed skills load, compare and share capture-bound feedback through a configured registry", async (t) => {
  const dir = setup(t),
    project = join(dir, "project with spaces"),
    data = join(dir, "registry");
  mkdirSync(project);
  const image = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  writeFileSync(join(project, "one.png"), image);
  writeFileSync(
    join(project, "screens.json"),
    JSON.stringify({
      schemaVersion: 1,
      project: { id: "skill-test", name: "Skill test" },
      screens: [
        {
          key: "home",
          title: "Home",
          captures: [
            {
              file: "one.png",
              role: "current",
              revision: "base",
              fixture: "seed",
            },
            { file: "one.png", role: "pr", revision: "head", fixture: "seed" },
          ],
        },
      ],
    }),
  );
  node(
    "scripts/install-skills.mjs",
    "--project",
    project,
    "--client",
    "both",
    "--data",
    data,
  );
  const claude = join(project, ".claude/skills/screens/scripts/screens.mjs"),
    codex = join(project, ".agents/skills/screens/scripts/screens.mjs");
  const loaded = JSON.parse(
    node(claude, "load", project, "--project", "skill-test"),
  );
  assert.ok(loaded.run.id);
  assert.equal(
    JSON.parse(node(codex, "list", "--project", "skill-test")).length,
    1,
  );
  const comparison = JSON.parse(
    node(
      codex,
      "compare",
      "--project",
      "skill-test",
      "--current",
      loaded.run.id,
      "--pr",
      loaded.run.id,
    ),
  );
  assert.equal(comparison.captureIds.length, 2);
  const call = (name, args) =>
    JSON.parse(
      execFileSync(process.execPath, [codex, "mcp"], {
        input:
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          }) + "\n",
        encoding: "utf8",
      }),
    ).result;
  const detail = JSON.parse(
    call("screens_get", { id: "skill-test/home" }).content[0].text,
  );
  const note = JSON.parse(
    call("reviews_add_note", {
      capture: detail.captures.find((c) => c.role === "current").id,
      text: "Check header alignment",
    }).content[0].text,
  );
  const submitted = call("reviews_submit_fix", {
    id: note.id,
    expectedRevision: 1,
    evidence: detail.captures.find((c) => c.role === "pr").id,
    resolution: "Recaptured header",
  });
  assert.equal(JSON.parse(submitted.content[0].text).status, "submitted");
  assert.notEqual(
    spawnSync(process.execPath, [
      "scripts/install-skills.mjs",
      "--project",
      project,
    ]).status,
    0,
  );
});
test("client archives contain the shared skill and helper with matching checksums", (t) => {
  const dir = setup(t);
  node("scripts/package-skills.mjs", dir);
  const manifest = JSON.parse(readFileSync(join(dir, "skills-manifest.json")));
  for (const a of manifest.artifacts) {
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(dir, a.file)))
        .digest("hex"),
      a.sha256,
    );
    const content = execFileSync("tar", ["-tzf", join(dir, a.file)], {
      encoding: "utf8",
    });
    assert.match(content, /skills\/screens\/SKILL.md/);
    assert.match(content, /scripts\/screens.mjs/);
    assert.doesNotMatch(content, /screens-config.json/);
  }
});
test("Docker helper maps host inputs into read-only mounts and keeps the compose registry", (t) => {
  const dir = setup(t),
    project = join(dir, "project"),
    bin = join(dir, "bin");
  mkdirSync(project);
  mkdirSync(bin);
  writeFileSync(
    join(bin, "docker"),
    "#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)))\n",
    { mode: 0o755 },
  );
  node(
    "scripts/install-skills.mjs",
    "--project",
    project,
    "--client",
    "claude",
    "--runtime",
    "docker",
  );
  const helper = join(project, ".claude/skills/screens/scripts/screens.mjs");
  const args = JSON.parse(
    execFileSync(
      process.execPath,
      [helper, "load", project, "--project", "test"],
      {
        env: { ...process.env, PATH: bin + ":" + process.env.PATH },
        encoding: "utf8",
      },
    ),
  );
  assert.ok(args.includes(`${project}:/input0:ro`));
  assert.ok(args.includes("/input0"));
  assert.ok(args.includes("--no-deps"));
  assert.ok(args.includes(resolve("compose.yaml")));
  assert.equal(existsSync(join(project, ".agents")), false);
});
