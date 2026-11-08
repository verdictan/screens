import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
async function cli(t, argv, { aborted = false, failure = false, defaultHome = false } = {}) {
    const { dir } = await fixture(t);
    let stdout = '', stderr = '', closed = 0;
    const signals = {}, calls = [];
    const properties = { count: { type: 'integer' }, ratio: { type: 'number' }, enabled: { type: 'boolean' }, filters: { type: 'array' }, nested: { type: 'object' }, nullable: { type: ['string', 'null'] }, choice: { enum: ['one', 'two'] }, execute: { const: 'yes' } };
    const descriptor = { inputSchema: { properties } };
    const result = await moduleUnderTest('src/cli.mjs', { argv, env: { SCREENS_HOME: defaultHome ? '' : dir }, processOverrides: { stdout: { write: bytes => { stdout += bytes; } }, stderr: { write: bytes => { stderr += bytes; } }, once: (name, fn) => signals[name] = fn, removeListener: () => { } }, mocks: {
            './store.mjs': { Store: class {
                    constructor(directory) { this.directory = directory; }
                    close() { closed++; }
                } },
            './headless.mjs': { headlessActions: { exercise: descriptor, 'capture-run': descriptor, doctor: { run: async (_store, input) => ({ input, ok: true }) } }, actionCatalog: () => [{ name: 'exercise' }], runHeadless: async (_store, name, input, context) => { calls.push({ name, input }); context.emit({ type: 'progress' }); if (aborted) {
                    signals.SIGINT();
                    throw Error('stopped');
                } if (failure)
                    throw Error('action failed'); return { input, exitCode: 0 }; } },
            './automatic-plan.mjs': { draftAutomaticPlan: () => ({ version: 1, configuration: {}, choices: [], decisions: [{ blocking: true }], discovery: { backlog: [] } }) },
            './discovery.mjs': { detectProject: () => ({ applications: [], execution: 'not-run' }) },
            './automation.mjs': { startAutomation: () => { }, runAutomaticJob: async (_store, input) => { calls.push(input); input.onEvent({ type: 'capture.started' }); signals.SIGTERM(); return { status: 'queued', job: 'job', exitCode: 0 }; } },
        } });
    for (let i = 0; i < 30 && !stdout && !result.errors.length; i++)
        await new Promise(done => setImmediate(done));
    return { ...result, stdout, stderr, calls, closed };
}
test('CLI action input parses typed flags and overrides JSON input without losing registry settings', async (t) => {
    const { dir } = await fixture(t), input = join(dir, 'input.json');
    fs.writeFileSync(input, JSON.stringify({ count: 1, choice: 'one' }));
    const result = await cli(t, ['exercise', '--input', input, '--count', '2', '--ratio', '0.5', '--enabled', 'false', '--filters', '["a"]', '--nested', '{"value":1}', '--nullable', 'null', '--choice', 'two']);
    assert.equal(result.process.exitCode, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0].input)), { count: 2, choice: 'two', ratio: .5, enabled: false, filters: ['a'], nested: { value: 1 }, nullable: null });
    assert.equal(result.closed, 1);
    const unknown = await cli(t, ['exercise', '--unknown', 'value']);
    assert.equal(unknown.process.exitCode, 1);
    assert.match(unknown.errors[0], /Unknown option/);
    const stream = await cli(t, ['capture-run', '--execute', 'yes']);
    assert.match(stream.stdout, /"type":"result"/);
    assert.match(stream.stdout, /progress/);
    const cancelled = await cli(t, ['capture-run'], { aborted: true });
    assert.equal(cancelled.process.exitCode, 130);
});
test('CLI drafts, detection, schema lookup and doctor do not execute app captures', async (t) => {
    const { dir } = await fixture(t), output = join(dir, 'draft.json');
    const drafted = await cli(t, ['capture-draft', 'project', '--output', output]);
    assert.equal(JSON.parse(drafted.stdout).blockers, 1);
    assert.equal(JSON.parse(fs.readFileSync(output)).version, 1);
    assert.equal(JSON.parse((await cli(t, ['capture-draft'])).stdout).version, 1);
    assert.equal(JSON.parse((await cli(t, ['detect'])).stdout).execution, 'not-run');
    assert.equal(JSON.parse((await cli(t, ['headless-help', 'exercise'])).stdout).name, 'exercise');
    assert.ok(JSON.parse((await cli(t, ['headless-help', 'missing'])).stdout).error);
    assert.ok(Array.isArray(JSON.parse((await cli(t, ['headless-help'])).stdout)));
    assert.equal(JSON.parse((await cli(t, ['doctor'])).stdout).ok, true);
});
test('CLI automatic capture forwards selection, progress and explicit resume to the job service', async (t) => {
    for (const argv of [['capture-auto', '.', '--screens', '["home"]', '--format', 'json'], ['capture-auto', '--resume', 'job'], ['load', '.', '--capture', 'yes']]) {
        const result = await cli(t, argv);
        assert.equal(result.process.exitCode, 0);
        assert.match(result.stderr, /capture.started/);
        assert.equal(result.calls.length, 1);
        if (argv.includes('--screens'))
            assert.deepEqual(JSON.parse(JSON.stringify(result.calls[0].screens)), ['home']);
    }
});
test('CLI uses the default data directory and reports non-cancellation action failures', async (t) => {
    const home = await cli(t, ['doctor'], { defaultHome: true });
    assert.equal(JSON.parse(home.stdout).ok, true);
    const failure = await cli(t, ['exercise'], { failure: true });
    assert.equal(failure.process.exitCode, 1);
    assert.match(failure.errors[0], /action failed/);
    assert.equal((await cli(t, ['capture-auto'])).process.exitCode, 0);
});
