import { spawn, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { requireThat, key, text, choice, variant } from "./validation.mjs";
import { importManifest, combineRuns } from "./import.mjs";
const runtime = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", `safe.directory=${cwd}`, "-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 10 * 1024 * 1024,
  }).trim();
export function captureConfig(filename) {
  const bytes = readFileSync(resolve(filename)),
    value = JSON.parse(bytes);
  requireThat(
    value.schemaVersion === 1 && value.adapter === "browser",
    "Use a schemaVersion 1 browser capture configuration",
  );
  key(value.project?.id, "project ID");
  text(value.project?.name, "project name");
  requireThat(
    Array.isArray(value.screens) &&
      value.screens.length > 0 &&
      value.screens.length <= 200,
    "Configure 1–200 screens",
  );
  const keys = new Set();
  for (const s of value.screens) {
    key(s.key, "screen key");
    text(s.title, "screen title");
    requireThat(!keys.has(s.key), "Screen keys must be unique");
    keys.add(s.key);
    requireThat(
      typeof s.path === "string" &&
        s.path.startsWith("/") &&
        !s.path.startsWith("//"),
      "Screen path must be local",
    );
    if (s.ready) text(s.ready, "ready selector");
  }
  const commands = [...(value.prepare || []), value.serve];
  requireThat(
    commands.every(
      (c) =>
        Array.isArray(c) &&
        c.length > 0 &&
        c.every((a) => typeof a === "string" && a.length > 0),
    ),
    "Commands must be nonempty argument arrays",
  );
  requireThat(
    Array.isArray(value.variants) &&
      value.variants.length > 0 &&
      value.variants.length <= 10,
    "Configure 1–10 variants",
  );
  const variants = new Set();
  for (const v of value.variants) {
    requireThat(
      [v.width, v.height].every(
        (n) => Number.isInteger(n) && n >= 200 && n <= 4000,
      ),
      "Viewport dimensions must be 200–4000",
    );
    choice(v.theme || "light", ["light", "dark"], "theme");
    text(v.device, "device");
    const id = JSON.stringify(
      variant({ ...v, viewport: `${v.width}x${v.height}` }),
    );
    requireThat(!variants.has(id), "Duplicate variants");
    variants.add(id);
  }
  text(value.fixture, "fixture");
  return { value, hash: hash(bytes) };
}
export function resolveRevision(repo, ref) {
  return git(
    repo,
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${text(ref, "Git ref")}^{commit}`,
  );
}
export function resolvePullRequest(repository, number) {
  requireThat(
    /^[\w.-]+\/[\w.-]+$/.test(repository) && /^[1-9]\d*$/.test(String(number)),
    "Use OWNER/REPO and a PR number",
  );
  const gh = (...a) =>
    JSON.parse(
      execFileSync("gh", a, {
        encoding: "utf8",
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      }),
    );
  const pr = gh("api", `repos/${repository}/pulls/${number}`);
  const comparison = gh(
    "api",
    `repos/${repository}/compare/${pr.base.sha}...${pr.head.sha}`,
  );
  return {
    repository,
    number: Number(number),
    url: pr.html_url,
    title: pr.title,
    base: pr.base.sha,
    head: pr.head.sha,
    mergeBase: comparison.merge_base_commit.sha,
    headRepository: pr.head.repo?.full_name || null,
    resolvedAt: new Date().toISOString(),
    captureStatus: "not-captured",
  };
}
async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
function runCommand(command, cwd, env, log) {
  const args = command.map((a) => a.replaceAll("{runtime}", runtime));
  const child = spawn(args[0], args.slice(1), {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  child.stdout.on("data", (b) => log(b.toString()));
  child.stderr.on("data", (b) => log(b.toString()));
  return child;
}
async function stop(child) {
  if (!child || !child.pid || child.exitCode !== null || child.signalCode)
    return;
  const kill = (signal) => {
    try {
      process.platform === "win32"
        ? child.kill(signal)
        : process.kill(-child.pid, signal);
    } catch (e) {
      if (e.code !== "ESRCH") throw e;
    }
  };
  const closed = once(child, "close");
  kill("SIGTERM");
  const timer = setTimeout(() => kill("SIGKILL"), 3000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
async function execute(command, cwd, env, log) {
  const child = runCommand(command, cwd, env, log);
  const timer = setTimeout(() => stop(child), 300000);
  try {
    const [code] = await once(child, "close");
    requireThat(
      code === 0,
      `Capture preparation failed: ${command[0]} (exit ${code})`,
      422,
    );
  } finally {
    clearTimeout(timer);
    await stop(child);
  }
}
export async function captureRevision(store, options) {
  requireThat(
    options.execute === "yes",
    "Capture executes project commands. Review the configuration, then pass --execute yes.",
  );
  const config = captureConfig(options.config),
    project = config.value.project;
  const repo = realpathSync(options.repo),
    revision = resolveRevision(repo, options.ref),
    role = choice(options.role || "pr", ["current", "target", "pr"], "role");
  const output = resolve(options.output);
  requireThat(!existsSync(output), "Capture output must be a new directory");
  mkdirSync(output, { recursive: true });
  const manifestPath = join(output, "screens.json");
  let logText = "";
  const log = (chunk) => {
    logText = (logText + chunk).slice(-2 * 1024 * 1024);
  };
  const workspace = mkdtempSync(join(tmpdir(), "screens-capture-"));
  let server, browser;
  try {
    const checkout = join(workspace, "checkout");
    execFileSync(
      "git",
      ["clone", "--no-hardlinks", "--no-checkout", "--", repo, checkout],
      { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] },
    );
    git(checkout, "checkout", "--detach", revision);
    const port = await availablePort(),
      env = {
        ...process.env,
        PORT: String(port),
        SCREENS_CAPTURE_PORT: String(port),
        SCREENS_HOST: "127.0.0.1",
        SCREENS_HOME: join(workspace, "registry"),
      };
    const subdir = config.value.directory || ".";
    const cwd = realpathSync(resolve(checkout, subdir));
    const rel = relative(realpathSync(checkout), cwd);
    requireThat(
      rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel),
      "Capture directory must stay inside checkout",
    );
    for (const command of config.value.prepare || [])
      await execute(command, cwd, env, log);
    server = runCommand(config.value.serve, cwd, env, log);
    let spawnError;
    server.on("error", (e) => {
      spawnError = e;
    });
    const base = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 300; i++) {
      if (spawnError) throw spawnError;
      requireThat(
        server.exitCode === null && !server.signalCode,
        "Capture server exited before readiness",
        422,
      );
      try {
        if (
          (
            await fetch(base + (config.value.readyPath || "/"), {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    requireThat(
      ready,
      "Capture server did not become ready within 60 seconds",
      422,
    );
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
    const screens = config.value.screens.map((s) => ({ ...s, captures: [] }));
    for (const v of config.value.variants) {
      const context = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        deviceScaleFactor: 1,
        colorScheme: v.theme || "light",
        locale: v.locale || "en",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      for (const [i, screen] of screens.entries()) {
        await page.goto(base + screen.path, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        if (screen.ready)
          await page
            .locator(screen.ready)
            .waitFor({ state: "visible", timeout: 30000 });
        await page.evaluate(() => document.fonts.ready);
        const file = `${i}-${hash(JSON.stringify(v)).slice(0, 12)}.png`;
        const bytes = await page.screenshot({
          path: join(output, file),
          fullPage: screen.fullPage ?? true,
          animations: "disabled",
        });
        screen.captures.push({
          file,
          role,
          revision,
          fixture: config.value.fixture,
          variant: {
            device: v.device,
            theme: v.theme || "light",
            viewport: `${v.width}x${v.height}`,
            locale: v.locale || "en",
            textScale: "default",
          },
          provenance: `Browser capture from isolated Git commit ${revision}; config ${config.hash}; Chromium ${browser.version()}; screenshot ${hash(bytes)}; fixture ${config.value.fixture}; reduced motion`,
        });
      }
      await context.close();
    }
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          project,
          screens,
          title: options.title || `${role} · ${revision.slice(0, 8)}`,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    const imported = importManifest(store, manifestPath, {
      project: project.id,
    });
    return {
      ...imported,
      revision,
      manifest: manifestPath,
      configHash: config.hash,
    };
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      try {
        await stop(server);
      } finally {
        writeFileSync(join(output, "capture.log"), logText, { flag: "wx" });
        rmSync(workspace, { recursive: true, force: true });
      }
    }
  }
}
export async function captureComparison(store, options) {
  const config = captureConfig(options.config),
    repo = realpathSync(options.repo);
  const context = options.context || {
    kind: "git-revisions",
    base: resolveRevision(repo, options.base),
    head: resolveRevision(repo, options.head),
  };
  const base = resolveRevision(repo, context.mergeBase || context.base),
    head = resolveRevision(repo, context.head);
  const output = resolve(options.output);
  const current = await captureRevision(store, {
    ...options,
    ref: base,
    role: "current",
    output: join(output, "current"),
  });
  const pr = await captureRevision(store, {
    ...options,
    ref: head,
    role: "pr",
    output: join(output, "pr"),
  });
  if (options.verifyPR) {
    const latest = resolvePullRequest(context.repository, context.number);
    requireThat(
      latest.head === head,
      "PR head changed during capture; evidence retained, comparison not published",
      409,
    );
  }
  const run = combineRuns(store, {
    project: config.value.project.id,
    current: current.run.id,
    pr: pr.run.id,
    target: options.target,
    title:
      options.title ||
      (context.number
        ? `PR ${context.number} · ${context.title}`
        : "Git revision comparison"),
    source: {
      ...context,
      mergeBase: base,
      head,
      captureStatus: "captured",
      configHash: config.hash,
    },
  });
  writeFileSync(
    join(output, "comparison.json"),
    JSON.stringify(run, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    run,
    current,
    pr,
    url: `http://127.0.0.1:${options.port || 4800}/?project=${encodeURIComponent(run.project)}&run=${run.id}`,
  };
}
