import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { fixture } from './support/registry.mjs';
import { runHeadless, actionCatalog } from '../src/headless.mjs';
import * as evidence from '../src/evidence-tools.mjs';
import * as storage from '../src/storage-tools.mjs';
import { Store } from '../src/store.mjs';
import { createDiff } from '../src/diff.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const action = (store, name, input = {}, context = {}) => runHeadless(store, name, input, { cli: true, ...context });
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
async function review(t) {
    const f = await fixture(t), left = f.capture({ role: 'current', fixture: 'seed', revision: 'before' }), right = f.capture({ role: 'pr', fixture: 'seed', revision: 'after' });
    const target = f.capture({ role: 'target', fixture: 'seed', revision: 'target' });
    const run = f.store.run({ project: 'demo', title: 'Review <&"\' | title', captureIds: [left.id, right.id, target.id] });
    const entry = f.store.compare(run.id).entries[0];
    const set = f.store.saveReviewSet({ run: run.id, title: 'Flow', entries: [`${entry.screen}|${JSON.stringify(entry.variant)}`], expectedRevision: 0 });
    return { ...f, left, right, target, run, set };
}
test('headless action schemas enforce required fields, local execution and exact input names', async (t) => {
    const { store } = await fixture(t);
    assert.ok(actionCatalog().every(item => !item.cliOnly));
    assert.ok(actionCatalog(true).some(item => item.cliOnly));
    for (const [name, input, context] of [['missing', {}, {}], ['storage-report', [], {}], ['jobs-get', {}, {}], ['storage-report', { unknown: true }, {}], ['bundle-export', {}, { cli: false }]])
        await assert.rejects(action(store, name, input, context));
    assert.ok((await action(store, 'storage-report')).assets >= 0);
});
test('derived evidence, OCR changes, selector notes and source links retain capture identity', async (t) => {
    const f = await review(t), { store, left, right } = f;
    assert.throws(() => evidence.getDerived(store, 'missing'), /not found/);
    const lines = values => values.map(text => ({ text }));
    const l = evidence.saveDerived(store, left.id, 'ocr', { text: 'Alpha Beta', lines: lines(['Alpha', 'Beta', 'Old']) });
    const r = evidence.saveDerived(store, right.id, 'ocr', { text: 'Alpha Gamma', lines: lines(['Alpha', 'New', 'Gamma']) });
    assert.equal(evidence.saveDerived(store, right.id, 'ocr', r.data).id, r.id);
    const compared = evidence.compareText(store, { left: left.id, right: right.id, leftOcr: l.id, rightOcr: r.id });
    assert.equal(compared.data.identical, false);
    assert.ok(compared.data.addedLines);
    assert.equal(evidence.compareText(store, { left: left.id, right: left.id }).data.identical, true);
    assert.throws(() => evidence.compareText(store, { left: left.id, right: 'missing' }), /Extract/);
    assert.throws(() => evidence.compareText(store, { left: right.id, right: right.id, leftOcr: l.id }), /belong/);
    const page = evidence.searchOcr(store, { query: 'Alpha', project: 'demo', limit: 1 });
    assert.equal(page.items.length, 1);
    assert.ok(page.nextCursor);
    assert.equal(evidence.searchOcr(store, { query: 'Alpha', cursor: page.nextCursor }).nextCursor, null);
    assert.equal(evidence.searchOcr(store, { query: 'Alpha', project: 'unknown' }).items.length, 0);
    assert.ok(evidence.listDerived(store, { capture: right.id, limit: 1 }).nextCursor);
    assert.equal(evidence.listDerived(store, { capture: right.id, kind: 'ocr', query: 'gamma' }).items.length, 1);
    assert.equal(evidence.listDerived(store, { capture: right.id, kind: 'missing', query: 'no' }).items.length, 0);
    const geometry = evidence.saveDerived(store, right.id, 'selectors', { items: [{ selector: '#visible', region: { x: 0, y: 0, width: .5, height: .5 } }, { selector: '#hidden', region: null }] });
    const note = evidence.addSelectorNote(store, { capture: right.id, selector: '#visible', text: 'Align this' });
    assert.equal(evidence.addSelectorNote(store, { capture: right.id, selector: '#visible', geometry: geometry.id, text: 'Second' }).capture, right.id);
    for (const input of [{ capture: left.id, selector: '#visible' }, { capture: right.id, selector: '#hidden' }, { capture: left.id, geometry: geometry.id, selector: '#visible' }])
        assert.throws(() => evidence.addSelectorNote(store, { ...input, text: 'invalid' }));
    const semantic = store.addEvidence({ capture: right.id, author: 'Test reviewer', kind: 'visual', method: 'manual', outcome: 'not-run', assertion: 'Review', procedure: 'Inspect', observation: 'Pending' });
    const link = evidence.addSourceLink(store, { capture: right.id, note: note.id, evidence: semantic.id, file: 'src\\Page.jsx', symbol: 'Page', line: 12 });
    assert.equal(link.file, 'src/Page.jsx');
    assert.equal(evidence.sourceLinks(store, { capture: right.id, note: note.id }).length, 1);
    assert.equal(evidence.sourceLinks(store, { capture: right.id, note: 'other' }).length, 0);
    for (const patch of [{ file: '../secret' }, { file: '/secret' }, { file: 'C:\\secret' }, { revision: 'wrong' }, { capture: left.id, note: note.id }, { capture: left.id, evidence: semantic.id }])
        assert.throws(() => evidence.addSourceLink(store, { capture: right.id, file: 'src/Page.jsx', ...patch }));
    await assert.rejects(evidence.extractOcr(store, { capture: right.id, language: 'fr' }), /English/);
    await assert.rejects(evidence.extractOcr(store, { capture: right.id, psm: 0 }), /segmentation/);
});
test('fixture and perceptual checks report missing metadata, mismatches and nonidentical pixels', async (t) => {
    const { store, left, right, capture } = await review(t);
    const first = evidence.fixtureContract(store, { capture: right.id, other: left.id, contract: { name: 'wrong', version: 'v1', required: ['missing.deep'], equals: { currency: 'EUR' } } });
    assert.equal(first.data.passed, false);
    const fixed = evidence.saveDerived(store, right.id, 'fixture', { version: 'v1', currency: 'EUR', record: { id: 'one' } });
    assert.equal(evidence.fixtureContract(store, { capture: right.id, record: fixed.id, contract: { name: 'seed', version: 'v1', required: ['record.id'], equals: { currency: 'EUR' } } }).data.passed, true);
    assert.throws(() => evidence.fixtureContract(store, { capture: left.id, record: fixed.id, contract: {} }), /belong/);
    const other = capture({ role: 'target', fixture: 'other' });
    assert.equal(evidence.fixtureContract(store, { capture: right.id, other: other.id, contract: {} }).data.passed, false);
    const changed = capture({ role: 'pr', revision: 'changed', bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: 'black' } }).png().toBuffer() });
    assert.equal((await evidence.perceptualComparison(store, { left: left.id, right: changed.id })).data.identical, false);
    const small = capture({ revision: 'small', bytes: await sharp({ create: { width: 1, height: 1, channels: 4, background: 'white' } }).png().toBuffer() });
    assert.equal((await evidence.perceptualComparison(store, { left: left.id, right: small.id })).data.status, 'dimension-mismatch');
    const pixel = capture({ revision: 'pixel', bytes: await sharp({ create: { width: 1, height: 1, channels: 4, background: 'black' } }).png().toBuffer() });
    assert.equal((await evidence.perceptualComparison(store, { left: small.id, right: pixel.id })).data.identical, false);
    await assert.rejects(evidence.perceptualComparison(store, { left: left.id, right: capture({ variant: { device: 'phone' } }).id }), /same screen/);
});
test('CI policies distinguish absent evidence, failed checks, pending jobs and export formats', async (t) => {
    const { store, left, right, run, dir, capture } = await review(t);
    await assert.rejects(evidence.evaluateCI(store, {}), /Supply/);
    await assert.rejects(evidence.evaluateCI(store, { run: run.id }), /select/);
    await assert.rejects(evidence.evaluateCI(store, { run: run.id, policy: { pair: ['bad'] } }), /roles/);
    const policy = { maxChangedRatio: 0, maxChangedPixels: 0, minSsim: 1, requireMatchingFixture: true, maxAccessibilityViolations: 0, failOnConsoleErrors: true, failOnNetworkErrors: true, requireEvidence: ['dom'], fixtureContract: { version: 'v1' } };
    let report = await evidence.evaluateCI(store, { run: run.id, policy });
    assert.equal(report.exitCode, 1);
    evidence.saveDerived(store, right.id, 'accessibility', { violations: [] });
    evidence.saveDerived(store, right.id, 'console', { items: [{ type: 'log', text: 'ready' }] });
    evidence.saveDerived(store, right.id, 'network', { items: [] });
    evidence.saveDerived(store, right.id, 'dom', { html: 'main' });
    for (const item of [left, right])
        evidence.saveDerived(store, item.id, 'fixture', { version: 'v1' });
    report = await evidence.evaluateCI(store, { run: run.id, policy });
    assert.equal(report.exitCode, 0);
    assert.equal(evidence.getReport(store, report.id).id, report.id);
    const note = store.addNote({ capture: right.id, text: 'Review < & > " \'' });
    evidence.addSourceLink(store, { capture: right.id, note: note.id, file: 'src/Page.jsx', line: 7 });
    for (const format of ['json', 'junit', 'sarif', 'markdown'])
        assert.ok(evidence.formatReport(store, report, format).length);
    assert.throws(() => evidence.formatReport(store, report, 'bad'), /Use json/);
    assert.throws(() => evidence.getReport(store, 'missing'), /not found/);
    const single = store.run({ project: 'demo', title: 'Comparison', captureIds: [right.id] });
    for (const failOnMissing of [true, false]) {
        const missing = await evidence.evaluateCI(store, { run: single.id, policy: { failOnMissing } });
        assert.equal(missing.checks[0].status, failOnMissing ? 'fail' : 'not-run');
        assert.ok(evidence.formatReport(store, missing, 'junit'));
        assert.ok(evidence.formatReport(store, missing, 'sarif'));
    }
    const changed = capture({ role: 'pr', revision: 'small', bytes: await sharp({ create: { width: 1, height: 1, channels: 4, background: 'black' } }).png().toBuffer() });
    const mismatch = store.run({ project: 'demo', title: 'Comparison', captureIds: [left.id, changed.id] });
    assert.equal((await evidence.evaluateCI(store, { run: mismatch.id, policy: { maxChangedRatio: 0, minSsim: 1 } })).exitCode, 1);
    for (const [i, status] of ['queued', 'running', 'failed', 'cancelled', 'completed'].entries()) {
        const id = `job-${i}`, value = { id, status, ref: 'sha', error: status === 'failed' ? { message: 'failure' } : status === 'cancelled' ? 'Cancelled by user' : undefined };
        store.db.prepare('INSERT INTO capture_jobs VALUES (?,?,?)').run(id, 1, JSON.stringify(value));
        const job = await evidence.evaluateCI(store, { jobs: [id] });
        assert.equal(job.exitCode, status === 'completed' ? 0 : status === 'queued' || status === 'running' ? 2 : 1);
    }
    await assert.rejects(evidence.evaluateCI(store, { jobs: ['missing'] }), /not found/);
    const output = join(dir, 'review-report');
    await evidence.exportReviewReport(store, { run: run.id, output });
    assert.ok(fs.readFileSync(join(output, 'review.md'), 'utf8').includes('Review'));
    await assert.rejects(evidence.exportReviewReport(store, { run: run.id, output }));
});
test('portable bundles preserve decisions, reject corrupt records, and make reimport idempotent', async (t) => {
    const { store, dir, left, right, target: design, run, set } = await review(t);
    const file = join(dir, 'review.gz'), target = new Store(join(dir, 'destination'));
    t.after(() => target.close());
    const note = store.addNote({ capture: left.id, text: 'Fix this' });
    store.updateNote({ id: note.id, expectedRevision: note.revision, status: 'submitted', evidence: right.id, resolution: 'Fixed' });
    store.approveTarget({ capture: design.id, expectedRevision: 0 });
    await createDiff(store, { left: left.id, right: right.id });
    store.addEvidence({ capture: right.id, author: 'Test reviewer', kind: 'visual', method: 'manual', outcome: 'pass', assertion: 'Match', procedure: 'Inspect', observation: 'Match', artifactBase64: Buffer.from('report').toString('base64'), artifactType: 'text/plain' });
    evidence.saveDerived(store, right.id, 'fixture', { version: 'seed' });
    evidence.addSourceLink(store, { capture: right.id, file: 'src/Page.jsx' });
    await evidence.evaluateCI(store, { run: run.id, policy: { maxChangedPixels: 0 } });
    const exported = await storage.exportBundle(store, { reviewSet: set.id, output: file });
    assert.ok(exported.assets > 1);
    await storage.importBundle(target, { file });
    assert.equal((await storage.importBundle(target, { file })).reused, true);
    const original = JSON.parse(gunzipSync(fs.readFileSync(file)));
    const corrupt = join(dir, 'corrupt.gz');
    for (const edit of [bundle => bundle.version = 2, bundle => delete bundle.records.review_sets, bundle => bundle.assets[Object.keys(bundle.assets)[0]] = 'wrong', bundle => delete bundle.assets[Object.keys(bundle.assets)[0]], bundle => bundle.records.projects[0].unexpected = true, bundle => bundle.records.projects[0].data = 'different']) {
        const value = structuredClone(original);
        edit(value);
        fs.writeFileSync(corrupt, gzipSync(Buffer.from(JSON.stringify(value))));
        await assert.rejects(storage.importBundle(target, { file: corrupt }));
    }
    await assert.rejects(storage.exportBundle(store, { reviewSet: 'missing', output: join(dir, 'missing.gz') }), /not found/);
    const usage = storage.storageReport(store);
    assert.ok(usage.assetBytes > 0);
    assert.equal(storage.integrityReport(store).ok, true);
    const bytes = store.image(left.id).bytes, asset = join(store.directory, 'assets', left.hash);
    fs.writeFileSync(asset, 'corrupt');
    assert.ok(storage.integrityReport(store).issues.some(item => item.kind === 'asset-hash'));
    fs.rmSync(asset);
    assert.ok(storage.integrityReport(store).issues.some(item => item.kind === 'missing-asset'));
    fs.writeFileSync(asset, bytes);
});
test('retention rechecks referenced, changed, missing and removable assets without deleting records', async (t) => {
    const { store, dir, bytes, capture } = await fixture(t);
    const hashes = [];
    for (let i = 0; i < 4; i++) {
        const data = Buffer.from(`orphan-${i}`);
        const id = hash(data);
        store.saveAsset(id, data);
        fs.utimesSync(join(store.directory, 'assets', id), new Date(0), new Date(0));
        hashes.push(id);
    }
    const planFile = join(dir, 'retention.json');
    const plan = storage.retentionPlan(store, { olderThanDays: 0, output: planFile });
    assert.equal(plan.assets.length, 4);
    const referenced = capture();
    const replacement = JSON.parse(fs.readFileSync(planFile));
    replacement.assets.push({ hash: referenced.hash, bytes: bytes.length, modifiedMs: 0 });
    delete replacement.id;
    delete replacement.reclaimableBytes;
    replacement.id = hash(JSON.stringify(replacement));
    write(planFile, replacement);
    fs.writeFileSync(join(store.directory, 'assets', hashes[1]), 'changed bytes');
    fs.rmSync(join(store.directory, 'assets', hashes[2]));
    const result = storage.executeRetention(store, { plan: planFile, execute: 'yes' });
    assert.equal(result.removed.length, 2);
    assert.deepEqual(new Set(result.skipped.map(item => item.reason)), new Set(['referenced', 'changed', 'missing']));
    assert.equal(store.getCapture(referenced.id).id, referenced.id);
    assert.throws(() => storage.retentionPlan(store, { olderThanDays: -1 }), /nonnegative/);
    assert.throws(() => storage.executeRetention(store, { plan: planFile }), /execute/);
    write(planFile, {});
    assert.throws(() => storage.executeRetention(store, { plan: planFile, execute: 'yes' }), /identity/);
});
test('backups and signatures reject mismatched database, image, key and trust identities', async (t) => {
    const { store, dir, capture } = await fixture(t);
    capture();
    const backup = join(dir, 'backup');
    await storage.backupRegistry(store, { output: backup });
    const manifest = JSON.parse(fs.readFileSync(join(backup, 'backup.json')));
    const target = () => join(dir, `restored-${Math.random()}`);
    for (const edit of [value => value.version = 0, value => value.database.sha256 = 'wrong', value => value.assets[0].hash = 'bad']) {
        const value = structuredClone(manifest);
        edit(value);
        write(join(backup, 'backup.json'), value);
        assert.throws(() => storage.restoreRegistry(store, { source: backup, output: target() }));
    }
    write(join(backup, 'backup.json'), manifest);
    assert.ok(storage.restoreRegistry(store, { source: backup, output: target() }).assets);
    assert.throws(() => storage.restoreRegistry(store, { source: backup, output: backup }), /new directory/);
    const file = join(dir, 'bytes'), signature = join(dir, 'signature.json');
    fs.writeFileSync(file, 'immutable bytes');
    storage.signBundle(store, { file, output: signature });
    assert.equal(storage.verifySignature(store, { file, signature }).valid, true);
    const publicFile = join(dir, 'public.pem');
    storage.exportSigningKey(store, { output: publicFile });
    const exported = storage.exportSigningKey(store, {});
    assert.ok(exported.publicKey);
    const targetStore = new Store(join(dir, 'untrusted'));
    t.after(() => targetStore.close());
    assert.throws(() => storage.verifySignature(targetStore, { file, signature }), /not trusted/);
    const trusted = storage.trustSigningKey(targetStore, { file: publicFile });
    assert.equal(storage.trustSigningKey(targetStore, { file: publicFile, label: 'same' }).id, trusted.id);
    assert.equal(storage.verifySignature(targetStore, { file, signature }).valid, true);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    fs.writeFileSync(publicFile, rsa.publicKey.export({ format: 'pem', type: 'spki' }));
    assert.throws(() => storage.trustSigningKey(store, { file: publicFile }), /Ed25519/);
    const value = JSON.parse(fs.readFileSync(signature));
    value.version = 0;
    write(signature, value);
    assert.throws(() => storage.verifySignature(store, { file, signature }), /signature/);
    value.version = 1;
    value.signature = Buffer.alloc(64).toString('base64');
    write(signature, value);
    assert.throws(() => storage.verifySignature(store, { file, signature }), /does not match/);
});
test('CI report export writes each selected format to a new file', async (t) => { const { store, run, dir } = await review(t); const report = await evidence.evaluateCI(store, { run: run.id, policy: { maxChangedPixels: 0 } }); for (const format of ['json', 'sarif', 'junit', 'markdown']) {
    const output = join(dir, `report.${format}`);
    const result = await action(store, 'report_export', { report: report.id, format, output });
    assert.equal(result.output, output);
    assert.ok(fs.readFileSync(output).length);
} });
test('storage audits report broken references and retain disk accounting for missing and orphan assets', async (t) => {
    const { store, dir, left, right, run, set } = await review(t);
    const { DatabaseSync } = await import('node:sqlite');
    const empty = new DatabaseSync(':memory:');
    assert.equal(storage.assetReferences(empty).size, 0);
    empty.close();
    const orphan = Buffer.from('unreferenced');
    store.saveAsset(hash(orphan), orphan);
    assert.ok(storage.storageReport(store).unreferencedBytes);
    assert.equal(storage.retentionPlan(store, {}).olderThanDays, 30);
    const imageFile = join(store.directory, 'assets', left.hash);
    fs.rmSync(imageFile);
    assert.ok(storage.storageReport(store).projects.some(project => project.bytes === 0));
    store.db.exec('PRAGMA foreign_keys=OFF');
    store.db.prepare('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify({ ...run, captureIds: ['missing-capture'] }), run.id);
    const note = store.addNote({ capture: right.id, text: 'Audit' });
    store.db.prepare('UPDATE notes SET data=? WHERE id=?').run(JSON.stringify({ ...note, evidence: 'missing-evidence-capture' }), note.id);
    store.db.prepare('INSERT INTO notes VALUES (?,?,?,?)').run('broken-note', 'missing-capture', 1, JSON.stringify({ id: 'broken-note', capture: 'missing-capture' }));
    store.db.prepare('INSERT INTO diffs VALUES (?,?)').run('broken-diff', JSON.stringify({ left: 'missing-left', right: 'missing-right' }));
    store.db.prepare('INSERT INTO source_links VALUES (?,?,?,?)').run('broken-source', right.id, 'missing-note', JSON.stringify({ capture: right.id, evidence: 'missing-evidence' }));
    const proxy = { directory: store.directory, db: { prepare: sql => sql === 'PRAGMA integrity_check' ? { all: () => [{ integrity_check: 'corrupt page' }] } : store.db.prepare(sql) } };
    const report = storage.integrityReport(proxy);
    for (const kind of ['database', 'foreign-key', 'run-capture', 'note-evidence', 'diff-capture', 'source-note', 'source-evidence'])
        assert.ok(report.issues.some(issue => issue.kind === kind), kind);
    store.db.prepare('UPDATE captures SET hash=? WHERE id=?').run('invalid-address', left.id);
    assert.ok(storage.assetReferences(store.db).size >= 0);
});
test('portable bundle optional tables and preview conflicts preserve existing immutable records', async (t) => {
    const { store, dir, left, set } = await review(t);
    const { preparePreview } = await import('../src/previews.mjs');
    await preparePreview(store, store.image(left.id).bytes);
    const file = join(dir, 'previews.gz');
    await storage.exportBundle(store, { reviewSet: set.id, output: file });
    const target = new Store(join(dir, 'target'));
    t.after(() => target.close());
    await storage.importBundle(target, { file });
    const bundle = JSON.parse(gunzipSync(fs.readFileSync(file)));
    assert.equal(bundle.records.previews.length, 1);
    const bad = join(dir, 'bad-preview.gz');
    const changed = structuredClone(bundle);
    changed.records.previews[0].data = '{}';
    fs.writeFileSync(bad, gzipSync(Buffer.from(JSON.stringify(changed))));
    await assert.rejects(storage.importBundle(target, { file: bad }), /previews/);
    const minimal = { format: bundle.format, version: bundle.version, reviewSet: bundle.reviewSet, records: { review_sets: bundle.records.review_sets, captures: [] }, assets: {} };
    const small = join(dir, 'minimal.gz');
    fs.writeFileSync(small, gzipSync(Buffer.from(JSON.stringify(minimal))));
    assert.equal((await storage.importBundle(target, { file: small })).captures, 0);
    delete minimal.records.captures;
    fs.writeFileSync(small, gzipSync(Buffer.from(JSON.stringify(minimal))));
    await assert.rejects(storage.importBundle(target, { file: small }));
});
test('CI missing pairs, unknown fixtures and coverage gaps remain explicit in every report format', async (t) => {
    const { store, dir, left, right, run, capture } = await review(t);
    evidence.saveDerived(store, left.id, 'fixture', { version: 'v1' });
    assert.equal(evidence.fixtureContract(store, { capture: right.id, other: left.id, contract: {} }).data.passed, false);
    const onlyCurrent = store.run({ project: 'demo', title: 'Only current', captureIds: [left.id] });
    for (const pair of [['current', 'pr'], ['target', 'pr']]) {
        const report = await evidence.evaluateCI(store, { run: onlyCurrent.id, policy: { pair } });
        for (const format of ['json', 'junit', 'markdown', 'sarif'])
            assert.ok(evidence.formatReport(store, report, format));
    }
    const unknown = capture({ role: 'current', fixture: 'unknown', revision: 'unknown' });
    const unknownRun = store.run({ project: 'demo', title: 'Unknown fixture', captureIds: [unknown.id, right.id] });
    assert.equal((await evidence.evaluateCI(store, { run: unknownRun.id, policy: { requireMatchingFixture: true } })).exitCode, 1);
    store.screen({ project: 'demo', key: 'uncovered', title: 'Missing' });
    const gaps = store.run({ project: 'demo', title: 'Coverage gaps', captureIds: [left.id, right.id] });
    for (const failOnMissing of [false, true]) {
        const report = await evidence.evaluateCI(store, { run: gaps.id, policy: { failOnMissing, maxChangedPixels: 0, region: { x: 0, y: 0, width: .5, height: .5 } } });
        assert.ok(report.checks.some(check => check.rule === 'capture-coverage'));
    }
    evidence.addSourceLink(store, { capture: left.id, file: 'src/Page.jsx' });
    const manual = { title: 'No title in check', passed: false, checks: [{ screen: 'demo/home', capture: left.id, rule: 'manual', status: 'fail', message: '<>&"\'' }, { screen: 'capture', capture: null, rule: 'job', status: 'not-run', message: 'Pending' }] };
    assert.ok(evidence.formatReport(store, manual, 'sarif'));
    assert.ok(evidence.formatReport(store, manual, 'markdown'));
    assert.ok(evidence.formatReport(store, manual, 'junit'));
    const note = store.addNote({ capture: right.id, text: 'Area report', region: { x: 0, y: 0, width: .5, height: .5 } });
    await createDiff(store, { left: left.id, right: right.id, region: note.region });
    const output = join(dir, 'area-report');
    await evidence.exportReviewReport(store, { run: run.id, output });
    assert.match(fs.readFileSync(join(output, 'review.md'), 'utf8'), /in selected area/);
});
