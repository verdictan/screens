import { useEffect, useState } from "react";
export async function api(url, body, signal) {
  const response = await fetch(url, {
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || `HTTP ${response.status}`);
  return result;
}
export function useResource(url, revision = 0) {
  const [state, setState] = useState({});
  const token = `${url}|${revision}`;
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    api(url, undefined, controller.signal)
      .then((data) => setState({ token, url, data }))
      .catch((error) => {
        if (error.name !== "AbortError")
          setState({ token, url, error: error.message });
      });
    return () => controller.abort();
  }, [url, token]);
  return state.url === url ? state : {};
}
export const labels = {
  current: "What it is",
  target: "What it should be",
  pr: "PR result",
};
export const entryKey = (e) => `${e.screen}|${JSON.stringify(e.variant)}`;
