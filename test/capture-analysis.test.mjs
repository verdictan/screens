import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, basename } from 'node:path';
import sharp from 'sharp';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
async function analysis(t, mode = 'changed') {
    const f = await fixture(t), dark = await sharp({ create: { width: mode === 'dimensions' ? 3 : 2, height: 2, channels: 4, background: 'black' } }).png().toBuffer();
    let number = 0;
    f.store.screen({ project: 'demo', key: 'other', title: 'Other' });
    const gitOutput = (_repo, args) => {
        if (args[0] === 'show' && args.includes('--format=%P'))
            return 'parent-a parent-b';
        if (args[0] === 'rev-list')
            return args.includes('--reverse') ? (mode === 'no-history' ? '' : 'c1\nc2\nc3') : mode === 'off-chain' ? 'c1\nc2\nc3' : 'c0\nc1\nc2\nc3';
        if (args[0] === 'merge-base')
            return '';
        if (args[0] === 'diff')
            return mode === 'no-changes' ? '' : 'src/value.js\0package.json\0';
        if (args[0] === 'ls-tree')
            return ['package.json', 'tsconfig.json', 'src/value.js', 'src/Page.jsx', 'src/routes.js', 'src/app/home/page.jsx', 'src/app/(group)/page.jsx', 'src/pages/other.jsx', 'src/routes/detail/+page.svelte'].join('\0');
        if (args[0] === 'show') {
            const file = args.at(-1).split(':').slice(1).join(':');
            return { 'package.json': JSON.stringify({ name: 'demo', dependencies: { shared: '1' } }), 'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['src/*'] } } }), 'src/Page.jsx': "import {value} from '@/value'; export * from './value.js'; const lazy=import('./value.js'); require('./value.js');", 'src/value.js': 'export const value=1;', 'src/routes.js': "const routes=[{path:'/literal'},{path:'//outside'}]" }[file] || '';
        }
        throw Error('Unexpected Git call ' + args.join(' '));
    };
    const captureRevision = async (store, options) => {
        fs.mkdirSync(options.output, { recursive: true });
        number++;
        const changed = mode === 'stable' ? false : options.ref === 'c0' ? false : options.ref === 'c1' ? false : options.ref === 'c2' || options.ref === 'c3' ? true : number > 1;
        const capture = store.capture({ screen: mode === 'missing' && number > 1 ? 'demo/other' : 'demo/home', role: 'pr', bytes: changed ? dark : f.bytes, fixture: 'seed', revision: options.ref || 'revision' });
        return { run: store.run({ project: 'demo', title: 'Capture', captureIds: [capture.id] }), received: options };
    };
    const value = await moduleUnderTest('src/capture-tools.mjs', { mocks: { './runtime.mjs': { gitOutput }, './capture.mjs': { captureRevision, resolveRevision: (_repo, ref) => ref || 'c0' } } });
    const file = join(f.dir, 'capture.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', serve: ['node', 'app.mjs'], variants: [{ device: 'desktop', width: 400, height: 300 }], scenarios: [{ key: 'home', path: '/', source: 'src/Page.jsx' }] }] }));
    return { ...f, ...value, file, input: { repo: f.dir, config: file, ref: 'revision', execute: 'yes' }, get number() { return number; } };
}
test('repeatability preserves pixel bounds, missing captures and immutable evidence', async (t) => {
    for (const mode of ['changed', 'stable', 'missing', 'dimensions']) {
        const s = await analysis(t, mode);
        const result = await s.exports.captureRepeatability(s.store, { ...s.input, count: 2, output: join(s.dir, 'repeat') });
        assert.equal(result.stable, mode === 'stable');
        assert.equal(result.results.length, 1);
        if (mode === 'changed')
            assert.deepEqual(JSON.parse(JSON.stringify(result.results[0].comparisons[0].changedBounds)), { x: 0, y: 0, width: 2, height: 2 });
    }
    const s = await analysis(t);
    await assert.rejects(s.exports.captureRepeatability(s.store, { ...s.input, execute: 'no' }), /execute/);
    await assert.rejects(s.exports.captureRepeatability(s.store, { ...s.input, count: 1 }), /two/);
});
test('regression search finds monotonic and scanned crossings and records supplied merge parents', async (t) => {
    for (const mode of ['changed', 'stable', 'missing', 'dimensions', 'no-history'])
        for (const search of ['bisect', 'scan']) {
            const s = await analysis(t, mode);
            const result = await s.exports.captureBisect(s.store, { ...s.input, base: 'c0', head: 'c3', mode: search, output: join(s.dir, 'bisect') });
            assert.equal(result.firstCrossing, mode === 'stable' || mode === 'no-history' ? null : mode === 'missing' ? 'c1' : 'c2');
            assert.ok(result.baselineRun);
        }
    const s = await analysis(t);
    for (const maxChangedRatio of [-1, 2, NaN])
        await assert.rejects(s.exports.captureBisect(s.store, { ...s.input, base: 'c0', head: 'c3', maxChangedRatio, output: join(s.dir, 'invalid') }), /between/);
    const off = await analysis(t, 'off-chain');
    await assert.rejects(off.exports.captureBisect(off.store, { ...off.input, base: 'c0', head: 'c3' }), /first-parent/);
    const merged = await s.exports.captureMerge(s.store, { ...s.input, output: join(s.dir, 'merge') });
    assert.equal(merged.mergeCandidate.parents.length, 2);
    await assert.rejects(s.exports.captureMerge(s.store, { ...s.input, execute: 'no' }), /execute/);
});
test('capture analysis uses static route proposals and source dependencies before selecting captures', async (t) => {
    const s = await analysis(t);
    const routes = s.exports.discoverRoutes({ repo: s.dir, roots: ['src'], output: join(s.dir, 'routes.json') });
    assert.ok(routes.screens.some(item => item.path === '/literal'));
    assert.equal(routes.screens.some(item => item.path === '//outside'), false);
    const affected = s.exports.affectedScreens({ ...s.input, base: 'c0', head: 'c3', output: join(s.dir, 'affected.json') });
    assert.equal(affected.screenKeys[0], 'home');
    const changed = await s.exports.captureActions['capture-changed'].run(s.store, { ...s.input, base: 'c0', head: 'c3', output: join(s.dir, 'selected') }, {});
    assert.equal(changed.captured, true);
    const empty = await analysis(t, 'no-changes');
    const none = await empty.exports.captureActions['capture-changed'].run(empty.store, { ...empty.input, base: 'c0', head: 'c0', output: join(empty.dir, 'none') }, {});
    assert.equal(none.captured, false);
    const plan = s.exports.captureActions['capture-config-diagnose'].run(s.store, { config: s.file });
    assert.equal(plan.valid, true);
});
test('isolated capture failures retain checkout logs and remove temporary workspaces', async (t) => {
    const { dir, store } = await fixture(t), file = join(dir, 'recipe.json');
    fs.writeFileSync(file, JSON.stringify({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [{ path: '.', adapter: 'browser', serve: ['node', 'app.mjs'], scenarios: [{ key: 'home', path: '/' }] }] }));
    for (const existingLog of [false, true]) {
        const output = join(dir, existingLog ? 'existing-log' : 'new-log');
        const mod = await moduleUnderTest('src/capture.mjs', { mocks: { './runtime.mjs': { gitOutput: () => 'commit-sha' }, './capture-process.mjs': { command: async (_args, context) => { context.log('Checkout failed'); if (existingLog) {
                        fs.mkdirSync(output);
                        fs.writeFileSync(join(output, 'capture.log'), 'Retained');
                    } throw Error('cannot checkout'); } }, './auto-capture.mjs': { executeCaptureRecipe: () => { } }, './automatic-plan.mjs': { automaticInput: () => ({}) } } });
        await assert.rejects(mod.exports.captureRevision(store, { repo: dir, ref: 'HEAD', config: file, output, execute: 'yes' }), /cannot checkout/);
        assert.equal(fs.readFileSync(join(output, 'capture.log'), 'utf8'), existingLog ? 'Retained' : 'Checkout failed');
    }
});
test('workspace changes flow through dependency packages and exact or suffix aliases', async (t) => {
    const { dir } = await fixture(t);
    const sources = { 'package.json': '{}', 'tsconfig.json': '{}', 'packages/shared/package.json': JSON.stringify({ name: '@app/shared' }), 'packages/other/package.json': JSON.stringify({ name: 'other' }), 'packages/ui/package.json': JSON.stringify({ name: 'ui', dependencies: { '@app/shared': '*' } }), 'packages/shared/value.js': 'export const value=1;', 'packages/ui/App.jsx': `import {value} from '@app/shared';import a from 'exact';import b from '@/value.end';import c from 'absent';`, 'packages/ui/Other.jsx': `import a from 'other';` };
    const file = join(dir, 'workspace.json');
    const config = { version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, sourceAliases: { exact: 'packages/shared/value.js', '@/*.end': ['packages/shared/*.js'] }, applications: [{ path: 'packages/ui', adapter: 'browser', scenarios: [{ key: 'linked', path: '/', source: 'App.jsx' }, { key: 'workspace', path: '/workspace', source: 'NotImported.jsx' }, { key: 'unmapped', path: '/unmapped' }] }] };
    fs.writeFileSync(file, JSON.stringify(config));
    const mod = await moduleUnderTest('src/capture-tools.mjs', { mocks: { './runtime.mjs': { gitOutput: (_root, args) => args[0] === 'diff' ? 'packages/shared/value.js\0' : args[0] === 'ls-tree' ? Object.keys(sources).join('\0') : sources[args.at(-1).split(':').slice(1).join(':')] || '' }, './capture.mjs': { resolveRevision: (_root, ref) => ref, captureRevision: async () => { } } } });
    const input = { repo: dir, config: file, base: 'base' };
    const result = mod.exports.affectedScreens(input);
    assert.equal(result.screens.find(row => row.key === 'packages/ui/linked').reason, 'source-dependency');
    assert.equal(result.screens.find(row => row.key === 'packages/ui/workspace').reason, 'workspace-dependency');
    assert.equal(result.screens.find(row => row.key === 'packages/ui/unmapped').reason, 'unmapped-screen');
    config.sharedSources = ['packages/**'];
    fs.writeFileSync(file, JSON.stringify(config));
    assert.equal(mod.exports.affectedScreens(input).screens[0].reason, 'shared-source');
    const plan = mod.exports.planCaptures({ config: file });
    assert.equal(plan.jobs.length, 9);
    config.scope = 'discovered';
    config.applications = [{ path: '.', adapter: 'command', command: ['capture'] }];
    fs.writeFileSync(file, JSON.stringify(config));
    assert.equal(mod.exports.planCaptures({ config: file }).jobs.length, 0);
    config.applications[0].scenarios = [{ key: 'one' }];
    fs.writeFileSync(file, JSON.stringify(config));
    assert.equal(mod.exports.planCaptures({ config: file }).jobs.length, 0);
});
test('default repeatability count and bisect mode preserve unmeasurable size differences', async (t) => {
    const s = await analysis(t, 'stable');
    const result = await s.exports.captureRepeatability(s.store, { ...s.input, output: join(s.dir, 'default-count') });
    assert.equal(result.count, 3);
    const b = await analysis(t);
    assert.equal((await b.exports.captureBisect(b.store, { ...b.input, base: 'c0', head: 'c3', output: join(b.dir, 'default-mode') })).mode, 'bisect');
    const token = await moduleUnderTest('src/capture.mjs', { env: { GITHUB_TOKEN: 'test-token' }, globals: { fetch: async (_url, options) => { assert.equal(options.headers.Authorization, 'Bearer test-token'); return { ok: true, json: async () => ({ base: { sha: 'base' }, head: { sha: 'head', repo: { full_name: 'sample/repo' } }, merge_base_commit: { sha: 'base' } }) }; } } });
    assert.equal((await token.exports.resolvePullRequest('sample/repo', 1)).head, 'head');
});
