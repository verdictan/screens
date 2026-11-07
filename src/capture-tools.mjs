import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, posix } from "node:path";
import sharp from "sharp";
import { gitOutput } from "./runtime.mjs";
import { parse as parseJson } from "jsonc-parser";
import { captureConfig, diagnoseCaptureConfig, captureRevision, resolveRevision } from "./capture.mjs";
import { createDiff } from "./diff.mjs";
import { requireThat } from "./validation.mjs";

const string = { type: "string" }, strings = { type: "array", items: string };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const action = (description, properties, required, run) => ({ description, inputSchema: schema(properties, required), cliOnly: true, run });
const git = (repo, args, extra = {}) => gitOutput(resolve(repo), args, extra);
const jsonFile = (value, output) => { if (output) writeFileSync(resolve(output), JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); return value; };
const sourceExtensions = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".vue", ".svelte", ".css", ".scss", ".json"];
const sourceFile = (file) => sourceExtensions.some((extension) => file.endsWith(extension));
const revisionFiles = (repo, revision) => git(repo, ["ls-tree", "-r", "--name-only", "-z", revision]).split("\0").filter(Boolean);
const sourceAt = (repo, revision, file) => git(repo, ["show", `${revision}:${file}`]);
const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*").replace(/\?/g, ".")}$`);
const matches = (pattern, file) => glob(pattern.replace(/^\.\//, "")).test(file);
const captureProperties = { repo: string, ref: string, config: string, output: string, profile: string, screens: strings, role: { enum: ["current", "target", "pr"] }, execute: { const: "yes" }, title: string };
const executionOptions = (input, context) => ({ ...input, signal: context?.signal, onEvent: context?.onEvent, onCapture: context?.onCapture, priorCaptureIds: context?.priorCaptureIds });

export function planCaptures(input) {
  const config = captureConfig(input.config, { profile: input.profile, screens: input.screens });
  const jobs = config.value.screens.flatMap((screen) => config.value.variants.map((variant) => ({ screen: screen.key, path: screen.path, variant })));
  return { project: config.value.project, configHash: config.hash, profile: input.profile || null, jobs, commands: { prepare: config.value.prepare || [], serve: config.value.serve }, config: config.value };
}
export function discoverRoutes(input) {
  const repo = resolve(input.repo), revision = resolveRevision(repo, input.ref || "HEAD");
  const files = revisionFiles(repo, revision), proposals = new Map();
  const add = (route, source, adapter) => {
    if (!route.startsWith("/") || route.startsWith("//")) return;
    const id = `${source}|${route}`;
    proposals.set(id, { key: route === "/" ? "home" : route.replace(/^\//, "").replace(/[^\w./-]/g, "-").replace(/-+/g, "-"), title: route, path: route, route, source, adapter, requiresParameters: /[:*]/.test(route), captures: [] });
  };
  for (const file of files) {
    if (input.roots?.length && !input.roots.some((root) => file.startsWith(root.replace(/\/$/, "") + "/"))) continue;
    let match;
    if ((match = file.match(/(?:^|\/)(?:src\/)?app\/(.*?)(?:\/)?page\.(?:jsx?|tsx?)$/))) {
      const path = match[1].split("/").filter((part) => part && !/^\(.*\)$/.test(part) && !part.startsWith("@"));
      add("/" + path.join("/").replace(/\[\[?\.\.\.(.+?)\]\]?/g, ":$1*").replace(/\[(.+?)\]/g, ":$1"), file, "next-app");
    } else if ((match = file.match(/(?:^|\/)(?:src\/)?pages\/(.+)\.(?:jsx?|tsx?)$/)) && !/^(?:api\/|_)/.test(match[1])) {
      add("/" + match[1].replace(/(?:^|\/)index$/, "").replace(/\[\[?\.\.\.(.+?)\]\]?/g, ":$1*").replace(/\[(.+?)\]/g, ":$1"), file, "next-pages");
    } else if ((match = file.match(/(?:^|\/)src\/routes\/(.*?)\+page\.svelte$/))) {
      add("/" + match[1].split("/").filter((part) => part && !/^\(.*\)$/.test(part)).join("/").replace(/\[\.\.\.(.+?)\]/g, ":$1*").replace(/\[(.+?)\]/g, ":$1"), file, "sveltekit");
    } else if (/\.(?:jsx?|tsx?)$/.test(file) && /(?:route|router)/i.test(file)) {
      const source = sourceAt(repo, revision, file);
      for (const match of source.matchAll(/\bpath\s*(?:=\s*["']|:\s*["'])(\/[^"']*)["']/g)) add(match[1], file, "literal-route");
    }
  }
  const screens = [...proposals.values()].map((screen, index, all) => all.some((other, i) => i !== index && other.key === screen.key) ? { ...screen, key: `${screen.key}-${index + 1}` } : screen);
  return jsonFile({ schemaVersion: 1, project: { id: input.project || "discovered", name: input.name || "Discovered routes" }, revision, coverage: "Static route proposals; dynamic routes and runtime configuration require explicit capture recipes", screens }, input.output);
}

export function affectedScreens(input) {
  const repo = resolve(input.repo), base = resolveRevision(repo, input.base), head = resolveRevision(repo, input.head || "HEAD");
  const config = captureConfig(input.config, { profile: input.profile });
  const changes = git(repo, ["diff", "--name-only", "--no-renames", "-z", base, head, "--"]).split("\0").filter(Boolean);
  const changed = new Set(changes), files = revisionFiles(repo, head), fileSet = new Set(files);
  const packages = files.filter((file) => /(?:^|\/)package\.json$/.test(file)).map((file) => {
    const value = JSON.parse(sourceAt(repo, head, file));
    return { file, directory: posix.dirname(file), name: value.name, dependencies: Object.keys({ ...value.dependencies, ...value.devDependencies, ...value.peerDependencies, ...value.optionalDependencies }) };
  });
  const packageByName = new Map(packages.filter((item) => item.name).map((item) => [item.name, item]));
  const inside = (file, directory) => directory === "." || file.startsWith(directory + "/");
  const owner = (file) => packages.filter((item) => inside(file, item.directory)).sort((a, b) => b.directory.length - a.directory.length)[0];
  const changedPackages = new Set(changes.map((file) => owner(file)?.name).filter(Boolean));
  const dependencyPackages = new Set(changes.filter((file) => /(?:^|\/)package\.json$/.test(file)).map((file) => owner(file)?.name).filter(Boolean));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of packages) if (!changedPackages.has(item.name) && item.dependencies.some((name) => changedPackages.has(name))) { changedPackages.add(item.name); dependencyPackages.add(item.name); expanded = true; }
  }
  const aliases = { ...(config.value.sourceAliases || {}) };
  for (const file of files.filter((file) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(file))) {
    const value = parseJson(sourceAt(repo, head, file));
    for (const [name, paths] of Object.entries(value?.compilerOptions?.paths || {})) aliases[name] = paths.map((path) => posix.normalize(posix.join(posix.dirname(file), value.compilerOptions.baseUrl || ".", path)));
  }
  function resolveImport(from, specifier) {
    const candidates = [];
    if (specifier.startsWith(".")) candidates.push(posix.normalize(posix.join(posix.dirname(from), specifier)));
    else for (const [name, replacements] of Object.entries(aliases)) {
      const star = name.indexOf("*"), prefix = star < 0 ? name : name.slice(0, star), suffix = star < 0 ? "" : name.slice(star + 1);
      if (star < 0 ? specifier === name : specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
        const value = star < 0 ? "" : specifier.slice(prefix.length, suffix ? -suffix.length : undefined);
        for (const replacement of Array.isArray(replacements) ? replacements : [replacements]) candidates.push(replacement.replace("*", value));
      }
    }
    for (const candidate of candidates) for (const path of [candidate, ...sourceExtensions.map((extension) => candidate + extension), ...sourceExtensions.map((extension) => candidate + "/index" + extension)]) if (fileSet.has(path) || changed.has(path)) return path;
    return null;
  }
  const dependencies = new Map();
  for (const file of files.filter(sourceFile)) {
    const source = sourceAt(repo, head, file), resolved = new Set();
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|@import\s*)["']([^"']+)["']/g)) {
      const target = resolveImport(file, match[1]); if (target) resolved.add(target);
      const packageName = match[1].startsWith("@") ? match[1].split("/").slice(0, 2).join("/") : match[1].split("/")[0];
      if (packageByName.has(packageName) && changedPackages.has(packageName)) changed.add(file);
    }
    dependencies.set(file, resolved);
  }
  expanded = true;
  while (expanded) { expanded = false; for (const [file, deps] of dependencies) if (!changed.has(file) && [...deps].some((dependency) => changed.has(dependency))) { changed.add(file); expanded = true; } }
  const allChanged = (config.value.sharedSources || []).some((pattern) => changes.some((file) => matches(pattern, file)));
  const selected = config.value.screens.flatMap((screen) => {
    const sources = [...(screen.sources || []), ...(screen.source ? [screen.source] : [])];
    const matched = [...changed].filter((file) => sources.some((pattern) => matches(pattern, file)));
    const packageChanged = sources.some((source) => dependencyPackages.has(owner(source)?.name));
    const reason = allChanged ? "shared-source" : !sources.length ? "unmapped-screen" : matched.length ? "source-dependency" : packageChanged ? "workspace-dependency" : null;
    return reason ? [{ key: screen.key, reason, sources: matched }] : [];
  });
  return jsonFile({ base, head, configHash: config.hash, changedFiles: changes, affectedPackages: [...changedPackages], screens: selected, screenKeys: selected.map((screen) => screen.key) }, input.output);
}

export async function captureRepeatability(store, input, context = {}) {
  requireThat(input.execute === "yes", "Pass --execute yes to run capture recipes");
  const count = input.count ?? 3;
  requireThat(Number.isInteger(count) && count >= 2, "Repeatability requires at least two captures");
  const output = resolve(input.output); mkdirSync(output, { recursive: false });
  const ref = resolveRevision(input.repo, input.ref), runs = [];
  for (let i = 0; i < count; i++) runs.push(await captureRevision(store, { ...executionOptions(input, context), ref, role: "pr", output: join(output, `sample-${i + 1}`), priorCaptureIds: [] }));
  const baseline = store.compare(runs[0].run.id), results = [];
  for (const entry of baseline.entries) {
    const original = entry.captures.pr;
    const comparisons = [];
    for (const run of runs.slice(1)) {
      const candidate = store.compare(run.run.id).entries.find((other) => other.screen === entry.screen && JSON.stringify(other.variant) === JSON.stringify(entry.variant))?.captures.pr;
      if (!candidate) { comparisons.push({ status: "missing-capture", run: run.run.id }); continue; }
      const diff = await createDiff(store, { left: original.id, right: candidate.id, threshold: input.threshold || 0 });
      let region = null;
      if (diff.image && diff.changedPixels > 0) {
        const { data, info } = await sharp(store.diffImage(diff.id)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let minX = info.width, minY = info.height, maxX = -1, maxY = -1;
        for (let pixel = 0; pixel < info.width * info.height; pixel++) if (data[pixel * 4] === 230 && data[pixel * 4 + 1] === 30 && data[pixel * 4 + 2] === 100) {
          const x = pixel % info.width, y = Math.floor(pixel / info.width); minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        region = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      }
      comparisons.push({ capture: candidate.id, diff: diff.id, status: diff.status, changedRatio: diff.changedRatio ?? null, changedPixels: diff.changedPixels, changedBounds: region });
    }
    const stable = comparisons.every((comparison) => comparison.status === "measured" && comparison.changedPixels === 0);
    const report = { screen: entry.screen, variant: entry.variant, baseline: original.id, stable, comparisons };
    const evidence = store.addEvidence({ capture: original.id, kind: "visual", method: "automated", outcome: stable ? "pass" : "fail", assertion: "Repeated captures of the same revision have equal pixels at the recorded tolerance", observation: stable ? "All repeated captures matched" : "Repeated captures differ or could not be measured", procedure: `Captured revision ${ref} ${count} times and compared each result to the first with channel tolerance ${input.threshold || 0}`, author: "Screens repeatability", artifactType: "application/json", artifactBase64: Buffer.from(JSON.stringify(report)).toString("base64") });
    results.push({ ...report, evidence: evidence.id });
  }
  return jsonFile({ revision: ref, count, runs: runs.map((result) => result.run.id), stable: results.every((result) => result.stable), results, acceptance: "not-assessed" }, join(output, "repeatability.json"));
}

export async function captureBisect(store, input, context = {}) {
  requireThat(input.execute === "yes", "Pass --execute yes to run capture recipes");
  const repo = resolve(input.repo), base = resolveRevision(repo, input.base), head = resolveRevision(repo, input.head);
  git(repo, ["merge-base", "--is-ancestor", base, head]);
  const commits = [base, ...git(repo, ["rev-list", "--first-parent", "--reverse", `${base}..${head}`]).split("\n").filter(Boolean)];
  const firstParent = new Set(git(repo, ["rev-list", "--first-parent", head]).split("\n"));
  requireThat(firstParent.has(base), "Base must be on the head's first-parent history");
  const maximum = input.maxChangedRatio ?? 0;
  requireThat(Number.isFinite(maximum) && maximum >= 0 && maximum <= 1, "maxChangedRatio must be between zero and one");
  const output = resolve(input.output); mkdirSync(output, { recursive: false });
  const baseline = await captureRevision(store, { ...executionOptions(input, context), ref: base, role: "pr", output: join(output, "baseline"), priorCaptureIds: [] });
  const entries = store.compare(baseline.run.id).entries, measurements = new Map();
  const sample = async (index) => {
    if (measurements.has(index)) return measurements.get(index);
    const captured = await captureRevision(store, { ...executionOptions(input, context), ref: commits[index], role: "pr", output: join(output, `revision-${index}`), priorCaptureIds: [] });
    const current = store.compare(captured.run.id).entries, pairs = [];
    for (const entry of entries) {
      const right = current.find((item) => item.screen === entry.screen && JSON.stringify(item.variant) === JSON.stringify(entry.variant))?.captures.pr;
      if (!right) { pairs.push({ screen: entry.screen, status: "missing-capture", exceeds: true }); continue; }
      const diff = await createDiff(store, { left: entry.captures.pr.id, right: right.id, threshold: input.threshold || 0 });
      pairs.push({ screen: entry.screen, variant: entry.variant, diff: diff.id, status: diff.status, changedRatio: diff.changedRatio ?? null, exceeds: diff.status !== "measured" || diff.changedRatio > maximum });
    }
    const result = { revision: commits[index], run: captured.run.id, exceeds: pairs.some((pair) => pair.exceeds), pairs };
    measurements.set(index, result); return result;
  };
  let found = null;
  if (input.mode === "scan") {
    for (let index = 1; index < commits.length; index++) if ((await sample(index)).exceeds) { found = commits[index]; break; }
  } else if (commits.length > 1 && (await sample(commits.length - 1)).exceeds) {
    let low = 0, high = commits.length - 1;
    while (high - low > 1) { const middle = Math.floor((low + high) / 2); if ((await sample(middle)).exceeds) high = middle; else low = middle; }
    found = commits[high];
  }
  return jsonFile({ base, head, baselineRun: baseline.run.id, maxChangedRatio: maximum, mode: input.mode || "bisect", monotonicAssumption: input.mode !== "scan", firstCrossing: found, sampled: [...measurements.entries()].sort(([a], [b]) => a - b).map(([, value]) => value), acceptance: "not-assessed" }, join(output, "bisect.json"));
}

export async function captureMerge(store, input, context = {}) {
  requireThat(input.execute === "yes", "Pass --execute yes to capture a merge candidate");
  const revision = resolveRevision(input.repo, input.ref);
  const parents = git(input.repo, ["show", "-s", "--format=%P", revision]).split(" ").filter(Boolean);
  const result = await captureRevision(store, { ...executionOptions(input, context), ref: revision });
  const mergeCandidate = { revision, parents, source: "merge-queue-ref" };
  jsonFile(mergeCandidate, join(input.output, "merge-candidate.json"));
  return { ...result, mergeCandidate };
}

export const captureActions = {
  "capture-config-diagnose": action("Report capture configuration errors with field paths and correction instructions.", { config: string, profile: string }, ["config"], (_store, input) => { const report = diagnoseCaptureConfig(input.config, { profile: input.profile }); return { file: report.file, valid: report.valid, issues: report.issues, configHash: report.hash }; }),
  "capture-plan": action("Expand a named capture profile and device matrix without executing project commands.", { config: string, profile: string, screens: strings, output: string }, ["config"], (_store, input) => jsonFile(planCaptures(input), input.output)),
  "capture-run": action("Execute an authorized browser capture plan at an exact Git revision.", captureProperties, ["repo", "ref", "config", "output", "execute"], (store, input, context) => captureRevision(store, executionOptions(input, context))),
  "routes-discover": action("Propose static Next.js, SvelteKit, and literal router screens from tracked source files; does not import or execute them.", { repo: string, ref: string, roots: strings, project: string, name: string, output: string }, ["repo"], (_store, input) => discoverRoutes(input)),
  "screens-affected": action("Map exact changed files, static imports, and workspace package dependencies to configured screen sources.", { repo: string, config: string, profile: string, base: string, head: string, output: string }, ["repo", "config", "base"], (_store, input) => affectedScreens(input)),
  "capture-changed": action("Capture only screens affected by source and workspace dependencies; unmapped screens remain included.", { ...captureProperties, base: string, head: string }, ["repo", "config", "base", "head", "output", "execute"], async (store, input, context) => {
    const affected = affectedScreens({ ...input, output: undefined });
    if (!affected.screenKeys.length) return { affected, captured: false, reason: "No affected screens" };
    const result = await captureRevision(store, { ...executionOptions(input, context), ref: affected.head, screens: affected.screenKeys });
    return { ...result, affected, captured: true };
  }),
  "capture-repeatability": action("Capture one revision repeatedly and retain pixel measurements and unstable-region bounds.", { ...captureProperties, count: { type: "integer", minimum: 2 }, threshold: { type: "integer", minimum: 0, maximum: 255 } }, ["repo", "ref", "config", "output", "execute"], captureRepeatability),
  "capture-bisect": action("Find a visual difference crossing on first-parent history; scan mode handles nonmonotonic changes.", { ...captureProperties, base: string, head: string, maxChangedRatio: { type: "number", minimum: 0, maximum: 1 }, threshold: { type: "integer", minimum: 0, maximum: 255 }, mode: { enum: ["bisect", "scan"] } }, ["repo", "base", "head", "config", "output", "execute"], captureBisect),
  "capture-merge": action("Capture the exact merge-candidate ref supplied by a merge queue and record its parents.", captureProperties, ["repo", "ref", "config", "output", "execute"], captureMerge),
};
