import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { tmpdir, platform, release, arch } from "node:os";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { requireThat, text, choice, variant } from "./validation.mjs";
import { bundledGit, gitOutput, captureBrowser } from "./runtime.mjs";
import { combineRuns } from "./import.mjs";
import { startBrowserEvidence, attachBrowserEvidence } from "./evidence-tools.mjs";
const runtime = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) => gitOutput(cwd, args);

export function expandCaptureConfig(source, { profile, screens } = {}) {
  if (profile) requireThat(source.profiles?.[profile], `Unknown capture profile: ${profile}`);
  const selected = profile ? source.profiles[profile] : {};
  const value = { ...source, ...selected };
  for (const field of ["readiness", "determinism", "network", "evidence"])
    if (source[field] || selected[field]) value[field] = { ...source[field], ...selected[field] };
  delete value.profiles;
  const matrix = value.matrix;
  if (matrix) {
    value.variants = [];
    for (const device of matrix.devices || [])
      for (const theme of matrix.themes || ["light"])
        for (const locale of matrix.locales || ["en"])
          for (const textScale of matrix.textScales || [1])
            value.variants.push({ ...device, theme, locale, textScale: String(textScale) });
    delete value.matrix;
  }
  const browsers = value.browsers || ["chromium"];
  value.variants = (value.variants || []).flatMap((variant) => (variant.browser ? [variant.browser] : browsers).map((browser) => ({ ...variant, browser })));
  delete value.browsers;
  if (screens) value.screens = (value.screens || []).filter((screen) => screens.includes(screen.key));
  return value;
}

export function diagnoseCaptureConfig(filename, options = {}) {
  const file = resolve(filename), issues = [];
  let bytes, source, value;
  const issue = (path, message, fix) => issues.push({ file, path, message, fix });
  try { bytes = readFileSync(file); source = JSON.parse(bytes); }
  catch (error) {
    issue("$", error.message, "Supply a readable JSON capture configuration.");
    return { file, valid: false, issues };
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    issue("$", "Expected a capture configuration object", "Use a JSON object with schemaVersion, project, screens, serve, and variants.");
    return { file, valid: false, issues };
  }
  if (options.profile && (!source.profiles?.[options.profile] || typeof source.profiles[options.profile] !== "object" || Array.isArray(source.profiles[options.profile]))) {
    issue(`$.profiles.${options.profile}`, "Unknown or invalid capture profile", "Choose a profile whose value is a configuration object.");
    return { file, valid: false, issues };
  }
  const selected = options.profile ? source.profiles[options.profile] : {};
  const raw = { ...source, ...selected };
  for (const field of ["screens", "variants"])
    if (Array.isArray(raw[field])) raw[field].forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) issue(`$.${field}[${index}]`, "Expected an object", "Provide the properties for this screen or variant.");
    });
  if (raw.matrix) {
    for (const field of ["devices", "themes", "locales", "textScales"])
      if ((field === "devices" || raw.matrix[field] !== undefined) && !Array.isArray(raw.matrix[field]))
        issue(`$.matrix.${field}`, "Expected an array", "Provide an array of values for this matrix axis.");
  } else if (raw.variants !== undefined && !Array.isArray(raw.variants)) issue("$.variants", "Expected an array", "Provide an array of device variants.");
  if (raw.browsers !== undefined && !Array.isArray(raw.browsers)) issue("$.browsers", "Expected an array", "Choose bundled browsers: chromium, firefox, webkit.");
  if (issues.length) return { file, valid: false, issues };
  try { value = expandCaptureConfig(source, options); }
  catch (error) { issue("$.profiles", error.message, "Choose a name defined in profiles."); return { file, valid: false, issues }; }
  if (value.schemaVersion !== 1) issue("$.schemaVersion", "Unsupported schema version", "Set schemaVersion to 1.");
  if (value.adapter !== "browser") issue("$.adapter", "Unsupported adapter", "Set adapter to browser; use native capture tools for native applications.");
  if (typeof value.project?.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value.project.id)) issue("$.project.id", "Missing or invalid project ID", "Use a stable ID with letters, digits, periods, slashes, colons, underscores, or hyphens.");
  if (!value.project?.name?.trim?.()) issue("$.project.name", "Missing project name", "Set a nonempty project name.");
  if (typeof value.fixture !== "string" || !value.fixture.trim()) issue("$.fixture", "Missing fixture identity", "Set fixture to the sample-data version used by this capture.");
  if (!Array.isArray(value.screens) || !value.screens.length) issue("$.screens", "No screens selected", "Add screen objects or select a profile containing screens.");
  const keys = new Set();
  for (const [i, screen] of (Array.isArray(value.screens) ? value.screens : []).entries()) {
    const path = `$.screens[${i}]`;
    if (typeof screen.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(screen.key)) issue(`${path}.key`, "Invalid screen key", "Use a stable screen key.");
    if (keys.has(screen.key)) issue(`${path}.key`, "Duplicate screen key", "Assign each screen a unique key.");
    keys.add(screen.key);
    if (typeof screen.title !== "string" || !screen.title.trim()) issue(`${path}.title`, "Missing title", "Set a nonempty screen title.");
    if (typeof screen.path !== "string" || !screen.path.startsWith("/") || screen.path.startsWith("//")) issue(`${path}.path`, "Invalid local route", "Use a route beginning with one slash.");
  }
  const commands = [...(Array.isArray(value.prepare) ? value.prepare : []), value.serve];
  if (value.prepare !== undefined && !Array.isArray(value.prepare)) issue("$.prepare", "Invalid preparation commands", "Use an array of argument arrays.");
  for (const [i, command] of commands.entries())
    if (!Array.isArray(command) || !command.length || !command.every((arg) => typeof arg === "string" && arg.length))
      issue(i === commands.length - 1 ? "$.serve" : `$.prepare[${i}]`, "Invalid command", 'Use an argument array, for example ["npm", "run", "dev"].');
  if (!value.variants.length) issue("$.variants", "No capture variants", "Supply variants or matrix.devices.");
  if (value.variants.length * (value.screens?.length || 0) > 10000) issue("$.variants", "Expanded plan exceeds 10000 captures per run", "Use smaller profiles or split the selected screens.");
  const variants = new Set();
  for (const [i, v] of value.variants.entries()) {
    const path = `$.variants[${i}]`;
    if (![v.width, v.height].every((n) => Number.isInteger(n) && n >= 200 && n <= 4000)) issue(path, "Invalid viewport", "Set width and height to integer pixel dimensions from 200 to 4000.");
    if (!["chromium", "firefox", "webkit"].includes(v.browser)) issue(`${path}.browser`, "Unknown browser", "Use chromium, firefox, or webkit.");
    if (!v.device || typeof v.device !== "string") issue(`${path}.device`, "Missing device label", "Set a device label such as desktop or phone.");
    if (!["light", "dark"].includes(v.theme || "light")) issue(`${path}.theme`, "Unsupported theme", "Use light or dark.");
    if (v.textScale !== undefined && v.textScale !== "default" && !(Number(v.textScale) > 0)) issue(`${path}.textScale`, "Invalid text scale", "Use a positive multiplier such as 1 or 1.25.");
    const id = JSON.stringify({ device: v.device, browser: v.browser, width: v.width, height: v.height, theme: v.theme || "light", locale: v.locale || "en", textScale: v.textScale || "default" });
    if (variants.has(id)) issue(path, "Duplicate capture variant", "Remove the repeated variant.");
    variants.add(id);
  }
  if (value.determinism?.time !== undefined && Number.isNaN(new Date(value.determinism.time).getTime())) issue("$.determinism.time", "Invalid fixed time", "Use an ISO date or epoch milliseconds.");
  if (value.animationTime !== undefined && !(Number.isFinite(value.animationTime) && value.animationTime >= 0)) issue("$.animationTime", "Invalid animation time", "Use a nonnegative number of milliseconds.");
  if (value.network?.har && (isAbsolute(value.network.har) || value.network.har.split(/[\\/]/).includes(".."))) issue("$.network.har", "HAR path must be repository-relative", "Place the recording in the repository and use its relative path.");
  return { file, valid: !issues.length, issues, value, sourceHash: hash(bytes), hash: hash(JSON.stringify(value)) };
}

export function captureConfig(filename, options = {}) {
  const report = diagnoseCaptureConfig(filename, options);
  requireThat(report.valid, report.issues.map((item) => `${item.path}: ${item.message}. ${item.fix}`).join("\n"));
  return { value: report.value, hash: report.hash, sourceHash: report.sourceHash };
}
export function resolveRevision(repo, ref) {
  return git(repo, "rev-parse", "--verify", "--end-of-options", `${text(ref, "Git ref")}^{commit}`);
}
export async function resolvePullRequest(repository, number) {
  requireThat(/^[\w.-]+\/[\w.-]+$/.test(repository) && /^[1-9]\d*$/.test(String(number)), "Use OWNER/REPO and a PR number");
  const request = async (path) => {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "verdictan-screens", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json();
    requireThat(response.ok, value.message || `GitHub returned ${response.status}`, response.status);
    return value;
  };
  const pr = await request(`repos/${repository}/pulls/${number}`);
  const comparison = await request(`repos/${repository}/compare/${pr.base.sha}...${pr.head.sha}`);
  return { repository, number: Number(number), url: pr.html_url, title: pr.title, base: pr.base.sha, head: pr.head.sha,
    mergeBase: comparison.merge_base_commit.sha, headRepository: pr.head.repo?.full_name || null,
    resolvedAt: new Date().toISOString(), captureStatus: "not-captured" };
}

async function availablePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = server.address().port; await new Promise((done) => server.close(done)); return port;
}
function runCommand(command, cwd, env, log) {
  const args = command.map((arg) => arg.replaceAll("{runtime}", runtime));
  const gitCommand = args[0] === "git";
  const child = spawn(gitCommand ? bundledGit.gitLocation : args[0], args.slice(1), { cwd, env: gitCommand ? { ...env, ...bundledGit.env } : env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  child.stdout.on("data", (bytes) => log(bytes.toString())); child.stderr.on("data", (bytes) => log(bytes.toString()));
  return child;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  const kill = (signal) => { try { process.platform === "win32" ? child.kill(signal) : process.kill(-child.pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const closed = once(child, "close"); kill("SIGTERM"); const timer = setTimeout(() => kill("SIGKILL"), 3000);
  try { await closed; } finally { clearTimeout(timer); }
}
async function execute(command, cwd, env, log, signal) {
  signal?.throwIfAborted();
  const child = runCommand(command, cwd, env, log);
  const abort = () => { void stop(child); };
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 300000);
  try {
    const [code] = await once(child, "close"); signal?.throwIfAborted();
    requireThat(code === 0, `Capture command failed: ${command[0]} (exit ${code})`, 422);
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); await stop(child); }
}
const captureVariant = (v) => variant({ ...v, viewport: `${v.width}x${v.height}`, textScale: String(v.textScale || "default") });
const slotKey = (screen, v) => `${screen}|${JSON.stringify(v)}`;

async function preparePage(page, context, config, checkout) {
  const deterministic = config.determinism || {};
  if (deterministic.time !== undefined) await page.clock.setFixedTime(deterministic.time);
  const seed = deterministic.seed === undefined ? null : parseInt(hash(String(deterministic.seed)).slice(0, 8), 16);
  const eventNames = [...new Set([config.readiness?.event, ...config.screens.map((screen) => screen.readiness?.event)].filter(Boolean))];
  await page.addInitScript(({ seed, fixture, eventNames }) => {
    if (seed !== null) {
      let state = seed;
      Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    }
    window.__SCREENS_FIXTURE__ = fixture;
    window.__SCREENS_READY_EVENTS__ = {};
    for (const name of eventNames) window.addEventListener(name, () => { window.__SCREENS_READY_EVENTS__[name] = true; }, { once: true });
  }, { seed, fixture: { version: config.fixture, ...(config.fixtureData || {}) }, eventNames });
  if (config.network?.har) await context.routeFromHAR(resolve(checkout, config.network.har), { update: false, notFound: "abort" });
}
async function waitForScreen(page, screen, config) {
  const readiness = { ...(config.readiness || {}), ...(screen.readiness || {}) };
  const timeout = readiness.timeoutMs || 30000;
  if (screen.ready || readiness.selector) await page.locator(readiness.selector || screen.ready).waitFor({ state: readiness.state || "visible", timeout });
  if (readiness.event) await page.waitForFunction((name) => window.__SCREENS_READY_EVENTS__?.[name], readiness.event, { timeout });
  await page.evaluate(async (fonts) => { for (const font of fonts) await document.fonts.load(font); await document.fonts.ready; }, readiness.fonts || []);
}

export async function captureRevision(store, options) {
  requireThat(options.execute === "yes", "Capture executes project commands. Review the configuration, then pass --execute yes.");
  const signal = options.signal;
  signal?.throwIfAborted();
  const config = captureConfig(options.config, { profile: options.profile, screens: options.screens }), project = config.value.project;
  const repo = realpathSync(options.repo), revision = resolveRevision(repo, options.ref), role = choice(options.role || "pr", ["current", "target", "pr"], "role");
  const output = resolve(options.output);
  requireThat(!existsSync(output), "Capture output must be a new directory"); mkdirSync(output, { recursive: true });
  const manifestPath = join(output, "screens.json"), screens = config.value.screens.map((screen) => ({ ...screen, route: screen.path, captures: [] }));
  const emit = async (type, data = {}) => { const event = { type, at: new Date().toISOString(), revision, ...data }; await options.onEvent?.(event); };
  const persisted = new Map(), captureIds = [];
  store.project(project);
  for (const screen of screens) store.screen({ project: project.id, ...screen, route: screen.path });
  for (const id of options.priorCaptureIds || []) {
    const capture = store.getCapture(id);
    if (capture.revision === revision && capture.role === role && capture.fixture === config.value.fixture && capture.provenance.includes(`config ${config.hash};`)) persisted.set(slotKey(capture.screen, capture.variant), capture);
  }
  let logText = "", server, browser, workspace;
  const log = (chunk) => { logText = (logText + chunk).slice(-2 * 1024 * 1024); };
  const abort = () => { void stop(server); if (browser) void browser.close().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await emit("capture.started", { configHash: config.hash, total: screens.length * config.value.variants.length });
    const needed = config.value.variants.some((v) => screens.some((s) => !persisted.has(slotKey(`${project.id}/${s.key}`, captureVariant(v)))));
    let checkout, base;
    if (needed) {
      workspace = mkdtempSync(join(tmpdir(), "screens-capture-")); checkout = join(workspace, "checkout");
      await execute(["git", "clone", "--no-hardlinks", "--no-checkout", "--", repo, checkout], workspace, process.env, log, signal);
      await execute(["git", "-C", checkout, "checkout", "--detach", revision], workspace, process.env, log, signal);
      const port = await availablePort();
      const env = { ...process.env, ...(config.value.env || {}), PORT: String(port), SCREENS_CAPTURE_PORT: String(port), SCREENS_HOST: "127.0.0.1", SCREENS_HOME: join(workspace, "registry"), SCREENS_FIXTURE_VERSION: config.value.fixture };
      const cwd = realpathSync(resolve(checkout, config.value.directory || ".")), rel = relative(realpathSync(checkout), cwd);
      requireThat(rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel), "Capture directory must stay inside checkout");
      for (const command of config.value.prepare || []) { await emit("capture.preparing", { command: command[0] }); await execute(command, cwd, env, log, signal); }
      server = runCommand(config.value.serve, cwd, env, log); let spawnError; server.on("error", (error) => { spawnError = error; });
      base = `http://127.0.0.1:${port}`; let ready = false;
      for (let i = 0; i < 300; i++) {
        signal?.throwIfAborted(); if (spawnError) throw spawnError;
        requireThat(server.exitCode === null && !server.signalCode, "Capture server exited before readiness", 422);
        try { if ((await fetch(base + (config.value.readyPath || "/"), { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
        await new Promise((done) => setTimeout(done, 200));
      }
      requireThat(ready, "Capture server did not become ready within 60 seconds", 422);
    }
    for (const v of config.value.variants) {
      signal?.throwIfAborted();
      const wanted = captureVariant(v), pending = screens.some((s) => !persisted.has(slotKey(`${project.id}/${s.key}`, wanted)));
      let context, page, collector;
      if (pending) {
        browser = await (await captureBrowser(v.browser)).launch({ headless: true });
        context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1, colorScheme: v.theme || "light", locale: v.locale || "en", timezoneId: config.value.determinism?.timezone || "UTC", reducedMotion: config.value.animationTime === undefined ? "reduce" : "no-preference", serviceWorkers: config.value.network?.har ? "block" : "allow" });
        page = await context.newPage(); await preparePage(page, context, config.value, checkout);
        collector = startBrowserEvidence(page, { fonts: true, ...(config.value.evidence || {}) });
      }
      try {
        for (const [i, screen] of screens.entries()) {
          signal?.throwIfAborted();
          const slot = slotKey(`${project.id}/${screen.key}`, wanted), file = `${i}-${hash(JSON.stringify(v)).slice(0, 12)}.png`;
          let capture = persisted.get(slot), environment;
          if (capture) {
            writeFileSync(join(output, file), store.image(capture.id).bytes, { flag: "wx" });
            await emit("capture.resumed", { capture: capture.id, slot });
          } else {
            collector.reset(); await emit("capture.navigating", { screen: screen.key, variant: wanted });
            await page.goto((config.value.network?.origin || base) + screen.path, { waitUntil: screen.readiness?.waitUntil || config.value.readiness?.waitUntil || "networkidle", timeout: screen.readiness?.timeoutMs || config.value.readiness?.timeoutMs || 30000 });
            await waitForScreen(page, screen, config.value);
            if (v.textScale && v.textScale !== "default" && Number(v.textScale) !== 1) await page.evaluate((scale) => { const root = document.documentElement; root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * scale}px`; }, Number(v.textScale));
            const animationTime = screen.animationTime ?? config.value.animationTime;
            if (animationTime !== undefined) await page.evaluate((time) => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; } }, animationTime);
            const collected = await collector.collect({ fullPage: screen.fullPage ?? true, fixture: { version: config.value.fixture, ...(config.value.fixtureData || {}) }, revision, selectors: screen.annotations || config.value.annotations || [] });
            const bytes = await page.screenshot({ path: join(output, file), fullPage: screen.fullPage ?? true, animations: animationTime === undefined ? "disabled" : "allow" });
            signal?.throwIfAborted();
            environment = { browser: v.browser, browserVersion: browser.version(), operatingSystem: { platform: platform(), release: release(), arch: arch() }, node: process.version, variant: wanted, deviceScaleFactor: 1, reducedMotion: animationTime === undefined ? "reduce" : "no-preference", animationTime: animationTime ?? null, determinism: config.value.determinism || {}, fixture: config.value.fixture, fixtureData: config.value.fixtureData || {}, configHash: config.hash, networkReplay: config.value.network?.har ? { hash: hash(readFileSync(resolve(checkout, config.value.network.har))), origin: config.value.network.origin || null } : null };
            capture = store.capture({ screen: `${project.id}/${screen.key}`, role, revision, bytes, fixture: config.value.fixture, variant: wanted, provenance: `Browser capture from isolated Git commit ${revision}; config ${config.hash}; ${v.browser} ${browser.version()}; screenshot ${hash(bytes)}; fixture ${config.value.fixture}` });
            await attachBrowserEvidence(store, capture.id, { ...collected, environment });
            await options.onCapture?.({ capture, slot, environment });
            await emit("capture.completed", { capture: capture.id, slot });
          }
          captureIds.push(capture.id);
          screen.captures.push({ file, role, revision, fixture: capture.fixture, variant: wanted, provenance: capture.provenance });
        }
      } finally { collector?.dispose(); if (context) await context.close(); if (browser) { await browser.close(); browser = null; } }
    }
    writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, project, screens, title: options.title || `${role} · ${revision.slice(0, 8)}` }, null, 2) + "\n", { flag: "wx" });
    const run = store.run({ project: project.id, title: options.title || `${role} · ${revision.slice(0, 8)}`, captureIds, source: { kind: "browser-capture", revision, configHash: config.hash, manifestHash: hash(readFileSync(manifestPath)) } });
    await emit("capture.finished", { run: run.id, captureIds });
    return { project: store.projects().find((item) => item.id === project.id), importedScreens: screens.length, warnings: [], run, revision, manifest: manifestPath, configHash: config.hash };
  } finally {
    signal?.removeEventListener("abort", abort);
    try { if (browser) await browser.close(); }
    finally { try { await stop(server); } finally { writeFileSync(join(output, "capture.log"), logText, { flag: "wx" }); if (workspace) rmSync(workspace, { recursive: true, force: true }); } }
  }
}
export async function captureComparison(store, options) {
  const config = captureConfig(options.config, { profile: options.profile }), repo = realpathSync(options.repo);
  const context = options.context || { kind: "git-revisions", base: resolveRevision(repo, options.base), head: resolveRevision(repo, options.head) };
  const base = resolveRevision(repo, context.mergeBase || context.base), head = resolveRevision(repo, context.head), output = resolve(options.output);
  const current = await captureRevision(store, { ...options, ref: base, role: "current", output: join(output, "current") });
  const pr = await captureRevision(store, { ...options, ref: head, role: "pr", output: join(output, "pr") });
  if (options.verifyPR) requireThat((await resolvePullRequest(context.repository, context.number)).head === head, "PR head changed during capture; evidence retained, comparison not published", 409);
  const run = combineRuns(store, { project: config.value.project.id, current: current.run.id, pr: pr.run.id, target: options.target, title: options.title || (context.number ? `PR ${context.number} · ${context.title}` : "Git revision comparison"), source: { ...context, mergeBase: base, head, captureStatus: "captured", configHash: config.hash } });
  writeFileSync(join(output, "comparison.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx" });
  return { run, current, pr, url: `http://127.0.0.1:${options.port || 4800}/?project=${encodeURIComponent(run.project)}&run=${run.id}` };
}
