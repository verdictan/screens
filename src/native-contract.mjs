import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, isAbsolute } from "node:path";

export const nativeScreenId = (path, id) => `native-${createHash("sha256").update(JSON.stringify([path, id])).digest("hex").slice(0, 16)}`;

export function nativeContract(root, filename = "screens.native.json") {
  const file = resolve(root, filename);
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (value.version !== 1 || !Array.isArray(value.applications)) throw Error("screens.native.json requires version 1 and applications");
  for (const app of value.applications) {
    if (!app.path || !Array.isArray(app.screens) || !app.screens.length) throw Error("Native applications require path and screens");
    const ids = new Set();
    for (const screen of app.screens) {
      if (!/^[a-zA-Z0-9][\w./:-]*$/.test(screen.id) || ids.has(screen.id)) throw Error("Native screen IDs must be unique stable keys");
      ids.add(screen.id);
    }
  }
  return { source: filename, ...value };
}

export function nativeApplications(contract, profile) {
  return (contract?.applications || []).map(app => {
    const name = profile || app.defaultProfile;
    const fixture = name ? app.profiles?.[name] : {};
    if (name && !fixture) throw Error(`Unknown native fixture profile ${name}`);
    const { screens, profiles, defaultProfile, readiness, ...settings } = app;
    return { ...settings, adapter: "apple", nativeProfile: name || null, fixture: fixture.fixture || app.fixture, env: { ...app.env, ...fixture.env },
      scenarios: app.screens.map(screen => ({ key: screen.id, title: screen.title || screen.id, group: screen.group, readOnly: screen.readOnly, platforms: screen.platforms,
        args: [...(app.args || []), ...(fixture.args || []), ...(screen.args || [])], fixture: screen.fixture || fixture.fixture || app.fixture,
        ready: screen.readiness || fixture.readiness || app.readiness,
        readinessCommand: screen.readiness?.command || fixture.readiness?.command || app.readiness?.command,
        covers: [...(screen.covers || []), nativeScreenId(app.path, screen.id)], source: contract.source })) };
  });
}

export function nativeReadySpec(state, context, values = {}) {
  const base = state.ready;
  const spec = base ? { ...base, ...base.platforms?.[values.platform] } : null;
  if (!spec?.file) return null;
  const request = { version: 1, requestId: values.requestId, screen: state.key, fixture: state.fixture || values.fixture, profile: values.profile || null };
  const file = values.container ? join(values.container, spec.file) : isAbsolute(spec.file) ? spec.file : resolve(context.output, spec.file);
  if (values.container && (isAbsolute(spec.file) || spec.file.split(/[\\/]/).includes(".."))) throw Error("Simulator readiness files must be relative to the app data container");
  return { ...spec, appFile: spec.file, file, request, timeoutMs: spec.timeoutMs || 15000 };
}

export async function waitNativeReady(spec, signal) {
  if (!spec) return { status: "unverified", reason: "No native readiness signal" };
  const deadline = Date.now() + spec.timeoutMs;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const state = JSON.parse(readFileSync(spec.file, "utf8"));
      if (state.version === 1 && state.requestId === spec.request.requestId && state.screen === spec.request.screen && (!spec.request.fixture || state.fixture === spec.request.fixture)) {
        if (state.state === "error") return { status: "failed", method: "native-signal", reason: state.error || "Native app reported an error" };
        if (state.state === "ready" && state.pending === 0) return { status: "passed", method: "native-signal" };
      }
    } catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code) && !(error instanceof SyntaxError)) throw error; }
    await new Promise(done => setTimeout(done, 100));
  }
  return { status: "failed", method: "native-signal", reason: "Native readiness signal timed out" };
}
