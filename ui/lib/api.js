import { resourceFlow } from "./workflows";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const cache = new Map();
const writes = new Map();
const empty = Object.freeze({ status: "idle", refreshing: false });
function resource(url) {
  if (!cache.has(url)) cache.set(url, { snapshot: empty, listeners: new Set(), request: null });
  return cache.get(url);
}
function publish(record, snapshot) {
  record.snapshot = { ...snapshot, refreshing: ["loading", "refreshing"].includes(snapshot.status) };
  record.listeners.forEach((listener) => listener());
}
async function read(url, signal) {
  const response = await fetch(url, { signal });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.error || `HTTP ${response.status}`), { status: response.status, code: result.code, recovery: result.recovery });
  return result;
}
export function revalidate(url, force = false) {
  const record = resource(url);
  if (record.request && !force) return record.request;
  record.controller?.abort();
  const controller = new AbortController();
  record.controller = controller;
  publish(record, resourceFlow(record.snapshot, { type: "load" }));
  const request = read(url, controller.signal).then((data) => {
    if (record.controller === controller) publish(record, resourceFlow(record.snapshot, { type: "success", data }));
    return data;
  }).catch((error) => {
    if (record.controller === controller)
      publish(record, resourceFlow(record.snapshot, error.name === "AbortError" ? { type: "cancel" } : { type: "failure", error: error.message }));
  }).finally(() => {
    if (record.controller === controller) record.request = null;
  });
  record.request = request;
  return request;
}
export function refreshResources() {
  return Promise.all([...cache].filter(([, record]) => record.listeners.size)
    .map(([url]) => revalidate(url, true)));
}
window.addEventListener("focus", () => { void refreshResources(); });
window.addEventListener("online", () => { void refreshResources(); });

export async function api(url, body, signal) {
  if (body === undefined) return read(url, signal);
  const fingerprint = `${url}|${JSON.stringify(body)}`;
  let write = writes.get(fingerprint);
  if (write?.promise) return write.promise;
  if (!write) {
    write = { key: crypto.randomUUID() };
    writes.set(fingerprint, write);
  }
  write.promise = (async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": write.key },
      body: JSON.stringify(body), signal,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status < 500) writes.delete(fingerprint);
      throw Object.assign(Error(result.error || `HTTP ${response.status}`), { status: response.status, code: result.code, recovery: result.recovery });
    }
    writes.delete(fingerprint);
    await refreshResources();
    return result;
  })();
  try { return await write.promise; }
  finally { write.promise = null; }
}
export function useResource(url, revision = 0) {
  const subscribe = useCallback((listener) => {
    if (!url) return () => {};
    const record = resource(url);
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }, [url]);
  const snapshot = useCallback(() => url ? resource(url).snapshot : empty, [url]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { if (url) void revalidate(url); }, [url, revision]);
  return state;
}
export function useDelayedLoading(loading, identity) {
  const [visibleFor, setVisibleFor] = useState(null);
  useEffect(() => {
    if (!loading) { setVisibleFor(null); return; }
    const timer = setTimeout(() => setVisibleFor(identity), 300);
    return () => clearTimeout(timer);
  }, [loading, identity]);
  return loading && visibleFor === identity;
}
export const labels = { current: "Current", target: "Design", pr: "Update" };
export const entryKey = (e) => `${e.screen}|${JSON.stringify(e.variant)}`;
