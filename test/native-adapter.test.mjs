import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
import { nativeScreenId } from '../src/native-contract.mjs';
import { expandCaptureConfig } from '../src/capture-recipe.mjs';
const detection = { applications: [], recipes: [], warnings: [], nativeContract: null, assets: { environment: [], readiness: [], scenarios: [], fixtures: [] }, inventory: { items: [], relationships: [], limitations: [], parserWarnings: [] } };
async function adapter(t, { mode = 'ok', platform = 'darwin', patch = {}, settings = {}, rootPatch = {}, detectionPatch = {}, seed } = {}) {
    const f = await fixture(t), calls = [], root = f.dir;
    const output = join(root, 'output');
    if (seed)
        await seed(f);
    const app = { path: 'App.xcodeproj', adapter: 'apple', fixture: 'native-v1', settleMs: 0, platforms: ['macos', 'ios'], scenarios: [{ key: 'home', readOnly: true, ready: { file: 'ready.json' } }, { key: 'settings', platforms: ['macos'], readinessCommand: ['check'] }], ...patch };
    const command = async (args, ctx) => {
        calls.push(args);
        if (args[0] === 'check') {
            if (mode === 'readiness-fails')
                throw Error('not ready');
            return '';
        }
        if (args[0] === 'prepare') {
            ctx.log('prepared\n');
            return '';
        }
        if (args[0] === 'producer') {
            fs.writeFileSync(join(ctx.output, 'image.png'), f.bytes);
            fs.writeFileSync(join(ctx.output, 'screens.json'), JSON.stringify({ schemaVersion: 1, screens: [{ key: 'home', ...(mode === 'minimal-producer' ? {} : { title: 'Home' }), captures: [{ file: 'image.png', ...(mode === 'minimal-producer' ? {} : { variant: { device: 'phone', browser: 'native' } }) }] }, { key: 'unselected', captures: [{ file: 'image.png', variant: { device: 'phone', browser: 'native' } }] }] }));
            return '';
        }
        if (args[0] === 'xcodebuild') {
            if (args.includes('-list'))
                return JSON.stringify({ [mode === 'workspace' ? 'workspace' : 'project']: (mode === 'absent-schemes' ? {} : { schemes: mode === 'ambiguous-scheme' ? ['One', 'Two'] : mode === 'exact-scheme' ? ['App', 'Other'] : mode === 'no-schemes' ? [] : ['App'] }) });
            if (args.includes('-version'))
                return 'Xcode fixture';
            if (args.includes('build')) {
                if (mode === 'build-fails')
                    throw Error('build failed');
                return '';
            }
            if (args.includes('-showBuildSettings'))
                return JSON.stringify(mode === 'no-products' ? [] : [{ target: 'App', buildSettings: { WRAPPER_EXTENSION: 'app', TARGET_BUILD_DIR: root, FULL_PRODUCT_NAME: 'App.app', PRODUCT_BUNDLE_IDENTIFIER: 'test.fixture' } }, ...(mode === 'multiple-products' ? [{ target: 'Other', buildSettings: { WRAPPER_EXTENSION: 'app' } }] : [])]);
        }
        if (args[1] === 'swift') {
            if (mode === 'mac-fails')
                throw Error('window failed');
            fs.writeFileSync(args[4], f.bytes);
            return JSON.stringify({ readiness: { status: 'passed', method: 'native-signal' } });
        }
        if (args[1] === 'simctl') {
            if (args[2] === 'list')
                return JSON.stringify({ runtimes: mode === 'no-runtime' ? [] : [{ identifier: 'com.apple.iOS-26', isAvailable: true, version: '26.0', name: 'iOS 26' }, { identifier: 'com.apple.iOS-25', isAvailable: true, version: '25.0', name: 'iOS 25' }], devicetypes: mode === 'no-device' ? [] : [{ identifier: 'phone', productFamily: 'iPhone', name: 'iPhone' }, { identifier: 'pad', productFamily: 'iPad', name: 'iPad' }] });
            if (args[2] === 'create') {
                if (mode === 'create-fails')
                    throw Error('cannot create');
                return 'simulator-id';
            }
            if (args[2] === 'get_app_container')
                return root;
            if (args[2] === 'launch') {
                const env = ctx.env;
                if (env.SIMCTL_CHILD_SCREENS_READY_FILE) {
                    const file = join(root, env.SIMCTL_CHILD_SCREENS_READY_FILE);
                    fs.writeFileSync(file, JSON.stringify({ version: 1, requestId: env.SIMCTL_CHILD_SCREENS_REQUEST_ID, screen: env.SIMCTL_CHILD_SCREENS_SCREEN_ID, fixture: env.SIMCTL_CHILD_SCREENS_FIXTURE, state: 'ready', pending: 0 }));
                }
                return '';
            }
            if (args[2] === 'io') {
                if (mode === 'screenshot-fails')
                    throw Error('screenshot failed');
                fs.writeFileSync(args.at(-1), f.bytes);
                return '';
            }
            if (['shutdown', 'delete'].includes(args[2]) && mode === 'cleanup-fails')
                throw Error('cleanup failed');
            return '';
        }
        throw Error('Unexpected command ' + args.join(' '));
    };
    const config = expandCaptureConfig({ version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications: [app], ...rootPatch });
    const input = { root, detection: { ...detection, ...detectionPatch }, config, inputHash: 'native-input', decisions: [] };
    const mod = await moduleUnderTest('src/auto-capture.mjs', { platform, globals: { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 1)) }, mocks: { './capture-process.mjs': { command, launch: () => { }, stop: async () => { } }, './automatic-plan.mjs': { automaticInput: () => input, identityHash: value => JSON.stringify(value) }, './runtime.mjs': { gitOutput: () => 'revision', captureBrowser: async () => { throw Error('No browser expected'); } }, 'node:timers/promises': { setTimeout: async () => { } } } });
    const report = await mod.exports.captureAutomatic(f.store, { path: root, execute: 'yes', output, ...settings });
    return { ...f, calls, report, input, mod };
}
test('Apple adapter builds Mac, iPhone and iPad states and cleans up every simulator', async (t) => {
    const { report, calls } = await adapter(t, { patch: { prepare: [['prepare']], target: 'App' } });
    assert.equal(report.status, 'captured');
    assert.equal(report.run.captureIds.length, 4);
    assert.equal(calls.filter(args => args[2] === 'delete').length, 2);
    assert.equal(report.coverage.complete, true);
    const workspace = await adapter(t, { mode: 'workspace', patch: { path: 'App.xcworkspace', platforms: ['iphone'], scheme: 'App', scenarios: [{ key: 'home', readOnly: true, readinessCommand: ['check'] }] }, settings: { mode: 'commit', revision: 'commit-sha' } });
    assert.equal(workspace.report.exitCode, 0);
    const exact = await adapter(t, { mode: 'exact-scheme', patch: { platforms: ['macos'], scenarios: [{ key: 'home', ready: { file: 'ready.json' } }] } });
    assert.equal(exact.report.exitCode, 0);
});
test('Apple adapter reports unsupported hosts, ambiguous schemes, build and device failures', async (t) => {
    for (const [mode, patch, platform, pattern] of [
        ['ok', {}, 'linux', /requires macOS/], ['ambiguous-scheme', {}, 'darwin', /Choose an app scheme/], ['no-schemes', {}, 'darwin', /Choose an app scheme/], ['ok', { platforms: [] }, 'darwin', /Set macos/], ['no-products', {}, 'darwin', /select one/], ['build-fails', {}, 'darwin', /build failed/], ['no-runtime', {}, 'darwin', /Install an iOS/], ['no-device', {}, 'darwin', /device type/], ['create-fails', {}, 'darwin', /cannot create/], ['mac-fails', {}, 'darwin', /window failed/], ['screenshot-fails', {}, 'darwin', /screenshot failed/], ['cleanup-fails', {}, 'darwin', /cleanup failed/], ['readiness-fails', { scenarios: [{ key: 'home', readinessCommand: ['check'] }] }, 'darwin', /Readiness failed/]
    ]) {
        const { report } = await adapter(t, { mode, patch, platform });
        assert.equal(report.exitCode, 1);
        assert.match(report.applications[0].issues.join(' '), pattern);
    }
});
test('command adapters use the shared manifest, readiness, selection and checkpoint lifecycle', async (t) => {
    const { report } = await adapter(t, { patch: { path: '.', adapter: 'command', command: ['producer', '{output}', '{project}'], platforms: ['iphone'], variants: [{ device: 'phone', browser: 'native' }], scenarios: [{ key: 'home', readinessCommand: ['check'], readOnly: true }] } });
    assert.equal(report.run.captureIds.length, 1);
    assert.equal(report.scenarios[0].readiness.status, 'passed');
    const unknown = await adapter(t, { patch: { adapter: 'unsupported', frameworks: ['Unknown'] } });
    assert.match(unknown.report.applications[0].issues[0], /No automatic adapter/);
    const empty = await adapter(t, { patch: { adapter: 'command', command: ['producer'], scenarios: [{ key: 'missing' }] } });
    assert.equal(empty.report.exitCode, 1);
    assert.match(empty.report.applications[0].issues[0], /no selected/);
});
test('native manifests supply executable states and passing independent captures can be reused', async (t) => {
    const contract = { source: 'screens.native.json', applications: [{ path: 'App.xcodeproj', platforms: ['macos'], fixture: 'seed', screens: [{ id: 'home', readOnly: true, readiness: { file: 'ready.json' } }] }] };
    const detectionPatch = { applications: [{ path: 'App.xcodeproj', kind: 'native', frameworks: ['Xcode'], platforms: ['macos'] }], nativeContract: contract, inventory: { items: [{ id: nativeScreenId('App.xcodeproj', 'home'), application: 'App.xcodeproj', kind: 'native-screen', name: 'home', confidence: 'declared', platforms: ['macos'] }], relationships: [], limitations: [] } };
    const declared = await adapter(t, { rootPatch: { applications: [], scope: 'discovered' }, detectionPatch });
    assert.equal(declared.report.exitCode, 0);
    const launch = await adapter(t, { rootPatch: { scope: 'discovered' }, patch: { scenarios: undefined, platforms: ['macos'], readinessCommand: ['check'], settleMs: undefined, fixture: undefined }, settings: { mode: 'commit', revision: 'commit' } });
    assert.equal(launch.report.exitCode, 0);
    const checkpoints = [];
    const first = await adapter(t, { settings: { onCheckpoint: value => checkpoints.push(value) } });
    const reused = await adapter(t, { settings: { priorCheckpoints: checkpoints }, seed: f => { for (const id of first.report.run.captureIds) {
            const capture = first.store.getCapture(id);
            f.store.screen({ project: 'demo', key: capture.screen.slice(5), title: capture.screen });
            f.store.capture({ ...capture, bytes: first.store.image(id).bytes });
        } } });
    assert.equal(reused.report.summary.reused, 3);
    const missing = await adapter(t, { settings: { priorCheckpoints: checkpoints } });
    assert.equal(missing.report.summary.reused, 0);
    const teardown = await adapter(t, { patch: { fixtures: { teardown: [['unknown']] } } });
    assert.equal(teardown.report.exitCode, 1);
});
test('command producers add discovered states without requiring per-screen setup', async (t) => {
    const discovered = await adapter(t, { rootPatch: { scope: 'discovered' }, patch: { path: '.', adapter: 'command', command: ['producer'], fixture: undefined, scenarios: undefined }, settings: { mode: 'commit', revision: 'commit' } });
    assert.equal(discovered.report.scenarios.length, 2);
    assert.equal(discovered.report.scenarios[0].readiness.status, 'unverified');
    const inferred = await adapter(t, { rootPatch: { applications: [], scope: 'discovered' }, detectionPatch: { applications: [{ path: 'App.xcodeproj', kind: 'native', frameworks: ['Xcode'], platforms: ['macos'] }] } });
    assert.equal(inferred.report.scenarios.length, 1);
    const unsupported = await adapter(t, { rootPatch: { applications: [], scope: 'discovered' }, detectionPatch: { applications: [{ path: '.', kind: 'native', frameworks: ['Flutter'], platforms: ['android'] }] } });
    assert.match(unsupported.report.applications[0].issues[0], /No automatic adapter/);
    const command = await adapter(t, { rootPatch: { applications: [], scope: 'discovered' }, detectionPatch: { recipes: [{ path: '.', name: 'screens:capture' }] } });
    assert.match(command.report.applications[0].issues[0], /Unexpected command npm/);
});
test('native capture uses fixture defaults and inferred platforms for states with explicit signals', async (t) => {
    const result = await adapter(t, { patch: { fixture: undefined, settleMs: undefined, platforms: undefined, scenarios: [{ key: 'home', ready: { file: 'ready.json' } }] }, rootPatch: { fixtures: { version: 'root-v1' } }, detectionPatch: { applications: [{ path: 'App.xcodeproj', frameworks: ['Xcode'], platforms: ['macos', 'ios'] }] } });
    assert.equal(result.report.scenarios.length, 3);
    const workspace = await adapter(t, { mode: 'workspace', patch: { path: 'App.xcworkspace', scheme: undefined, platforms: ['macos'], fixture: undefined, scenarios: [{ key: 'home', ready: { file: 'ready.json' } }] } });
    assert.equal(workspace.report.scenarios.length, 1);
    const base = await adapter(t);
    for (const root of [base.dir, '/']) {
        const input = { ...base.input, root, config: { version: 1, scope: 'discovered', applications: [] }, detection: { ...detection, applications: [] } };
        const report = await base.mod.exports.executeCaptureRecipe(base.store, { execute: 'yes', input, output: join(base.dir, root === '/' ? 'root-name' : 'directory-name') });
        assert.equal(report.project.id, root === '/' ? 'app' : base.dir.split('/').at(-1));
    }
});
test('empty native recipes and minimal producer manifests retain explicit coverage gaps', async (t) => {
    for (const patch of [{ platforms: undefined, scenarios: undefined }, { platforms: ['macos'], scenarios: undefined }]) {
        const empty = await adapter(t, { patch });
        assert.equal(empty.report.exitCode, 1);
    }
    const absent = await adapter(t, { mode: 'absent-schemes' });
    assert.match(absent.report.applications[0].issues[0], /Choose an app scheme/);
    const minimal = await adapter(t, { mode: 'minimal-producer', patch: { path: '.', adapter: 'command', command: ['producer'], scenarios: undefined, fixtures: {}, fixture: undefined }, rootPatch: { scope: 'discovered', coverage: { exclude: [] } } });
    assert.equal(minimal.report.scenarios.length, 2);
    const windows = await adapter(t, { platform: 'win32', rootPatch: { applications: [], scope: 'discovered' }, detectionPatch: { recipes: [{ path: '.', name: 'screens:capture' }] } });
    assert.match(windows.report.applications[0].issues[0], /npm.cmd/);
    const noFramework = await adapter(t, { patch: { adapter: 'unsupported', frameworks: [] } });
    assert.match(noFramework.report.applications[0].issues[0], /App.xcodeproj/);
    const noFixture = await adapter(t, { patch: { platforms: ['iphone'], fixture: undefined, scenarios: [{ key: 'home', ready: { file: 'ready.json' } }] }, settings: { signal: new AbortController().signal } });
    assert.equal(noFixture.report.scenarios.length, 1);
});
test('native contracts fill missing configured scenarios and unsupported apps need no framework label', async (t) => {
    const contract = { source: 'screens.native.json', applications: [{ path: 'App.xcodeproj', platforms: ['macos'], screens: [{ id: 'home', readiness: { file: 'ready.json' } }] }] };
    const inventory = { items: [{ id: nativeScreenId('App.xcodeproj', 'home'), application: 'App.xcodeproj', kind: 'native-screen', confidence: 'declared' }], relationships: [], limitations: [] };
    const result = await adapter(t, { patch: { scenarios: undefined }, detectionPatch: { nativeContract: contract, inventory } });
    assert.equal(result.report.scenarios.length, 3);
    const unknown = await adapter(t, { patch: { adapter: 'unsupported', frameworks: undefined } });
    assert.match(unknown.report.applications[0].issues[0], /No automatic adapter/);
});
