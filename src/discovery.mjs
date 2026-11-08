import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { createHash } from "node:crypto";
import { parseSourceGraph } from "./source-graph.mjs";
import { nativeContract, nativeScreenId } from "./native-contract.mjs";
import { gitOutput } from "./runtime.mjs";
import { classifySource, discoverCaptureAssets } from "./capture-assets.mjs";
import { discoverScreens } from "./screen-inventory.mjs";
import { discover } from "./import.mjs";

const excluded = new Set([
  "node_modules", ".git", ".build", ".cache", ".next", ".nuxt", ".output",
  "dist", "build", "DerivedData", "Pods", "Carthage", "vendor", "target",
  ".artifacts", "generated", "coverage", "test-results", "ci-results", ".screens", ".agents", ".claude",
  ".history", ".venv", "venv", ".gradle", ".dart_tool", "storybook-static",
]);
const frameworks = [
  ["next", "Next.js"], ["@angular/core", "Angular"], ["@sveltejs/kit", "SvelteKit"],
  ["nuxt", "Nuxt"], ["astro", "Astro"], ["@remix-run/react", "Remix"],
  ["vite", "Vite"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"],
];

export function detectProject(projectPath) {
  const root = realpathSync(projectPath);
  if (!statSync(root).isDirectory()) throw Error("Detection needs a project directory");
  const files = [], directories = [], warnings = [];
  let visited = 0, repository = false;
  try { gitOutput(root, ["rev-parse", "--show-toplevel"], { stdio: ["pipe", "pipe", "ignore"] }); repository = true; } catch {}
  const ignored = paths => {
    if (!repository || !paths.length) return new Set();
    try { return new Set(gitOutput(root, ["check-ignore", "--stdin", "-z"], { input: paths.join("\0") + "\0", stdio: ["pipe", "pipe", "ignore"] }).split("\0").filter(Boolean)); }
    catch (error) { if (error.status === 1) return new Set(); throw error; }
  };
  function walk(folder, depth) {
    let entries;
    try { entries = readdirSync(folder, { withFileTypes: true }); }
    catch (error) { warnings.push(`${relative(root, folder) || "."}: ${error.code || error.message}`); return; }
    const ignoredPaths = ignored(entries.map(entry => relative(root, join(folder, entry.name))));
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 20000) return;
      const path = join(folder, entry.name);
      if (ignoredPaths.has(relative(root, path))) continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (excluded.has(entry.name) || /\.(app|xcassets|xcresult|xcarchive)$/.test(entry.name)) continue;
        directories.push(relative(root, path));
        if (depth < 8) walk(path, depth + 1);
        else warnings.push(`Depth limit reached: ${relative(root, path)}`);
      } else if (entry.isFile()) files.push(relative(root, path));
    }
  }
  walk(root, 0);
  if (!repository && files.some(file => basename(file) === ".gitignore")) warnings.push("Git ignore rules require a Git repository; only built-in exclusions were applied");
  if (visited > 20000) warnings.push("File limit reached; detection is partial");
  const normalized = (path) => path.replaceAll("\\", "/");
  const read = (file) => {
    try { return readFileSync(join(root, file), "utf8"); }
    catch (error) { warnings.push(`${file}: ${error.code || error.message}`); return ""; }
  };
  const applications = [], recipes = [], manifests = new Set(discover(root).map(file => relative(root, file)));
  const add = (path, kind, names, platforms, evidence) => {
    applications.push({ path: normalized(path), kind, frameworks: names, platforms, evidence: evidence.map(normalized),
      capture: kind === "web" ? "browser" : "native", coverage: "not-captured" });
  };
  for (const file of files) {
    const name = basename(file), folder = dirname(file), source = normalized(file);
    if (["fixture", "generated"].includes(classifySource(source))) continue;
    if (name === "package.json") {
      let pkg;
      try { pkg = JSON.parse(read(file)); }
      catch { warnings.push(`${source}: Invalid package.json`); continue; }
      const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
      const native = [
        ["expo", "Expo", ["ios", "android"]],
        ["react-native", "React Native", ["ios", "android"]],
        ["electron", "Electron", ["desktop"]],
        ["@tauri-apps/api", "Tauri", ["desktop"]],
        ["@tauri-apps/cli", "Tauri", ["desktop"]],
      ].filter(([key]) => Object.hasOwn(dependencies, key));
      const web = frameworks.filter(([key]) => Object.hasOwn(dependencies, key)).map(([, label]) => label);
      if (native.length) add(folder, "native", [...new Set(native.map(([, label]) => label))], [...new Set(native.flatMap(([, , platforms]) => platforms))], [file]);
      else if (web.length) add(folder, "web", web, ["web"], [file]);
      for (const [script, command] of Object.entries(pkg.scripts || {})) {
        if (typeof command !== "string") continue;
        if (/capture|screenshot|snapshot|evidence|mock.*server|fixture.*server|^(dev|start|build|storybook)$/.test(script))
          recipes.push({ path: normalized(folder), source, name: script, command,
            purpose: /capture|screenshot|snapshot|evidence/.test(script) ? "capture-candidate" : "development",
            execution: "not-run" });
      }
    } else if (name === "project.pbxproj") {
      const content = read(file);
      const platforms = [];
      if (/SDKROOT\s*=\s*macosx|SUPPORTED_PLATFORMS\s*=\s*"?macosx/.test(content)) platforms.push("macos");
      if (/SDKROOT\s*=\s*iphoneos|SUPPORTED_PLATFORMS\s*=\s*"?[^;]*iphone/.test(content)) {
        const families = [...content.matchAll(/TARGETED_DEVICE_FAMILY\s*=\s*"?([^;"\n]+)/g)].map(match => match[1]).join(",");
        if (/\b1\b/.test(families)) platforms.push("iphone");
        if (/\b2\b/.test(families)) platforms.push("ipad");
        if (!/\b[12]\b/.test(families)) platforms.push("ios");
      }
      if (/SDKROOT\s*=\s*appletvos/.test(content)) platforms.push("tvos");
      if (/SDKROOT\s*=\s*watchos/.test(content)) platforms.push("watchos");
      if (/SDKROOT\s*=\s*xros/.test(content)) platforms.push("visionos");
      if (content.includes("com.apple.product-type.application"))
        add(folder, "native", ["Xcode"], platforms.length ? platforms : ["apple-unspecified"], [file]);
    } else if (name === "Package.swift") {
      const content = read(file);
      if (/\.executable(?:Target)?\s*\(/.test(content))
        add(folder, "native", ["Swift executable"], ["native-unspecified"], [file]);
    } else if (name === "pubspec.yaml" && /^\s+sdk:\s*flutter\s*$/m.test(read(file))) {
      const platforms = ["ios", "android", "macos", "windows", "linux", "web"].filter(platform => directories.includes(join(folder === "." ? "" : folder, platform)));
      add(folder, "native", ["Flutter"], platforms.length ? platforms : ["unspecified"], [file]);
    } else if (/^build\.gradle(?:\.kts)?$/.test(name) && /com\.android\.application/.test(read(file))) {
      add(folder, "native", ["Android"], ["android"], [file]);
    } else if (/^tauri\.conf\.(json|json5)$/.test(name)) {
      add(folder, "native", ["Tauri"], ["desktop"], [file]);
    }
    if (/^(?:capture|screens)(?:[.-].*)?\.json$/.test(name)) recipes.push({ source, purpose: "configuration-candidate", execution: "not-run" });
    if (/(?:^|\/)(?:scripts?|Tools)\/.*(?:capture|screenshot|evidence)[^/]*\.(?:sh|mjs|js|py|swift)$/i.test(source))
      recipes.push({ source, purpose: "capture-candidate", execution: "not-run" });
    if (name === "screens.json" || /(?:docs\/picks|docs\/routing-comparison|\.artifacts\/ui-review)\/manifest\.json$/.test(source)) manifests.add(file);
  }
  if (files.includes("index.html") && !applications.some(app => app.path === "."))
    add(".", "web", ["Static HTML"], ["web"], ["index.html"]);
  for (const app of applications.filter(app => app.kind === "web")) {
    const prefix = app.path === "." ? "" : `${app.path}/`;
    const routes = new Map();
    for (const file of files.map(normalized).filter(file => file.startsWith(prefix))) {
      const local = file.slice(prefix.length);
      let route;
      if (app.frameworks.includes("Next.js")) {
        const page = local.match(/^(?:src\/)?app\/(.*)page\.(?:tsx?|jsx?|mdx)$/);
        const pages = local.match(/^(?:src\/)?pages\/(.+)\.(?:tsx?|jsx?|mdx)$/);
        if (page && !page[1].split("/").some(part => part.startsWith("_") || part.startsWith("@")))
          route = page[1].split("/").filter(part => part && !/^\(.*\)$/.test(part)).join("/");
        if (pages && !/^(api\/|_)/.test(pages[1])) route = pages[1].replace(/(?:^|\/)index$/, "");
      } else if (app.frameworks.includes("SvelteKit")) {
        const page = local.match(/^src\/routes\/(.*)\+page\.svelte$/);
        if (page) route = page[1].split("/").filter(part => part && !/^\(.*\)$/.test(part)).join("/");
      } else if (app.frameworks.includes("Nuxt") || app.frameworks.includes("Astro")) {
        const page = local.match(/^(?:src\/|app\/)?pages\/(.+)\.(?:vue|astro|md|mdx|html)$/);
        if (page) route = page[1].replace(/(?:^|\/)index$/, "");
      }
      if (route !== undefined) {
        route = "/" + route.replace(/^\/+|\/+$/g, "");
        routes.set(route, { path: route, source: file, confidence: "declared", parser: "file-router", requiresParameters: /[\[\]$:*]/.test(route) });
      }
    }
    app.routes = [...routes.values()];
    if (!app.routes.length) app.routes.push({ path: "/", source: app.evidence[0], confidence: "possible", parser: "launch-probe", requiresParameters: false });
  }
  const uiFiles = files.map(normalized).filter(file => !["api", "fixture", "generated"].includes(classifySource(file)));
  const graph = parseSourceGraph(applications, uiFiles, read);
  if (graph.warnings.length) warnings.push(`${graph.warnings.length} source files have unresolved parser syntax; see inventory.parserWarnings`);
  for (const app of applications.filter(app => app.kind === "web")) {
    const inside = file => app.path === "." || file.startsWith(app.path + "/");
    for (const record of graph.records.filter(record => record.kind === "route" && inside(record.source))) {
      const entry = { path: record.route, source: record.source, line: record.line, requiresParameters: !record.route.startsWith("/") || /[\[\]$:*]/.test(record.route), confidence: "declared", parser: graph.parser };
      const existing = app.routes.find(route => route.path === record.route);
      if (!existing) app.routes.push(entry);
      else if (existing.parser === "launch-probe" || existing.source === record.source) Object.assign(existing, entry);
    }
  }
  const contract = nativeContract(root);
  for (const app of contract?.applications || []) if (!applications.some(existing => existing.path === app.path)) add(app.path, "native", ["Xcode"], app.platforms || [], [contract.source]);
  const assets = discoverCaptureAssets(applications, files.map(normalized), read);
  assets.readiness = assets.readiness.filter(item => graph.records.some(record => record.kind === "readiness-contract" && record.source === item.source));
  const inventory = discoverScreens(applications, uiFiles, read, graph);
  for (const app of contract?.applications || []) for (const screen of app.screens) inventory.items.push({
    id: nativeScreenId(app.path, screen.id), application: app.path, kind: "native-screen", name: screen.id, source: contract.source, line: 1,
    confidence: "declared", classification: "screen", platforms: screen.platforms || app.platforms,
  });
  const workspaces = directories.filter(path => path.endsWith(".xcworkspace")).map(normalized);
  const schemes = files.filter(path => path.endsWith(".xcscheme")).map(normalized);
  if (!applications.length) warnings.push("No supported frontend or application markers found");
  return {
    root, applications, workspaces, schemes, recipes, inventory, assets, nativeContract: contract,
    inputs: files.map(path => ({ path: normalized(path), hash: createHash("sha256").update(readFileSync(join(root, path))).digest("hex") })), ignoreRules: repository ? "git" : "built-in",
    manifests: [...manifests].sort().map(normalized), warnings,
    execution: "not-run",
    nextSteps: [
      ...(applications.some(app => app.capture === "browser") ? ["Run capture-auto to start supported frontends and capture concrete routes. Configure authentication and dynamic routes in screens.capture.json."] : []),
      ...(applications.some(app => app.capture === "native") ? ["Run capture-auto for Xcode launch screens or configure native state commands in screens.capture.json."] : []),
      "Use inventory IDs to map source candidates to scenarios. Uncertain candidates stay in the discovery backlog unless coverage.required selects them.",
    ],
  };
}
