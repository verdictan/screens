import { workflows, workflowCatalog, feedbackOpen, feedbackTaskWorkflow, canJobTransition, jobActions } from "./workflows.mjs";
import { Worker } from "node:worker_threads";
import { automaticInput } from "./automatic-plan.mjs";
import { captureSummary } from "./capture-summary.mjs";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, accessSync, constants, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, platform, arch } from "node:os";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { requireThat, revisionRecovery, text, choice } from "./validation.mjs";
import { bundledGit, captureBrowser } from "./runtime.mjs";
import { captureConfig } from "./capture-recipe.mjs";
import { captureRevision, resolveRevision } from "./capture.mjs";

const now = () => new Date().toISOString();
const parse = (row) => row ? JSON.parse(row.data) : null;
const string = { type: "string" }, integer = { type: "integer" }, boolean = { type: "boolean" };
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const action = (description, properties, required, run, cliOnly = false) => ({ description, inputSchema: schema(properties, required), run, cliOnly });
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function initializeAutomation(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS capture_jobs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS task_claims (id TEXT PRIMARY KEY REFERENCES notes(id), revision INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS job_events (id INTEGER PRIMARY KEY, job TEXT NOT NULL REFERENCES capture_jobs(id), data TEXT NOT NULL);
  `);
}
function get(store, table, id) {
  const value = parse(store.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(text(id, "ID")));
  requireThat(value, "Record not found", 404);
  return value;
}
function revision(previous, expected) {
  requireThat(expected === (previous?.revision ?? 0), "Record changed. Read its latest revision before updating.", 409, revisionRecovery("automation-record", previous?.id));
}
function save(store, table, value) {
  store.db.prepare(`INSERT INTO ${table} VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data`)
    .run(value.id, value.revision, JSON.stringify(value));
  return value;
}
function jobEvent(store, job, type, value = {}) {
  store.db.prepare("INSERT INTO job_events(job,data) VALUES (?,?)").run(job, JSON.stringify({ type, at: now(), ...value }));
  store.event(type, { job, ...value });
}
function note(store, id) { return get(store, "notes", id); }
function claims(store) { return new Map(store.db.prepare("SELECT id,data FROM task_claims").all().map((row) => [row.id, parse(row)])); }
function live(claim) { return claim?.owner && Date.parse(claim.expiresAt) > Date.now(); }
function taskList(store, input) {
  const allClaims = claims(store);
  const notes = store.db.prepare("SELECT data FROM notes ORDER BY rowid").all().map(parse)
    .filter((note) => feedbackOpen(note))
    .filter((note) => !input.project || store.getScreen(note.screen).project === input.project)
    .filter((note) => !input.status || note.status === input.status);
  const tasks = notes.map((note) => ({ ...note, workflow: feedbackTaskWorkflow(note), claim: allClaims.get(note.id) || null, available: !live(allClaims.get(note.id)) }));
  return { tasks: tasks.filter((task) => !input.available || task.available).slice(0, input.limit || 100), total: tasks.length };
}
function claimTask(store, input, release = false) {
  return store.transaction(() => {
    const task = note(store, input.id);
    const previous = parse(store.db.prepare("SELECT data FROM task_claims WHERE id=?").get(task.id));
    revision(previous, input.expectedRevision);
    const owner = text(input.owner, "owner");
    requireThat(!live(previous) || previous.owner === owner, "Task is claimed by another agent", 409);
    requireThat(release || feedbackOpen(task), "Task is already closed", 409);
    const seconds = input.seconds ?? 900;
    requireThat(Number.isInteger(seconds) && seconds >= 30 && seconds <= 86400, "Lease must be 30–86400 seconds");
    const value = save(store, "task_claims", { id: task.id, owner: release ? null : owner, expiresAt: release ? now() : new Date(Date.now() + seconds * 1000).toISOString(), revision: (previous?.revision ?? 0) + 1, updatedAt: now() });
    store.event(release ? "task.released" : "task.claimed", { note: task.id, owner, revision: value.revision });
    return value;
  });
}
function taskHandoff(store, input) {
  const task = note(store, input.id), detail = store.getScreen(task.screen);
  const original = store.getCapture(task.capture);
  const ids = new Set([task.capture, task.evidence].filter(Boolean));
  const captures = [...ids].map((id) => store.getCapture(id));
  const measurements = store.db.prepare("SELECT data FROM diffs ORDER BY rowid").all().map(parse).filter((item) => ids.has(item.left) || ids.has(item.right));
  return { task, claim: parse(store.db.prepare("SELECT data FROM task_claims WHERE id=?").get(task.id)),
    screen: { id: detail.id, title: detail.title, route: detail.route, source: detail.source, recipe: detail.recipe },
    captures, evidence: detail.evidence.filter((item) => ids.has(item.capture)), measurements,
    relatedNotes: detail.notes.filter((item) => item.id !== task.id && ids.has(item.capture)),
    sourceLinks: store.db.prepare("SELECT data FROM source_links WHERE capture=?").all(original.id).map(parse),
    workflow: feedbackTaskWorkflow(task),
    instructions: "Keep original capture anchors. Submit a new implementation capture and resolution. Human review decides acceptance." };
}
function listPage(store, input) {
  const tables = { screens: "screens", captures: "captures", notes: "notes", runs: "runs", evidence: "evidence", reviewSets: "review_sets" };
  const table = tables[input.collection];
  requireThat(table, "Unknown collection");
  const limit = input.limit ?? 50;
  requireThat(Number.isInteger(limit) && limit > 0 && limit <= 500, "Limit must be 1–500");
  const fingerprint = hash({ collection: input.collection, project: input.project, screen: input.screen, capture: input.capture });
  const cursor = input.cursor ? JSON.parse(Buffer.from(input.cursor, "base64url").toString()) : {
    after: 0, until: store.db.prepare(`SELECT COALESCE(MAX(rowid),0) AS last FROM ${table}`).get().last, fingerprint,
  };
  requireThat(cursor.fingerprint === fingerprint && Number.isInteger(cursor.after) && Number.isInteger(cursor.until), "Cursor belongs to a different query");
  const clauses = ["rowid > ?", "rowid <= ?"], values = [cursor.after, cursor.until];
  if (input.project) {
    if (["screens", "runs", "review_sets"].includes(table)) clauses.push("json_extract(data,'$.project')=?");
    else if (["captures", "notes"].includes(table)) clauses.push("json_extract(data,'$.screen') IN (SELECT id FROM screens WHERE project=?)");
    else clauses.push("capture IN (SELECT c.id FROM captures c JOIN screens s ON s.id=c.screen WHERE s.project=?)");
    values.push(input.project);
  }
  if (input.screen) { clauses.push(table === "screens" ? "id=?" : table === "evidence" ? "capture IN (SELECT id FROM captures WHERE screen=?)" : "json_extract(data,'$.screen')=?"); values.push(input.screen); }
  if (input.capture) { clauses.push(table === "captures" ? "id=?" : "json_extract(data,'$.capture')=?"); values.push(input.capture); }
  const rows = store.db.prepare(`SELECT rowid,data FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY rowid LIMIT ?`).all(...values, limit + 1);
  const page = rows.slice(0, limit);
  return { items: page.map(parse), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ ...cursor, after: page.at(-1).rowid })).toString("base64url") : null };
}
function scopedEvidence(store, input) {
  const ids = new Set();
  if (input.capture) ids.add(store.getCapture(input.capture).id);
  if (input.run) for (const id of store.getRun(input.run).captureIds) ids.add(id);
  if (input.reviewSet) {
    const set = get(store, "review_sets", input.reviewSet), run = store.compare(set.run);
    for (const entry of run.entries.filter((entry) => set.entries.includes(`${entry.screen}|${JSON.stringify(entry.variant)}`)))
      for (const capture of Object.values(entry.captures)) ids.add(capture.id);
  }
  requireThat(ids.size, "Supply capture, run, or reviewSet");
  const intersects = (a) => !input.region || !a || a.x < input.region.x + input.region.width && a.x + a.width > input.region.x && a.y < input.region.y + input.region.height && a.y + a.height > input.region.y;
  const captures = [...ids].map((id) => store.getCapture(id));
  const notes = store.db.prepare("SELECT data FROM notes").all().map(parse).filter((item) => ids.has(item.capture) && intersects(item.region || (item.point && { ...item.point, width: 0.00001, height: 0.00001 })));
  const measurements = store.db.prepare("SELECT data FROM diffs").all().map(parse).filter((item) => (ids.has(item.left) || ids.has(item.right)) && intersects(item.region));
  const evidence = captures.flatMap((capture) => store.listEvidence({ capture: capture.id }));
  const derived = store.db.prepare("SELECT data FROM derived_evidence").all().map(parse).filter((item) => ids.has(item.capture));
  return { captures, notes, measurements, evidence, derived };
}

async function doctor(store, input) {
  const findings = [];
  const add = (name, ok, detail, fix = null) => findings.push({ name, ok, detail, fix: ok ? null : fix });
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  add("node", major > 22 || major === 22 && (minor > 22 || minor === 22 && patch >= 2), process.version, "Install Node.js 22.22.2 or later");
  add("bundled-git", existsSync(bundledGit.gitLocation), bundledGit.gitLocation, "Reinstall Screens to restore its bundled Git");
  try {
    let directory = store.directory;
    while (!existsSync(directory) && dirname(directory) !== directory) directory = dirname(directory);
    accessSync(directory, constants.R_OK | constants.W_OK);
    add("registry", true, existsSync(store.directory) ? store.directory : `${store.directory} can be created`);
  }
  catch (error) { add("registry", false, error.message, "Choose a writable registry directory with --data"); }
  for (const name of ["chromium", "firefox", "webkit"]) {
    const executable = (await captureBrowser(name)).executablePath();
    add(`bundled-${name}`, existsSync(executable), executable, "Reinstall Screens to restore its bundled browsers");
  }
  if (input.port) {
    const occupied = await new Promise((done) => {
      const socket = createConnection({ host: "127.0.0.1", port: input.port });
      socket.once("connect", () => { socket.destroy(); done(true); });
      socket.once("error", () => done(false)); socket.setTimeout(1000, () => { socket.destroy(); done(false); });
    });
    add("port", !occupied, `${input.port} is ${occupied ? "in use" : "available"}`, "Use another port or stop the process that owns it");
  }
  return { platform: platform(), arch: arch(), findings, ok: findings.every((item) => item.ok) };
}
function recipe(input) {
  const config = captureConfig(input.config, { profile: input.profile, screens: input.screens });
  const repo = resolve(text(input.repo, "repository"));
  return { repo, config: config.value, configHash: config.hash, ref: resolveRevision(repo, input.ref || "HEAD"), role: input.role || "pr", profile: input.profile || null };
}
function enqueue(store, input) {
  requireThat(input.execute === "yes", "Review the capture recipe and pass execute=yes to queue it");
  const prepared = recipe(input);
  return store.transaction(() => enqueuePrepared(store, prepared, input));
}
function enqueuePrepared(store, prepared, input) {
  const value = { id: randomUUID(), revision: 1, ...prepared, title: input.title || `Capture ${prepared.ref.slice(0, 12)}`,
    status: "queued", captures: [], worker: null, token: null, leaseUntil: null, attempts: 0,
    createdAt: now(), updatedAt: now(), result: null, error: null };
  save(store, "capture_jobs", value); jobEvent(store, value.id, "job.queued"); return value;
}
function leaseJob(store, input) {
  return store.transaction(() => {
    const job = store.db.prepare("SELECT data FROM capture_jobs ORDER BY rowid").all().map(parse).find((job) =>
      canJobTransition(job, "lease", { actor: "worker" }) &&
      (!input.id || job.id === input.id) && (job.kind !== "automatic" || existsSync(job.repo)));
    if (!job) return null;
    Object.assign(job, { worker: text(input.worker, "worker"), token: randomUUID(), status: workflows.job.events.lease.to, leaseUntil: new Date(Date.now() + 60000).toISOString(), attempts: job.attempts + 1, revision: job.revision + 1, updatedAt: now() });
    save(store, "capture_jobs", job); jobEvent(store, job.id, "job.started", { worker: job.worker, attempt: job.attempts }); return job;
  });
}
function ownedJob(store, input) {
  const job = get(store, "capture_jobs", input.id);
  requireThat(canJobTransition(job, "heartbeat", { actor: "worker", token: input.token }), "Job lease expired or changed", 409);
  return job;
}
function heartbeat(store, input) {
  return store.transaction(() => {
    const job = ownedJob(store, input);
    job.leaseUntil = new Date(Date.now() + 60000).toISOString(); job.updatedAt = now(); job.revision++;
    return save(store, "capture_jobs", job);
  });
}
function checkpoint(store, input) {
  return store.transaction(() => {
    const job = ownedJob(store, input);
    const capture = store.getCapture(input.capture);
    requireThat(capture.revision === job.ref && store.getScreen(capture.screen).project === job.config.project.id, "Capture does not belong to this job");
    if (!job.captures.includes(capture.id)) job.captures.push(capture.id);
    job.revision++; job.updatedAt = now(); save(store, "capture_jobs", job);
    jobEvent(store, job.id, "job.capture", { capture: capture.id }); return job;
  });
}
function finishJob(store, input) {
  return store.transaction(() => {
    const job = ownedJob(store, input);
    requireThat(input.run || input.error, "Supply a completed run or failure reason");
    if (input.run) {
      const run = store.getRun(input.run);
      requireThat(run.project === job.config.project.id && run.captureIds.every((id) => job.captures.includes(id)), "Run does not belong to this job");
    }
    job.status = workflows.job.events[input.error ? "fail" : "complete"].to; job.error = input.error || null; job.result = input.run || null;
    job.revision++; job.updatedAt = now(); job.token = null; job.leaseUntil = null;
    save(store, "capture_jobs", job); jobEvent(store, job.id, `job.${job.status}`, { run: job.result, error: job.error }); return job;
  });
}
function changeJob(store, input) {
  return store.transaction(() => {
    const job = get(store, "capture_jobs", input.id); revision(job, input.expectedRevision);
    requireThat(!["completed"].includes(job.status), "Completed jobs are immutable");
    const event = input.resume ? "resume" : "cancel";
    requireThat(canJobTransition(job, event), "Job already has an active worker", 409);
    job.status = workflows.job.events[event].to; job.token = null; job.leaseUntil = null; job.error = null;
    job.revision++; job.updatedAt = now(); save(store, "capture_jobs", job); jobEvent(store, job.id, `job.${job.status}`); return job;
  });
}
function jobEvents(store, input) {
  get(store, "capture_jobs", input.id);
  return store.db.prepare("SELECT id,data FROM job_events WHERE job=? AND id>? ORDER BY id LIMIT ?").all(input.id, input.after || 0, input.limit || 100).map((row) => ({ id: row.id, ...parse(row) }));
}

function saveSchedule(store, input) {
  requireThat(input.execute === "yes", "Pass execute=yes to enable scheduled work");
  const kind = choice(input.kind || "capture", ["capture", "backup"], "schedule kind");
  const prepared = kind === "capture" ? recipe(input) : null;
  if (kind === "backup") mkdirSync(resolve(text(input.destination, "backup destination")), { recursive: true });
  return store.transaction(() => {
    const previous = input.id ? get(store, "schedules", input.id) : null;
    revision(previous, input.expectedRevision);
    requireThat(Number.isInteger(input.everySeconds) && input.everySeconds >= 60, "Schedule interval must be at least 60 seconds");
    const value = { id: previous?.id || randomUUID(), revision: (previous?.revision || 0) + 1, title: text(input.title || `${kind} schedule`, "title"),
      kind, recipe: prepared, ref: input.ref || "HEAD", destination: kind === "backup" ? resolve(text(input.destination, "backup destination")) : null,
      enabled: input.enabled ?? true, everySeconds: input.everySeconds, nextAt: input.nextAt || now(), eventTypes: input.eventTypes || [], eventAfter: store.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get().id, updatedAt: now() };
    requireThat(Number.isFinite(Date.parse(value.nextAt)), "Invalid nextAt time");
    return save(store, "schedules", value);
  });
}
async function tickSchedules(store, input, context) {
  const due = store.db.prepare("SELECT data FROM schedules").all().map(parse).filter((item) => item.enabled);
  const results = [];
  for (const schedule of due) {
    const events = schedule.eventTypes.length ? store.db.prepare("SELECT id,data FROM events WHERE id>? ORDER BY id").all(schedule.eventAfter).filter((row) => schedule.eventTypes.includes(parse(row).type)) : [];
    if (Date.parse(schedule.nextAt) > Date.now() && !events.length) continue;
    let lease;
    try { lease = store.transaction(() => {
      const current = get(store, "schedules", schedule.id);
      if (current.revision !== schedule.revision) return null;
      current.nextAt = new Date(Date.now() + current.everySeconds * 1000).toISOString();
      current.eventAfter = store.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM events").get().id;
      current.revision++; save(store, "schedules", current);
      if (current.kind === "capture") {
        const prepared = { ...current.recipe, ref: resolveRevision(current.recipe.repo, current.ref) };
        return { schedule: current, job: enqueuePrepared(store, prepared, current) };
      }
      return { schedule: current };
    }); } catch (error) {
      store.transaction(() => {
        const current = get(store, "schedules", schedule.id);
        if (current.revision === schedule.revision) {
          current.nextAt = new Date(Date.now() + current.everySeconds * 1000).toISOString(); current.revision++;
          save(store, "schedules", current);
        }
        store.event("schedule.failed", { schedule: schedule.id, error: error.message });
      });
      results.push({ schedule: schedule.id, error: error.message });
      continue;
    }
    if (!lease) continue;
    try {
      if (lease.job) results.push({ schedule: schedule.id, job: lease.job.id });
      else {
        const destination = join(schedule.destination, `${Date.now()}-${randomUUID()}`);
        const result = await context.runAction("registry-backup", { output: destination }, { cli: true });
        results.push({ schedule: schedule.id, result });
      }
    } catch (error) { store.event("schedule.failed", { schedule: schedule.id, error: error.message }); results.push({ schedule: schedule.id, error: error.message }); }
  }
  return results;
}
async function scheduler(store, input, context) {
  requireThat(input.execute === "yes", "Pass execute=yes to start scheduled work");
  do {
    const results = await tickSchedules(store, input, context);
    for (const result of results) context.emit?.({ type: "schedule.result", ...result });
    await delay(1000, undefined, { signal: context.signal });
  } while (!context.signal?.aborted);
}

function enqueueAutomatic(store, input) {
  requireThat(input.execute === "yes", "Pass execute=yes to queue automatic capture");
  const prepared = automaticInput(input.path || ".", input);
  const project = { id: input.project || prepared.config.project?.id || prepared.root.split(/[\\/]/).at(-1).replace(/[^a-zA-Z0-9._-]/g, "-"), name: prepared.config.project?.name || prepared.root.split(/[\\/]/).at(-1) };
  const options = Object.fromEntries(["path", "config", "plan", "project", "profile", "title", "url", "output", "port", "screens", "recipe", "role", "review"].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  if (input.role !== undefined) choice(input.role, ["current", "target", "pr"], "capture role");
  if (input.review) requireThat(store.getRun(input.review).project === project.id, "Capture session belongs to another project");
  options.path = prepared.root; options.project = project.id;
  for (const key of ["config", "plan", "output"]) if (options[key]) options[key] = resolve(options[key]);
  return store.transaction(() => {
    const job = enqueuePrepared(store, { kind: "automatic", repo: prepared.root, ref: prepared.inputHash, configHash: prepared.inputHash, config: { project }, auto: { options }, checkpoints: {} }, { title: input.title || "Automatic capture" });
    return job;
  });
}
export async function executeAutomaticLease(store, job, signal, onEvent) {
  const { captureAutomatic } = await import("./auto-capture.mjs");
  const result = await captureAutomatic(store, { ...job.auto.options, expectedInputHash: job.configHash,
    output: job.auto.options.output ? join(job.auto.options.output, `attempt-${job.attempts}`) : undefined,
    execute: "yes", signal, priorCheckpoints: Object.values(job.checkpoints || {}), job: job.id,
    assertOwnership() { ownedJob(store, { id: job.id, token: job.token }); },
    onEvent(event) { ownedJob(store, { id: job.id, token: job.token }); jobEvent(store, job.id, "job.progress", { event }); onEvent?.(event); },
    onCheckpoint(value) {
      store.transaction(() => {
        const current = ownedJob(store, { id: job.id, token: job.token });
        const capture = store.getCapture(value.captureId);
        requireThat(store.getScreen(capture.screen).project === current.config.project.id, "Capture does not belong to this job");
        if (!current.captures.includes(capture.id)) current.captures.push(capture.id);
        (current.checkpoints ||= {})[value.identity] = value;
        current.revision++; current.updatedAt = now(); save(store, "capture_jobs", current);
        jobEvent(store, job.id, "job.checkpoint", { identity: value.identity, capture: capture.id, readiness: value.readiness.status });
      });
    } });
  if (signal?.aborted) return result;
  store.transaction(() => {
    const current = ownedJob(store, { id: job.id, token: job.token });
    current.status = workflows.job.events[result.exitCode ? "fail" : "complete"].to; current.error = result.exitCode ? result.error || "Capture coverage or readiness is incomplete" : null;
    const summary = captureSummary(result);
    let capturedRun = result.run;
    if (capturedRun && job.auto.options.review) {
      const previous = store.getRun(job.auto.options.review), slots = new Map();
      for (const id of [...previous.captureIds, ...capturedRun.captureIds]) {
        const capture = store.getCapture(id);
        slots.set(`${capture.screen}|${JSON.stringify(capture.variant)}|${capture.role}`, id);
      }
      capturedRun = store.run({ project: capturedRun.project, title: capturedRun.title, captureIds: [...slots.values()], warnings: capturedRun.warnings,
        source: { ...capturedRun.source, previous: previous.id, captureSession: capturedRun.id } });
      result.run = capturedRun;
      if (result.url) {
        const url = new URL(result.url); url.searchParams.set("run", capturedRun.id); result.url = url.href;
        summary.reviewUrl = result.url;
      }
    }
    current.result = capturedRun?.id || null; current.report = { output: result.output, summary };
    current.revision++; current.updatedAt = now(); current.token = null; current.leaseUntil = null;
    save(store, "capture_jobs", current); jobEvent(store, job.id, `job.${current.status}`, { run: current.result });
  });
  return result;
}
function automaticAttempt(store, job, signal, onEvent) {
  const thread = new Worker(new URL("./automatic-worker.mjs", import.meta.url), { workerData: { directory: store.directory, job } });
  const abort = () => { try { thread.postMessage({ type: "abort", reason: signal?.reason?.message || "Capture interrupted" }); } catch {} };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  return new Promise((resolve, reject) => {
    let completed = false;
    thread.on("message", message => {
      if (message.type === "event") {
        try { onEvent?.(message.event); } catch (error) { reject(error); abort(); }
      }
      if (message.type === "result") { completed = true; resolve(message.result); }
      if (message.type === "error") { completed = true; const error = Error(message.message); error.status = message.status; reject(error); }
    });
    thread.once("error", reject);
    thread.once("exit", code => { if (!completed) reject(Error(`Automatic capture worker exited (${code})`)); });
  }).finally(() => signal?.removeEventListener("abort", abort));
}
export async function runAutomaticJob(store, input) {
  let job;
  if (input.resume) {
    job = get(store, "capture_jobs", input.resume);
    requireThat(job.kind === "automatic", "Resume requires an automatic capture job");
    for (const key of ["path", "config", "plan", "project", "profile", "url", "screens", "recipe", "role", "review"]) if (input[key] !== undefined) {
      const value = ["path", "config", "plan"].includes(key) ? resolve(input[key]) : input[key];
      requireThat(JSON.stringify(value) === JSON.stringify(job.auto.options[key]), `Resume uses frozen ${key}; create a new job to change it`);
    }
    requireThat(canJobTransition(job, "resume"), "Job cannot resume while completed or owned by an active worker", 409);
    changeJob(store, { id: job.id, expectedRevision: input.expectedRevision === undefined ? job.revision : Number(input.expectedRevision), resume: true });
  } else job = enqueueAutomatic(store, { ...input, execute: "yes" });
  if (input.queue === "yes") return { status: "queued", job: job.id, exitCode: 0 };
  job = leaseJob(store, { id: job.id, worker: `screens-cli-${process.pid}` });
  requireThat(job, "Job was leased by another worker", 409);
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) abort();
  const timer = setInterval(() => { try { heartbeat(store, { id: job.id, token: job.token }); } catch (error) { controller.abort(error); } }, 1000);
  let result;
  try {
    result = await automaticAttempt(store, job, controller.signal, input.onEvent);
    if (controller.signal.aborted) {
      const current = get(store, "capture_jobs", job.id);
      if (current.token === job.token) changeJob(store, { id: job.id, expectedRevision: current.revision, resume: false });
    }
  } catch (error) {
    try { finishJob(store, { id: job.id, token: job.token, error: error.message }); } catch (stateError) { if (stateError.status !== 409) throw stateError; }
    throw error;
  } finally { clearInterval(timer); input.signal?.removeEventListener("abort", abort); }
  return result;
}

async function worker(store, context) {
  do {
    const job = leaseJob(store, { worker: `screens-${process.pid}` });
    if (!job) { await delay(1000, undefined, { signal: context.signal }); continue; }
    const controller = new AbortController();
    const abort = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", abort, { once: true });
    const temp = mkdtempSync(join(tmpdir(), "screens-job-"));
    let leaseError;
    const timer = setInterval(() => {
      try { heartbeat(store, { id: job.id, token: job.token }); }
      catch (error) { leaseError = error; controller.abort(error); }
    }, 1000);
    try {
      if (job.kind === "automatic") {
        await automaticAttempt(store, job, controller.signal, context.emit);
        if (controller.signal.aborted) controller.signal.throwIfAborted();
        continue;
      }
      const configFile = join(temp, "capture.json"); writeFileSync(configFile, JSON.stringify(job.config));
      requireThat(captureConfig(configFile).hash === job.configHash, "Queued capture configuration changed");
      const result = await captureRevision(store, {
        repo: job.repo, ref: job.ref, config: configFile, output: join(temp, "output"), role: job.role,
        execute: "yes", priorCheckpoints: Object.values(job.checkpoints || {}), signal: controller.signal,
        assertOwnership: () => ownedJob(store, { id: job.id, token: job.token }),
        onCheckpoint: value => { store.transaction(() => { const current = ownedJob(store, { id: job.id, token: job.token }); (current.checkpoints ||= {})[value.identity] = value; current.revision++; current.updatedAt = now(); save(store, "capture_jobs", current); }); },
        onEvent: (event) => { ownedJob(store, { id: job.id, token: job.token }); jobEvent(store, job.id, "job.progress", { event }); },
        onCapture: ({ capture }) => checkpoint(store, { id: job.id, token: job.token, capture: capture.id }),
      });
      finishJob(store, { id: job.id, token: job.token, run: result.run?.id, error: result.exitCode ? result.error || "Capture is incomplete; inspect report.json" : undefined });
    } catch (error) {
      if (!leaseError) {
        try {
          if (context.signal.aborted) {
            store.transaction(() => {
              const current = ownedJob(store, { id: job.id, token: job.token });
              current.status = workflows.job.events.interrupt.to; current.token = null; current.leaseUntil = null;
              current.error = null; current.revision++; current.updatedAt = now();
              save(store, "capture_jobs", current); jobEvent(store, current.id, "job.queued", { reason: "worker-interrupted" });
            });
          } else finishJob(store, { id: job.id, token: job.token, error: error.message });
        } catch (stateError) { if (stateError.status !== 409) throw stateError; }
      }
    } finally {
      clearInterval(timer); context.signal.removeEventListener("abort", abort); rmSync(temp, { recursive: true, force: true });
    }
  } while (!context.signal.aborted);
}

export function startAutomation(store, context) {
  const controller = new AbortController();
  const service = { ...context, signal: controller.signal, emit: () => {} };
  const supervise = async (name, run) => {
    while (!controller.signal.aborted) {
      try { await run(); }
      catch (error) {
        if (controller.signal.aborted) return;
        store.event("automation.failed", { service: name, error: error.message });
        await delay(1000, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  };
  const running = [
    supervise("captures", () => worker(store, service)),
    supervise("schedules", () => scheduler(store, { execute: "yes" }, service)),
  ];
  return { async stop() { controller.abort(Error("Screens stopped")); await Promise.allSettled(running); } };
}

async function watchJob(store, input, context) {
  let after = input.after || 0;
  while (!context.signal?.aborted) {
    const events = jobEvents(store, { id: input.id, after, limit: 100 });
    for (const event of events) { context.emit?.(event); after = event.id; }
    const job = get(store, "capture_jobs", input.id);
    if (["completed", "failed", "cancelled"].includes(job.status) && events.length < 100) return { job: job.id, status: job.status, after };
    await delay(500, undefined, { signal: context.signal });
  }
}
async function watchEvents(store, input, context) {
  let after = input.after || 0;
  while (!context.signal.aborted) {
    const rows = store.db.prepare("SELECT id,data FROM events WHERE id>? ORDER BY id LIMIT 100").all(after);
    for (const row of rows) {
      const event = { id: row.id, ...parse(row) };
      if (!input.types?.length || input.types.includes(event.type)) context.emit?.(event);
      after = row.id;
    }
    if (rows.length < 100) await delay(500, undefined, { signal: context.signal });
  }
}

const captureInput = { config: string, repo: string, ref: string, role: string, profile: string, screens: { type: "array", items: string }, title: string, execute: string };
export const automationActions = {
  "workflow-catalog": action("Read workflow states, transitions, actors, requirements and ownership. Does not execute actions or change human decisions.", {}, [], () => workflowCatalog()),
  doctor: action("Report environment, browser, registry, and port diagnostics without executing captures.", { port: integer }, [], doctor, true),
  "tasks-list": action("List open feedback tasks and active agent leases.", { project: string, status: string, available: boolean, limit: integer }, [], taskList),
  "tasks-claim": action("Claim or renew a feedback task lease using its current claim revision (0 for a new claim).", { id: string, owner: string, expectedRevision: integer, seconds: integer }, ["id", "owner", "expectedRevision"], (store, input) => claimTask(store, input)),
  "tasks-release": action("Release your feedback task lease.", { id: string, owner: string, expectedRevision: integer }, ["id", "owner", "expectedRevision"], (store, input) => claimTask(store, input, true)),
  "tasks-handoff": action("Retrieve capture-bound feedback and supporting evidence for an agent handoff.", { id: string }, ["id"], taskHandoff),
  "registry-page": action("Retrieve a bounded page of screens, captures, notes, runs, evidence, or reviewSets.", { collection: string, project: string, screen: string, capture: string, cursor: string, limit: integer }, ["collection"], listPage),
  "evidence-scoped": action("Retrieve evidence for exact captures, a run, or a review set, optionally scoped to a region.", { capture: string, run: string, reviewSet: string, region: { type: "object" } }, [], scopedEvidence),
  "jobs-enqueue-auto": action("Queue an authorized automatic capture plan with persistent scenario checkpoints.", { path: string, config: string, plan: string, project: string, profile: string, screens: { type: "array", items: string }, title: string, execute: string, output: string }, ["path", "execute"], enqueueAutomatic, true),
  "jobs-enqueue": action("Queue an explicitly authorized capture recipe at a resolved commit.", captureInput, ["repo", "config", "execute"], enqueue, true),
  "jobs-list": action("List persistent capture jobs.", { status: string }, [], (store, input) => store.db.prepare("SELECT data FROM capture_jobs ORDER BY rowid DESC").all().map(parse).filter((job) => !input.status || job.status === input.status).map(job => ({ ...job, availableActions: jobActions(job) }))),
  "jobs-get": action("Read a capture job and its current revision.", { id: string }, ["id"], (store, input) => { const job = get(store, "capture_jobs", input.id); return { ...job, availableActions: jobActions(job) }; }),
  "jobs-change": action("Cancel a job, or resume a failed/interrupted job from its saved captures.", { id: string, expectedRevision: integer, resume: boolean }, ["id", "expectedRevision"], changeJob),
  "jobs-watch": action("Stream persisted job events as NDJSON until the job stops.", { id: string, after: integer }, ["id"], watchJob, true),
  "jobs-events": action("Read ordered capture job events after a cursor.", { id: string, after: integer, limit: integer }, ["id"], jobEvents),
  "schedule-save": action("Create or update an explicitly enabled interval/event capture or backup schedule.", { ...captureInput, id: string, kind: string, expectedRevision: integer, everySeconds: integer, nextAt: string, destination: string, enabled: boolean, eventTypes: { type: "array", items: string } }, ["execute", "expectedRevision", "everySeconds"], saveSchedule, true),
  "schedule-list": action("List configured schedules.", {}, [], (store) => store.db.prepare("SELECT data FROM schedules ORDER BY rowid").all().map(parse)),
  "schedule-set-enabled": action("Enable or disable an existing schedule using its revision.", { id: string, expectedRevision: integer, enabled: boolean }, ["id", "expectedRevision", "enabled"], (store, input) => store.transaction(() => { const value = get(store, "schedules", input.id); revision(value, input.expectedRevision); value.enabled = input.enabled; value.revision++; return save(store, "schedules", value); }), true),
  "events-watch": action("Stream local registry events as NDJSON without an external subscriber.", { after: integer, types: { type: "array", items: string } }, [], watchEvents, true),
  "events-list": action("Read registry events after a cursor.", { after: integer, limit: integer }, [], (store, input) => store.db.prepare("SELECT id,data FROM events WHERE id>? ORDER BY id LIMIT ?").all(input.after || 0, input.limit || 100).map((row) => ({ id: row.id, ...parse(row) }))),
};
