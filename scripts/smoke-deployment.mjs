const base = `http://127.0.0.1:${process.env.SCREENS_PORT || 4800}`;
async function request(path, body) {
  const res = await fetch(
    base + path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {},
  );
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  return res.json();
}
if (!(await request("/api/health")).ok) throw Error("Unhealthy service");
if (process.argv[2] === "write")
  await request("/api/projects", {
    id: "deployment-check",
    name: "Deployment persistence check",
  });
else if (process.argv[2] !== "read") throw Error("Use write or read");
if (!(await request("/api/projects")).some((p) => p.id === "deployment-check"))
  throw Error("Persisted project missing");
const rpc = await request("/mcp", {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
});
if (!rpc.result.tools.some((t) => t.name === "diffs_create"))
  throw Error("MCP diff tool missing");
console.log("HTTP, MCP and registry persistence smoke check passed.");
