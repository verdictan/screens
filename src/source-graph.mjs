import ts from "typescript";
import { posix } from "node:path";
import { parse as parseJson } from "jsonc-parser";

export function parseSourceGraph(applications, files, read) {
  const records = [], relationships = [], warnings = [], fileSet = new Set(files);
  const aliases = [];
  for (const file of files.filter(file => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(file))) {
    const config = parseJson(read(file));
    for (const [pattern, targets] of Object.entries(config?.compilerOptions?.paths || {}))
      for (const target of Array.isArray(targets) ? targets : []) aliases.push({ root: posix.dirname(file), pattern, target: posix.join(posix.dirname(file), config.compilerOptions.baseUrl || ".", target) });
  }
  const resolveImport = (file, specifier) => {
    const candidates = specifier.startsWith(".") ? [posix.join(posix.dirname(file), specifier)] : aliases.flatMap(alias => {
      if (alias.root !== "." && !file.startsWith(alias.root + "/")) return [];
      const [prefix, suffix = ""] = alias.pattern.split("*");
      if (!alias.pattern.includes("*")) return alias.pattern === specifier ? [alias.target] : [];
      return specifier.startsWith(prefix) && specifier.endsWith(suffix) ? [alias.target.replace("*", specifier.slice(prefix.length, suffix ? -suffix.length : undefined))] : [];
    });
    return candidates.flatMap(candidate => [candidate, ...[".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte", ".astro"].flatMap(extension => [candidate + extension, candidate + "/index" + extension])]).find(candidate => fileSet.has(candidate)) || null;
  };
  for (const file of files.filter(file => /\.[cm]?[jt]sx?$|\.(?:vue|svelte|astro)$/.test(file))) {
    const text = read(file);
    let script = text;
    if (/\.(?:vue|svelte|astro)$/.test(file)) {
      const characters = text.split("").map(char => /[\r\n]/.test(char) ? char : " ");
      const blocks = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
      const frontmatter = file.endsWith(".astro") && text.match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatter) blocks.push({ ...frontmatter, index: 0 });
      for (const block of blocks) {
        const start = block.index + block[0].indexOf(block[1]);
        for (let i = 0; i < block[1].length; i++) characters[start + i] = block[1][i];
      }
      script = characters.join("");
    }
    const source = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, /\.[cm]?jsx?$/.test(file) ? ts.ScriptKind.JSX : file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (source.parseDiagnostics.length) { warnings.push({ source: file, reason: "Parser could not resolve all syntax", count: source.parseDiagnostics.length }); continue; }
    const imports = new Map();
    const string = node => node && ts.isStringLiteralLike(node) ? node.text : undefined;
    const position = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const imported = node => {
      if (!node) return null;
      if (ts.isJsxSelfClosingElement(node)) return imported(node.tagName);
      if (ts.isJsxElement(node)) return imported(node.openingElement.tagName);
      if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return imported(node.expression);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "then") {
        const target = imported(node.expression.expression), callback = node.arguments[0];
        if (target && callback && ts.isArrowFunction(callback) && ts.isPropertyAccessExpression(callback.body)) return { ...target, symbol: callback.body.name.text };
      }
      if (ts.isIdentifier(node)) return imports.get(node.text) || { source: file, symbol: node.text };
      if (ts.isArrowFunction(node) || ts.isParenthesizedExpression(node)) return imported(node.body || node.expression);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) { const path = string(node.arguments[0]); return path ? { source: resolveImport(file, path), symbol: "default", specifier: path } : null; }
      return null;
    };
    function visit(node) {
      if (ts.isImportDeclaration(node)) {
        const specifier = string(node.moduleSpecifier), target = specifier && resolveImport(file, specifier);
        if (node.importClause?.name) imports.set(node.importClause.name.text, { source: target, symbol: "default", specifier });
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imports.set(element.name.text, { source: target, symbol: element.propertyName?.text || element.name.text, specifier });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    const router = [...imports.values()].some(item => /react-router|@angular\/router|vue-router/.test(item.specifier));
    const add = (kind, route, node, component = null, extra = {}) => {
      records.push({ kind, route, source: file, line: position(node), component, confidence: "declared", method: "typescript-ast", ...extra });
      if (component?.source) relationships.push({ kind: "renders", source: file, route, target: component.source, symbol: component.symbol, confidence: "declared" });
    };
    const jsxAttribute = (node, name) => node.attributes.properties.find(property => ts.isJsxAttribute(property) && property.name.getText(source) === name)?.initializer;
    const attributeString = node => ts.isJsxExpression(node || {}) ? string(node.expression) : string(node);
    const jsxPath = node => {
      let value = attributeString(jsxAttribute(node, "path"));
      if (value === undefined) return value;
      let parent = node.parent;
      while (parent) {
        if (ts.isJsxElement(parent) && parent.openingElement !== node && parent.openingElement.tagName.getText(source) === "Route") {
          const path = attributeString(jsxAttribute(parent.openingElement, "path"));
          if (path && !value.startsWith("/")) value = posix.join(path, value);
        }
        parent = parent.parent;
      }
      return value;
    };
    function inspect(node) {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && /^(?:window|globalThis)\.__SCREENS_CAPTURE__$/.test(node.left.getText(source))) add("readiness-contract", "screens-v1", node);
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "Route") {
        const path = jsxPath(node);
        if (path !== undefined) {
          const element = jsxAttribute(node, "element");
          const expression = element && ts.isJsxExpression(element) ? element.expression : null;
          const tag = expression && (ts.isJsxSelfClosingElement(expression) ? expression.tagName : ts.isJsxElement(expression) ? expression.openingElement.tagName : null);
          add("route", path, node, imported(tag));
        }
      }
      if (router && ts.isObjectLiteralExpression(node)) {
        const properties = node.properties.filter(ts.isPropertyAssignment);
        const property = name => properties.find(item => item.name.getText(source).replace(/['"]/g, "") === name)?.initializer;
        let path = string(property("path"));
        let parent = node.parent;
        while (path !== undefined && !path.startsWith("/") && parent) {
          if (ts.isObjectLiteralExpression(parent)) {
            const prefix = parent.properties.filter(ts.isPropertyAssignment).find(item => item.name.getText(source).replace(/['"]/g, "") === "path");
            const value = string(prefix?.initializer); if (value) path = posix.join(value, path);
          }
          parent = parent.parent;
        }
        if (path !== undefined) add("route", path, node, imported(property("component") || property("Component") || property("element") || property("loadComponent")), { relative: !path.startsWith("/") });
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source), path = string(node.arguments[0]);
        if (path?.startsWith("/") && (/router\.(?:push|replace|navigate)$/.test(callee) || callee === "navigate")) add("navigation", path, node);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["Link", "NavLink"].includes(tag)) {
          const path = attributeString(jsxAttribute(node, "href") || jsxAttribute(node, "to"));
          if (path?.startsWith("/")) add("navigation", path, node);
        }
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    const routeOwners = applications.filter(app => app.routes?.some(route => route.source === file));
    if (routeOwners.length) {
      let exported;
      for (const statement of source.statements) {
        if (ts.isExportAssignment(statement)) exported = imported(statement.expression);
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) exported = { source: file, symbol: statement.name?.text || "default" };
      }
      if (exported) for (const app of routeOwners) for (const route of app.routes.filter(route => route.source === file)) relationships.push({ kind: "renders", source: file, route: route.path, target: exported.source, symbol: exported.symbol, confidence: "declared" });
    }
  }
  return { records, relationships, warnings, parser: "typescript" };
}
