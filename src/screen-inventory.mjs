import { createHash } from "node:crypto";
import { dirname } from "node:path";

const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 16);
const sourceExtensions = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|swift|kt|java|dart|storyboard|xib)$/;

export function discoverScreens(applications, files, read, graph) {
  const items = new Map(), scannedFiles = [];
  const add = (app, kind, name, source, line, extra = {}) => {
    const id = `screen-${digest(JSON.stringify([app.path, kind, source, name]))}`;
    if (!items.has(id)) items.set(id, { id, application: app.path, kind, name, source, line, confidence: kind === "route" || kind === "story" ? "declared" : "possible", classification: kind === "route" ? "screen" : kind === "story" ? "executable-scenario" : kind === "navigation" ? "navigation-destination" : "possible-component-or-state", ...extra });
    return id;
  };
  for (const app of applications) {
    for (const route of app.routes || []) {
      const id = add(app, "route", route.path, route.source, route.line || 1, { route: route.path, automatic: !route.requiresParameters, confidence: route.confidence || "declared", method: route.parser || "file-router" });
      route.covers = [id];
    }
  }
  const roots = applications.map(app => ({ app, root: /\.xc(?:odeproj|workspace)$/.test(app.path) ? dirname(app.path) : app.path }));
  for (const file of files.filter(file => sourceExtensions.test(file))) {
    const text = read(file);
    scannedFiles.push({ path: file, digest: digest(text) });
    const owners = roots.filter(({ root }) => root === "." || file.startsWith(`${root}/`));
    const deepest = Math.max(...owners.map(({ root }) => root === "." ? 0 : root.length));
    for (const { app } of owners.filter(({ root }) => (root === "." ? 0 : root.length) === deepest)) {
      const lineAt = index => text.slice(0, index).split("\n").length;
      const patterns = app.kind === "web" ? [
        ["presentation", /<(Dialog|AlertDialog|Sheet|Drawer|Modal|Popover|TabsContent)\b([^>]*?)(?:\/?>)/g],
        ["computed-route", /\bpath\s*(?:=\s*\{\s*|:\s*)([A-Za-z_$][\w.$]*(?:\([^;\n]*?\))?)/g],
        ["state", /\b(?:if\s*\(\s*|\{\s*)((?:is)?(?:Loading|Pending|Empty|Error|Failed|Offline)|loading|pending|empty|error|failed|offline)\b/g],
        ["story", /\bexport\s+(?:const|function)\s+(\w+)/g],
        ["screen-component", /\b(?:function|class|const)\s+([A-Z]\w*(?:Screen|Page|View))\b/g],
      ] : [
        ["screen-component", /\b(?:struct|class)\s+(\w+)\s*:\s*(?:View\b|(?:UI|NS)ViewController\b|(?:Stateless|Stateful)Widget\b)/g],
        ["presentation", /\.(sheet|fullScreenCover|popover|alert|confirmationDialog|navigationDestination)\s*\(/g],
        ["navigation", /\b(NavigationLink|WindowGroup|Window|Tab|Settings)\s*\(/g],
        ["navigation", /<(?:\w+\.)?Screen\b[^>]*\bname\s*=\s*["']([^"']+)["']/g],
        ["navigation", /\bcomposable\s*\(\s*(?:route\s*=\s*)?["']([^"']+)["']/g],
        ["screen-component", /\b(?:function|const)\s+([A-Z]\w*(?:Screen|Page))\b/g],
        ["state", /\b(?:if|case)\s+\.?((?:is)?(?:Loading|Pending|Empty|Error|Failed|Offline)|loading|pending|empty|error|failed|offline)\b/g],
        ["storyboard", /<(?:viewController|navigationController|tabBarController|windowController)\b[^>]*\bid="([^"]+)"/g],
      ];
      const occurrences = new Map();
      for (const [kind, pattern] of patterns) for (const match of text.matchAll(pattern)) {
        const value = match[1];
        if (kind === "computed-route" && !/(?:react-router|@angular\/router|vue-router|<Route\b)/.test(text)) continue;
        if (kind === "story" && !/\.stories\.[jt]sx?$/.test(file)) continue;
        const token = `${kind}:${value}`, occurrence = (occurrences.get(token) || 0) + 1;
        occurrences.set(token, occurrence);
        add(app, kind, `${value}${kind === "presentation" || kind === "navigation" || kind === "state" ? ` #${occurrence}` : ""}`, file, lineAt(match.index), { automatic: false });
      }
    }
  }
  const relationships = [];
  for (const relation of graph.relationships) {
    const routes = [...items.values()].filter(item => item.kind === "route" && item.route === relation.route && item.source === relation.source);
    const components = [...items.values()].filter(item => item.source === relation.target && (item.name === relation.symbol || relation.symbol === "default" && item.kind === "screen-component"));
    for (const route of routes) {
      relationships.push({ ...relation, from: route.id, targets: components.map(item => item.id) });
      if (components.length === 1) {
        const component = components[0]; component.confidence = "referenced"; component.classification = "route-component";
        for (const app of applications) for (const entry of app.routes || []) if (entry.covers.includes(route.id)) entry.covers.push(component.id);
      }
    }
  }
  for (const record of graph.records.filter(record => record.kind === "navigation")) for (const app of applications.filter(app => app.path === "." || record.source.startsWith(app.path + "/"))) {
    const id = add(app, "navigation", record.route, record.source, record.line, { confidence: "referenced", classification: "navigation-destination" });
    const targets = [...items.values()].filter(item => item.kind === "route" && item.route === record.route && item.application === app.path).map(item => item.id);
    relationships.push({ kind: "navigates-to", from: id, targets, source: record.source });
    for (const route of app.routes || []) if (route.covers.some(target => targets.includes(target))) route.covers.push(id);
  }
  return { version: 1, relationships, parserWarnings: graph.warnings, scope: "Supported source patterns; runtime-generated screens and arbitrary state combinations are not enumerable", scannedFiles,
    items: [...items.values()], limitations: ["Source patterns are candidates, not compiler-resolved reachability", "Native source ownership uses project directories, not build target membership", "Relative and computed routes need explicit capture recipes"] };
}

export function createCoverage(detection, applications, config, defaults) {
  const inventory = detection.inventory.items.map(item => ({ ...item }));
  const bindings = [], exclusions = config.coverage?.exclude || [];
  for (const [index, app] of applications.entries()) {
    const path = app.path || ".";
    const recipes = app.scenarios || [];
    for (const [position, raw] of recipes.entries()) {
      const recipe = typeof raw === "string" ? { path: raw } : raw;
      const key = recipe.key || recipe.path;
      const own = { id: `recipe-${digest(`${index}:${key}:${position}`)}`, application: path, kind: "recipe", name: key, source: recipe.source || "screens.capture.json", adapter: app.adapter, platforms: recipe.platforms, automatic: true };
      inventory.push(own);
      const inferred = recipe.path ? inventory.filter(item => item.application === path && item.kind === "route" && item.route === (recipe.routePattern || recipe.path)).map(item => item.id) : [];
      bindings.push({ applicationIndex: index, key, ids: [...new Set([own.id, ...inferred, ...(recipe.covers || [])])], adapter: app.adapter });
    }
  }
  const ids = new Set(inventory.map(item => item.id));
  for (const binding of bindings) for (const id of binding.ids) if (!ids.has(id)) throw Error(`Unknown coverage ID: ${id}`);
  for (const exclusion of exclusions) {
    if (!ids.has(exclusion.id) || typeof exclusion.reason !== "string" || !exclusion.reason.trim()) throw Error("Coverage exclusions need a known ID and a reason");
  }
  const selected = new Set(config.coverage?.required || []);
  for (const id of selected) if (!ids.has(id)) throw Error(`Unknown required coverage ID: ${id}`);
  for (const item of inventory) item.required = item.kind === "recipe" || selected.has(item.id) || item.confidence === "declared" && ["route", "native-screen"].includes(item.kind) && (config.scope === "discovered" || bindings.some(binding => binding.ids.includes(item.id)));
  for (const binding of bindings) {
    const recipe = inventory.find(item => item.id === binding.ids[0]);
    if (recipe) recipe.logicalScreen = !binding.ids.some(id => inventory.some(item => item.id === id && item.confidence === "declared" && ["route", "native-screen"].includes(item.kind)));
  }
  const requirements = [];
  for (const item of inventory) {
    const appIndexes = item.kind === "recipe" ? [] : applications.flatMap((app, index) => (app.path || ".") === item.application ? [index] : []);
    const mapped = bindings.filter(binding => binding.ids.includes(item.id));
    const indexes = [...new Set([...appIndexes, ...mapped.map(binding => binding.applicationIndex)])];
    const exclusion = exclusions.find(entry => entry.id === item.id);
    if (!indexes.length) {
      const detected = detection.applications.find(app => app.path === item.application);
      const devices = detected?.kind === "web" ? defaults.map(variant => variant.device)
        : (detected?.platforms || ["unassigned"]).flatMap(platform => platform === "ios" ? ["iphone", "ipad"] : platform === "macos" ? ["mac"] : [platform]);
      for (const device of devices) requirements.push({ ...item, variant: { device }, status: exclusion ? "excluded" : "unresolved", reason: exclusion?.reason || "No application recipe", captureIds: [] });
    }
    for (const index of indexes) {
      const app = applications[index];
      const detected = detection.applications.find(candidate => candidate.path === item.application);
      const platforms = [...new Set([...(detected?.platforms || []), ...(app.platforms || []), ...(item.platforms || [])])];
      const variants = app.adapter === "browser" || (app.adapter === "command" && detected?.kind === "web") ? (app.variants || defaults).filter((variant, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(variant)) === i).map(variant => ({ device: variant.device, viewport: `${variant.width}x${variant.height}`, theme: variant.theme || "light", locale: variant.locale || "en", browser: variant.browser || "chromium", textScale: String(variant.textScale || "default") }))
        : [...[...new Set(platforms.flatMap(platform => platform === "ios" ? ["iphone", "ipad"] : platform === "macos" ? ["mac"] : [platform]))].map(device => ({ device, browser: "native" })), ...(app.variants || [])].filter((variant, i, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(variant)) === i);
      for (const variant of (variants.length ? variants : [{ device: "unspecified" }]).filter(variant => !item.platforms || item.platforms.flatMap(platform => platform === "ios" ? ["iphone", "ipad"] : platform === "macos" ? ["mac"] : [platform]).includes(variant.device))) requirements.push({ ...item, applicationIndex: index, variant, status: exclusion ? "excluded" : mapped.some(binding => binding.applicationIndex === index) ? "missing" : "unresolved", reason: exclusion?.reason || (mapped.some(binding => binding.applicationIndex === index) ? "Capture not completed" : "Map this source candidate to a recipe with covers"), captureIds: [] });
    }
  }
  return { requiredScope: config.scope, scope: detection.inventory.scope, discoveryWarnings: detection.warnings, limitations: detection.inventory.limitations, requirements, bindings };
}

export function recordCoverage(coverage, applicationIndex, key, variant, captureId, readiness) {
  const ids = new Set(coverage.bindings.filter(binding => binding.applicationIndex === applicationIndex && binding.key === key).flatMap(binding => binding.ids));
  for (const item of coverage.requirements) {
    if (item.applicationIndex !== applicationIndex || !ids.has(item.id) || item.status === "excluded") continue;
    if (!Object.entries(item.variant).every(([key, value]) => variant[key] === value)) continue;
    item.status = "captured"; item.reason = null; item.captureIds.push(captureId);
    if (item.readiness?.status !== "passed") item.readiness = readiness || { status: "unverified" };
  }
}

export function finishCoverage(coverage, results) {
  for (const item of coverage.requirements) if (item.status === "missing" && results[item.applicationIndex]?.issues.length) {
    item.status = "failed"; item.reason = "Application reported capture issues; see application results";
  }
  const active = coverage.requirements.filter(item => item.required && item.status !== "excluded");
  const summarize = rows => {
    const groups = new Map();
    for (const row of rows) { const key = `${row.applicationIndex ?? row.application}:${row.id}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    return { total: groups.size, captured: [...groups.values()].filter(items => items.every(item => item.status === "captured")).length,
      ready: [...groups.values()].filter(items => items.every(item => item.status === "captured" && item.readiness?.status === "passed")).length };
  };
  const scenarioRows = active.filter(item => item.kind === "recipe");
  const candidates = coverage.requirements.filter(item => !item.required && item.status !== "excluded");
  const metrics = {
    screens: summarize(active.filter(item => item.kind === "route" || item.kind === "native-screen" || item.logicalScreen)),
    scenarios: summarize(scenarioRows),
    variants: { total: scenarioRows.length, captured: scenarioRows.filter(item => item.status === "captured").length, ready: scenarioRows.filter(item => item.readiness?.status === "passed").length,
      failed: scenarioRows.filter(item => item.status === "failed" || item.readiness?.status === "failed").length, unverified: scenarioRows.filter(item => item.readiness?.status === "unverified").length },
    candidates: { total: new Set(candidates.map(item => item.id)).size, unresolved: new Set(candidates.filter(item => item.status === "unresolved").map(item => item.id)).size },
    exclusions: new Set(coverage.requirements.filter(item => item.status === "excluded").map(item => item.id)).size,
  };
  const backlog = [...new Map(candidates.map(item => [item.id, { id: item.id, name: item.name, kind: item.kind, source: item.source, line: item.line, confidence: item.confidence, required: false }])).values()];
  return { ...coverage, bindings: undefined, metrics, backlog, discoveryComplete: !coverage.discoveryWarnings.length,
    complete: active.length > 0 && active.every(item => item.status === "captured" && item.readiness?.status === "passed") };
}
