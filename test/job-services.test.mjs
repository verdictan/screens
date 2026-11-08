import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
import * as runtime from '../src/runtime.mjs';
async function services(t, { mode = 'success', workerMode, versions = '22.23.4', beforeResult, project = true } = {}) {
    const f = await fixture(t), file = join(f.dir, 'recipe.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', serve: ['node', 'app.mjs'], scenarios: [{ key: 'home', path: '/' }] }] }));
    let tick, selectedJob, revisionFailure = false;
    class Worker extends EventEmitter {
        constructor(_url, { workerData }) { super(); selectedJob = workerData.job; queueMicrotask(() => { beforeResult?.(f.store, selectedJob, () => tick?.()); if (workerMode === 'error')
            this.emit('error', Error('thread failed'));
        else if (workerMode === 'exit')
            this.emit('exit', 2);
        else if (workerMode === 'reported')
            this.emit('message', { type: 'error', message: 'worker failed', status: 409 });
        else {
            this.emit('message', { type: 'event', event: { type: 'progress' } });
            this.emit('message', { type: 'result', result: { status: 'captured', exitCode: 0 } });
            this.emit('exit', 0);
        } }); }
        postMessage() { if (workerMode === 'abort-fails')
            throw Error('thread closed'); }
    }
    const captureRevision = async (store, options) => {
        if (mode === 'failure')
            throw Error('build failed');
        if (mode === 'finish-store-fails') {
            const original = store.transaction.bind(store);
            store.transaction = () => { store.transaction = original; throw Error('write unavailable'); };
            throw Error('build failed');
        }
        options.assertOwnership();
        options.onEvent({ type: 'capture.started' });
        const capture = store.capture({ screen: 'demo/home', role: 'pr', bytes: f.bytes, revision: 'commit' });
        options.onCapture({ capture });
        options.onCapture({ capture });
        options.onCheckpoint({ identity: 'home', captureId: capture.id });
        if (mode === 'lease-lost') {
            const row = JSON.parse(store.db.prepare('SELECT data FROM capture_jobs WHERE id=?').get(options.job || store.db.prepare('SELECT id FROM capture_jobs').get().id).data);
            row.token = 'another-worker';
            store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify(row), row.id);
        }
        tick?.();
        if (mode === 'wait' || mode === 'lease-lost')
            await delay(50, undefined, { signal: options.signal });
        if (mode === 'finish-conflict') {
            const row = JSON.parse(store.db.prepare('SELECT data FROM capture_jobs').get().data);
            row.token = 'different';
            store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify(row), row.id);
        }
        const run = store.run({ project: 'demo', title: 'Job review', captureIds: [capture.id] });
        return { run, exitCode: mode === 'partial' ? 1 : 0 };
    };
    const value = await moduleUnderTest('src/automation.mjs', { processOverrides: { versions: { node: versions } }, globals: { setInterval: fn => { tick = fn; return 1; }, clearInterval: () => { } }, mocks: { './capture.mjs': { resolveRevision: () => { if (revisionFailure)
                    throw Error('reference unavailable'); return 'commit'; }, captureRevision }, 'node:worker_threads': { Worker }, './automatic-plan.mjs': { automaticInput: path => ({ root: path, config: project ? { project: { id: 'demo', name: 'Demo' } } : {}, inputHash: 'frozen' }) }, 'node:timers/promises': { setTimeout: (ms, value, options) => delay(Math.min(ms, 10), value, options) } } });
    const act = (name, input = {}, context = {}) => value.exports.automationActions[name].run(f.store, input, context);
    return { ...f, ...value, act, file, get job() { return selectedJob; }, get tick() { return tick; }, failRevision() { revisionFailure = true; } };
}
test('task claims enforce revision, ownership, expiry, closure and bounded listing', async (t) => {
    const s = await services(t), capture = s.capture(), note = s.store.addNote({ capture: capture.id, text: 'Task' });
    assert.equal(s.act('tasks-list').total, 1);
    assert.equal(s.act('tasks-list', { project: 'other' }).total, 0);
    assert.equal(s.act('tasks-list', { status: 'submitted' }).total, 0);
    assert.throws(() => s.act('tasks-claim', { id: note.id, owner: 'a', expectedRevision: 0, seconds: 1 }), /30/);
    const claim = s.act('tasks-claim', { id: note.id, owner: 'a', expectedRevision: 0, seconds: 30 });
    assert.equal(s.act('tasks-list', { available: true }).tasks.length, 0);
    const renewed = s.act('tasks-claim', { id: note.id, owner: 'a', expectedRevision: claim.revision });
    assert.ok(renewed.revision > claim.revision);
    assert.throws(() => s.act('tasks-release', { id: note.id, owner: 'b', expectedRevision: renewed.revision }), /another/);
    const released = s.act('tasks-release', { id: note.id, owner: 'a', expectedRevision: renewed.revision });
    assert.equal(released.owner, null);
    s.store.updateNote({ id: note.id, status: 'wont-fix', resolution: 'Outside scope', expectedRevision: note.revision }, { human: true });
    assert.equal(s.act('tasks-list').total, 0);
    assert.throws(() => s.act('tasks-claim', { id: note.id, owner: 'a', expectedRevision: released.revision }), /closed/);
});
test('registry pagination and scoped evidence preserve query boundaries and region intersections', async (t) => {
    const s = await services(t), capture = s.capture();
    s.capture({ revision: 'second' });
    s.store.addNote({ capture: capture.id, text: 'Inside', point: { x: .2, y: .2 } });
    s.store.addNote({ capture: capture.id, text: 'Outside', region: { x: .8, y: .8, width: .1, height: .1 } });
    for (const collection of ['screens', 'captures', 'notes', 'runs', 'evidence', 'reviewSets'])
        for (const filters of [{}, { project: 'demo' }, { screen: 'demo/home' }, { capture: capture.id }])
            assert.ok(Array.isArray(s.act('registry-page', { collection, ...filters }).items));
    for (const input of [{ collection: 'bad' }, { collection: 'captures', limit: 0 }, { collection: 'captures', cursor: Buffer.from(JSON.stringify({ after: 0, until: 1, fingerprint: 'wrong' })).toString('base64url') }])
        assert.throws(() => s.act('registry-page', input));
    const scope = s.act('evidence-scoped', { capture: capture.id, region: { x: 0, y: 0, width: .5, height: .5 } });
    assert.equal(scope.notes.length, 1);
    assert.throws(() => s.act('evidence-scoped', {}), /Supply/);
    const handoff = s.act('tasks-handoff', { id: scope.notes[0].id });
    assert.equal(handoff.relatedNotes.length, 1);
});
test('local job workers checkpoint, publish completion, preserve failures and reject edits to completed jobs', async (t) => {
    for (const mode of ['success', 'failure', 'partial']) {
        const s = await services(t, { mode });
        assert.throws(() => s.act('jobs-enqueue', { repo: s.dir, config: s.file }), /execute/);
        const job = s.act('jobs-enqueue', { repo: s.dir, config: s.file, execute: 'yes', ref: 'HEAD', title: 'Capture' });
        assert.equal(s.act('jobs-list', { status: 'queued' }).length, 1);
        const service = s.exports.startAutomation(s.store, {});
        for (let i = 0; i < 100; i++) {
            const current = s.act('jobs-get', { id: job.id });
            if (['completed', 'failed'].includes(current.status))
                break;
            await delay(2);
        }
        const result = s.act('jobs-get', { id: job.id });
        assert.equal(result.status, mode === 'success' ? 'completed' : 'failed');
        assert.ok(s.act('jobs-events', { id: job.id, after: 0, limit: 100 }).length > 1);
        if (mode === 'success')
            assert.throws(() => s.act('jobs-change', { id: job.id, expectedRevision: result.revision, resume: true }), /immutable/);
        else {
            assert.throws(() => s.act('jobs-change', { id: job.id, expectedRevision: 0, resume: true }), /changed/);
            const cancelled = s.act('jobs-change', { id: job.id, expectedRevision: result.revision, resume: false });
            assert.equal(cancelled.status, 'cancelled');
        }
        await service.stop();
        const events = [];
        const stopped = await s.act('jobs-watch', { id: job.id, after: 0 }, { emit: event => events.push(event) });
        assert.ok(stopped.after);
    }
});
test('schedules enforce revisions, event triggers, backup destinations and execution authorization', async (t) => {
    const s = await services(t), destination = join(s.dir, 'backups');
    assert.throws(() => s.act('schedule-save', { expectedRevision: 0, everySeconds: 60 }), /execute/);
    assert.throws(() => s.act('schedule-save', { kind: 'backup', destination, execute: 'yes', expectedRevision: 0, everySeconds: 1 }), /interval/);
    assert.throws(() => s.act('schedule-save', { kind: 'backup', destination, execute: 'yes', expectedRevision: 0, everySeconds: 60, nextAt: 'bad' }), /nextAt/);
    const backup = s.act('schedule-save', { kind: 'backup', destination, execute: 'yes', expectedRevision: 0, everySeconds: 60, eventTypes: ['project.created'] });
    assert.ok(fs.existsSync(destination));
    const disabled = s.act('schedule-set-enabled', { id: backup.id, enabled: false, expectedRevision: backup.revision });
    assert.equal(disabled.enabled, false);
    const schedule = s.act('schedule-save', { id: backup.id, kind: 'backup', destination, execute: 'yes', expectedRevision: disabled.revision, everySeconds: 60, enabled: true });
    assert.ok(s.act('schedule-list').length);
    const service = s.exports.startAutomation(s.store, {});
    await delay(15);
    await service.stop();
    assert.ok(s.act('events-list', {}).length);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await s.act('events-watch', { types: ['other'] }, { signal: controller.signal, emit: () => { } }), undefined);
});
test('automatic thread failures, progress errors and frozen options stay visible in persistent jobs', async (t) => {
    for (const workerMode of ['error', 'exit', 'reported', 'success']) {
        const s = await services(t, { workerMode });
        const options = { path: s.dir, config: s.file };
        if (workerMode === 'success') {
            const result = await s.exports.runAutomaticJob(s.store, options);
            assert.equal(result.exitCode, 0);
            await assert.rejects(s.exports.runAutomaticJob(s.store, { resume: s.job.id, config: 'different' }), /frozen/);
        }
        else
            await assert.rejects(s.exports.runAutomaticJob(s.store, options), /thread|worker/);
    }
    const s = await services(t, { workerMode: 'success' });
    await assert.rejects(s.exports.runAutomaticJob(s.store, { path: s.dir, onEvent: () => { throw Error('progress failed'); } }), /progress failed/);
    const queued = await s.exports.runAutomaticJob(s.store, { path: s.dir, queue: 'yes', output: join(s.dir, 'new'), screens: ['home'] });
    assert.equal(queued.status, 'queued');
    const cancel = s.act('jobs-change', { id: queued.job, expectedRevision: s.act('jobs-get', { id: queued.job }).revision, resume: false });
    assert.equal(cancel.status, 'cancelled');
});
test('doctor reports installed runtime and occupied, free and timed-out ports', async (t) => {
    const { dir } = await fixture(t);
    for (const version of ['24.0.0', '22.22.2', '22.22.1', '20.0.0'])
        for (const outcome of ['connect', 'error', 'timeout']) {
            const value = await moduleUnderTest('src/automation.mjs', { processOverrides: { versions: { node: version } }, mocks: { './runtime.mjs': { ...runtime, bundledGit: { gitLocation: dir }, captureBrowser: async () => ({ executablePath: () => dir }) }, 'node:net': { createConnection: () => { const socket = new EventEmitter(); socket.destroy = () => { }; socket.setTimeout = (_ms, fn) => { queueMicrotask(() => outcome === 'timeout' ? fn() : socket.emit(outcome)); }; return socket; } } } });
            const result = await value.exports.automationActions.doctor.run({ directory: join(dir, 'future', 'registry') }, { port: 4800 });
            assert.equal(result.findings.find(item => item.name === 'node').ok, version === '24.0.0' || version === '22.22.2');
            assert.equal(result.findings.find(item => item.name === 'port').ok, outcome !== 'connect');
        }
});
test('capture schedules surface unavailable refs and job watchers continue until cancellation', async (t) => {
    const s = await services(t);
    const schedule = s.act('schedule-save', { repo: s.dir, config: s.file, execute: 'yes', expectedRevision: 0, everySeconds: 60 });
    s.failRevision();
    const service = s.exports.startAutomation(s.store, {});
    await delay(25);
    await service.stop();
    assert.ok(s.act('events-list', {}).some(event => event.type === 'schedule.failed'));
    const jobs = await services(t);
    const job = jobs.act('jobs-enqueue', { repo: jobs.dir, config: jobs.file, execute: 'yes' });
    const events = [];
    const watching = jobs.act('jobs-watch', { id: job.id }, { emit: event => events.push(event) });
    await delay(5);
    jobs.act('jobs-change', { id: job.id, expectedRevision: job.revision, resume: false });
    assert.equal((await watching).status, 'cancelled');
    assert.ok(events.length >= 2);
    for (let i = 0; i < 110; i++)
        jobs.store.event('test.event', { index: i });
    const controller = new AbortController();
    let count = 0;
    await jobs.act('events-watch', { types: ['test.event'] }, { signal: controller.signal, emit: () => { count++; if (count === 80)
            controller.abort(); } }).catch(error => assert.equal(error.name, 'AbortError'));
    assert.ok(count >= 80);
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 5);
    await assert.rejects(jobs.act('events-watch', { after: 1e9 }, { signal: stop.signal, emit: () => { } }).then(value => value), error => error.name === 'AbortError');
});
test('stopping a worker requeues interrupted exact-commit captures and supervision retries transient failures', async (t) => {
    const s = await services(t, { mode: 'wait' });
    const job = s.act('jobs-enqueue', { repo: s.dir, config: s.file, execute: 'yes' });
    const worker = s.exports.startAutomation(s.store, {});
    for (let i = 0; i < 30 && s.act('jobs-get', { id: job.id }).status !== 'running'; i++)
        await delay(1);
    await worker.stop();
    assert.equal(s.act('jobs-get', { id: job.id }).status, 'queued');
    const second = await services(t);
    let failed = false;
    const proxy = new Proxy(second.store, { get(target, key) { if (key === 'db')
            return new Proxy(target.db, { get(db, property) { if (property === 'prepare')
                    return sql => { if (!failed && sql.includes('capture_jobs ORDER')) {
                        failed = true;
                        throw Error('temporary database failure');
                    } return db.prepare(sql); }; return db[property]; } }); const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
    const service = second.exports.startAutomation(proxy, {});
    await delay(25);
    await service.stop();
    assert.ok(second.act('events-list').some(event => event.type === 'automation.failed'));
});
test('scoped run evidence and event schedules expose their terminal results', async (t) => {
    const s = await services(t), capture = s.capture(), run = s.store.run({ project: 'demo', title: 'Run', captureIds: [capture.id] });
    assert.equal(s.act('evidence-scoped', { run: run.id }).captures.length, 1);
    const events = s.act('schedule-save', { repo: s.dir, config: s.file, execute: 'yes', expectedRevision: 0, everySeconds: 60, nextAt: new Date(Date.now() + 60000).toISOString(), eventTypes: ['capture.created'] });
    s.capture({ revision: 'trigger' });
    s.store.event('capture.created', {});
    const service = s.exports.startAutomation(s.store, {});
    await delay(40);
    await service.stop();
    assert.ok(s.act('jobs-list').length);
    assert.ok(s.act('schedule-list')[0].revision > events.revision);
    const controller = new AbortController();
    controller.abort();
    assert.equal(await s.act('jobs-watch', { id: s.act('jobs-list')[0].id }, { signal: controller.signal }), undefined);
});
test('automatic resumes enforce frozen scalar options, active leases and expected revisions', async (t) => {
    const s = await services(t);
    const queued = await s.exports.runAutomaticJob(s.store, { path: s.dir, queue: 'yes', project: 'demo', screens: ['home'] });
    let job = s.act('jobs-get', { id: queued.job });
    await assert.rejects(s.exports.runAutomaticJob(s.store, { resume: job.id, project: 'changed' }), /frozen project/);
    const result = await s.exports.runAutomaticJob(s.store, { resume: job.id, project: 'demo', screens: ['home'], expectedRevision: String(job.revision) });
    assert.equal(result.exitCode, 0);
    job = s.act('jobs-get', { id: job.id });
    await assert.rejects(s.exports.runAutomaticJob(s.store, { resume: job.id }), /active worker/);
    job.leaseUntil = new Date(0).toISOString();
    s.store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
    assert.equal((await s.exports.runAutomaticJob(s.store, { resume: job.id })).exitCode, 0);
    const aborted = new AbortController();
    aborted.abort();
    const cancelled = await services(t, { workerMode: 'abort-fails' });
    assert.equal((await cancelled.exports.runAutomaticJob(cancelled.store, { path: cancelled.dir, signal: aborted.signal })).exitCode, 0);
    assert.equal(cancelled.act('jobs-list')[0].status, 'cancelled');
});
test('doctor reports registry access failures without trying to write into it', async (t) => {
    const { dir } = await fixture(t);
    const value = await moduleUnderTest('src/automation.mjs', { mocks: { 'node:fs': { ...fs, accessSync: () => { throw Error('permission denied'); } }, './runtime.mjs': { ...runtime, bundledGit: { gitLocation: dir }, captureBrowser: async () => ({ executablePath: () => dir }) } } });
    const report = await value.exports.automationActions.doctor.run({ directory: dir }, {});
    assert.equal(report.findings.find(row => row.name === 'registry').ok, false);
    const available = await services(t);
    const doctor = await available.act('doctor');
    assert.equal(doctor.findings.find(row => row.name === 'registry').ok, true);
});
test('capture workers stop when heartbeats lose ownership and expired jobs can be reclaimed', async (t) => {
    const s = await services(t, { mode: 'lease-lost' });
    const job = s.act('jobs-enqueue', { repo: s.dir, config: s.file, execute: 'yes' });
    const worker = s.exports.startAutomation(s.store, {});
    await delay(30);
    await worker.stop();
    assert.equal(s.act('jobs-get', { id: job.id }).token, 'another-worker');
    const expired = await services(t);
    const q = expired.act('jobs-enqueue', { repo: expired.dir, config: expired.file, execute: 'yes' });
    q.status = 'running';
    q.leaseUntil = new Date(0).toISOString();
    expired.store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify(q), q.id);
    const restarted = expired.exports.startAutomation(expired.store, {});
    await delay(30);
    await restarted.stop();
    assert.equal(expired.act('jobs-get', { id: q.id }).status, 'completed');
    const automatic = await services(t, { project: false, beforeResult: (store, job, tick) => { store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify({ ...job, token: 'other' }), job.id); tick(); }, workerMode: 'reported' });
    await assert.rejects(automatic.exports.runAutomaticJob(automatic.store, {}), /worker failed/);
});
test('schedule snapshots yield to another scheduler revision before running commands', async (t) => {
    const s = await services(t);
    s.act('schedule-save', { repo: s.dir, config: s.file, execute: 'yes', expectedRevision: 0, everySeconds: 60 });
    let changed = false;
    const proxy = new Proxy(s.store, { get(target, key) { if (key === 'db')
            return new Proxy(target.db, { get(db, prop) { if (prop === 'prepare')
                    return sql => { const statement = db.prepare(sql); if (sql === 'SELECT data FROM schedules')
                        return { all: () => { const rows = statement.all(); if (!changed) {
                                changed = true;
                                const value = JSON.parse(rows[0].data);
                                value.revision++;
                                value.enabled = false;
                                db.prepare('UPDATE schedules SET data=? WHERE id=?').run(JSON.stringify(value), value.id);
                            } return rows; } }; return statement; }; return db[prop]; } }); const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
    const service = s.exports.startAutomation(proxy, {});
    await delay(20);
    await service.stop();
    assert.equal(s.act('jobs-list').length, 0);
    assert.ok(changed);
});
test('automatic worker handles abort messages without a reason and closes its own store', async () => {
    let handler, closed = 0;
    const mod = await moduleUnderTest('src/automatic-worker.mjs', { mocks: { 'node:worker_threads': { parentPort: { on: (_name, fn) => handler = fn, postMessage() { }, close: () => closed++ }, workerData: { directory: 'unused', job: {} } }, './store.mjs': { Store: class {
                    close() { closed++; }
                } }, './automation.mjs': { executeAutomaticLease: async (_store, _job, signal) => { handler({ type: 'ignore' }); handler({ type: 'abort' }); assert.match(signal.reason.message, /Capture interrupted/); return {}; } } } });
    assert.equal(mod.error, undefined);
    assert.equal(closed, 2);
});
test('automatic failures report unavailable job storage after the worker exits', async (t) => {
    const s = await services(t, { workerMode: 'reported', beforeResult: store => store.close() });
    try {
        await assert.rejects(s.exports.runAutomaticJob(s.store, { path: s.dir }), /not open|closed/);
    }
    finally {
        s.store.db.open();
    }
});
test('automatic background workers requeue an attempt stopped before its result arrives', async (t) => {
    const s = await services(t);
    const queued = await s.exports.runAutomaticJob(s.store, { path: s.dir, queue: 'yes' });
    const worker = s.exports.startAutomation(s.store, {});
    await worker.stop();
    assert.equal(s.act('jobs-get', { id: queued.job }).status, 'queued');
});
test('automatic lease completion accepts an empty checkpoint record and isolates attempt output', async (t) => {
    const s = await services(t), queued = await s.exports.runAutomaticJob(s.store, { path: s.dir, queue: 'yes' });
    const job = s.act('jobs-get', { id: queued.job });
    job.status = 'running';
    job.token = 'token';
    job.leaseUntil = new Date(Date.now() + 60000).toISOString();
    job.attempts = 1;
    job.auto.options.output = join(s.dir, 'attempts');
    delete job.checkpoints;
    s.store.db.prepare('UPDATE capture_jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
    const mod = await moduleUnderTest('src/automation.mjs', { mocks: { './auto-capture.mjs': { captureAutomatic: async (_store, options) => { assert.ok(options.output.endsWith('attempt-1')); assert.equal(options.priorCheckpoints.length, 0); options.assertOwnership(); return { exitCode: 0, output: options.output, applications: [], scenarios: [], warnings: [] }; } } } });
    await mod.exports.executeAutomaticLease(s.store, job);
    assert.equal(s.act('jobs-get', { id: job.id }).status, 'completed');
});
test('background capture completion handles lost leases and transient state write failures', async (t) => {
    for (const mode of ['finish-conflict', 'finish-store-fails']) {
        const s = await services(t, { mode });
        const job = s.act('jobs-enqueue', { repo: s.dir, config: s.file, execute: 'yes' });
        const service = s.exports.startAutomation(s.store, {});
        await delay(25);
        await service.stop();
        assert.equal(s.act('jobs-get', { id: job.id }).status, 'running');
        if (mode === 'finish-store-fails')
            assert.ok(s.act('events-list').some(row => row.type === 'automation.failed' && row.error === 'write unavailable'));
    }
});
