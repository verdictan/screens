import { readFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

export const defaultVariants = [
  { device: "desktop", width: 1440, height: 1000 },
  { device: "tablet", width: 820, height: 1180 },
  { device: "phone", width: 390, height: 844 },
];
export const recipeHash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex");
const mergedFields = ["env", "ready", "determinism", "network", "evidence", "fixtures", "coverage", "defaults"];
function merge(base, patch) {
  const value = { ...base, ...patch };
  for (const field of mergedFields) if (patch[field] && typeof patch[field] === "object" && !Array.isArray(patch[field])) value[field] = field === "defaults" ? merge(base.defaults || {}, patch.defaults) : { ...base[field], ...patch[field] };
  return value;
}
export function expandCaptureConfig(source, { profile, screens } = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) throw Error("Use a capture recipe object");
  if (source.version !== undefined && source.version !== 1) throw Error("Use recipe version 1");
  if (["schemaVersion", "screens", "adapter", "serve", "prepare", "variants", "browsers", "matrix", "fixture", "fixtureData", "readiness", "directory", "determinism", "network", "evidence", "animationTime", "annotations"].some(field => source[field] !== undefined)) throw Error("Use version 1 with applications[].scenarios");
  const selected = profile ? source.profiles?.[profile] : {};
  if (profile && !selected) throw Error(`Unknown capture profile: ${profile}`);
  const value = merge(source, selected);
  if (screens) value.selection = { ...value.selection, scenarios: screens };
  value.version = 1; value.scope = value.selection?.scenarios ? "configured" : value.scope || "discovered";
  if (!["configured", "discovered"].includes(value.scope)) throw Error("Capture scope must be configured or discovered");
  const baseApps = source.applications || [], overrides = selected?.applications || [];
  value.applications = [...baseApps.map(app => merge(app, overrides.find(item => (item.path || ".") === (app.path || ".")) || {})), ...overrides.filter(app => !baseApps.some(item => (item.path || ".") === (app.path || ".")))].map(raw => {
    if (raw.routes !== undefined || raw.states !== undefined || raw.coverageBindings !== undefined || raw.readiness !== undefined) throw Error("Use applications[].scenarios and ready");
    const app = merge(value.defaults || {}, raw);
    app.path ||= ".";
    if (isAbsolute(app.path) || app.path.split(/[\\/]/).includes("..")) throw Error("Application path must stay inside the project");
    if (app.scenarios) app.scenarios = app.scenarios.map(scenario => ({ ...scenario, key: scenario.key || (scenario.path ? `route-${recipeHash(scenario.path).slice(0, 16)}` : undefined), title: scenario.title || scenario.path || scenario.key }));
    if (app.matrix) {
      app.variants = [];
      for (const device of app.matrix.devices || []) for (const theme of app.matrix.themes || ["light"]) for (const locale of app.matrix.locales || ["en"]) for (const textScale of app.matrix.textScales || ["default"]) app.variants.push({ ...device, theme, locale, textScale: String(textScale) });
    }
    if (app.adapter === "browser") app.variants = (app.variants || defaultVariants).flatMap(variant => (variant.browser ? [variant.browser] : app.browsers || ["chromium"]).map(browser => ({ ...variant, browser, theme: variant.theme || "light", locale: variant.locale || "en", textScale: String(variant.textScale || "default") })));
    if (value.selection?.scenarios && app.scenarios) app.scenarios = app.scenarios.filter(scenario => scenarioSelected(value, app, scenario));
    delete app.matrix; delete app.browsers;
    return app;
  });
  delete value.profiles; delete value.defaults;
  return value;
}
export function scenarioSelected(recipe, app, scenario) {
  const selected = recipe.selection?.scenarios;
  const key = scenario.selectionKey || scenario.key;
  return !selected || selected.includes(key) || selected.includes(`${app.path}/${key}`);
}
export function recipeScenarios(recipe) {
  return recipe.applications.flatMap(app => (app.scenarios || []).map(scenario => ({ ...scenario, application: app.path })));
}
export function diagnoseCaptureConfig(filename, options = {}) {
  const file = resolve(filename), issues = [];
  const issue = (path, message, fix) => issues.push({ file, path, message, fix });
  let bytes, value;
  try { bytes = readFileSync(file); value = expandCaptureConfig(JSON.parse(bytes), options); }
  catch (error) { issue("$", error.message, "Supply a version 1 recipe with applications[].scenarios."); return { file, valid: false, issues }; }
  if (!value.project?.id || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value.project.id)) issue("$.project.id", "Missing or invalid project ID", "Supply a stable project ID.");
  if (!value.project?.name?.trim?.()) issue("$.project.name", "Missing project name", "Supply a project name.");
  if (!value.applications.length) issue("$.applications", "No applications configured", "Generate a capture draft or declare an application.");
  let total = 0;
  const paths = new Set();
  for (const [i, app] of value.applications.entries()) {
    const path = `$.applications[${i}]`;
    if (paths.has(app.path)) issue(`${path}.path`, "Duplicate application", "Combine scenarios under one application path."); paths.add(app.path);
    if (!["browser", "apple", "command"].includes(app.adapter)) issue(`${path}.adapter`, "Unsupported adapter", "Choose browser, apple or command.");
    for (const [j, command] of [...(app.prepare || []), ...(app.serve ? [app.serve] : []), ...(app.command ? [app.command] : [])].entries()) if (!Array.isArray(command) || !command.length || !command.every(arg => typeof arg === "string" && arg)) issue(`${path}.commands[${j}]`, "Invalid command", "Use a nonempty argument array.");
    const keys = new Set();
    if (value.scope === "configured" && app.adapter !== "apple" && !app.scenarios?.length && !app.scenarioImports?.length && !app.storybook) issue(`${path}.scenarios`, "No scenarios selected", "Declare scenarios or use discovered scope.");
    for (const [j, scenario] of (app.scenarios || []).entries()) {
      if (typeof scenario.key !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(scenario.key) || keys.has(scenario.key)) issue(`${path}.scenarios[${j}].key`, "Missing, duplicate or invalid key", "Use a unique stable scenario key."); keys.add(scenario.key);
      if (app.adapter === "browser" && (typeof scenario.path !== "string" || !scenario.path.startsWith("/") || scenario.path.startsWith("//"))) issue(`${path}.scenarios[${j}].path`, "Invalid route", "Use a local route beginning with one slash.");
    }
    if (app.adapter === "browser") {
      const variants = new Set();
      if (!app.variants.length) issue(`${path}.variants`, "No variants selected", "Provide a variant or matrix.");
      for (const [j, variant] of app.variants.entries()) {
        if (![variant.width, variant.height].every(n => Number.isInteger(n) && n >= 200 && n <= 4000) || !variant.device) issue(`${path}.variants[${j}]`, "Invalid device viewport", "Use a device label and dimensions from 200 to 4000.");
        if (!["chromium", "firefox", "webkit"].includes(variant.browser)) issue(`${path}.variants[${j}].browser`, "Unsupported browser", "Choose chromium, firefox or webkit.");
        if (!["light", "dark"].includes(variant.theme)) issue(`${path}.variants[${j}].theme`, "Unsupported theme", "Choose light or dark.");
        if (variant.textScale !== "default" && !(Number(variant.textScale) > 0)) issue(`${path}.variants[${j}].textScale`, "Invalid text scale", "Use default or a positive multiplier.");
        const id = JSON.stringify(variant); if (variants.has(id)) issue(`${path}.variants[${j}]`, "Duplicate variant", "Remove the repeated device variant."); variants.add(id);
      }
    }
    if (app.determinism?.time !== undefined && Number.isNaN(new Date(app.determinism.time).getTime())) issue(`${path}.determinism.time`, "Invalid fixed time", "Supply an ISO date or epoch milliseconds.");
    if (app.animationTime !== undefined && !(Number.isFinite(app.animationTime) && app.animationTime >= 0)) issue(`${path}.animationTime`, "Invalid animation time", "Supply a nonnegative time.");
    if (app.network?.har && (isAbsolute(app.network.har) || app.network.har.split(/[\\/]/).includes(".."))) issue(`${path}.network.har`, "HAR must be project-relative", "Place the recording inside the project.");
    total += (app.scenarios?.length || 0) * (app.variants?.length || 1);
  }
  if (total > 10000) issue("$.applications", "Plan exceeds 10000 captures", "Select a smaller profile.");
  return { file, value, issues, valid: !issues.length, sourceHash: recipeHash(bytes), hash: recipeHash(value) };
}
export function captureConfig(filename, options = {}) {
  const report = diagnoseCaptureConfig(filename, options);
  if (!report.valid) throw Error(report.issues.map(item => `${item.path}: ${item.message}. ${item.fix}`).join("\n"));
  return { value: report.value, hash: report.hash, sourceHash: report.sourceHash };
}
