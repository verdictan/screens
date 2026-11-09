import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";
import { createServer } from "node:net";
import { once } from "node:events";

export function substitute(value, variables) {
  if (Array.isArray(value)) return value.map(item => substitute(item, variables));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, variables)]));
  if (typeof value !== "string") return value;
  return value.replace(/\{((?:services|ports|env)\.[\w.-]+|root|output)\}/g, (_, key) => {
    if (variables[key] === undefined) throw Error(`Missing capture variable: ${key}`);
    return String(variables[key]);
  });
}

export function environmentAt(cwd, extraFiles = []) {
  const values = {};
  for (const file of [".env", ".env.development", ".env.local", ".env.development.local", ...extraFiles]) {
    const path = resolve(cwd, file);
    if (existsSync(path)) Object.assign(values, parseEnv(readFileSync(path, "utf8")));
    else if (extraFiles.includes(file)) throw Error(`Environment file not found: ${file}`);
  }
  return values;
}

export async function managedEnvironment(config, detection, applications, context, operations) {
  const children = [], logs = [], report = { environment: [], services: [], setup: [] };
  const variables = { root: context.root, output: context.output, ...Object.fromEntries(Object.entries(process.env).map(([key, value]) => [`env.${key}`, value])) };
  const services = config.services || [];
  const ports = new Set([...(config.ports || []), ...services.map(service => service.name)]);
  for (const name of ports) {
    const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
    variables[`ports.${name}`] = server.address().port;
    variables[`services.${name}.port`] = server.address().port;
    variables[`services.${name}.url`] = `http://127.0.0.1:${server.address().port}`;
    await new Promise(done => server.close(done));
  }
  const inheritedEnv = { ...environmentAt(context.root, config.envFiles), ...process.env };
  for (const [key, value] of Object.entries(inheritedEnv)) variables[`env.${key}`] = value;
  const rootEnv = { ...inheritedEnv, ...substitute(config.env || {}, variables) };
  for (const [key, value] of Object.entries(rootEnv)) variables[`env.${key}`] = value;
  const prepared = applications.map(app => {
    const cwd = resolve(context.root, app.path || ".");
    const env = { ...rootEnv, ...environmentAt(cwd, app.envFiles), ...process.env, ...substitute(config.env || {}, variables), ...substitute(app.env || {}, variables) };
    const required = new Set([...(config.requiredEnv || []), ...(app.requiredEnv || []), ...detection.assets.environment.filter(item => item.application === (app.path || ".") && item.required).map(item => item.name)]);
    const optional = new Set(app.optionalEnv || []);
    report.environment.push({ application: app.path || ".", required: [...required].filter(name => !optional.has(name)), missing: [...required].filter(name => !optional.has(name) && !String(env[name] ?? "").trim()) });
    const appVariables = { ...variables, ...Object.fromEntries(Object.entries(env).map(([key, value]) => [`env.${key}`, value])) };
    return { ...substitute({ ...app, env: undefined }, appVariables), env };
  });
  const preparedServices = services.map(service => substitute(service, variables));
  const setupCommands = substitute(config.setup || [], variables);
  for (const service of preparedServices) {
    const env = { ...rootEnv, ...substitute(service.env || {}, variables) };
    report.environment.push({ service: service.name, required: service.requiredEnv || [], missing: (service.requiredEnv || []).filter(name => !String(env[name] ?? "").trim()) });
  }
  let cleanup;
  const close = () => cleanup ||= (async () => {
    for (const { child, record } of [...children].reverse()) {
      try { record.phase = "stopping"; await operations.stop(child); record.stopped = true; record.phase = "stopped"; }
      catch (error) { record.stopped = false; record.phase = "stop-failed"; (report.cleanupErrors ||= []).push(`${record.name}: ${error.message}`); }
    }
    for (const entry of logs) {
      try { writeFileSync(join(context.output, `service-${entry.index}.log`), entry.text, { flag: "wx" }); }
      catch (error) { (report.cleanupErrors ||= []).push(`Service log ${entry.index}: ${error.message}`); }
    }
  })();
  const missing = report.environment.filter(item => item.missing.length);
  if (missing.length) { const error = Error(`Missing environment settings: ${missing.map(item => `${item.application || item.service}: ${item.missing.join(", ")}`).join("; ")}`); error.environmentReport = report; throw error; }
  const setupContext = { ...context, env: rootEnv };
  try {
    const pending = new Map(preparedServices.map(service => [service.name, service]));
    if (pending.size !== services.length) throw Error("Managed service names must be unique");
    const ready = new Set();
    while (pending.size) {
      const entry = [...pending.entries()].find(([, service]) => (service.dependsOn || []).every(name => ready.has(name)));
      if (!entry) throw Error("Service dependencies contain a cycle or unknown name");
      const [name, raw] = entry, service = substitute(raw, variables);
      context.signal?.throwIfAborted();
      const record = { name, status: "starting", phase: "starting", url: variables[`services.${name}.url`] }; report.services.push(record);
      const log = { index: logs.length, text: "" }; logs.push(log);
      const serviceContext = { ...setupContext, cwd: resolve(context.root, service.cwd || "."), env: { ...rootEnv, PORT: String(variables[`ports.${name}`]), ...service.env }, log: chunk => { log.text = (log.text + chunk).slice(-8 * 1024 * 1024); } };
      for (const args of service.prepare || []) await operations.command(args, serviceContext);
      const child = operations.launch(service.command, serviceContext.cwd, serviceContext.env, serviceContext.log);
      children.push({ child, record });
      if (!service.ready?.url) throw Error(`Service ${name} needs ready.url`);
      const deadline = Date.now() + (service.ready.timeoutMs || 60000);
      let healthy = false;
      while (Date.now() < deadline) {
        context.signal?.throwIfAborted();
        if (child.failure || child.exitCode !== null || child.signalCode) throw Error(`Service ${name} exited before readiness`);
        try {
          const response = await fetch(service.ready.url, { signal: AbortSignal.any([AbortSignal.timeout(1000), ...(context.signal ? [context.signal] : [])]) });
          if (response.status === (service.ready.status || 200)) { await response.body?.cancel(); healthy = true; break; }
          await response.body?.cancel();
        } catch (error) { context.signal?.throwIfAborted(); }
        await new Promise(done => setTimeout(done, 200));
      }
      if (!healthy) throw Error(`Service ${name} did not become ready`);
      record.status = "ready"; record.phase = "ready"; ready.add(name); pending.delete(name);
    }
    for (const args of setupCommands) { await operations.command(args, setupContext); report.setup.push({ status: "completed" }); }
    return { applications: prepared, variables, env: rootEnv, report, close,
      assertRunning() { for (const { child, record } of children) if (child.failure || child.exitCode !== null || child.signalCode) throw Error(`Managed service ${record.name} exited during capture`); } };
  } catch (error) {
    for (const record of report.services) if (record.status === "starting") { record.status = "failed"; record.phase = "failed"; }
    await close(); error.environmentReport = report; throw error;
  }
}
