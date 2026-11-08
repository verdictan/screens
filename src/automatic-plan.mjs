import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { basename, resolve, join } from "node:path";
import { expandCaptureConfig } from "./capture-recipe.mjs";
import { detectProject } from "./discovery.mjs";
import { nativeApplications } from "./native-contract.mjs";

export const identityHash = value => createHash("sha256").update(JSON.stringify(value, (_, item) => typeof item === "function" ? item.toString() : item)).digest("hex");
export function configurationDecisions(config, detection, proposals = []) {
  const command = value => Array.isArray(value) && value.length && value.every(arg => typeof arg === "string" && arg);
  const supportedStartup = app => Boolean(app.baseUrl || command(app.serve) || detection.applications.find(item => item.path === app.path)?.frameworks.includes("Static HTML") || detection.recipes.some(recipe => recipe.path === app.path && ["dev", "start"].includes(recipe.name) && /\b(?:next\s+(?:dev|start)|vite|astro|nuxt|nuxi|ng\s+serve|react-scripts\s+start)\b/.test(recipe.command)));
  const findings = [];
  for (const service of config.services || []) if (!command(service.command) || typeof service.ready?.url !== "string" || !service.ready.url.trim()) findings.push({ kind: "service", service: service.name, blocking: true, question: `Set command and ready.url for service ${service.name}` });
  for (const app of config.applications || []) {
    if (!["browser", "apple", "command"].includes(app.adapter)) findings.push({ kind: "adapter", application: app.path, blocking: true, question: "Choose browser, apple or command" });
    if (app.adapter === "browser" && !supportedStartup(app)) findings.push({ kind: "startup", application: app.path, blocking: true, question: "Set serve with its port interface, or baseUrl" });
    if (app.adapter === "command" && !command(app.command)) findings.push({ kind: "startup", application: app.path, blocking: true, question: "Set an argument-array capture command" });
    if (app.adapter === "apple" && !(app.platforms || detection.applications.find(item => item.path === app.path)?.platforms || []).some(platform => ["macos", "iphone", "ipad", "ios"].includes(platform))) findings.push({ kind: "native-platforms", application: app.path, blocking: true, question: "Declare supported Apple device families" });
  }
  for (const proposal of proposals.filter(item => !item.blocking && item.kind !== "classify-candidate")) {
    const app = config.applications.find(item => item.path === proposal.application);
    if (proposal.application && !app) continue;
    let open = true;
    if (proposal.kind === "fixture-conflict") open = app?.fixtureParams?.[proposal.name] === undefined;
    if (proposal.kind === "scenario-import") open = !(app?.scenarioImports || []).some(item => proposal.evidence.includes(item.file));
    if (proposal.kind === "readiness") open = !app?.ready && !(app?.scenarios?.length && app.scenarios.every(item => item.ready)) && !detection.assets.readiness.some(item => item.application === app?.path);
    if (proposal.kind === "environment") {
      const values = {};
      for (const cwd of [detection.root, resolve(detection.root, app?.path || ".")]) for (const name of [".env", ".env.development", ".env.local", ".env.development.local", ...(config.envFiles || []), ...(app?.envFiles || [])]) {
        const file = resolve(cwd, name); if (existsSync(file)) Object.assign(values, parseEnv(readFileSync(file, "utf8")));
      }
      Object.assign(values, process.env, config.env, app?.env);
      open = !String(values[proposal.name] ?? "").trim();
    }
    if (open) findings.push(proposal);
  }
  return findings;
}
export function automaticInput(path, options = {}) {
  const detection = detectProject(path), root = detection.root;
  const file = options.config ? resolve(options.config) : join(root, "screens.capture.json");
  let config, proposals = [];
  if (options.plan) {
    const plan = JSON.parse(readFileSync(resolve(options.plan), "utf8"));
    if (plan.version !== 1 || !plan.configuration) throw Error("Use a version 1 draft capture plan");
    config = plan.configuration; proposals = plan.decisions || [];
  } else config = options.recipe || (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {});
  if (options.config && !existsSync(file)) throw Error(`Capture configuration not found: ${file}`);
  config = expandCaptureConfig(config, { profile: options.recipe ? undefined : options.profile, screens: options.screens });
  const decisions = configurationDecisions(config, detection, proposals);
  if (decisions.some(item => item.blocking)) throw Error(decisions.filter(item => item.blocking).map(item => item.question).join("; "));
  const environment = [];
  for (const base of [root, ...config.applications.map(app => resolve(root, app.path))]) for (const name of [".env", ".env.development", ".env.local", ".env.development.local", ...(config.envFiles || []), ...config.applications.flatMap(app => app.envFiles || [])]) {
    const path = resolve(base, name);
    if (existsSync(path)) environment.push({ path, hash: createHash("sha256").update(readFileSync(path)).digest("hex") });
  }
  const names = new Set([...detection.assets.environment.map(item => item.name), ...JSON.stringify(config).matchAll(/\{env\.([\w]+)\}/g)].map(item => typeof item === "string" ? item : item[1]));
  const engine = ["auto-capture.mjs", "automatic-plan.mjs", "capture-recipe.mjs", "capture-process.mjs", "automation.mjs", "automatic-worker.mjs", "capture-environment.mjs", "capture-scenarios.mjs", "fixture-boundaries.mjs", "native-contract.mjs", "source-graph.mjs", "screen-inventory.mjs", "discovery.mjs", "capture-assets.mjs", "../scripts/capture-macos.swift", "../package-lock.json"].map(file => createHash("sha256").update(readFileSync(fileURLToPath(new URL(file, import.meta.url)))).digest("hex"));
  const inputHash = identityHash({ version: 1, engine, source: detection.inputs, config, selection: { profile: options.profile, url: options.url }, environment, inherited: [...names].sort().map(name => [name, Object.hasOwn(config.env || {}, name) ? "configured" : process.env[name] || null]), node: process.version });
  return { root, detection, config, inputHash, decisions, configPath: options.config ? file : existsSync(file) ? file : null };
}

export function draftAutomaticPlan(path, options = {}) {
  const detection = detectProject(path), choices = [], decisions = [];
  const add = (setting, value, evidence, confidence = "declared") => { choices.push({ setting, value, evidence, confidence }); return value; };
  const configuration = { version: 1, scope: "discovered", project: { id: options.project || basename(detection.root).replace(/[^a-zA-Z0-9._-]/g, "-"), name: basename(detection.root) }, services: [], applications: [] };
  const native = nativeApplications(detection.nativeContract);
  for (const app of detection.applications) {
    const declared = native.find(item => item.path === app.path);
    const prepared = declared || { path: app.path, adapter: app.kind === "web" ? "browser" : app.frameworks.includes("Xcode") ? "apple" : "unsupported" };
    add(`applications.${app.path}.adapter`, prepared.adapter, app.evidence);
    const recipes = detection.recipes.filter(recipe => recipe.path === app.path);
    const dev = recipes.find(recipe => recipe.name === "dev") || recipes.find(recipe => recipe.name === "start");
    if (dev && !/\b(?:next\s+(?:dev|start)|vite|astro|nuxt|nuxi|ng\s+serve|react-scripts\s+start)\b/.test(dev.command)) decisions.push({ application: app.path, kind: "startup", blocking: true, question: "Set serve with an explicit port interface", evidence: [dev.source] });
    if (dev) add(`applications.${app.path}.startup`, { script: dev.name, command: dev.command }, [dev.source]);
    if (prepared.adapter === "unsupported") decisions.push({ application: app.path, kind: "adapter", blocking: true, question: "Select a native capture command or supported adapter", evidence: app.evidence });
    if (prepared.adapter === "browser" && !dev && !app.frameworks.includes("Static HTML")) decisions.push({ application: app.path, kind: "startup", blocking: true, question: "Choose an app startup command or baseUrl", evidence: app.evidence });
    if (prepared.adapter === "apple" && !app.platforms.some(platform => ["macos", "iphone", "ipad", "ios"].includes(platform))) decisions.push({ application: app.path, kind: "native-platforms", blocking: true, question: "Declare supported Apple device families", evidence: app.evidence });
    if (prepared.adapter === "browser") {
      if (detection.assets.readiness.some(item => item.application === app.path)) prepared.ready = add(`applications.${app.path}.ready`, { contract: { required: true } }, detection.assets.readiness.filter(item => item.application === app.path).map(item => item.source));
      prepared.scenarios = app.routes.map(route => ({ ...route, inferred: true, ready: null }));
      prepared.requiredEnv = [...new Set(detection.assets.environment.filter(item => item.application === app.path && item.required).map(item => item.name))];
      for (const name of prepared.requiredEnv) decisions.push({ application: app.path, kind: "environment", name, blocking: false, question: `Supply ${name} through the environment or envFiles`, evidence: detection.assets.environment.filter(item => item.name === name).map(item => ({ source: item.source, line: item.line })) });
      const modules = detection.assets.modules.filter(module => app.path === "." || module.source.startsWith(app.path + "/"));
      for (const module of modules) decisions.push({ application: app.path, kind: "scenario-import", blocking: false, question: `Select export ${module.export} and its arguments/result path if it returns capture scenarios`, evidence: [module.source] });
      const params = {}, conflicts = new Set();
      for (const fixture of detection.assets.fixtures.filter(fixture => fixture.applications.includes(app.path) && fixture.params)) for (const [key, value] of Object.entries(fixture.params)) {
        if (conflicts.has(key)) continue;
        if (Object.hasOwn(params, key) && identityHash(params[key]) !== identityHash(value)) {
          delete params[key]; conflicts.add(key);
          for (let i = choices.length - 1; i >= 0; i--) if (choices[i].setting === `applications.${app.path}.fixtureParams.${key}`) choices.splice(i, 1);
          decisions.push({ application: app.path, kind: "fixture-conflict", name: key, blocking: false, question: `Choose a fixture value for ${key}`, evidence: [fixture.source] });
        } else params[key] = add(`applications.${app.path}.fixtureParams.${key}`, value, [fixture.source]);
      }
      prepared.fixtureParams = params;
      for (const service of recipes.filter(recipe => /mock.*server|fixture.*server|^storybook$/.test(recipe.name))) {
        const name = `service-${configuration.services.length + 1}`;
        const record = { name, cwd: app.path, command: ["npm", "run", service.name], ready: { url: null } };
        configuration.services.push(record);
        add(`services.${name}.command`, record.command, [service.source]);
        decisions.push({ application: app.path, kind: "service", service: name, blocking: true, question: "Set the command's port interface and HTTP readiness URL", evidence: [service.source] });
        if (service.name === "storybook") { prepared.storybook = { url: `{services.${name}.url}` }; add(`applications.${app.path}.storybook`, prepared.storybook, [service.source]); }
      }
      decisions.push({ application: app.path, kind: "readiness", blocking: false, question: "Use the app readiness contract or set ready conditions for scenarios", evidence: app.routes.map(route => route.source) });
    }
    configuration.applications.push(prepared);
  }
  return { version: 1, sourceFingerprint: identityHash(detection.inputs), configuration, choices, decisions: configurationDecisions(expandCaptureConfig(configuration), detection, decisions),
    discovery: { backlog: detection.inventory.items.filter(item => item.confidence === "possible").map(item => ({ ...item, required: false })), warnings: detection.warnings, relationships: detection.inventory.relationships, assets: { modules: detection.assets.modules, stories: detection.assets.stories, fixtures: detection.assets.fixtures.map(({ source, name }) => ({ source, name })) } },
    execution: "not-run" };
}
