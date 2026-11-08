import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fixture } from './support/registry.mjs';
import { runAutomaticJob, startAutomation } from '../src/automation.mjs';
import { runHeadless } from '../src/headless.mjs';
import { captureAutomatic } from '../src/auto-capture.mjs';
const action = (store, name, input = {}) => runHeadless(store, name, input, { cli: true });
test('automatic jobs retain ready evidence, retry failed states, resume cancellation and reject changed inputs', { timeout: 60000 }, async (t) => {
    const f = await fixture(t), root = join(f.dir, 'app'), file = join(f.dir, 'capture.json');
    fs.mkdirSync(root);
    fs.writeFileSync(join(root, 'index.html'), '<main>Static fixture</main>');
    let blocked = true;
    const server = createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(blocked && req.url === '/second' ? '<p>Loading</p>' : '<main>Ready</main>'); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
    const config = { version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', baseUrl: `http://127.0.0.1:${server.address().port}`, fixture: 'seed', fixtures: { independent: true }, variants: [{ device: 'desktop', width: 400, height: 300 }], ready: { selector: 'main', timeoutMs: 50 }, scenarios: [{ key: 'home', path: '/' }, { key: 'second', path: '/second' }] }] };
    fs.writeFileSync(file, JSON.stringify(config));
    const first = await runAutomaticJob(f.store, { path: root, config: file, output: join(f.dir, 'attempts') });
    assert.equal(first.exitCode, 1);
    assert.equal(first.run.captureIds.length, 2);
    blocked = false;
    const resumed = await runAutomaticJob(f.store, { resume: first.job });
    assert.equal(resumed.exitCode, 0);
    assert.equal(resumed.summary.reused, 1);
    const signal = new AbortController();
    const interrupted = await runAutomaticJob(f.store, { path: root, config: file, signal: signal.signal, onEvent: event => { if (event.type === 'capture.completed')
            signal.abort(Error('interrupt')); } });
    assert.equal(interrupted.exitCode, 1);
    assert.equal((await action(f.store, 'jobs-get', { id: interrupted.job })).status, 'cancelled');
    const recovered = await runAutomaticJob(f.store, { resume: interrupted.job });
    assert.equal(recovered.exitCode, 0);
    assert.ok(recovered.summary.reused);
    await assert.rejects(runAutomaticJob(f.store, { resume: recovered.job, path: join(root, 'different') }), /frozen path/);
    blocked = true;
    const failed = await runAutomaticJob(f.store, { path: root, config: file });
    fs.writeFileSync(join(root, 'changed.txt'), 'changed source');
    const changed = await runAutomaticJob(f.store, { resume: failed.job });
    assert.match(changed.error, /inputs changed/);
    const invalid = await runAutomaticJob(f.store, { path: root, config: file, queue: 'yes' });
    fs.writeFileSync(file, 'invalid JSON');
    await assert.rejects(runAutomaticJob(f.store, { resume: invalid.job }), /JSON|Unexpected/);
    fs.writeFileSync(file, JSON.stringify(config));
    const queued = await runAutomaticJob(f.store, { path: root, config: file, queue: 'yes', screens: ['home'] });
    assert.equal(queued.status, 'queued');
    const automation = startAutomation(f.store, {});
    t.after(() => automation.stop());
    for (let i = 0; i < 200; i++) {
        const job = await action(f.store, 'jobs-get', { id: queued.job });
        if (job.status === 'completed') {
            assert.equal(job.captures.length, 1);
            break;
        }
        assert.notEqual(job.status, 'failed', job.error);
        await new Promise(done => setTimeout(done, 50));
        if (i === 199)
            assert.fail('queued job did not complete');
    }
    await automation.stop();
});
test('automatic static server creates fresh captures and stores a missing-state diagnostic', { timeout: 20000 }, async (t) => {
    const f = await fixture(t), root = join(f.dir, 'static');
    fs.mkdirSync(root);
    fs.writeFileSync(join(root, 'index.html'), '<main>Static capture</main>');
    fs.writeFileSync(join(root, 'page.html'), '<main>Page capture</main>');
    const file = join(f.dir, 'static.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', ready: 'main', settleMs: 0, variants: [{ device: 'desktop', width: 400, height: 300 }], scenarios: [{ key: 'home', path: '/' }, { key: 'page', path: '/page.html' }, { key: 'missing', path: '/missing', ready: { selector: 'main', timeoutMs: 30 }, expectedStatus: 404 }] }] }));
    const report = await captureAutomatic(f.store, { path: root, config: file, execute: 'yes' });
    assert.equal(report.status, 'partial');
    assert.equal(report.run.captureIds.length, 3);
    assert.equal(report.scenarios.filter(item => item.readiness.status === 'passed').length, 2);
});
test('static capture servers reject external symlinks and serve unknown asset types as binary', async (t) => {
    const f = await fixture(t), root = join(f.dir, 'static');
    fs.mkdirSync(root);
    fs.writeFileSync(join(f.dir, 'outside'), 'private');
    fs.symlinkSync(join(f.dir, 'outside'), join(root, 'escape'));
    fs.writeFileSync(join(root, 'asset.dat'), 'binary');
    fs.writeFileSync(join(root, 'index.html'), `<main>Loading</main><script>Promise.all([fetch('/escape'),fetch('/asset.dat')]).then(([a,b])=>document.querySelector('main').textContent=a.status+' '+b.headers.get('content-type'))</script>`);
    const file = join(f.dir, 'capture.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', settleMs: 0, ready: { text: '403 application/octet-stream' }, variants: [{ device: 'desktop', width: 400, height: 300 }], scenarios: [{ key: 'home', path: '/' }] }] }));
    const result = await captureAutomatic(f.store, { path: root, config: file, execute: 'yes' });
    assert.equal(result.exitCode, 0, JSON.stringify(result));
});
