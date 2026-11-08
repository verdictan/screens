import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { takeCoverage } from "node:v8";
import { after } from "node:test";

const contexts = [];
after(() => { takeCoverage(); contexts.length = 0; });
export class Exit extends Error {
  constructor(code) {
    super(`exit ${code}`);
    this.code = code;
  }
}
export async function moduleUnderTest(
  file,
  {
    mocks = {},
    globals = {},
    argv = [],
    env = {},
    platform = process.platform,
    processOverrides = {},
  } = {},
) {
  const logs = [],
    errors = [];
  const proc = {
    ...process,
    argv: [process.execPath, resolve(file), ...argv],
    env: { ...process.env, ...env },
    platform,
    exitCode: 0,
    exit(code) {
      throw new Exit(code);
    },
    ...processOverrides,
  };
  const context = vm.createContext({
    Buffer,
    URL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch,
    process: proc,
    console: {
      log: (...a) => logs.push(a.join(" ")),
      error: (...a) => errors.push(a.join(" ")),
    },
    ...globals,
  });
  contexts.push(context);
  const url = pathToFileURL(resolve(file)).href;
  const cache = new Map();
  const dependency = async (specifier, ref) => {
    const id = specifier.startsWith(".")
      ? new URL(specifier, ref.identifier).href
      : specifier;
    if (cache.has(id)) return cache.get(id);
    const exports = mocks[specifier] ?? mocks[id] ?? (await import(id));
    const names = Object.keys(exports);
    const mod = new vm.SyntheticModule(
      names,
      function () {
        for (const name of names) this.setExport(name, exports[name]);
      },
      { context, identifier: id },
    );
    cache.set(id, mod);
    return mod;
  };
  const mod = new vm.SourceTextModule(readFileSync(resolve(file), "utf8"), {
    context,
    identifier: url,
    initializeImportMeta(meta) {
      meta.url = url;
    },
    importModuleDynamically: async (specifier, ref) => {
      const dep = await dependency(specifier, ref);
      if (dep.status === "unlinked") await dep.link(dependency);
      if (dep.status === "linked") await dep.evaluate();
      return dep;
    },
  });
  await mod.link(dependency);
  let error;
  try {
    await mod.evaluate();
  } catch (e) {
    error = e;
  }
  takeCoverage();
  return {
    exports: mod.namespace,
    logs,
    errors,
    error,
    process: proc,
    context,
  };
}
