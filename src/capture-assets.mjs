import { dirname } from "node:path";

export function classifySource(file) {
  if (/(?:^|\/)(?:generated|vendor|dist|build|\.artifacts|archive|archives)(?:\/|$)/.test(file)) return "generated";
  if (/\.stories\.[cm]?[jt]sx?$/.test(file)) return "story";
  if (/(?:^|\/)(?:tests?|__tests__|fixtures|mocks)(?:\/|$)|\.(?:test|spec)\./.test(file)) return "fixture";
  if (/(?:^|\/)(?:api|server)(?:\/|$)|(?:^|\/)route\.[jt]s$/.test(file)) return "api";
  return "application";
}

export function literalValue(source, offset = 0) {
  let i = offset;
  const space = () => {
    while (true) {
      const match = source.slice(i).match(/^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)/);
      if (!match) break;
      i += match[0].length;
    }
  };
  function value() {
    space(); const c = source[i++];
    if (c === '"' || c === "'") {
      let result = "";
      while (i < source.length) {
        const char = source[i++];
        if (char === c) return result;
        if (char === "\\") {
          const escaped = source[i++];
          if (escaped === "u") { result += String.fromCharCode(parseInt(source.slice(i, i + 4), 16)); i += 4; }
          else result += ({ n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped;
        } else result += char;
      }
      throw Error("Unterminated literal");
    }
    if (c === "{" || c === "[") {
      const object = c === "{", result = object ? {} : [], end = object ? "}" : "]";
      space();
      while (source[i] !== end) {
        if (object) {
          let key;
          if (/['"]/.test(source[i])) key = value();
          else { const match = source.slice(i).match(/^[A-Za-z_$][\w$]*/); if (!match) throw Error("Computed property"); key = match[0]; i += key.length; }
          space(); if (source[i++] !== ":") throw Error("Nonliteral property");
          Object.defineProperty(result, key, { value: value(), enumerable: true, configurable: true, writable: true });
        } else result.push(value());
        space(); if (source[i] === end) break;
        if (source[i++] !== ",") throw Error("Nonliteral expression"); space();
      }
      i++; return result;
    }
    i--; const match = source.slice(i).match(/^(?:true\b|false\b|null\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) throw Error("Nonliteral expression");
    i += match[0].length; return JSON.parse(match[0]);
  }
  return { value: value(), end: i };
}

export function discoverCaptureAssets(applications, files, read) {
  const environment = [], scenarios = [], fixtures = [], modules = [], stories = [], readiness = [];
  const owners = file => {
    const candidates = applications.map(app => ({ app, root: /\.xc(?:odeproj|workspace)$/.test(app.path) ? dirname(app.path) : app.path }))
      .filter(({ root }) => root === "." || file.startsWith(`${root}/`));
    const length = Math.max(...candidates.map(({ root }) => root === "." ? 0 : root.length));
    return candidates.filter(({ root }) => (root === "." ? 0 : root.length) === length).map(({ app }) => app);
  };
  for (const file of files) {
    if (!/\.(?:[cm]?[jt]sx?|md|json|swift|kt|dart)$|(?:^|\/)\.env\.(?:example|sample|template)$/.test(file)) continue;
    if (classifySource(file) === "generated") continue;
    const text = read(file), fileOwners = owners(file);
    if (/\.(?:[cm]?[jt]sx?|vue|svelte|astro|html)$/.test(file) && text.includes("__SCREENS_CAPTURE__")) for (const app of fileOwners) readiness.push({ application: app.path, source: file, contract: "screens-v1" });
    const line = index => text.slice(0, index).split("\n").length;
    const requirements = new Map();
    for (const match of text.matchAll(/(?:process\.env|import\.meta\.env)(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g))
      requirements.set(match[1] || match[2], { required: false, line: line(match.index), evidence: "source-reference" });
    for (const match of text.matchAll(/['"`]([^'"`\n]*(?:must be set|is required|missing|required environment)[^'"`\n]*)['"`]/gi))
      for (const name of match[1].match(/\b[A-Z][A-Z0-9_]{2,}\b/g) || []) if (name.includes("_")) requirements.set(name, { required: true, line: line(match.index), evidence: "required-error" });
    if (/\.md$/.test(file)) {
      let required = false, level = 0;
      for (const [index, row] of text.split("\n").entries()) {
        const heading = row.match(/^(#+)\s+(.*)/);
        if (heading) {
          if (required && heading[1].length <= level) required = false;
          if (/required|necessary|mandatory/i.test(heading[2])) { required = true; level = heading[1].length; }
        }
        const name = row.match(/^\s*[-*]\s+`([A-Z][A-Z0-9_]+)`/);
        if (name) requirements.set(name[1], { required: required && !/optional|defaults? to/i.test(row), line: index + 1, evidence: "documentation" });
      }
    }
    if (/\.env\.(example|sample|template)$/.test(file)) for (const match of text.matchAll(/^([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/gm))
      requirements.set(match[1], { required: !match[2].trim(), line: line(match.index), evidence: "environment-template" });
    for (const app of fileOwners) for (const [name, requirement] of (classifySource(file) === "fixture" ? [] : requirements))
      environment.push({ application: app.path, name, source: file, ...requirement });
    if (/\.stories\.[cm]?[jt]sx?$/.test(file)) {
      for (const match of text.matchAll(/export\s+(?:const|function)\s+(\w+)/g)) stories.push({ source: file, export: match[1], applications: fileOwners.map(app => app.path) });
    }
    if (/capture|scenario|fixture|mock|stor(?:y|ies)/i.test(file)) {
      for (const match of text.matchAll(/(?:export\s+)?const\s+(\w+)\s*(?::[^=]+)?=\s*/g)) {
        try {
          const parsed = literalValue(text, match.index + match[0].length).value;
          if (match[1] === "dynamicSegmentDefaults" || /(?:routeParams|fixtureParams)$/i.test(match[1])) fixtures.push({ source: file, name: match[1], params: parsed, applications: fileOwners.map(app => app.path) });
          if (Array.isArray(parsed)) for (const item of parsed) if (item && typeof item.path === "string") scenarios.push({ ...item, source: file, applications: fileOwners.map(app => app.path) });
        } catch {}
      }
      for (const match of text.matchAll(/routeStory\(\s*(["'][^"']*["'])\s*,\s*(["'][^"']*["'])\s*,\s*(["'][^"']*["'])/g)) {
        const pattern = literalValue(match[1]).value, path = literalValue(match[2]).value, readyText = literalValue(match[3]).value;
        scenarios.push({ routePattern: pattern, path, readyText, source: file, applications: fileOwners.map(app => app.path), storyOnly: true });
      }
      for (const match of text.matchAll(/export\s+(?:async\s+)?function\s+(\w*(?:Scenarios|Routes)\w*)\s*\(/g)) modules.push({ source: file, export: match[1], execution: "requires-explicit-import" });
    }
    if (/\.json$/.test(file) && /fixture|scenario/i.test(file)) {
      try { const data = JSON.parse(text); fixtures.push({ source: file, name: "default", records: data, applications: fileOwners.map(app => app.path) }); } catch {}
    }
  }
  return { environment, scenarios, fixtures, modules, stories, readiness };
}
