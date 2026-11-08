import { scenarioSelected } from "./capture-recipe.mjs";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { captureBrowser } from "./runtime.mjs";

const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 12);
const at = (value, path) => String(path || "").split(".").filter(Boolean).reduce((item, key) => item?.[key], value);
export const scenarioKey = route => route.key || route.path || route.screen;

export function scenarioReadiness(app, scenario) {
  const object = value => typeof value === "string" ? { selector: value } : value || {};
  return { ...object(app.ready), ...object(scenario.ready) };
}
export async function prepareBrowserPage(page, session, app, scenario, root) {
  if (app.determinism?.time !== undefined) await page.clock.setFixedTime(app.determinism.time);
  const seed = app.determinism?.seed === undefined ? null : parseInt(hash(String(app.determinism.seed)).slice(0, 8), 16);
  const condition = scenarioReadiness(app, scenario);
  await page.addInitScript(({ seed, fixture, event }) => {
    if (seed !== null) {
      let state = seed;
      Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296; };
    }
    window.__SCREENS_FIXTURE__ = fixture;
    window.__SCREENS_READY_EVENTS__ = {};
    if (event) window.addEventListener(event, () => { window.__SCREENS_READY_EVENTS__[event] = true; }, { once: true });
  }, { seed, fixture: { version: app.fixture, ...(app.fixtureData || {}) }, event: condition.event });
  if (app.network?.har) await session.routeFromHAR(resolve(root, app.network.har), { update: false, notFound: "abort" });
}
export async function performSteps(page, steps = []) {
  for (const step of steps) {
    const locator = step.selector ? page.locator(step.selector) : step.text ? page.getByText(step.text, { exact: true }) : null;
    if (step.action === "click") await locator.click();
    else if (step.action === "fill") await locator.fill(step.value);
    else if (step.action === "check") await locator.setChecked(step.checked ?? true);
    else if (step.action === "select") await locator.selectOption(step.value);
    else if (step.action === "press") await locator.press(step.key);
    else if (step.action === "wait") await locator.waitFor({ state: step.state || "visible" });
    else throw Error(`Unknown capture step: ${step.action}`);
  }
}

export async function readiness(page, condition, request) {
  const ready = typeof condition === "string" ? { selector: condition } : condition || {};
  const timeout = ready.timeoutMs || 15000;
  const contractAvailable = () => page.evaluate(() => window.__SCREENS_CAPTURE__ !== undefined);
  const contract = async () => {
    await page.waitForFunction(expected => {
      const state = window.__SCREENS_CAPTURE__;
      if (state?.state === "error") return true;
      return state?.version === 1 && state.state === "ready" && state.pending === 0
        && (!expected || state.requestId === expected.requestId && state.screen === expected.screen && (!expected.fixture || state.fixture === expected.fixture))
        && document.fonts.status === "loaded" && [...document.images].every(image => image.complete && (image.naturalWidth > 0 || !image.src));
    }, request || null, { timeout });
    const error = await page.evaluate(() => window.__SCREENS_CAPTURE__?.state === "error" ? window.__SCREENS_CAPTURE__.error || "Application reported an error" : null);
    if (error) throw Error(String(error));
    return { status: "passed", method: "app-contract" };
  };
  try {
    if (ready.contract !== false && (ready.contract?.required || await contractAvailable())) return await contract();
    if (!ready.selector && !ready.text && !ready.url && !ready.storyId && !ready.event && !ready.fonts?.length) return { status: "unverified", reason: "No readiness condition or app signal" };
    if (ready.event) await page.waitForFunction(name => window.__SCREENS_READY_EVENTS__?.[name], ready.event, { timeout });
    if (ready.fonts?.length) await page.evaluate(async fonts => { for (const font of fonts) await document.fonts.load(font); }, ready.fonts);
    if (ready.selector) await page.locator(ready.selector).waitFor({ state: ready.state || "visible", timeout });
    if (ready.text) await page.getByText(ready.text, { exact: ready.exact ?? false }).first().waitFor({ state: "visible", timeout });
    if (ready.url) await page.waitForURL(ready.url, { timeout });
    if (ready.storyId) await page.waitForFunction(id => document.body.dataset.storyResult === `${id}:success`, ready.storyId, { timeout });
    for (const selector of ready.absent || []) await page.locator(selector).waitFor({ state: "hidden", timeout });
    await page.evaluate(() => document.fonts.ready);
    if (ready.contract !== false && await contractAvailable()) return await contract();
    return { status: "passed", method: "selector-or-story" };
  } catch (error) { return { status: "failed", reason: error.message }; }
}

export async function authenticate(browser, auth, cwd, baseUrl, signal) {
  if (!auth) return undefined;
  const session = await browser.newContext({ ...(auth.storageState ? { storageState: resolve(cwd, auth.storageState) } : {}) });
  try {
    signal?.throwIfAborted();
    if (auth.request) {
      const request = auth.request;
      const response = await session.request.fetch(new URL(request.url, baseUrl).href, { method: request.method || "POST", data: request.data, headers: request.headers, timeout: request.timeoutMs || 30000 });
      if (response.status() !== (request.status || 200)) throw Error(`Authentication returned HTTP ${response.status()}`);
      if (auth.token) {
        const value = at(await response.json(), auth.token.path);
        if (typeof value !== "string" || !value) throw Error("Authentication token was not present");
        session.captureHeaders = { [auth.token.header || "Authorization"]: `${auth.token.prefix ?? "Bearer "}${value}` };
        await session.setExtraHTTPHeaders(session.captureHeaders);
      }
    }
    if (auth.url || auth.steps?.length || auth.ready) {
      const page = await session.newPage();
      await page.goto(new URL(auth.url || "/", baseUrl).href, { waitUntil: "domcontentloaded" });
      await performSteps(page, auth.steps);
      const outcome = await readiness(page, auth.ready);
      if (outcome.status !== "passed") throw Error(`Authentication readiness: ${outcome.reason}`);
      await page.close();
    }
    signal?.throwIfAborted();
    return session;
  } catch (error) { await session.close(); throw error; }
}

export async function resolveScenarios(app, detection, context) {
  const imported = [], issues = [], assets = detection.assets;
  for (const source of app.scenarioImports || []) {
    const file = resolve(context.cwd, source.file);
    let rows;
    if (file.endsWith(".json")) rows = JSON.parse(readFileSync(file, "utf8"));
    else {
      const module = await import(pathToFileURL(file).href);
      const exported = module[source.export];
      rows = typeof exported === "function" ? await exported(...(source.args || [])) : exported;
    }
    if (source.path) rows = at(rows, source.path);
    if (!Array.isArray(rows)) throw Error(`Scenario import must return an array: ${source.file}`);
    imported.push(...rows.map(row => ({ ...row, source: source.file })));
  }
  const staticRows = context.scope === "configured" ? [] : assets.scenarios.filter(row => row.applications.includes(app.path || ".") && !row.storyOnly);
  const explicit = (app.scenarios || []).map(row => typeof row === "string" ? { path: row } : row);
  const recipes = [...explicit];
  for (const row of [...imported, ...staticRows]) {
    const pattern = row.routePattern || row.path;
    const existing = recipes.findIndex(recipe => recipe.path === pattern && recipe.inferred && !recipe.ready && !recipe.steps);
    const recipe = { ...row, key: row.key || row.slug, ready: row.ready || (row.readyText ? { text: row.readyText } : undefined), auth: row.requiresAuth === false ? false : row.auth,
      covers: [...new Set([...(row.covers || []), ...detection.inventory.items.filter(item => item.application === (app.path || ".") && item.kind === "route" && item.route === pattern).map(item => item.id)])] };
    if (existing >= 0) recipes.splice(existing, 1, recipe);
    else if (!recipes.some(item => scenarioKey(item) === scenarioKey(recipe) || (!item.source && item.path === recipe.path))) recipes.push(recipe);
  }
  const params = {}, recordSets = new Map();
  for (const fixture of assets.fixtures.filter(fixture => fixture.applications.includes(app.path || ".") && fixture.params)) for (const [name, value] of Object.entries(fixture.params)) {
    if (Object.hasOwn(app.fixtureParams || {}, name)) continue;
    if (params[name] !== undefined && JSON.stringify(params[name]) !== JSON.stringify(value)) { issues.push(`Conflicting fixture parameter ${name}; configure fixtureParams`); params[name] = null; }
    else params[name] = value;
  }
  Object.assign(params, app.fixtureParams || {});
  let browser, session;
  try {
    if ((app.fixtureSources || []).some(source => source.url) || app.storybook) {
      browser = await (await captureBrowser()).launch();
      session = await authenticate(browser, app.auth, context.cwd, app.baseUrl, context.signal) || await browser.newContext({ ...(app.storageState ? { storageState: resolve(context.cwd, app.storageState) } : {}) });
    }
    for (const source of app.fixtureSources || []) {
      let data;
      if (source.file) data = JSON.parse(readFileSync(resolve(context.cwd, source.file), "utf8"));
      else {
        const response = await session.request.get(new URL(source.url, app.baseUrl).href, { timeout: source.timeoutMs || 30000 });
        if (!response.ok()) throw Error(`Fixture API returned HTTP ${response.status()}`);
        data = await response.json();
      }
      const rows = at(data, source.records);
      if (!Array.isArray(rows)) throw Error("Fixture source records must be an array");
      const mapped = rows.map(row => Object.fromEntries(Object.entries(source.params || {}).map(([name, field]) => [name, at(row, field)])));
      if (source.name) recordSets.set(source.name, mapped);
      for (const [name] of Object.entries(source.params || {})) params[name] = mapped.map(row => row[name]).filter(value => value !== undefined && value !== null);
    }
    if (app.storybook) {
      const response = await session.request.get(new URL(app.storybook.indexPath || "/index.json", app.storybook.url).href);
      if (!response.ok()) throw Error(`Storybook index returned HTTP ${response.status()}`);
      const index = await response.json();
      for (const story of Object.values(index.entries || {})) {
        if (story.type !== "story" || (app.storybook.ids && !app.storybook.ids.includes(story.id))) continue;
        const source = story.importPath ? relative(context.root, resolve(context.cwd, story.importPath)).replaceAll("\\", "/") : undefined;
        const candidates = detection.inventory.items.filter(item => item.kind === "story" && item.source === source && (item.name === story.exportName || item.name.replace(/\W/g, "").toLowerCase() === story.name?.replace(/\W/g, "").toLowerCase()));
        recipes.push({ key: `story-${story.id}`, path: `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, baseUrl: app.storybook.url, title: `${story.title}: ${story.name}`, auth: false,
          ready: app.storybook.ready || (app.storybook.waitForStoryResult ? { storyId: story.id } : { selector: "#storybook-root > *", absent: [".sb-show-errordisplay", ".sb-show-nopreview"] }),
          covers: candidates.length === 1 ? [candidates[0].id] : [], source });
      }
    }
  } finally { try { await session?.close(); } finally { await browser?.close(); } }
  const routes = [];
  for (const recipe of recipes) {
    if (!recipe.path) { issues.push(`Scenario in ${recipe.source || "configuration"} has no path`); continue; }
    const names = [...recipe.path.split(/[?#]/)[0].matchAll(/\[\[?((?:\.\.\.)?\w+)\]?\]|:([A-Za-z_]\w*)|\$([A-Za-z_]\w*)/g)].map(match => match[1] || match[2] || match[3]);
    if (!names.length) { routes.push(recipe); continue; }
    const declaredRecords = recipe.records || (recipe.fixtureSource ? recordSets.get(recipe.fixtureSource) : undefined);
    if (recipe.fixtureSource && !declaredRecords) { routes.push({ ...recipe, requiresParameters: true }); issues.push(`Unknown fixture source ${recipe.fixtureSource}`); continue; }
    let expansions = (declaredRecords || [{}]).map(record => ({ path: recipe.path, values: {}, record }));
    for (const name of names) {
      expansions = expansions.flatMap(item => {
        const value = item.record[name] ?? recipe.params?.[name] ?? params[name];
        const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
        return values.map(value => {
          const encoded = name.startsWith("...") ? String(value).split("/").map(encodeURIComponent).join("/") : encodeURIComponent(String(value));
          return { path: item.path.replace(`[[${name}]]`, encoded).replace(`[${name}]`, encoded).replace(`:${name}`, encoded).replace(`$${name}`, encoded), values: { ...item.values, [name]: value }, record: item.record };
        });
      });
    }
    if (!expansions.length) { routes.push({ ...recipe, requiresParameters: true }); continue; }
    for (const expansion of expansions) routes.push({ ...recipe, path: expansion.path, routePattern: recipe.path, selectionKey: scenarioKey(recipe), key: `scenario-${hash(scenarioKey(recipe))}-${hash(JSON.stringify(expansion.values))}`, requiresParameters: false });
  }
  const unique = new Map();
  for (const route of routes) {
    const key = scenarioKey(route);
    if (!unique.has(key)) unique.set(key, route);
    else unique.get(key).covers = [...new Set([...(unique.get(key).covers || []), ...(route.covers || [])])];
  }
  return { routes: [...unique.values()].filter(scenario => scenarioSelected(context.recipe, app, scenario)), issues };
}
