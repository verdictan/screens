import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  Fault,
  requireThat,
  text,
  key,
  choice,
  point,
  raster,
  variant,
} from "./validation.mjs";

import { initializeAutomation } from "./automation.mjs";
import { initializeEvidence } from "./evidence-tools.mjs";
import { initializeStorage } from "./storage-tools.mjs";

const now = () => new Date().toISOString();
const parse = (row) => (row ? JSON.parse(row.data) : null);

export class Store {
  constructor(directory) {
    mkdirSync(join(directory, "assets"), { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.db = new DatabaseSync(join(directory, "screens.sqlite"));
    requireThat(
      this.db.prepare("PRAGMA user_version").get().user_version <= 5,
      "Registry was created by a newer Screens version",
      409,
    );
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS screens (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, screen TEXT NOT NULL REFERENCES screens(id), hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, capture TEXT NOT NULL REFERENCES captures(id), revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS targets (screen TEXT NOT NULL REFERENCES screens(id), variant TEXT NOT NULL, capture TEXT NOT NULL REFERENCES captures(id), revision INTEGER NOT NULL, PRIMARY KEY(screen,variant));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS diffs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, capture TEXT NOT NULL REFERENCES captures(id), data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS evidence_capture ON evidence(capture);
      CREATE INDEX IF NOT EXISTS captures_screen ON captures(screen);
      CREATE INDEX IF NOT EXISTS notes_capture ON notes(capture);
      CREATE TABLE IF NOT EXISTS previews (hash TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS review_sets (id TEXT PRIMARY KEY, run TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, data TEXT NOT NULL);
      PRAGMA user_version=5;`);
    initializeEvidence(this);
    initializeAutomation(this);
    initializeStorage(this);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    const savepoint = `write_${randomUUID().replaceAll("-", "")}`;
    const outer = !this.transactionDepth;
    this.db.exec(outer ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.transactionDepth = (this.transactionDepth || 0) + 1;
    let result;
    try {
      result = fn();
      this.db.exec(outer ? "COMMIT" : `RELEASE ${savepoint}`);
    } catch (error) {
      this.db.exec(outer ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.transactionDepth--;
    }
    return result;
  }
  requestFingerprint(operation, input) {
    const canonical = (value) => Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
        : value;
    return createHash("sha256").update(JSON.stringify([operation, canonical(input)])).digest("hex");
  }
  replay(requestKey, operation, input) {
    if (requestKey === undefined) return null;
    requireThat(typeof requestKey === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey), "Idempotency-Key must be a UUID v4");
    const previous = this.db.prepare("SELECT fingerprint,data FROM requests WHERE key=?").get(requestKey);
    if (!previous) return null;
    requireThat(previous.fingerprint === this.requestFingerprint(operation, input), "Idempotency key was used for a different action", 409);
    return parse(previous);
  }
  once(requestKey, operation, input, action) {
    return this.transaction(() => {
      const previous = this.replay(requestKey, operation, input);
      if (previous) return previous;
      const result = action();
      if (requestKey !== undefined) {
        this.db.prepare("INSERT INTO requests VALUES (?,?,?)").run(
          requestKey, this.requestFingerprint(operation, input), JSON.stringify(result),
        );
      }
      return result;
    });
  }
  getPreview(hash) {
    return parse(this.db.prepare("SELECT data FROM previews WHERE hash=?").get(hash));
  }
  savePreview(hash, preview) {
    this.db.prepare("INSERT OR IGNORE INTO previews VALUES (?,?)").run(hash, JSON.stringify(preview));
    return this.getPreview(hash);
  }
  event(type, data) {
    this.db
      .prepare("INSERT INTO events(data) VALUES (?)")
      .run(JSON.stringify({ type, at: now(), ...data }));
  }
  project(input) {
    const id = key(input.id, "project ID");
    const existing = parse(
      this.db.prepare("SELECT data FROM projects WHERE id=?").get(id),
    );
    if (existing) return existing;
    const value = {
      id,
      name: text(input.name, "project name"),
      repository: input.repository
        ? text(input.repository, "repository")
        : null,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO projects VALUES (?,?)")
      .run(id, JSON.stringify(value));
    return value;
  }
  projects() {
    return this.db
      .prepare("SELECT data FROM projects ORDER BY id")
      .all()
      .map(parse);
  }
  screen(input) {
    const project = key(input.project, "project");
    requireThat(
      this.projects().some((p) => p.id === project),
      "Project not found",
      404,
    );
    const externalId = key(input.key, "screen key");
    const id = `${project}/${externalId}`;
    const existing = parse(
      this.db.prepare("SELECT data FROM screens WHERE id=?").get(id),
    );
    if (existing) return existing;
    const value = {
      id,
      project,
      key: externalId,
      title: text(input.title, "screen title", 2000),
      state: text(input.state ?? "default", "state"),
      group: input.group || "Screens",
      route: input.route || null,
      source: input.source || null,
      recipe: input.recipe || null,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO screens VALUES (?,?,?)")
      .run(id, project, JSON.stringify(value));
    return value;
  }
  search({ project, query = "" } = {}) {
    requireThat(typeof query === "string", "Invalid query");
    const rows = project
      ? this.db
          .prepare("SELECT data FROM screens WHERE project=? ORDER BY id")
          .all(project)
      : this.db.prepare("SELECT data FROM screens ORDER BY id").all();
    return rows
      .map(parse)
      .filter((s) =>
        `${s.id} ${s.title} ${s.state} ${s.route || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      );
  }
  getScreen(id) {
    const screen = parse(
      this.db
        .prepare("SELECT data FROM screens WHERE id=?")
        .get(text(id, "screen")),
    );
    requireThat(screen, "Screen not found", 404);
    const captures = this.db
      .prepare("SELECT id FROM captures WHERE screen=? ORDER BY rowid DESC")
      .all(id)
      .map((row) => this.getCapture(row.id));
    const notes = this.db
      .prepare(
        "SELECT n.data FROM notes n JOIN captures c ON n.capture=c.id WHERE c.screen=? ORDER BY n.rowid",
      )
      .all(id)
      .map(parse);
    const targets = this.db
      .prepare("SELECT capture,revision FROM targets WHERE screen=?")
      .all(id);
    return {
      ...screen,
      captures,
      notes,
      targets,
      evidence: this.listEvidence({ screen: id }),
    };
  }
  capture(input) {
    return this.transaction(() => this.writeCapture(input));
  }
  writeCapture(input) {
    this.getScreen(input.screen);
    const role = choice(
      input.role,
      ["current", "target", "pr"],
      "capture role",
    );
    const v = variant(input.variant);
    const bytes = Buffer.isBuffer(input.bytes)
      ? input.bytes
      : Buffer.from(
          text(input.imageBase64, "imageBase64", 36 * 1024 * 1024),
          "base64",
        );
    const mimeType = raster(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const metadata = {
      screen: input.screen,
      role,
      variant: v,
      hash,
      mimeType,
      revision: text(input.revision ?? "unknown", "source revision"),
      fixture: text(input.fixture ?? "unspecified", "fixture"),
      provenance: text(input.provenance ?? "imported", "provenance", 4000),
    };
    const id = createHash("sha256")
      .update(JSON.stringify(metadata))
      .digest("hex");
    const existing = parse(
      this.db.prepare("SELECT data FROM captures WHERE id=?").get(id),
    );
    if (existing) return this.getCapture(id);
    this.saveAsset(hash, bytes);
    const value = {
      id,
      ...metadata,
      byteSize: bytes.length,
      createdAt: now(),
      url: `/api/captures/${id}/image`,
    };
    this.db
      .prepare("INSERT OR IGNORE INTO captures VALUES (?,?,?,?)")
      .run(id, input.screen, hash, JSON.stringify(value));
    return this.getCapture(id);
  }
  getCapture(id) {
    const value = parse(
      this.db
        .prepare("SELECT data FROM captures WHERE id=?")
        .get(text(id, "capture")),
    );
    requireThat(value, "Capture not found", 404);
    return { ...value, preview: this.getPreview(value.hash) };
  }
  image(id) {
    const capture = this.getCapture(id);
    return {
      capture,
      bytes: readFileSync(join(this.directory, "assets", capture.hash)),
    };
  }
  runs(project) {
    return this.db
      .prepare("SELECT data FROM runs WHERE project=? ORDER BY rowid DESC")
      .all(text(project, "project"))
      .map(parse);
  }
  getRun(id) {
    const run = parse(
      this.db.prepare("SELECT data FROM runs WHERE id=?").get(text(id, "run")),
    );
    requireThat(run, "Run not found", 404);
    return run;
  }
  run(input) {
    const project = key(input.project);
    requireThat(
      Array.isArray(input.captureIds) &&
        input.captureIds.length > 0 &&
        input.captureIds.length <= 10000,
      "Run needs 1–10000 captures",
    );
    const captures = [...new Set(input.captureIds)].map((id) =>
      this.getCapture(id),
    );
    requireThat(
      captures.every((c) => this.getScreen(c.screen).project === project),
      "Run captures must belong to the same project",
    );
    const slots = captures.map(
      (c) => `${c.screen}|${JSON.stringify(c.variant)}|${c.role}`,
    );
    requireThat(
      new Set(slots).size === slots.length,
      "Only one capture per screen, variant and role is allowed in a run",
    );
    const value = {
      id: randomUUID(),
      project,
      title: text(input.title, "run title"),
      captureIds: captures.map((c) => c.id),
      uncoveredScreens: this.search({ project })
        .filter((s) => !captures.some((c) => c.screen === s.id))
        .map((s) => ({ id: s.id, title: s.title, state: s.state })),
      source: input.source || null,
      warnings: input.warnings || [],
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO runs VALUES (?,?,?)")
      .run(value.id, project, JSON.stringify(value));
    this.event("run.created", { run: value.id });
    return value;
  }
  reviewSets(run) {
    this.getRun(run);
    return this.db.prepare("SELECT data FROM review_sets WHERE run=? ORDER BY rowid DESC").all(run).map(parse);
  }
  saveReviewSet(input) {
    return this.transaction(() => {
      const run = this.getRun(input.run);
      const previous = input.id
        ? parse(this.db.prepare("SELECT data FROM review_sets WHERE id=?").get(input.id))
        : null;
      requireThat(!input.id || previous?.run === run.id, "Review set not found", 404);
      requireThat(input.expectedRevision === (previous?.revision ?? 0), "Review set changed. Reload before saving.", 409);
      const available = new Set(this.compare(run.id).entries.map((entry) => `${entry.screen}|${JSON.stringify(entry.variant)}`));
      requireThat(Array.isArray(input.entries) && input.entries.length > 0 && input.entries.every((entry) => available.has(entry)), "Select screens from this run");
      const value = {
        id: previous?.id ?? randomUUID(), run: run.id, project: run.project,
        title: text(input.title, "review set title"), entries: [...new Set(input.entries)],
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? now(), updatedAt: now(),
      };
      this.db.prepare("INSERT INTO review_sets VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data")
        .run(value.id, value.run, value.revision, JSON.stringify(value));
      this.event("review-set.saved", { reviewSet: value.id, revision: value.revision });
      return value;
    });
  }
  compare(runId) {
    const run = this.getRun(runId),
      groups = new Map();
    for (const id of run.captureIds) {
      const c = this.getCapture(id),
        k = `${c.screen}|${JSON.stringify(c.variant)}`;
      if (!groups.has(k)) {
        const s = this.getScreen(c.screen);
        groups.set(k, {
          screen: s.id,
          title: s.title,
          state: s.state,
          group: s.group,
          variant: c.variant,
          captures: {},
        });
      }
      groups.get(k).captures[c.role] = c;
    }
    const measured = this.db
      .prepare("SELECT data FROM diffs ORDER BY rowid DESC")
      .all()
      .map(parse)
      .filter(
        (d) =>
          run.captureIds.includes(d.left) && run.captureIds.includes(d.right),
      );
    for (const entry of groups.values()) {
      const ids = new Set(Object.values(entry.captures).map((c) => c.id));
      entry.measurements = measured.filter(
        (d) => ids.has(d.left) && ids.has(d.right),
      );
      entry.pixelComparisonPair = ["current", "pr"];
      const { current, target, pr } = entry.captures;
      entry.pixelComparison =
        current && pr
          ? current.hash === pr.hash
            ? "identical-bytes"
            : "not-measured"
          : "missing-evidence";
      entry.compatible =
        new Set(Object.values(entry.captures).map((c) => c.fixture)).size === 1;
      const screenDetail = this.getScreen(entry.screen);
      const variantIds = new Set(
        screenDetail.captures
          .filter(
            (c) => JSON.stringify(c.variant) === JSON.stringify(entry.variant),
          )
          .map((c) => c.id),
      );
      entry.openNotes = screenDetail.notes.filter(
        (note) =>
          variantIds.has(note.capture) &&
          !["verified", "wont-fix"].includes(note.status),
      ).length;
      entry.targetApproval = target
        ? (this.db
            .prepare(
              "SELECT revision FROM targets WHERE screen=? AND variant=? AND capture=?",
            )
            .get(target.screen, JSON.stringify(target.variant), target.id)
            ?.revision ?? null)
        : null;
    }
    return {
      ...run,
      entries: [...groups.values()],
      uncoveredScreens: run.uncoveredScreens ?? [],
    };
  }
  findDiff(id) {
    return parse(this.db.prepare("SELECT data FROM diffs WHERE id=?").get(id));
  }
  getDiff(id) {
    const result = this.findDiff(text(id, "diff ID"));
    requireThat(result, "Diff not found", 404);
    return result;
  }
  saveAsset(hash, bytes) {
    requireThat(/^[a-f0-9]{64}$/.test(hash), "Invalid asset hash");
    try {
      writeFileSync(join(this.directory, "assets", hash), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  saveDiff(value, bytes) {
    return this.transaction(() => this.writeDiff(value, bytes));
  }
  writeDiff(value, bytes) {
    if (bytes) this.saveAsset(value.image, bytes);
    this.db
      .prepare("INSERT OR IGNORE INTO diffs VALUES (?,?)")
      .run(value.id, JSON.stringify(value));
    return this.getDiff(value.id);
  }
  diffImage(id) {
    const diff = this.getDiff(id);
    requireThat(diff.image, "Diff has no image", 404);
    return readFileSync(join(this.directory, "assets", diff.image));
  }
  listEvidence({ capture, screen } = {}) {
    requireThat(capture || screen, "Supply capture or screen");
    return (
      capture
        ? this.db
            .prepare(
              "SELECT data FROM evidence WHERE capture=? ORDER BY rowid DESC",
            )
            .all(capture)
        : this.db
            .prepare(
              "SELECT e.data FROM evidence e JOIN captures c ON e.capture=c.id WHERE c.screen=? ORDER BY e.rowid DESC",
            )
            .all(screen)
    ).map(parse);
  }
  getEvidence(id) {
    const value = parse(
      this.db
        .prepare("SELECT data FROM evidence WHERE id=?")
        .get(text(id, "evidence ID")),
    );
    requireThat(value, "Evidence not found", 404);
    return value;
  }
  addEvidence(input) {
    const capture = this.getCapture(input.capture);
    const kind = choice(
      input.kind,
      ["visual", "behavior", "accessibility", "motion"],
      "evidence kind",
    );
    const method = choice(
      input.method,
      ["manual", "automated", "screenshot"],
      "evidence method",
    );
    const outcome = choice(
      input.outcome,
      ["pass", "fail", "not-run"],
      "reported outcome",
    );
    requireThat(
      kind === "visual" || method !== "screenshot",
      "Screenshots cannot verify behavior, accessibility or motion",
    );
    const assertion = text(input.assertion, "assertion", 4000);
    const observation = text(input.observation, "observation", 10000);
    const procedure = text(input.procedure, "procedure", 10000);
    const author = text(input.author, "evidence author");
    let artifact = null,
      bytes;
    if (input.artifactBase64 !== undefined) {
      const mimeType = choice(
        input.artifactType,
        ["text/plain", "application/json", "video/mp4", "video/webm"],
        "artifact type",
      );
      bytes = Buffer.from(
        text(input.artifactBase64, "artifact", 28 * 1024 * 1024),
        "base64",
      );
      requireThat(
        bytes.length > 0 && bytes.length <= 20 * 1024 * 1024,
        "Artifact must be 1 byte to 20 MB",
      );
      artifact = {
        hash: createHash("sha256").update(bytes).digest("hex"),
        mimeType,
        byteSize: bytes.length,
      };
    }
    requireThat(
      method !== "automated" || outcome === "not-run" || artifact,
      "Automated results require a captured report artifact",
    );
    const value = {
      id: randomUUID(),
      capture: capture.id,
      captureHash: capture.hash,
      sourceRevision: capture.revision,
      fixture: capture.fixture,
      kind,
      method,
      outcome,
      assertion,
      observation,
      procedure,
      author,
      artifact,
      createdAt: now(),
      acceptance: "not-assessed",
      provenance: "reporter-supplied",
    };
    if (artifact) {
      value.artifact.url = `/api/evidence/${value.id}/artifact`;
    }
    this.transaction(() => {
      if (artifact) this.saveAsset(artifact.hash, bytes);
      this.db
        .prepare("INSERT INTO evidence VALUES (?,?,?)")
        .run(value.id, capture.id, JSON.stringify(value));
      this.event("evidence.added", { evidence: value.id, capture: capture.id });
    });
    return value;
  }
  evidenceArtifact(id) {
    const evidence = this.getEvidence(id);
    requireThat(evidence.artifact, "No artifact attached", 404);
    return {
      bytes: readFileSync(
        join(this.directory, "assets", evidence.artifact.hash),
      ),
      artifact: evidence.artifact,
    };
  }
  addNote(input) {
    const capture = this.getCapture(input.capture);
    const value = {
      id: randomUUID(),
      capture: capture.id,
      screen: capture.screen,
      text: text(input.text, "note", 10000),
      point: point(input.point),
      region: input.region ? {
        x: input.region.x, y: input.region.y,
        width: input.region.width, height: input.region.height,
      } : null,
      author: text(input.author ?? "reviewer", "author"),
      status: "open",
      revision: 1,
      createdAt: now(),
      updatedAt: now(),
      evidence: null,
    };
    this.db
      .prepare("INSERT INTO notes VALUES (?,?,?,?)")
      .run(value.id, capture.id, 1, JSON.stringify(value));
    this.event("note.created", { note: value.id, capture: capture.id });
    return value;
  }
  updateNote(input, { human = false } = {}) {
    return this.transaction(() => {
      const note = parse(
        this.db
          .prepare("SELECT data FROM notes WHERE id=?")
          .get(text(input.id, "note ID")),
      );
      requireThat(note, "Note not found", 404);
      requireThat(
        Number.isInteger(input.expectedRevision) &&
          input.expectedRevision === note.revision,
        "Feedback changed. Reload before updating.",
        409,
      );
      const status = choice(
        input.status,
        ["open", "in-progress", "submitted", "verified", "wont-fix"],
        "status",
      );
      requireThat(
        human || !["verified", "wont-fix"].includes(status),
        "This decision requires the review interface",
        403,
      );
      if (["submitted", "verified"].includes(status)) {
        const evidence = this.getCapture(input.evidence ?? note.evidence);
        const original = this.getCapture(note.capture);
        requireThat(
          evidence.screen === note.screen &&
            JSON.stringify(evidence.variant) ===
              JSON.stringify(original.variant),
          "Evidence must show the same screen and variant",
        );
        requireThat(
          evidence.id !== note.capture && evidence.role !== "target",
          "Submit fresh implementation evidence",
        );
        note.evidence = evidence.id;
      }
      if (input.text !== undefined) note.text = text(input.text, "note", 10000);
      if (input.resolution !== undefined)
        note.resolution = text(input.resolution, "resolution", 10000);
      if (["submitted", "wont-fix"].includes(status))
        requireThat(note.resolution, "Explain the resolution");
      note.status = status;
      note.updatedAt = now();
      note.revision++;
      this.db
        .prepare("UPDATE notes SET revision=?,data=? WHERE id=?")
        .run(note.revision, JSON.stringify(note), note.id);
      this.event("note.updated", {
        note: note.id,
        revision: note.revision,
        status,
      });
      return note;
    });
  }
  approveTarget(input) {
    return this.transaction(() => {
      const c = this.getCapture(input.capture);
      requireThat(c.role === "target", "Only target captures can be approved");
      const v = JSON.stringify(c.variant);
      const previous = this.db
        .prepare("SELECT revision FROM targets WHERE screen=? AND variant=?")
        .get(c.screen, v);
      requireThat(
        input.expectedRevision === (previous?.revision ?? 0),
        "Target approval changed. Reload before updating.",
        409,
      );
      const revision = (previous?.revision ?? 0) + 1;
      this.db
        .prepare(
          "INSERT INTO targets VALUES (?,?,?,?) ON CONFLICT(screen,variant) DO UPDATE SET capture=excluded.capture,revision=excluded.revision",
        )
        .run(c.screen, v, c.id, revision);
      this.event("target.approved", { capture: c.id, revision });
      return { capture: c.id, revision };
    });
  }
}
