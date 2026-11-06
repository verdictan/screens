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

const now = () => new Date().toISOString();
const parse = (row) => (row ? JSON.parse(row.data) : null);

export class Store {
  constructor(directory) {
    mkdirSync(join(directory, "assets"), { recursive: true, mode: 0o700 });
    this.directory = directory;
    this.db = new DatabaseSync(join(directory, "screens.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS screens (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, screen TEXT NOT NULL REFERENCES screens(id), hash TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, capture TEXT NOT NULL REFERENCES captures(id), revision INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS targets (screen TEXT NOT NULL REFERENCES screens(id), variant TEXT NOT NULL, capture TEXT NOT NULL REFERENCES captures(id), revision INTEGER NOT NULL, PRIMARY KEY(screen,variant));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS captures_screen ON captures(screen);
      CREATE INDEX IF NOT EXISTS notes_capture ON notes(capture);
      PRAGMA user_version=1;`);
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
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
      .prepare("SELECT data FROM captures WHERE screen=? ORDER BY rowid DESC")
      .all(id)
      .map(parse);
    const notes = this.db
      .prepare(
        "SELECT n.data FROM notes n JOIN captures c ON n.capture=c.id WHERE c.screen=? ORDER BY n.rowid",
      )
      .all(id)
      .map(parse);
    const targets = this.db
      .prepare("SELECT capture,revision FROM targets WHERE screen=?")
      .all(id);
    return { ...screen, captures, notes, targets };
  }
  capture(input) {
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
    if (existing) return existing;
    const path = join(this.directory, "assets", hash);
    try {
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const value = {
      id,
      ...metadata,
      byteSize: bytes.length,
      createdAt: now(),
      url: `/api/captures/${id}/image`,
    };
    this.db
      .prepare("INSERT INTO captures VALUES (?,?,?,?)")
      .run(id, input.screen, hash, JSON.stringify(value));
    return value;
  }
  getCapture(id) {
    const value = parse(
      this.db
        .prepare("SELECT data FROM captures WHERE id=?")
        .get(text(id, "capture")),
    );
    requireThat(value, "Capture not found", 404);
    return value;
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
    for (const entry of groups.values()) {
      const { current, target, pr } = entry.captures;
      entry.pixelComparison =
        current && pr
          ? current.hash === pr.hash
            ? "identical-bytes"
            : "not-measured"
          : "missing-evidence";
      entry.compatible =
        new Set(Object.values(entry.captures).map((c) => c.fixture)).size === 1;
      entry.openNotes = Object.values(entry.captures).reduce(
        (n, c) =>
          n +
          this.getScreen(c.screen).notes.filter(
            (note) =>
              note.capture === c.id &&
              !["verified", "wont-fix"].includes(note.status),
          ).length,
        0,
      );
      entry.targetApproval = target
        ? (this.db
            .prepare(
              "SELECT revision FROM targets WHERE screen=? AND variant=? AND capture=?",
            )
            .get(target.screen, JSON.stringify(target.variant), target.id)
            ?.revision ?? null)
        : null;
    }
    return { ...run, entries: [...groups.values()] };
  }
  addNote(input) {
    const capture = this.getCapture(input.capture);
    const value = {
      id: randomUUID(),
      capture: capture.id,
      screen: capture.screen,
      text: text(input.text, "note", 10000),
      point: point(input.point),
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
