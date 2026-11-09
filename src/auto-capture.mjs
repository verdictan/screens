import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import sharp from "sharp";
import { automaticInput, identityHash } from "./automatic-plan.mjs";
import { nativeApplications, nativeReadySpec, waitNativeReady } from "./native-contract.mjs";
import { fixtureBoundaries } from "./fixture-boundaries.mjs";
import { captureSummary } from "./capture-summary.mjs";
import { substitute } from "./capture-environment.mjs";
import { launch, command, stop } from "./capture-process.mjs";
import { defaultVariants, expandCaptureConfig, recipeHash, scenarioSelected } from "./capture-recipe.mjs";
import { startBrowserEvidence, attachBrowserEvidence } from "./evidence-tools.mjs";
import { platform, release, arch } from "node:os";
import { managedEnvironment } from "./capture-environment.mjs";
import { authenticate, readiness, performSteps, resolveScenarios, prepareBrowserPage, scenarioReadiness } from "./capture-scenarios.mjs";
import { createCoverage, recordCoverage, finishCoverage } from "./screen-inventory.mjs";
import { captureBrowser, gitOutput } from "./runtime.mjs";
import { manifestCaptures } from "./import.mjs";

const delay = (ms) => new Promise(done => setTimeout(done, ms));
const hash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const defaults = defaultVariants;

async function listen(server, port = 0) {
  server.listen(port, "127.0.0.1"); await once(server, "listening"); return server.address().port;
}

function staticServer(directory) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  return createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      let file = resolve(directory, "." + decodeURIComponent(url.pathname));
      if (statSync(file).isDirectory()) file = join(file, "index.html");
      file = realpathSync(file);
      const rel = relative(directory, file);
      if (rel.startsWith("..") || isAbsolute(rel)) { response.writeHead(403).end(); return; }
      response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" });
      response.end(readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
}

function webCommand(app, cwd, port) {
  const file = join(cwd, "package.json");
  if (!existsSync(file)) throw Error("No start command found; set serve or baseUrl in screens.capture.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  const script = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : null;
  if (!script) throw Error("No dev or start script; set serve or baseUrl in screens.capture.json");
  const source = pkg.scripts[script];
  let flags;
  if (/\bnext\s+(?:dev|start)\b/.test(source)) flags = ["--hostname", "127.0.0.1", "--port", String(port)];
  else if (/\b(?:vite|astro|nuxt|nuxi)\b/.test(source)) flags = ["--host", "127.0.0.1", "--port", String(port)];
  else if (/\bng\s+serve\b/.test(source)) flags = ["--host", "127.0.0.1", "--port", String(port)];
  else if (/\breact-scripts\s+start\b/.test(source)) flags = [];
  else throw Error("Start script has no known port interface; set serve in screens.capture.json with {port}");
  const manager = pkg.packageManager?.split("@")[0] || (existsSync(join(cwd, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(cwd, "yarn.lock")) ? "yarn" : "npm");
  if (!["npm", "pnpm", "yarn", "bun"].includes(manager)) throw Error(`Unsupported package manager: ${manager}`);
  return [process.platform === "win32" ? `${manager}.cmd` : manager, "run", script, ...(manager === "npm" ? ["--"] : []), ...flags];
}

async function prepareApplication(app, context) {
  for (const args of app.prepare || []) {
    await context.emit?.({ type: "capture.preparing", command: args[0] });
    await command(args, context);
  }
}

async function browserCaptures(app, context, save) {
  let server, http, browser;
  const errors = [];
  const abort = () => { void stop(server); void browser?.close().catch(() => {}); };
  context.signal?.addEventListener("abort", abort, { once: true });
  try {
    let base = app.baseUrl, port;
    if (!base) {
      const probe = createServer(); port = await listen(probe); await new Promise(done => probe.close(done));
      context.env = { ...context.env, PORT: String(port), HOST: "127.0.0.1", BROWSER: "none", SCREENS_CAPTURE_PORT: String(port) };
    }
    await prepareApplication(app, context);
    if (!base) {
      if (app.frameworks?.includes("Static HTML") && !app.serve) {
        http = staticServer(context.cwd); base = `http://127.0.0.1:${await listen(http, port)}`;
      } else {
        const args = app.serve ? app.serve.map(arg => arg.replaceAll("{port}", String(port))) : webCommand(app, context.cwd, port);
        server = launch(args, context.cwd, context.env, context.log);
        base = `http://127.0.0.1:${port}`;
        let ready = false;
        for (let i = 0; i < 600; i++) {
          context.signal?.throwIfAborted();
          if (server.failure) throw server.failure;
          if (server.exitCode !== null || server.signalCode) throw Error("App server exited before readiness");
          try { const response = await fetch(base + (app.readyPath || "/"), { signal: AbortSignal.timeout(1000) }); if (response.status < 500) { ready = true; break; } } catch {}
          await delay(200);
        }
        if (!ready) throw Error("App server did not become ready");
      }
    }
    const origin = new URL(base);
    if (!["http:", "https:"].includes(origin.protocol)) throw Error("baseUrl must use HTTP or HTTPS");
    const plan = await resolveScenarios({ ...app, baseUrl: base }, context.detection, context);
    app.scenarios = plan.routes; errors.push(...plan.issues);
    for (const variant of app.variants) {
      browser = await (await captureBrowser(variant.browser)).launch({ headless: true });
      for (const route of app.scenarios) {
        context.signal?.throwIfAborted(); context.assertRunning();
        if (route.requiresParameters || /[\[\]]/.test(route.path)) { errors.push(`${route.path}: needs concrete route parameters`); continue; }
        let session;
        try {
        await context.fixtures.enter({ application: app.path, scenario: route.key || route.path, group: route.group, variant, baseUrl: base });
        const checkpoint = context.checkpoint(route, variant, `${variant.browser} ${browser.version()}`);
        const captureKey = route.key || `route-${hash(route.path)}`;
        if (await context.savePrior(checkpoint, route, variant, captureKey)) continue;
        const auth = route.auth === false ? null : await authenticate(browser, app.auth, context.cwd, base, context.signal);
        const state = auth ? await auth.storageState() : app.storageState ? resolve(context.cwd, app.storageState) : undefined;
        const headers = auth?.captureHeaders;
        const animationTime = route.animationTime ?? app.animationTime;
        await auth?.close();
        session = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, deviceScaleFactor: 1, colorScheme: variant.theme, locale: variant.locale, timezoneId: app.determinism?.timezone || "UTC", reducedMotion: animationTime === undefined ? "reduce" : "no-preference", serviceWorkers: app.network?.har ? "block" : "allow",
          ...(route.auth !== false && state ? { storageState: state } : {}), ...(route.auth !== false && headers ? { extraHTTPHeaders: headers } : {}) });
        const page = await session.newPage();
        await prepareBrowserPage(page, session, app, route, context.cwd);
        const collector = startBrowserEvidence(page, { fonts: true, ...(app.evidence || {}), ...(route.evidence || {}) });
        const request = { version: 1, requestId: randomUUID(), screen: route.key || route.path, fixture: app.fixture || context.fixtures.definition.version || null };
        await page.addInitScript(value => { window.__SCREENS_CAPTURE_REQUEST__ = value; }, request);
        const pageErrors = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        let outcome = { status: "unverified", reason: "No readiness condition" };
        try {
          const origin = new URL(route.baseUrl || app.network?.origin || base), url = new URL(route.path, origin);
          if (url.origin !== origin.origin) throw Error("Route points outside the application origin");
          try {
            await context.emit?.({ type: "capture.navigating", screen: route.key || route.path, variant });
            await route.beforeGoto?.(page);
            const response = await page.goto(url.href, { waitUntil: scenarioReadiness(app, route).waitUntil || "domcontentloaded", timeout: scenarioReadiness(app, route).timeoutMs || app.timeoutMs || 60000 });
            if (response?.status() !== (route.expectedStatus || 200)) throw Error(`HTTP ${response?.status() || "no response"}`);
            await performSteps(page, route.steps);
            await route.afterLoad?.(page);
            outcome = await readiness(page, { ...(context.detection.assets.readiness.some(item => item.application === app.path) ? { contract: { required: true } } : {}), ...scenarioReadiness(app, route) }, request);
            await page.evaluate(() => document.fonts.ready);
            await page.waitForTimeout(app.settleMs ?? 300);
            if (new URL(page.url()).pathname !== new URL(route.expectedPath || route.path, origin).pathname) throw Error("Unexpected navigation; configure expectedPath or authentication");
            if (pageErrors.length && !route.allowPageErrors) throw Error(`Page error: ${pageErrors.join("; ")}`);
          } catch (error) { outcome = { status: "failed", reason: error.message }; }
          if (outcome.status !== "passed") errors.push(`${variant.device} ${route.path}: ${outcome.reason}`);
          if (variant.textScale !== "default" && Number(variant.textScale) !== 1) await page.evaluate(scale => { const root = document.documentElement; root.style.fontSize = `${parseFloat(getComputedStyle(root).fontSize) * scale}px`; }, Number(variant.textScale));
          if (animationTime !== undefined) await page.evaluate(time => { for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; } }, animationTime);
          const observation = collector.checkpoint();
          const collected = await collector.collect({ fullPage: route.fullPage ?? true, fixture: { version: app.fixture, ...(app.fixtureData || {}) }, revision: context.revision, selectors: route.annotations || app.annotations || [] });
          const environment = { browser: variant.browser, browserVersion: browser.version(), operatingSystem: { platform: platform(), release: release(), arch: arch() }, node: process.version, variant, deviceScaleFactor: 1, determinism: app.determinism || {}, fixture: app.fixture, fixtureData: app.fixtureData || {}, configHash: context.configHash, animationTime: animationTime ?? null, networkReplay: app.network?.har ? { hash: recipeHash(readFileSync(resolve(context.cwd, app.network.har))), origin: app.network.origin || null } : null };
          const bytes = await page.screenshot({ fullPage: route.fullPage ?? true, animations: animationTime === undefined ? "disabled" : "allow" });
          collector.assertCurrent(observation);
          await save({ evidence: { ...collected, environment }, checkpoint, coverageKey: route.key || route.path, key: captureKey, title: route.title || route.path, route: route.path, bytes, readiness: outcome,
            variant: { device: variant.device, viewport: `${variant.width}x${variant.height}`, theme: variant.theme, locale: variant.locale, browser: variant.browser, textScale: variant.textScale },
            provenance: `${context.mode === "commit" ? "Browser capture from isolated Git commit " + context.revision : "Working-tree browser capture"}; config ${context.configHash}; ${app.path}; ${route.path}; ${variant.browser} ${browser.version()}; readiness ${outcome.status}; fixture ${app.fixture || "uncontrolled"}.` });
        } catch (error) { errors.push(`${variant.device} ${route.path}: ${error.message}`); }
        finally { collector.dispose(); }
        } catch (error) { errors.push(`${variant.device} ${route.path}: ${error.message}`); }
        finally { await session?.close(); }
      }
      await browser.close(); browser = undefined;
    }
    return errors;
  } finally {
    context.signal?.removeEventListener("abort", abort);
    try {
      if (context.ownsFixtures) await context.fixtures.close();
    } finally {
      await browser?.close();
      await stop(server);
      if (http) { http.closeAllConnections(); await new Promise(done => http.close(done)); }
    }
  }
}

async function appleCaptures(app, context, save) {
  if (process.platform !== "darwin") throw Error("Apple capture requires macOS and Xcode; it cannot run inside Docker");
  const project = [app.path.endsWith(".xcworkspace") ? "-workspace" : "-project", resolve(context.root, app.path)];
  let scheme = app.scheme;
  if (!scheme) {
    const listing = JSON.parse(await command(["xcodebuild", ...project, "-list", "-json"], context));
    const info = listing.project || listing.workspace;
    const choices = info.schemes || [];
    const exact = choices.filter(name => name === basename(app.path, extname(app.path)));
    if (choices.length === 1) scheme = choices[0];
    else if (exact.length === 1) scheme = exact[0];
    else throw Error(`Choose an app scheme in screens.capture.json: ${choices.join(", ")}`);
  }
  const toolchain = await command(["xcodebuild", "-version"], context);
  const issues = [], states = app.scenarios || [];
  const platforms = app.platforms || [];
  const mobile = platforms.some(platform => ["iphone", "ipad", "ios"].includes(platform));
  if (!mobile && !platforms.includes("macos")) throw Error("Set macos, iphone or ipad platforms in screens.capture.json");
  const destinations = [...(platforms.includes("macos") ? ["macos"] : []), ...(mobile ? ["ios"] : [])];
  for (const platform of destinations) {
    try {
      const derived = join(context.output, platform, "DerivedData");
      const flags = [...project, "-scheme", scheme, "-configuration", "Debug", "-derivedDataPath", derived,
        "-destination", platform === "macos" ? "platform=macOS" : "generic/platform=iOS Simulator"];
      await command(["xcodebuild", ...flags, "build", "-quiet"], context, 1800000);
      const settings = JSON.parse(await command(["xcodebuild", ...flags, "-showBuildSettings", "-json"], context));
      const products = settings.filter(item => item.buildSettings.WRAPPER_EXTENSION === "app");
      const matching = products.filter(item => item.target === scheme);
      const selected = app.target ? products.filter(item => item.target === app.target) : matching.length === 1 ? matching : products;
      if (selected.length !== 1) throw Error("Set target in screens.capture.json to select one application product");
      const values = selected[0].buildSettings;
      const bundle = join(values.TARGET_BUILD_DIR, values.FULL_PRODUCT_NAME);
      const bundleId = values.PRODUCT_BUNDLE_IDENTIFIER;
      if (platform === "macos") {
        for (const state of states.filter(state => !state.platforms || state.platforms.includes("macos"))) {
          try {
          const variant = { device: "mac", browser: "native" };
          await context.fixtures.enter({ application: app.path, scenario: state.key, group: state.group, variant });
          const checkpoint = context.checkpoint(state, variant, toolchain);
          if (await context.savePrior(checkpoint, state, variant, state.key)) continue;
          const file = join(context.output, `${hash(state.key)}-mac.png`);
          const spec = nativeReadySpec(state, context, { requestId: randomUUID(), fixture: app.fixture || context.fixtures.definition.version, profile: app.nativeProfile, platform: "macos" });
          const env = { ...app.env, ...(spec ? { SCREENS_READY_FILE: spec.file, SCREENS_REQUEST_ID: spec.request.requestId, SCREENS_SCREEN_ID: state.key, SCREENS_FIXTURE: spec.request.fixture || "", SCREENS_FIXTURE_PROFILE: app.nativeProfile || "" } : {}) };
          const helper = fileURLToPath(new URL("../scripts/capture-macos.swift", import.meta.url));
          const response = JSON.parse(await command(["xcrun", "swift", helper, bundle, file, String(app.settleMs ?? 3000), JSON.stringify(env), JSON.stringify(spec), ...(state.args || [])], context));
          await save({ checkpoint, readiness: spec ? response.readiness : undefined, readinessCommand: state.readinessCommand, coverageKey: state.key, key: state.key, title: state.title, bytes: readFileSync(file), variant: { device: "mac", browser: "native" }, fixture: state.fixture,
            provenance: `Native macOS window capture; Xcode scheme ${scheme}; target ${selected[0].target}; state ${state.key}. ${context.mode === "commit" ? "Build from isolated Git commit " + context.revision : "Fresh working-tree build"}; declared scenario ${state.key}.` });
          } catch (error) { issues.push(`macos ${state.key}: ${error.message}`); }
        }
      } else {
        const catalog = JSON.parse(await command(["xcrun", "simctl", "list", "--json"], context));
        const runtimes = catalog.runtimes.filter(runtime => runtime.isAvailable && runtime.identifier.includes(".iOS-"))
          .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
        if (!runtimes.length) throw Error("Install an iOS Simulator runtime in Xcode");
        const families = platforms.includes("ios") ? ["iphone", "ipad"] : platforms.filter(value => ["iphone", "ipad"].includes(value));
        for (const family of families) {
          let simulator;
          try {
            const type = catalog.devicetypes.find(type => type.productFamily === (family === "iphone" ? "iPhone" : "iPad"));
            if (!type) throw Error(`No ${family} simulator device type installed`);
            simulator = (await command(["xcrun", "simctl", "create", `Screens-${randomUUID()}`, type.identifier, runtimes[0].identifier], context)).trim();
            await command(["xcrun", "simctl", "boot", simulator], context);
            await command(["xcrun", "simctl", "bootstatus", simulator, "-b"], context);
            await command(["xcrun", "simctl", "install", simulator, bundle], context);
            const container = (await command(["xcrun", "simctl", "get_app_container", simulator, bundleId, "data"], context)).trim();
            for (const state of states.filter(state => !state.platforms || state.platforms.includes(family) || state.platforms.includes("ios"))) {
              context.signal?.throwIfAborted();
              try {
              const variant = { device: family, browser: "native" };
              context.env = { ...context.env, SCREENS_SIMULATOR: simulator, SCREENS_BUNDLE_ID: bundleId };
              await context.fixtures.enter({ application: app.path, scenario: state.key, group: state.group, variant });
              const checkpoint = context.checkpoint(state, variant, `${toolchain}; ${type.identifier}; ${runtimes[0].identifier}; ${runtimes[0].version}`);
              if (await context.savePrior(checkpoint, state, variant, state.key)) continue;
              const spec = nativeReadySpec(state, context, { container, requestId: randomUUID(), fixture: app.fixture || context.fixtures.definition.version, profile: app.nativeProfile, platform: family });
              const nativeEnv = { ...app.env, ...(spec ? { SCREENS_READY_FILE: spec.appFile, SCREENS_REQUEST_ID: spec.request.requestId, SCREENS_SCREEN_ID: state.key, SCREENS_FIXTURE: spec.request.fixture || "", SCREENS_FIXTURE_PROFILE: app.nativeProfile || "" } : {}) };
              await command(["xcrun", "simctl", "launch", "--terminate-running-process", simulator, bundleId, ...(state.args || [])], { ...context, env: { ...context.env, ...Object.fromEntries(Object.entries(nativeEnv).map(([key, value]) => [`SIMCTL_CHILD_${key}`, value])) } });
              const ready = await waitNativeReady(spec, context.signal);
              await delay(app.settleMs ?? 5000);
              const file = join(context.output, `${hash(state.key)}-${family}.png`);
              await command(["xcrun", "simctl", "io", simulator, "screenshot", "--type=png", file], context);
              await save({ checkpoint, readiness: spec ? ready : undefined, readinessCommand: state.readinessCommand, coverageKey: state.key, key: state.key, title: state.title, bytes: readFileSync(file), fixture: state.fixture,
                variant: { device: family, browser: "native" },
                provenance: `Native ${family} Simulator capture; ${type.name}; ${runtimes[0].name}; scheme ${scheme}; state ${state.key}. ${context.mode === "commit" ? "Build from isolated Git commit " + context.revision : "Fresh working-tree build"}; simulator fixture evidence.` });
              } catch (error) { issues.push(`${family} ${state.key}: ${error.message}`); }
            }
          } catch (error) { issues.push(`${family}: ${error.message}`); }
          finally {
            if (simulator) {
              const cleanup = { ...context, signal: undefined };
              await command(["xcrun", "simctl", "shutdown", simulator], cleanup).catch(error => issues.push(error.message));
              await command(["xcrun", "simctl", "delete", simulator], cleanup).catch(error => issues.push(error.message));
            }
          }
        }
      }
    } catch (error) { issues.push(`${platform}: ${error.message}`); }
  }
  return issues;
}

export async function captureAutomatic(store, options) {
  return executeCaptureRecipe(store, { ...options, input: automaticInput(options.path || ".", options) });
}

export async function executeCaptureRecipe(store, options) {
  if (options.execute !== "yes") throw Error("Pass --execute yes to run capture recipes");
  const { detection, root, config, inputHash } = options.input;
  const project = { id: options.project || config.project?.id || basename(root).replace(/[^a-zA-Z0-9._-]/g, "-") || "app", name: options.name || config.project?.name || basename(root) || "App" };
  const output = resolve(options.output || join(root, ".screens", "captures", `${Date.now()}-${randomUUID()}`));
  if (existsSync(output)) throw Error("Capture output must be a new directory");
  mkdirSync(output, { recursive: true });
  store.project(project);
  let completed;
  let managed, rootFixtures, logText = options.preparationLog || "";
  try {
  if (options.expectedInputHash && options.expectedInputHash !== inputHash) throw Error("Source or capture inputs changed; create a new automatic capture job");
  const native = nativeApplications(detection.nativeContract);
  const nativeRecipe = detection.recipes.find(recipe => recipe.path === "." && recipe.name === "screens:capture");
  let applications = config.applications.length ? config.applications : (nativeRecipe
    ? [{ path: ".", adapter: "command", command: [process.platform === "win32" ? "npm.cmd" : "npm", "run", "screens:capture"] }]
    : detection.applications.map(app => native.find(item => item.path === app.path) || ({ path: app.path, frameworks: app.frameworks, platforms: app.platforms, adapter: app.kind === "web" ? "browser" : app.frameworks.includes("Xcode") ? "apple" : "unsupported" })));
  for (const app of applications) {
    const detected = detection.applications.find(candidate => candidate.path === app.path);
    if (!app.frameworks) app.frameworks = detected?.frameworks;
    if (app.adapter === "browser") {
      const configured = app.scenarios || [];
      app.scenarios = [...configured, ...(config.scope === "discovered" ? detected?.routes || [] : []).filter(route => !configured.some(item => item.path === route.path || (item.covers || []).some(id => (route.covers || []).includes(id)))).map(route => ({ ...route, inferred: true }))];
      if (!app.scenarios.length && config.scope === "discovered") app.scenarios = [{ path: "/", inferred: true }];
    }
    if (app.adapter === "apple") {
      const source = detection.nativeContract?.applications.find(item => item.path === app.path);
      const declared = source ? nativeApplications({ source: detection.nativeContract.source, applications: [source] }, app.nativeProfile)[0] : null;
      if (declared) Object.assign(app, { ...declared, ...app, scenarios: app.scenarios || declared.scenarios });
    }
    if (app.adapter === "apple" && !app.scenarios?.length && config.scope === "discovered") app.scenarios = [{ key: "launch", title: "Launch screen", args: [] }];
    if (app.adapter === "apple" && !app.platforms) app.platforms = detected?.platforms;
  }
  applications = expandCaptureConfig({ ...config, applications }).applications;
  for (const app of applications) if (app.scenarios) app.scenarios = app.scenarios.filter(scenario => scenarioSelected(config, app, scenario));
  createCoverage(detection, applications, config, defaults);
  managed = await managedEnvironment(config, detection, applications, { root, cwd: root, output, signal: options.signal, log: chunk => { logText = (logText + chunk).slice(-8 * 1024 * 1024); } }, { launch, stop, command });
  applications = managed.applications;
  rootFixtures = fixtureBoundaries(substitute(config.fixtures || {}, managed.variables), { root, cwd: root, output, env: managed.env, signal: options.signal, log: () => {} }, command);
  await rootFixtures.start();
  const excludedIds = new Set((config.coverage?.exclude || []).map(item => item.id));
  for (const app of applications) if (app.adapter === "browser") {
    app.scenarios = app.scenarios.filter(route => {
      const ids = route.covers || detection.inventory.items.filter(item => item.application === app.path && item.kind === "route" && item.route === route.path).map(item => item.id);
      return !ids.length || !ids.every(id => excludedIds.has(id));
    });
  }

  json(join(output, "inventory.json"), detection.inventory);
  if (options.url) {
    const web = applications.filter(app => app.adapter === "browser");
    if (web.length !== 1) throw Error("--url requires exactly one browser application; configure baseUrl per app in screens.capture.json");
    web[0].baseUrl = options.url;
  }
  let revision = options.revision || "unknown";
  try { if (!options.revision) revision = `${gitOutput(root, ["rev-parse", "HEAD"], { stdio: ["pipe", "pipe", "ignore"] })}-tree-${inputHash.slice(0, 16)}`; } catch {}
  const manifest = { schemaVersion: 1, project, screens: [] }, results = [], captures = new Map(), observations = [];
  const report = { project, output, detection, applications: results, run: null, url: null, coverage: null, environment: managed.report, scenarios: observations, job: options.job || null, inputHash, fixtureEvents: rootFixtures.events };
  report.decisions = options.input.decisions;
  report.revision = revision; report.configHash = options.configHash || recipeHash(config); report.manifest = join(output, "screens.json");
  const emit = event => options.onEvent?.({ at: new Date().toISOString(), revision, ...event });
  const collect = (id) => { const capture = store.getCapture(id); captures.set(`${capture.screen}|${JSON.stringify(capture.variant)}|${capture.role}`, id); };
  for (const [index, app] of applications.entries()) {
    if (options.signal?.aborted) {
      for (const pending of applications.slice(index)) results.push({ path: pending.path, adapter: pending.adapter, captures: 0, status: "failed", issues: ["Capture interrupted"] });
      break;
    }
    const directory = join(output, `app-${index}`); mkdirSync(directory);
    const path = app.path;
    const result = { path, adapter: app.adapter, captures: 0, issues: [], status: "running" }; results.push(result);
    let log = "";
    const context = { root, detection, recipe: config, revision, configHash: report.configHash, mode: options.mode || "working-tree", scope: config.scope, emit: event => emit({ application: path, ...event }), assertRunning() { managed.assertRunning(); options.assertOwnership?.(); }, cwd: resolve(root, path.endsWith(".xcodeproj") || path.endsWith(".xcworkspace") ? dirname(path) : path), output: directory, signal: options.signal,
      env: { ...app.env, SCREENS_OUTPUT_DIR: directory, SCREENS_MANIFEST: join(directory, "screens.json"), SCREENS_PROJECT_ID: project.id, SCREENS_FIXTURE_VERSION: app.fixture || app.fixtures?.version || config.fixtures?.version || "" }, log: chunk => { log = (log + chunk).slice(-8 * 1024 * 1024); logText = (logText + chunk).slice(-8 * 1024 * 1024); } };
    const fixtures = app.fixtures ? fixtureBoundaries(app.fixtures, context, command) : rootFixtures;
    result.fixtureEvents = fixtures.events;
    context.fixtures = fixtures; context.ownsFixtures = fixtures !== rootFixtures;
    const controlledFixture = app.fixture || fixtures.definition.version;
    result.reusePolicy = { controlledFixture: controlledFixture || null, rule: "Matching ready evidence from an independent or reset scenario" };
    context.checkpoint = (recipe, variant, toolchain) => {
      const identity = identityHash({ application: index, path, scenario: recipe.key || recipe.path, variant });
      const normalized = JSON.stringify(recipe, (_, value) => typeof value === "function" ? value.toString() : value)?.replaceAll(output, "{output}").replace(/https?:\/\/127\.0\.0\.1:\d+/g, "local-service");
      const fingerprint = identityHash({ inputHash, identity, recipe: normalized, toolchain });
      const prior = controlledFixture && fixtures.reusable(recipe) ? options.priorCheckpoints?.find(item => item.identity === identity && item.fingerprint === fingerprint && item.readiness.status === "passed") : null;
      return { identity, fingerprint, prior };
    };
    context.savePrior = async (checkpoint, recipe, variant, key) => {
      const prior = checkpoint.prior;
      if (!prior) return false;
      let capture, bytes;
      try { capture = store.getCapture(prior.captureId); bytes = store.image(capture.id).bytes; }
      catch (error) { if (error.status === 404 || error.code === "ENOENT") return false; throw error; }
      await save({ key, coverageKey: recipe.key || recipe.path, title: recipe.title || recipe.key || recipe.path, route: recipe.path,
        bytes, variant: capture.variant, readiness: prior.readiness, checkpoint, priorCapture: capture });
      return true;
    };
    const save = async (item) => {
      const metadata = await sharp(item.bytes).metadata();
      const key = path === "." ? item.key : `${path}/${item.key}`;
      let entry = manifest.screens.find(screen => screen.key === key);
      if (!entry) {
        entry = { key, title: item.title, state: item.key, route: item.route, group: path, captures: [] };
        manifest.screens.push(entry); store.screen({ project: project.id, ...entry });
      }
      const variant = { ...item.variant, viewport: item.variant.viewport || `${metadata.width}x${metadata.height}`, theme: item.variant.theme || app.theme || "unspecified", locale: item.variant.locale || app.locale || "unspecified", textScale: item.variant.textScale || "default" };
      const input = { role: options.role || "current", variant, revision, fixture: item.fixture || app.fixture || fixtures.definition.version || "uncontrolled-working-tree", provenance: item.provenance };
      const capture = store.transaction(() => { options.assertOwnership?.(); return item.priorCapture || store.capture({ screen: `${project.id}/${key}`, bytes: item.bytes, ...input }); });
      if (item.evidence) await attachBrowserEvidence(store, capture.id, item.evidence);
      await options.onCapture?.({ capture, slot: `${capture.screen}|${JSON.stringify(capture.variant)}`, environment: item.evidence?.environment });
      const file = `${capture.id}.png`; writeFileSync(join(directory, file), item.bytes, { flag: "wx" });
      entry.captures.push({ ...input, revision: capture.revision, fixture: capture.fixture, provenance: capture.provenance, file: `app-${index}/${file}` }); collect(capture.id); result.captures++;
      if (!item.readiness && (item.readinessCommand || app.readinessCommand)) {
        try {
          await command((item.readinessCommand || app.readinessCommand).map(arg => arg.replaceAll("{image}", join(directory, file)).replaceAll("{screen}", item.key).replaceAll("{device}", variant.device)), context);
          item.readiness = { status: "passed", method: "command" };
        } catch (error) { item.readiness = { status: "failed", reason: error.message }; result.issues.push(`Readiness failed: ${item.key}`); }
      }
      observations.push({ applicationIndex: index, key: item.coverageKey, variant, captureId: capture.id, capture: "created", readiness: item.readiness || { status: "unverified", reason: "Native readiness requires an explicit command" }, reused: Boolean(item.priorCapture) });
      if (item.checkpoint) await options.onCheckpoint?.({ identity: item.checkpoint.identity, fingerprint: item.checkpoint.fingerprint, captureId: capture.id, readiness: observations.at(-1).readiness });
      await emit({ type: item.priorCapture ? "capture.resumed" : "capture.completed", application: path, screen: key, capture: capture.id, variant });
    };
    try {
      await emit({ type: "capture.started", application: path, adapter: app.adapter });
      managed.assertRunning();
      if (app.adapter !== "browser") await prepareApplication(app, context);
      if (app.adapter === "browser") result.issues.push(...await browserCaptures(app, context, save));
      else if (app.adapter === "apple") result.issues.push(...await appleCaptures(app, context, save));
      else if (app.adapter === "command") {
        await fixtures.enter({ application: path, scenario: "command-batch", group: "command-batch" });
        const args = app.command.map(arg => arg.replaceAll("{output}", directory).replaceAll("{project}", project.id));
        await command(args, context);
        const file = resolve(directory, app.manifest || "screens.json");
        const produced = manifestCaptures(file);
        for (const { screen, capture, bytes } of produced) {
          const selected = app.scenarios?.find(item => item.key === screen.key);
          if (config.scope === "configured" && !selected) continue;
          const scenario = selected || { key: screen.key, title: screen.title || screen.key };
          if (!selected) (app.scenarios ||= []).push(scenario);
          const checkpoint = context.checkpoint(scenario, capture.variant || {}, `command-${process.version}`);
          await save({ key: scenario.key, coverageKey: scenario.key, title: scenario.title, route: screen.route,
            bytes, variant: capture.variant || {}, checkpoint, fixture: scenario.fixture || app.fixture || capture.fixture,
            readinessCommand: scenario.readinessCommand,
            provenance: `${context.mode === "commit" ? "Isolated Git commit " + revision : "Working-tree command capture"}; config ${report.configHash}; producer: ${capture.provenance || "project command"}` });
        }
        if (!result.captures) result.issues.push("Capture command produced no selected images");
      } else throw Error(`No automatic adapter for ${(app.frameworks || []).join(", ") || path}; configure a native command in screens.capture.json`);
    } catch (error) { result.issues.push(error.message); }
    finally {
      if (fixtures !== rootFixtures) { try { await fixtures.close(); } catch (error) { result.issues.push(`Fixture teardown: ${error.message}`); } }
      result.status = result.issues.length ? result.captures ? "partial" : "failed" : result.captures ? "captured" : config.selection?.scenarios ? "not-selected" : "empty";
      writeFileSync(join(directory, "capture.log"), log, { flag: "wx" });
    }
  }
  const coverage = createCoverage(detection, applications, config, defaults);
  for (const observation of observations) recordCoverage(coverage, observation.applicationIndex, observation.key, observation.variant, observation.captureId, observation.readiness);
  report.coverage = finishCoverage(coverage, results);
  try { await rootFixtures.close(); } catch (error) { report.fixtureErrors = [`Fixture teardown failed: ${error.message}`]; }
  await managed.close(); managed = undefined;
  json(join(output, "coverage.json"), report.coverage);
  json(join(output, "screens.json"), manifest);
  const warnings = [...detection.warnings, ...(report.environment.cleanupErrors || []), ...(report.fixtureErrors || []), ...results.flatMap(item => item.issues.map(issue => `${item.path}: ${issue}`))];
  if (!report.coverage.complete) warnings.push("Screen coverage is incomplete; see coverage.json for missing, failed, unresolved, and excluded items");
  if (captures.size) {
    report.run = store.run({ project: project.id, title: options.title || "Automatic captures", captureIds: [...captures.values()], warnings,
      source: { kind: "capture", mode: options.mode || "working-tree", revision, configHash: report.configHash, coverage: report.coverage } });
    report.url = `http://127.0.0.1:${options.port || process.env.PORT || 4800}/?project=${encodeURIComponent(project.id)}&run=${report.run.id}`;
  }
  if (!applications.length) warnings.push("No applications detected; define applications in screens.capture.json");
  report.warnings = warnings;
  report.status = !captures.size ? "failed" : (!report.coverage.complete || report.environment.cleanupErrors?.length || report.fixtureErrors?.length || results.some(item => item.status !== "captured" && item.status !== "not-selected")) ? "partial" : "captured";
  report.exitCode = report.status === "captured" ? 0 : 1;
  await emit({ type: "capture.finished", run: report.run?.id, captureIds: report.run?.captureIds || [] });
  report.summary = captureSummary(report);
  json(join(output, "summary.json"), report.summary);
  writeFileSync(join(output, "capture.log"), logText, { flag: "wx" });
  json(join(output, "report.json"), report);
  completed = report;
  } catch (error) {
    const failure = { project, output, status: "failed", phase: "setup-or-planning", error: error.message, environment: error.environmentReport || managed?.report, job: options.job || null, exitCode: 1 };
    if (!existsSync(join(output, "capture.log"))) writeFileSync(join(output, "capture.log"), logText, { flag: "wx" });
    failure.summary = captureSummary(failure);
    if (!existsSync(join(output, "report.json"))) json(join(output, "report.json"), failure);
    completed = failure;
  } finally { try { await rootFixtures?.close(); } finally { await managed?.close(); } }
  return completed;
}
