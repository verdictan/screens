import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
import { expandCaptureConfig } from '../src/capture-recipe.mjs';
async function browserAdapter(t, { script = 'vite', manager, lock, mode = 'ok', platform = 'darwin', rootPatch = {}, appPatch = {}, options = {}, detected, readinessAssets = [], rawRoutes, seed } = {}) {
    const f = await fixture(t), calls = [], root = f.dir;
    if (seed)
        await seed(f);
    if (script !== null)
        fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: script === 'absent' ? {} : mode === 'start-script' ? { start: script } : { dev: script }, ...(manager ? { packageManager: manager } : {}) }));
    if (lock)
        fs.writeFileSync(join(root, lock), 'lock');
    fs.writeFileSync(join(root, 'record.har'), '{}');
    let location, listener;
    const page = { addInitScript: async (fn, input) => fn(input), on: (_name, fn) => { listener = fn; }, goto: async (url) => { location = mode === 'redirect' ? 'http://127.0.0.1/other' : url; if (mode === 'page-error')
            listener?.(Error('page failed')); return mode === 'no-response' ? null : { status: () => mode === 'http-error' ? 500 : 200 }; }, url: () => location, evaluate: async (fn, input) => fn(input), waitForTimeout: async () => { }, screenshot: async () => { if (mode === 'image-fails')
            throw Error('image failed'); return f.bytes; } };
    const session = { newPage: async () => page, close: async () => { } };
    const browser = { version: () => 'fixture-browser', newContext: async (value) => { if (mode === 'context-fails')
            throw Error('context failed'); calls.push(['context', value]); return session; }, close: async () => { } };
    const command = async (args, ctx) => { calls.push(args); ctx.log('command log'); if (mode === 'teardown-fails' && args[0] === 'fixture-close')
        throw Error('fixture cleanup failed'); };
    const launch = (args, cwd, env, log) => { calls.push(args); log('startup log'); const child = new EventEmitter(); Object.assign(child, { pid: 1, exitCode: null, signalCode: null }); return child; };
    const config = expandCaptureConfig({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', fixture: 'seed', variants: [{ device: 'desktop', width: 400, height: 300 }], scenarios: [{ key: 'home', path: '/', ready: 'main' }], settleMs: 0, ...appPatch }], ...rootPatch });
    const detection = { applications: detected || [{ path: '.', kind: 'web', frameworks: ['React'], routes: [] }], recipes: [], warnings: [], nativeContract: null, assets: { environment: [], readiness: readinessAssets, scenarios: [], fixtures: [] }, inventory: { items: [], relationships: [], limitations: [] } };
    const input = { root, config, detection, inputHash: 'source' };
    const module = await moduleUnderTest('src/auto-capture.mjs', { platform, globals: { fetch: async () => ({ status: 200 }), window: {}, getComputedStyle: () => ({ fontSize: "16px" }), document: { documentElement: { style: {} }, getAnimations: () => [{ pause() { } }], fonts: { ready: Promise.resolve() } } }, mocks: { './automatic-plan.mjs': { automaticInput: () => input, identityHash: value => JSON.stringify(value) }, './runtime.mjs': { gitOutput: () => { if (mode === 'no-git')
                    throw Error('not a repository'); return 'commit'; }, captureBrowser: async () => ({ launch: async () => browser }) }, './capture-process.mjs': { launch, command, stop: async () => { if (mode === 'stop-fails')
                    throw Error('stop failed'); } }, './capture-scenarios.mjs': { prepareBrowserPage: async () => { }, authenticate: async () => mode === 'auth' ? { storageState: async () => ({ cookies: [] }), captureHeaders: { Authorization: 'Bearer fixture' }, close: async () => { } } : undefined, performSteps: async () => { }, scenarioReadiness: (app, scenario) => ({ ...app.ready, ...(typeof scenario.ready === 'string' ? { selector: scenario.ready } : scenario.ready) }), readiness: async () => ({ status: mode === 'unverified' ? 'unverified' : 'passed' }), resolveScenarios: async (app) => ({ routes: rawRoutes || app.scenarios, issues: [] }) }, './evidence-tools.mjs': { startBrowserEvidence: () => ({ collect: async () => ({}), dispose: () => { } }), attachBrowserEvidence: async () => { } } } });
    const report = await module.exports.captureAutomatic(f.store, { execute: 'yes', output: join(root, 'output'), ...options });
    return { ...f, report, calls, module, input };
}
test('browser adapter infers supported startup interfaces and package managers', async (t) => {
    for (const script of ['next dev', 'vite', 'astro dev', 'nuxt dev', 'nuxi dev', 'ng serve', 'react-scripts start']) {
        const result = await browserAdapter(t, { script });
        assert.equal(result.report.exitCode, 0, JSON.stringify(result.report));
        assert.equal(result.calls.find(args => args[0] === 'npm')[1], 'run');
    }
    for (const [manager, lock, platform, expected] of [['pnpm@9', null, 'darwin', 'pnpm'], ['bun@1', null, 'win32', 'bun.cmd'], [null, 'pnpm-lock.yaml', 'darwin', 'pnpm'], [null, 'yarn.lock', 'darwin', 'yarn']]) {
        const result = await browserAdapter(t, { manager, lock, platform });
        assert.equal(result.report.exitCode, 0, JSON.stringify(result.report));
        assert.ok(result.calls.some(args => args[0] === expected));
    }
    for (const [script, manager, pattern] of [[null, null, /No start command/], ['absent', null, /No dev or start/], ['custom serve', null, /known port/], ['vite', 'other@1', /Unsupported package/]]) {
        const result = await browserAdapter(t, { script, manager });
        assert.equal(result.report.exitCode, 1);
        assert.match(result.report.applications[0].issues.join(' '), pattern);
    }
    assert.equal((await browserAdapter(t, { script: 'vite', mode: 'start-script' })).report.exitCode, 0);
});
test('browser adapters retain diagnostics for navigation, page and image failures', async (t) => {
    for (const mode of ['http-error', 'redirect', 'page-error', 'image-fails', 'unverified', 'no-response', 'context-fails']) {
        const result = await browserAdapter(t, { mode });
        assert.equal(result.report.exitCode, 1);
        assert.equal(result.report.status, ['image-fails', 'context-fails'].includes(mode) ? 'failed' : 'partial', JSON.stringify(result.report));
    }
    const auth = await browserAdapter(t, { mode: 'auth', appPatch: { baseUrl: 'http://fixture', storageState: 'state.json', animationTime: 0, network: { har: 'record.har', origin: 'http://fixture' }, prepare: [['prepare']] } });
    assert.equal(auth.report.exitCode, 0, JSON.stringify(auth.report));
    assert.ok(auth.calls.find(args => args[0] === 'context')[1].extraHTTPHeaders);
    const alternate = await browserAdapter(t, { appPatch: { baseUrl: 'http://fixture', scenarios: [{ path: '/', auth: false, expectedPath: '/', allowPageErrors: true }] }, mode: 'page-error' });
    assert.equal(alternate.report.exitCode, 0);
    const invalid = await browserAdapter(t, { appPatch: { baseUrl: 'file:///project' } });
    assert.match(invalid.report.applications[0].issues[0], /HTTP/);
    const outside = await browserAdapter(t, { appPatch: { baseUrl: 'http://fixture', scenarios: [{ key: 'outside', path: '//outside/' }] } });
    assert.match(outside.report.applications[0].issues[0], /outside/);
});
test('capture planning reports empty scope, changed inputs, cancelled work and invalid URL selection', async (t) => {
    const empty = await browserAdapter(t, { rootPatch: { applications: [] }, detected: [] });
    assert.equal(empty.report.status, 'failed');
    assert.match(empty.report.warnings.join(' '), /No applications/);
    const changed = await browserAdapter(t, { options: { expectedInputHash: 'changed' } });
    assert.match(changed.report.error, /inputs changed/);
    const stopped = new AbortController();
    stopped.abort();
    const aborted = await browserAdapter(t, { options: { signal: stopped.signal } });
    assert.equal(aborted.report.exitCode, 1);
    const named = await browserAdapter(t, { rootPatch: { project: undefined }, options: { name: 'Named app', project: 'named' }, appPatch: { adapter: 'unknown' } });
    assert.equal(named.report.project.name, 'Named app');
    const two = await browserAdapter(t, { rootPatch: { applications: [{ path: '.', adapter: 'browser' }, { path: 'other', adapter: 'browser' }] }, options: { url: 'http://fixture' } });
    assert.match(two.report.error, /one browser/);
    const known = await browserAdapter(t, { rootPatch: { scope: 'discovered', applications: [] }, mode: 'no-git' });
    assert.equal(known.report.exitCode, 0, JSON.stringify(known.report));
    const fixture = await browserAdapter(t, { rootPatch: { setup: [['setup']], fixtures: { setup: [['fixture-setup']], teardown: [['fixture-close']] } } });
    assert.equal(fixture.report.exitCode, 0);
    const override = await browserAdapter(t, { options: { url: 'http://fixture' }, appPatch: { variants: [{ device: 'desktop', width: 400, height: 300, textScale: 2 }] } });
    assert.equal(override.report.exitCode, 0);
    const selected = await browserAdapter(t, { rootPatch: { selection: { scenarios: ['missing'] } } });
    assert.equal(selected.report.exitCode, 1);
    const denied = await browserAdapter(t);
    await assert.rejects(denied.module.exports.captureAutomatic(denied.store, { path: denied.dir }), /execute/);
    await assert.rejects(denied.module.exports.captureAutomatic(denied.store, { execute: 'yes', output: denied.report.output }), /new directory/);
});
test('capture cleanup errors and empty unselected applications remain separate outcomes', async (t) => {
    const cleanup = await browserAdapter(t, { mode: 'teardown-fails', rootPatch: { fixtures: { teardown: [['fixture-close']] } } });
    assert.equal(cleanup.report.status, 'partial');
    assert.match(cleanup.report.fixtureErrors[0], /cleanup failed/);
    for (const selected of [false, true]) {
        const result = await browserAdapter(t, { rootPatch: { ...(selected ? { selection: { scenarios: ['home'] } } : {}), applications: [{ path: '.', adapter: 'browser', baseUrl: 'http://fixture', ready: 'main', scenarios: [{ key: 'home', path: '/' }] }, { path: 'other', adapter: 'browser', baseUrl: 'http://fixture', scenarios: [] }] } });
        assert.equal(result.report.applications[1].status, selected ? 'not-selected' : 'empty');
        assert.equal(result.report.status, selected ? 'captured' : 'partial');
    }
});
test('browser routes honor unresolved IDs, callbacks, disk authentication and explicit readiness contracts', async (t) => {
    let callbacks = 0;
    const result = await browserAdapter(t, { readinessAssets: [{ application: '.' }], appPatch: { baseUrl: 'http://fixture', storageState: 'state.json', determinism: { timezone: 'Europe/Madrid' }, animationTime: 0, network: { har: 'record.har' } }, rawRoutes: [{ path: '/', beforeGoto: async () => callbacks++, afterLoad: async () => callbacks++ }, { path: '/records/[id]', requiresParameters: true }] });
    assert.equal(result.report.scenarios.length, 1);
    assert.equal(callbacks, 2);
    assert.match(result.report.applications[0].issues.join(' '), /concrete/);
    assert.ok(result.calls.find(args => args[0] === 'context')[1].storageState.endsWith('state.json'));
});
test('browser checkpoint reuse reports missing assets and does not hide other storage errors', async (t) => {
    const checkpoints = [], route = { path: '/', readOnly: true };
    const first = await browserAdapter(t, { rawRoutes: [route], options: { onCheckpoint: value => checkpoints.push(value) } });
    const seed = async (f, mode) => { for (const id of first.report.run.captureIds) {
        const capture = first.store.getCapture(id);
        f.store.screen({ project: 'demo', key: capture.screen.slice(5), title: capture.screen });
        f.store.capture({ ...capture, bytes: first.store.image(id).bytes });
    } if (mode)
        f.store.image = () => { throw Object.assign(Error(mode), { code: mode }); }; };
    const reused = await browserAdapter(t, { rawRoutes: [route], options: { priorCheckpoints: checkpoints }, seed: f => seed(f) });
    assert.equal(reused.report.summary.reused, 1);
    for (const mode of ['ENOENT', 'EIO']) {
        const result = await browserAdapter(t, { rawRoutes: [route], options: { priorCheckpoints: checkpoints }, seed: f => seed(f, mode) });
        if (mode === 'ENOENT')
            assert.equal(result.report.summary.reused, 0);
        else
            assert.match(result.report.applications[0].issues.join(' '), /EIO/);
    }
    const cleanup = await browserAdapter(t, { mode: 'stop-fails', rootPatch: { services: [{ name: 'api', command: ['service'], ready: { url: 'data:text/plain,ready' } }] } });
    assert.ok(cleanup.report.environment.cleanupErrors.length);
});
test('discovered web applications without a route list use a root launch probe', async (t) => {
    const result = await browserAdapter(t, { rootPatch: { scope: 'discovered', applications: [] }, detected: [{ path: '.', kind: 'web', frameworks: ['React'] }] });
    assert.equal(result.report.exitCode, 0);
});
