import { DatabaseSync, backup } from "node:sqlite";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, copyFileSync, unlinkSync } from "node:fs";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { requireThat, text } from "./validation.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const parse = (row) => JSON.parse(row.data);
const string = { type: "string" };
const schema = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const rows = (db, table) => hasTable(db, table) ? db.prepare(`SELECT * FROM ${table}`).all() : [];
const now = () => new Date().toISOString();
const canonical = (value) => JSON.stringify(value, Object.keys(value).sort());
const exportTables = {
  projects: ["id", "data"], screens: ["id", "project", "data"],
  captures: ["id", "screen", "hash", "data"], runs: ["id", "project", "data"],
  notes: ["id", "capture", "revision", "data"],
  targets: ["screen", "variant", "capture", "revision"],
  diffs: ["id", "data"], evidence: ["id", "capture", "data"], previews: ["hash", "data"],
  review_sets: ["id", "run", "revision", "data"],
  derived_evidence: ["id", "capture", "kind", "data"],
  source_links: ["id", "capture", "note", "data"],
  ci_reports: ["id", "data"],
};

export function initializeStorage(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS bundle_imports (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS trusted_signers (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
}

export function assetReferences(db) {
  const references = new Map();
  const add = (hash, owner) => {
    if (!isHash(hash)) return;
    if (!references.has(hash)) references.set(hash, []);
    references.get(hash).push(owner);
  };
  for (const row of rows(db, "captures")) add(row.hash, { type: "capture", id: row.id, screen: row.screen });
  for (const row of rows(db, "diffs")) {
    const value = parse(row);
    add(value.image, { type: "diff", id: row.id, capture: value.left });
  }
  for (const row of rows(db, "evidence")) add(parse(row).artifact?.hash, { type: "evidence", id: row.id, capture: row.capture });
  return references;
}

function assetBytes(store, assetHash) {
  return readFileSync(join(store.directory, "assets", assetHash));
}

function snapshotBundle(store, reviewSet) {
  const setRow = store.db.prepare("SELECT * FROM review_sets WHERE id=?").get(text(reviewSet, "review set"));
  requireThat(setRow, "Review set not found", 404);
  const set = parse(setRow);
  const runRow = store.db.prepare("SELECT * FROM runs WHERE id=?").get(set.run);
  const run = parse(runRow);
  const captures = new Set(run.captureIds);
  const allNotes = rows(store.db, "notes");
  let notes, previousCount;
  do {
    previousCount = captures.size;
    notes = allNotes.filter((row) => captures.has(row.capture));
    for (const row of notes) if (parse(row).evidence) captures.add(parse(row).evidence);
  } while (captures.size !== previousCount);
  const captureRows = rows(store.db, "captures").filter((row) => captures.has(row.id));
  const screens = new Set(captureRows.map((row) => row.screen));
  const records = {
    projects: rows(store.db, "projects").filter((row) => row.id === run.project),
    screens: rows(store.db, "screens").filter((row) => screens.has(row.id)),
    captures: captureRows, runs: [runRow], notes,
    targets: rows(store.db, "targets").filter((row) => captures.has(row.capture)),
    diffs: rows(store.db, "diffs").filter((row) => { const diff = parse(row); return captures.has(diff.left) && captures.has(diff.right); }),
    evidence: rows(store.db, "evidence").filter((row) => captures.has(row.capture)),
    previews: rows(store.db, "previews").filter((row) => captureRows.some((capture) => capture.hash === row.hash)),
    review_sets: [setRow],
    derived_evidence: rows(store.db, "derived_evidence").filter((row) => captures.has(row.capture)),
    source_links: rows(store.db, "source_links").filter((row) => captures.has(row.capture)),
    ci_reports: rows(store.db, "ci_reports").filter((row) => parse(row).run === run.id),
  };
  const references = new Set([set.id, run.id, ...captures, ...notes.map((row) => row.id), ...records.evidence.map((row) => row.id)]);
  const containsReference = (value) => typeof value === "string" ? references.has(value) : value && typeof value === "object" && Object.values(value).some(containsReference);
  records.events = rows(store.db, "events").filter((row) => containsReference(parse(row)));
  return { format: "screens-review-bundle", version: 1, createdAt: now(), reviewSet: set.id, records };
}

export async function exportBundle(store, input) {
  const bundle = store.transaction(() => snapshotBundle(store, input.reviewSet));
  const hashes = new Set(bundle.records.captures.map((row) => row.hash));
  for (const row of bundle.records.diffs) if (parse(row).image) hashes.add(parse(row).image);
  for (const row of bundle.records.evidence) if (parse(row).artifact) hashes.add(parse(row).artifact.hash);
  bundle.assets = {};
  for (const assetHash of hashes) bundle.assets[assetHash] = assetBytes(store, assetHash).toString("base64");
  const bytes = gzipSync(Buffer.from(JSON.stringify(bundle)));
  const output = resolve(text(input.output, "bundle output"));
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  return { output, sha256: hash(bytes), reviewSet: bundle.reviewSet, captures: bundle.records.captures.length, assets: hashes.size, bytes: bytes.length };
}

function matchingRow(db, table, row) {
  const keys = table === "targets" ? ["screen", "variant"] : table === "previews" ? ["hash"] : ["id"];
  return db.prepare(`SELECT * FROM ${table} WHERE ${keys.map((key) => `${key}=?`).join(" AND ")}`).get(...keys.map((key) => row[key]));
}

export async function importBundle(store, input) {
  initializeStorage(store);
  const bytes = readFileSync(resolve(text(input.file, "bundle file")));
  const bundleId = hash(bytes);
  if (input.signature) verifySignature(store, input);
  const imported = store.db.prepare("SELECT data FROM bundle_imports WHERE id=?").get(bundleId);
  if (imported) return { ...parse(imported), reused: true };
  const bundle = JSON.parse(gunzipSync(bytes));
  requireThat(bundle.format === "screens-review-bundle" && bundle.version === 1, "Use a Screens review bundle");
  requireThat(bundle.records && bundle.assets && bundle.records.review_sets?.some((row) => row.id === bundle.reviewSet), "Bundle is missing its review set");
  const assets = Object.entries(bundle.assets).map(([assetHash, encoded]) => {
    const value = Buffer.from(encoded, "base64");
    requireThat(isHash(assetHash) && hash(value) === assetHash, "Bundle asset does not match its address");
    return [assetHash, value];
  });
  for (const row of bundle.records.captures || []) requireThat(assets.some(([assetHash]) => assetHash === row.hash), "Bundle capture asset is missing");
  const result = store.transaction(() => {
    if (bundle.records.ci_reports?.length) store.db.exec("CREATE TABLE IF NOT EXISTS ci_reports (id TEXT PRIMARY KEY,data TEXT NOT NULL)");
    if (bundle.records.derived_evidence?.length || bundle.records.source_links?.length) store.db.exec(`
      CREATE TABLE IF NOT EXISTS derived_evidence (id TEXT PRIMARY KEY,capture TEXT NOT NULL REFERENCES captures(id),kind TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_links (id TEXT PRIMARY KEY,capture TEXT NOT NULL REFERENCES captures(id),note TEXT,data TEXT NOT NULL);`);
    for (const [table, columns] of Object.entries(exportTables)) {
      for (const row of bundle.records[table] || []) {
        requireThat(Object.keys(row).every((key) => columns.includes(key)) && columns.every((key) => Object.hasOwn(row, key)), `Unexpected ${table} record`);
        const previous = matchingRow(store.db, table, row);
        requireThat(!previous || canonical(previous) === canonical(row), `Existing ${table} record differs: ${row.id || row.screen || row.hash}`, 409);
      }
    }
    for (const [assetHash, value] of assets) store.saveAsset(assetHash, value);
    for (const [table, columns] of Object.entries(exportTables)) {
      for (const row of bundle.records[table] || []) {
        store.db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((key) => row[key]));
      }
    }
    for (const row of bundle.records.events || []) {
      const value = parse(row);
      store.event("bundle.source-event", { bundle: bundleId, sourceEvent: row.id, original: value });
    }
    const result = { bundle: bundleId, reviewSet: bundle.reviewSet, importedAt: now(), captures: bundle.records.captures.length, assets: assets.length, sourceDecisions: "preserved" };
    store.db.prepare("INSERT INTO bundle_imports VALUES (?,?)").run(bundleId, JSON.stringify(result));
    store.event("bundle.imported", result);
    return result;
  });
  return result;
}

export async function backupRegistry(store, input) {
  const output = resolve(text(input.output, "backup directory"));
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(join(output, "assets"), { mode: 0o700 });
  const database = join(output, "screens.sqlite");
  await backup(store.db, database);
  const snapshot = new DatabaseSync(database, { readOnly: true });
  let refs;
  try { refs = assetReferences(snapshot); } finally { snapshot.close(); }
  const assets = [];
  for (const assetHash of refs.keys()) {
    const bytes = assetBytes(store, assetHash);
    writeFileSync(join(output, "assets", assetHash), bytes, { flag: "wx", mode: 0o600 });
    assets.push({ hash: assetHash, bytes: bytes.length });
  }
  const privateFile = join(store.directory, "signing", "private.pem");
  let signingIdentity = null;
  if (existsSync(privateFile)) {
    const privateBytes = readFileSync(privateFile);
    mkdirSync(join(output, "signing"), { mode: 0o700 });
    writeFileSync(join(output, "signing", "private.pem"), privateBytes, { flag: "wx", mode: 0o600 });
    signingIdentity = { sha256: hash(privateBytes), bytes: privateBytes.length };
  }
  const manifest = { format: "screens-registry-backup", version: 2, createdAt: now(), database: { file: "screens.sqlite", sha256: hash(readFileSync(database)) }, assets, signingIdentity };
  writeFileSync(join(output, "backup.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { output, createdAt: manifest.createdAt, assets: assets.length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, statSync(database).size + (signingIdentity?.bytes || 0)) };
}

export function restoreRegistry(store, input) {
  const source = resolve(text(input.source, "backup directory"));
  const output = resolve(text(input.output, "restore directory"));
  requireThat(!existsSync(output), "Restore requires a new directory");
  const manifest = JSON.parse(readFileSync(join(source, "backup.json"), "utf8"));
  requireThat(manifest.format === "screens-registry-backup" && manifest.version === 2, "Use a Screens registry backup");
  const database = readFileSync(join(source, "screens.sqlite"));
  requireThat(hash(database) === manifest.database.sha256, "Backup database hash differs");
  for (const asset of manifest.assets) {
    requireThat(isHash(asset.hash), "Invalid backup asset address");
    requireThat(hash(readFileSync(join(source, "assets", asset.hash))) === asset.hash, `Backup asset differs: ${asset.hash}`);
  }
  const signingIdentity = manifest.signingIdentity ? readFileSync(join(source, "signing", "private.pem")) : null;
  if (signingIdentity) requireThat(hash(signingIdentity) === manifest.signingIdentity.sha256, "Backup signing identity differs");
  mkdirSync(output, { mode: 0o700 });
  mkdirSync(join(output, "assets"), { mode: 0o700 });
  if (signingIdentity) {
    mkdirSync(join(output, "signing"), { mode: 0o700 });
    writeFileSync(join(output, "signing", "private.pem"), signingIdentity, { flag: "wx", mode: 0o600 });
  }
  writeFileSync(join(output, "screens.sqlite"), database, { flag: "wx", mode: 0o600 });
  for (const asset of manifest.assets) copyFileSync(join(source, "assets", asset.hash), join(output, "assets", asset.hash), constants.COPYFILE_EXCL);
  return { output, assets: manifest.assets.length, restoredFrom: manifest.createdAt };
}

export function integrityReport(store) {
  const issues = [];
  for (const row of store.db.prepare("PRAGMA integrity_check").all()) if (row.integrity_check !== "ok") issues.push({ kind: "database", detail: row.integrity_check });
  for (const row of store.db.prepare("PRAGMA foreign_key_check").all()) issues.push({ kind: "foreign-key", ...row });
  const refs = assetReferences(store.db);
  for (const [assetHash, owners] of refs) {
    const file = join(store.directory, "assets", assetHash);
    if (!existsSync(file)) issues.push({ kind: "missing-asset", hash: assetHash, owners });
    else if (hash(readFileSync(file)) !== assetHash) issues.push({ kind: "asset-hash", hash: assetHash, owners });
  }
  const captureIds = new Set(rows(store.db, "captures").map((row) => row.id));
  for (const row of rows(store.db, "runs")) for (const capture of parse(row).captureIds) if (!captureIds.has(capture)) issues.push({ kind: "run-capture", run: row.id, capture });
  for (const row of rows(store.db, "notes")) if (parse(row).evidence && !captureIds.has(parse(row).evidence)) issues.push({ kind: "note-evidence", note: row.id, capture: parse(row).evidence });
  for (const row of rows(store.db, "diffs")) for (const capture of [parse(row).left, parse(row).right]) if (!captureIds.has(capture)) issues.push({ kind: "diff-capture", diff: row.id, capture });
  const noteIds = new Set(rows(store.db, "notes").map((row) => row.id));
  const evidenceIds = new Set(rows(store.db, "evidence").map((row) => row.id));
  for (const row of rows(store.db, "source_links")) {
    if (row.note && !noteIds.has(row.note)) issues.push({ kind: "source-note", sourceLink: row.id, note: row.note });
    const evidence = parse(row).evidence;
    if (evidence && !evidenceIds.has(evidence)) issues.push({ kind: "source-evidence", sourceLink: row.id, evidence });
  }
  return { checkedAt: now(), ok: issues.length === 0, assets: refs.size, issues };
}

function localAssets(store) {
  return readdirSync(join(store.directory, "assets"), { withFileTypes: true }).filter((entry) => entry.isFile() && isHash(entry.name)).map((entry) => {
    const file = statSync(join(store.directory, "assets", entry.name));
    return { hash: entry.name, bytes: file.size, modifiedMs: file.mtimeMs };
  });
}

export function storageReport(store) {
  const assets = localAssets(store);
  const refs = assetReferences(store.db);
  const captures = new Map(rows(store.db, "captures").map((row) => [row.id, row]));
  const projects = new Map(rows(store.db, "projects").map((row) => [row.id, { id: row.id, name: parse(row).name, assetHashes: new Set() }]));
  const screens = new Map(rows(store.db, "screens").map((row) => [row.id, row.project]));
  const sizes = new Map(assets.map((asset) => [asset.hash, asset.bytes]));
  for (const [assetHash, owners] of refs) for (const owner of owners) {
    const screen = owner.screen || captures.get(owner.capture)?.screen;
    projects.get(screens.get(screen))?.assetHashes.add(assetHash);
  }
  return {
    databaseBytes: statSync(join(store.directory, "screens.sqlite")).size,
    assets: assets.length, assetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    unreferencedBytes: assets.filter((asset) => !refs.has(asset.hash)).reduce((sum, asset) => sum + asset.bytes, 0),
    projects: [...projects.values()].map(({ assetHashes, ...project }) => ({ ...project, assets: assetHashes.size, bytes: [...assetHashes].reduce((sum, assetHash) => sum + (sizes.get(assetHash) || 0), 0) })).sort((a, b) => b.bytes - a.bytes),
    largestAssets: [...assets].sort((a, b) => b.bytes - a.bytes).slice(0, 50).map((asset) => ({ ...asset, references: refs.get(asset.hash) || [] })),
  };
}

export function retentionPlan(store, input) {
  const days = input.olderThanDays ?? 30;
  requireThat(Number.isFinite(days) && days >= 0, "olderThanDays must be a nonnegative number");
  const before = Date.now() - days * 86400000;
  const refs = assetReferences(store.db);
  const value = { format: "screens-retention-plan", version: 1, createdAt: now(), olderThanDays: days, assets: localAssets(store).filter((asset) => !refs.has(asset.hash) && asset.modifiedMs < before) };
  value.id = hash(JSON.stringify(value));
  if (input.output) writeFileSync(resolve(input.output), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { ...value, reclaimableBytes: value.assets.reduce((sum, asset) => sum + asset.bytes, 0) };
}

export function executeRetention(store, input) {
  requireThat(input.execute === "yes", "Pass execute yes to delete the assets in the plan");
  const plan = JSON.parse(readFileSync(resolve(text(input.plan, "retention plan")), "utf8"));
  const { id, reclaimableBytes, ...identity } = plan;
  requireThat(plan.format === "screens-retention-plan" && plan.version === 1 && hash(JSON.stringify(identity)) === id, "Retention plan differs from its recorded identity");
  return store.transaction(() => {
    const refs = assetReferences(store.db);
    const removed = [], skipped = [];
    for (const asset of plan.assets) {
      requireThat(isHash(asset.hash), "Invalid asset address in retention plan");
      const file = join(store.directory, "assets", asset.hash);
      if (refs.has(asset.hash)) { skipped.push({ hash: asset.hash, reason: "referenced" }); continue; }
      if (!existsSync(file)) { skipped.push({ hash: asset.hash, reason: "missing" }); continue; }
      const current = statSync(file);
      if (current.size !== asset.bytes || current.mtimeMs !== asset.modifiedMs) { skipped.push({ hash: asset.hash, reason: "changed" }); continue; }
      unlinkSync(file);
      removed.push(asset.hash);
    }
    store.event("storage.retained", { plan: id, removed, skipped });
    return { plan: id, removed, skipped };
  });
}

function publicIdentity(key) {
  const publicKey = createPublicKey(key);
  requireThat(publicKey.asymmetricKeyType === "ed25519", "Use a Screens Ed25519 signing key");
  const fingerprint = hash(publicKey.export({ format: "der", type: "spki" }));
  return { publicKey, fingerprint };
}

function managedSigningKey(store) {
  return store.transaction(() => {
    const directory = join(store.directory, "signing"), file = join(directory, "private.pem");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existsSync(file)) {
      const { privateKey } = generateKeyPairSync("ed25519");
      writeFileSync(file, privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
    }
    return createPrivateKey(readFileSync(file));
  });
}

function trustedIdentity(store, fingerprint) {
  const localFile = join(store.directory, "signing", "private.pem");
  if (existsSync(localFile)) {
    const local = publicIdentity(createPrivateKey(readFileSync(localFile)));
    if (local.fingerprint === fingerprint) return local;
  }
  const trusted = store.db.prepare("SELECT data FROM trusted_signers WHERE id=?").get(fingerprint);
  requireThat(trusted, "Signer is not trusted. Import its public key with signing-key-trust.", 422);
  return publicIdentity(parse(trusted).publicKey);
}

export function exportSigningKey(store, input) {
  const identity = publicIdentity(managedSigningKey(store));
  const publicKey = identity.publicKey.export({ format: "pem", type: "spki" });
  const output = input.output ? resolve(input.output) : null;
  if (output) writeFileSync(output, publicKey, { flag: "wx", mode: 0o600 });
  return { keyFingerprint: identity.fingerprint, publicKey, output };
}

export function trustSigningKey(store, input) {
  const identity = publicIdentity(readFileSync(resolve(text(input.file, "public key file"))));
  const existing = store.db.prepare("SELECT data FROM trusted_signers WHERE id=?").get(identity.fingerprint);
  if (existing) return parse(existing);
  const value = { id: identity.fingerprint, label: input.label ? text(input.label, "signer label") : identity.fingerprint,
    publicKey: identity.publicKey.export({ format: "pem", type: "spki" }), trustedAt: now() };
  store.transaction(() => {
    store.db.prepare("INSERT OR IGNORE INTO trusted_signers VALUES (?,?)").run(value.id, JSON.stringify(value));
    store.event("signer.trusted", { fingerprint: value.id, label: value.label });
  });
  return parse(store.db.prepare("SELECT data FROM trusted_signers WHERE id=?").get(value.id));
}

export function signBundle(store, input) {
  const file = resolve(text(input.file, "file to sign"));
  const bytes = readFileSync(file);
  const privateKey = managedSigningKey(store), identity = publicIdentity(privateKey);
  const result = { format: "screens-file-signature", version: 1, createdAt: now(), sha256: hash(bytes), keyFingerprint: identity.fingerprint,
    keyType: "ed25519", signature: sign(null, bytes, privateKey).toString("base64") };
  const output = resolve(text(input.output, "signature output"));
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { output, sha256: result.sha256, keyFingerprint: result.keyFingerprint };
}

export function verifySignature(store, input) {
  const bytes = readFileSync(resolve(text(input.file, "signed file")));
  const signature = JSON.parse(readFileSync(resolve(text(input.signature, "signature file")), "utf8"));
  requireThat(signature.format === "screens-file-signature" && signature.version === 1, "Use a Screens file signature");
  const identity = trustedIdentity(store, signature.keyFingerprint);
  const valid = signature.sha256 === hash(bytes) && signature.keyFingerprint === identity.fingerprint &&
    verify(null, bytes, identity.publicKey, Buffer.from(signature.signature, "base64"));
  requireThat(valid, "Signature does not match the file and trusted signing key", 422);
  return { valid, sha256: signature.sha256, keyFingerprint: identity.fingerprint, signedAt: signature.createdAt };
}

export const storageActions = {
  "bundle-export": { description: "Export an ordered review set with exact run captures, comments, decisions, and evidence into a gzip bundle.", inputSchema: schema({ reviewSet: string, output: string }, ["reviewSet", "output"]), cliOnly: true, run: exportBundle },
  "bundle-import": { description: "Import a review bundle; retain identities and reject conflicting destination records.", inputSchema: schema({ file: string, signature: string }, ["file"]), cliOnly: true, run: importBundle },
  "registry-backup": { description: "Create a consistent SQLite snapshot and its referenced assets in a new directory.", inputSchema: schema({ output: string }, ["output"]), cliOnly: true, run: backupRegistry },
  "registry-restore": { description: "Restore a registry backup into a new directory.", inputSchema: schema({ source: string, output: string }, ["source", "output"]), cliOnly: true, run: restoreRegistry },
  "registry-integrity": { description: "Report database, asset hash, and evidence reference integrity problems.", inputSchema: schema(), cliOnly: true, run: integrityReport },
  "storage-report": { description: "Report disk usage by project and asset, including unreferenced bytes.", inputSchema: schema(), cliOnly: false, run: storageReport },
  "retention-plan": { description: "Plan removal of unreferenced local assets older than the requested age.", inputSchema: schema({ olderThanDays: { type: "number", minimum: 0 }, output: string }), cliOnly: true, run: retentionPlan },
  "retention-execute": { description: "Execute a retention plan after rechecking current references and file identity.", inputSchema: schema({ plan: string, execute: { const: "yes" } }, ["plan", "execute"]), cliOnly: true, run: executeRetention },
  "bundle-sign": { description: "Sign a bundle or report with this registry's managed Ed25519 identity.", inputSchema: schema({ file: string, output: string }, ["file", "output"]), cliOnly: true, run: signBundle },
  "signature-verify": { description: "Verify a bundle or report with a local or explicitly trusted signing identity.", inputSchema: schema({ file: string, signature: string }, ["file", "signature"]), cliOnly: true, run: verifySignature },
  "signing-key-export": { description: "Export this registry's public signing identity; create its local key when first used.", inputSchema: schema({ output: string }), cliOnly: true, run: exportSigningKey },
  "signing-key-trust": { description: "Trust an explicitly supplied Screens public signing key.", inputSchema: schema({ file: string, label: string }, ["file"]), cliOnly: true, run: trustSigningKey },
};
