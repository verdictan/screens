import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { fixture } from './support/registry.mjs';
import { moduleUnderTest } from './support/module.mjs';
import { detectProject } from '../src/discovery.mjs';
import { gitOutput } from '../src/runtime.mjs';
import { discoverScreens, createCoverage, recordCoverage, finishCoverage } from '../src/screen-inventory.mjs';
const put = (root, file, value) => { fs.mkdirSync(join(root, file, '..'), { recursive: true }); fs.writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)); };
test('discovery separates frontend routes, native families, generated files and Git-ignored content', async (t) => {
    const { dir } = await fixture(t), root = join(dir, 'repo');
    fs.mkdirSync(root);
    gitOutput(root, ['init', '--quiet']);
    const files = {
        'package.json': { dependencies: { next: '1' }, scripts: { dev: 'next dev', start: 'next start', capture: 'node capture', storybook: 'storybook', ignored: 3 } },
        'src/app/(group)/page.tsx': 'export default function HomePage(){return <main/>}',
        'src/app/@slot/page.tsx': 'export default function SlotPage(){}', 'src/app/_hidden/page.tsx': '',
        'src/pages/about.tsx': 'export default function AboutPage(){}', 'src/pages/api/hello.ts': '', 'src/pages/_app.tsx': '',
        'src/router.tsx': `import {Route} from 'react-router-dom'; export const routes=<Route path='/direct' element={<div/>}/>; navigate('/direct');`,
        'bad.ts': 'const = ;', 'src/OtherView.tsx': 'export function OtherView(){return <Dialog/>}',
        'apps/svelte/package.json': { dependencies: { '@sveltejs/kit': '1' } }, 'apps/svelte/src/routes/(group)/about/+page.svelte': '<p>Page</p>',
        'apps/nuxt/package.json': { dependencies: { nuxt: '1' } }, 'apps/nuxt/pages/index.vue': '<template/>',
        'apps/astro/package.json': { dependencies: { astro: '1' } }, 'apps/astro/src/pages/contact.astro': '<p>Contact</p>',
        'apps/react/package.json': { dependencies: { react: '1' } }, 'apps/react/App.jsx': "import {Route} from 'react-router-dom'; export function MainScreen(){return <main/>} const route=<Route path='/' element={<MainScreen/>}/>",
        'apps/native/package.json': { dependencies: { expo: '1', 'react-native': '1', electron: '1', '@tauri-apps/api': '1', '@tauri-apps/cli': '1' } },
        'apple/App.xcodeproj/project.pbxproj': 'com.apple.product-type.application SDKROOT = macosx; SUPPORTED_PLATFORMS = iphoneos; TARGETED_DEVICE_FAMILY = "1,2"; SDKROOT = appletvos; SDKROOT = watchos; SDKROOT = xros;',
        'apple/Unknown.xcodeproj/project.pbxproj': 'com.apple.product-type.application',
        'apple/Phone.xcodeproj/project.pbxproj': 'com.apple.product-type.application SDKROOT = iphoneos;',
        'apple/NotApp.xcodeproj/project.pbxproj': 'library',
        'apple/Shared.xcworkspace/contents.xcworkspacedata': 'workspace', 'apple/shared.xcscheme': 'scheme',
        'swift/Package.swift': '.executableTarget(name:"App")', 'swift-lib/Package.swift': '.library(name:"Library")',
        'flutter/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n', 'flutter/ios/file': 'app',
        'flutter-empty/pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter\n',
        'android/build.gradle.kts': 'plugins { id("com.android.application") }',
        'tauri/tauri.conf.json': {}, 'bad/package.json': 'invalid json',
        'archive/package.json': { dependencies: { react: '1' } }, 'tests/package.json': { dependencies: { react: '1' } },
        'screens.native.json': { version: 1, applications: [{ path: 'Virtual.xcodeproj', platforms: ['iphone'], screens: [{ id: 'home' }, { id: 'settings', platforms: ['ipad'] }] }] },
        '.gitignore': 'ignored/\n', 'ignored/package.json': { dependencies: { react: '1' } }
    };
    for (const [file, value] of Object.entries(files))
        put(root, file, value);
    fs.symlinkSync(join(root, 'src'), join(root, 'linked'));
    const found = detectProject(root);
    assert.equal(found.ignoreRules, 'git');
    assert.ok(found.warnings.some(item => item.includes('Invalid package.json')));
    assert.ok(found.warnings.some(item => item.includes('parser syntax')));
    const web = found.applications.find(app => app.path === '.');
    assert.ok(web.routes.some(route => route.path === '/direct'));
    assert.ok(web.routes.some(route => route.path === '/about'));
    assert.equal(web.routes.some(route => route.path.includes('@slot')), false);
    assert.ok(found.applications.some(app => app.frameworks.includes('Flutter') && app.platforms.includes('ios')));
    assert.ok(found.applications.some(app => app.frameworks.includes('Flutter') && app.platforms.includes('unspecified')));
    assert.ok(found.applications.some(app => app.platforms.includes('visionos')));
    assert.ok(found.applications.some(app => app.platforms.includes('apple-unspecified')));
    assert.ok(found.applications.some(app => app.platforms.includes('ios')));
    assert.equal(found.applications.some(app => app.path.startsWith('ignored') || app.path.startsWith('archive')), false);
    assert.equal(found.inputs.some(item => item.path.startsWith('linked')), false);
    const flat = join(dir, 'static');
    fs.mkdirSync(flat);
    put(flat, 'index.html', '<main>Static</main>');
    put(flat, '.gitignore', 'unused');
    assert.ok(detectProject(flat).applications[0].frameworks.includes('Static HTML'));
    assert.ok(detectProject(flat).warnings.some(item => item.includes('ignore rules')));
    assert.throws(() => detectProject(join(flat, 'index.html')), /directory/);
    const deep = Array(10).fill('nested').join('/');
    put(flat, deep + '/file.txt', 'deep');
    assert.ok(detectProject(flat).warnings.some(item => item.includes('Depth limit')));
});
test('discovery reports read and traversal limits without claiming complete analysis', async (t) => {
    const { dir } = await fixture(t);
    const file = name => ({ name, isSymbolicLink: () => false, isFile: () => true, isDirectory: () => false });
    const virtual = await moduleUnderTest('src/discovery.mjs', { mocks: { 'node:fs': { ...fs, readdirSync: () => Array.from({ length: 20001 }, (_, i) => file(`file-${i}.txt`)), readFileSync: () => Buffer.from('') }, './runtime.mjs': { gitOutput: () => { throw Error('not a repository'); } }, './import.mjs': { discover: () => [] } } });
    const limited = virtual.exports.detectProject(dir);
    assert.ok(limited.warnings.some(item => item.includes('File limit')));
    assert.equal(limited.inputs.length, 20000);
    const blocked = await moduleUnderTest('src/discovery.mjs', { mocks: { 'node:fs': { ...fs, readdirSync: () => { throw Object.assign(Error('blocked'), { code: 'EACCES' }); } }, './runtime.mjs': { gitOutput: () => { throw Error('no git'); } }, './import.mjs': { discover: () => [] } } });
    assert.ok(blocked.exports.detectProject(dir).warnings.some(item => item.includes('EACCES')));
    const brokenIgnore = await moduleUnderTest('src/discovery.mjs', { mocks: { './runtime.mjs': { gitOutput: (_root, args) => { if (args[0] === 'check-ignore')
                    throw Object.assign(Error('git failed'), { status: 2 }); return ''; } }, './import.mjs': { discover: () => [] } } });
    assert.throws(() => brokenIgnore.exports.detectProject(dir), /git failed/);
});
test('source inventory distinguishes optional candidates from selected required scope', () => {
    const apps = [{ path: '.', kind: 'web', routes: [{ path: '/', source: 'src/routes.jsx', confidence: 'declared', requiresParameters: false }] }];
    const files = { 'src/routes.jsx': `import {Route} from 'react-router-dom';const route=<Route path='/'/>; const computed={path:computedRoute}; function MainPage(){return <Dialog open/>} if(loading){};`, 'src/RootView.jsx': 'export function RootView(){return <main/>}', 'src/story.stories.tsx': 'export const Default={};', 'native/App.swift': 'struct Root: View {} .sheet {} NavigationLink()', 'native/a.kt': 'composable(route="home")', 'native/app.storyboard': '<viewController id="controller"/>', 'native/a.dart': 'class Page: StatelessWidget {}' };
    const graph = { relationships: [{ source: 'src/routes.jsx', route: '/', target: 'src/RootView.jsx', symbol: 'RootView' }], records: [{ kind: 'navigation', source: 'src/routes.jsx', route: '/', line: 1 }], warnings: [] };
    const inventory = discoverScreens(apps, Object.keys(files), file => files[file], graph);
    assert.ok(inventory.relationships.some(item => item.kind === 'navigates-to'));
    assert.ok(inventory.items.some(item => item.confidence === 'referenced'));
    const detection = { applications: apps, inventory, warnings: [] };
    const executions = [{ path: '.', adapter: 'browser', variants: [{ device: 'desktop', width: 400, height: 300, browser: 'firefox' }], scenarios: [{ key: 'home', path: '/' }] }];
    const defaults = [{ device: 'phone', width: 390, height: 844 }];
    const config = { scope: 'configured' };
    const coverage = createCoverage(detection, executions, config, defaults);
    assert.equal(coverage.requirements.find(item => item.kind === 'recipe').variant.browser, 'firefox');
    recordCoverage(coverage, 0, 'home', { device: 'desktop', viewport: '400x300', theme: 'light', locale: 'en', browser: 'firefox', textScale: 'default' }, 'capture', { status: 'passed' });
    assert.equal(finishCoverage(coverage, [{ issues: [] }]).complete, true);
    const optional = inventory.items.find(item => item.confidence === 'possible');
    assert.ok(optional);
    const required = createCoverage(detection, executions, { scope: 'configured', coverage: { required: [optional.id] } }, defaults);
    recordCoverage(required, 0, 'home', { device: 'desktop', viewport: '400x300', theme: 'light', locale: 'en', browser: 'firefox', textScale: 'default' }, 'capture', { status: 'passed' });
    assert.equal(finishCoverage(required, [{ issues: ['capture failed'] }]).complete, false);
    for (const entry of [{ coverage: { required: ['unknown'] } }, { coverage: { exclude: [{ id: 'unknown', reason: 'scope' }] } }, { coverage: { exclude: [{ id: optional.id, reason: '' }] } }])
        assert.throws(() => createCoverage(detection, executions, entry, defaults));
    const excluded = createCoverage(detection, executions, { scope: 'discovered', coverage: { exclude: [{ id: optional.id, reason: 'Reusable component' }] } }, defaults);
    assert.ok(excluded.requirements.some(item => item.status === 'excluded'));
    const noApps = createCoverage(detection, [], {}, defaults);
    assert.equal(finishCoverage(noApps, []).complete, false);
});
test('coverage accounts for unassigned native states, explicit exclusions and repeated evidence', () => {
    const items = [{ id: 'ios', application: 'native', kind: 'native-screen', confidence: 'declared', platforms: ['ios', 'macos', 'android'] }, { id: 'mac', application: 'other', kind: 'native-screen', confidence: 'declared' }, { id: 'unknown', application: 'absent', kind: 'native-screen', confidence: 'declared' }, { id: 'web', application: 'web', kind: 'route', route: '/', confidence: 'declared' }];
    const detection = { applications: [{ path: 'native', kind: 'native', platforms: ['ios', 'macos', 'android'] }, { path: 'other', kind: 'native', platforms: ['macos'] }, { path: 'web', kind: 'web' }], inventory: { items, limitations: [] }, warnings: [] };
    const defaults = [{ device: 'desktop', width: 300, height: 200 }];
    const empty = createCoverage(detection, [], { scope: 'discovered', coverage: { exclude: [{ id: 'mac', reason: 'No host' }] } }, defaults);
    assert.ok(empty.requirements.some(row => row.variant.device === 'unassigned'));
    assert.ok(empty.requirements.some(row => row.variant.device === 'ipad'));
    assert.ok(empty.requirements.some(row => row.status === 'excluded'));
    finishCoverage(empty, []);
    const apps = [{ adapter: 'command', scenarios: ['/'] }, { path: 'native', adapter: 'apple', scenarios: [{ key: 'home', covers: ['ios'] }], platforms: ['ios', 'macos', 'android'] }, { path: 'other', adapter: 'command' }, { path: 'web', adapter: 'browser', scenarios: [{ path: '/' }] }];
    const coverage = createCoverage(detection, apps, { scope: 'discovered' }, defaults);
    assert.ok(coverage.requirements.some(row => row.variant.browser === 'chromium'));
    recordCoverage(coverage, 1, 'home', { device: 'iphone', browser: 'native' }, 'one');
    recordCoverage(coverage, 1, 'home', { device: 'iphone', browser: 'native' }, 'two', { status: 'passed' });
    recordCoverage(coverage, 1, 'home', { device: 'iphone', browser: 'native' }, 'three', { status: 'failed' });
    assert.equal(coverage.requirements.find(row => row.id === 'ios' && row.variant.device === 'iphone').readiness.status, 'passed');
    assert.throws(() => createCoverage(detection, [{ scenarios: [{ key: 'bad', covers: ['missing'] }] }], {}, defaults), /Unknown coverage ID/);
    const files = { 'App.jsx': 'const item={path:computed}; function RootView(){}', 'Route.jsx': 'import {Route} from "react-router"; const item=<Route path="/"/>;', 'MainView.jsx': 'function MainView(){}' };
    const apps2 = [{ path: '.', kind: 'web', routes: [{ path: '/', source: 'Route.jsx' }] }, { path: 'native', kind: 'native' }];
    const graph = { relationships: [{ route: '/', source: 'Route.jsx', target: 'MainView.jsx', symbol: 'default' }], records: [{ kind: 'navigation', source: 'Route.jsx', route: '/' }], warnings: [] };
    const inventory = discoverScreens(apps2, Object.keys(files), f => files[f], graph);
    assert.equal(inventory.items.find(row => row.name === 'MainView').confidence, 'referenced');
    discoverScreens([{ path: '.', kind: 'web' }], ['App.jsx'], f => files[f], { relationships: [], records: [{ kind: 'navigation', source: 'App.jsx', route: '/' }], warnings: [] });
});
test('source graph maps wildcard suffixes, paired JSX and unresolved route elements', async () => {
    const { parseSourceGraph } = await import('../src/source-graph.mjs');
    const files = { 'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*.screen': ['src/*'] } } }), 'jsconfig.json': '{}', 'src/Home.jsx': 'export function HomeView(){}', 'src/routes.jsx': `import {Route} from 'react-router';import {HomeView} from '@/Home.screen';import 'styles';const a=<Route path='/paired' element={<HomeView></HomeView>}/>;const b=<Route path='/plain' element='text'/>;const c=<Route path='/expr' element={42}/>;const d={path:'/object',element:<HomeView></HomeView>};` };
    const graph = parseSourceGraph([{ path: '.' }], Object.keys(files), f => files[f]);
    assert.equal(graph.records.find(row => row.route === '/paired').component.source, 'src/Home.jsx');
    assert.equal(graph.records.find(row => row.route === '/plain').component, null);
    assert.equal(graph.records.find(row => row.route === '/object').component.symbol, 'HomeView');
});
test('discovery identifies root Flutter projects, capture helpers and transient source read errors', async (t) => {
    const { dir } = await fixture(t);
    put(dir, 'pubspec.yaml', 'flutter:\n  sdk: flutter\n');
    put(dir, 'scripts/capture-ui.mjs', 'export const capture=true;');
    put(dir, 'screens.native.json', { version: 1, applications: [{ path: 'Virtual.xcodeproj', screens: [{ id: 'home' }] }] });
    put(dir, 'App.jsx', 'function HomeView(){}');
    let failed = false;
    const mod = await moduleUnderTest('src/discovery.mjs', { mocks: { 'node:fs': { ...fs, readFileSync: (file, encoding) => { if (!failed && String(file).endsWith('App.jsx') && encoding === 'utf8') {
                    failed = true;
                    throw Error('source unavailable');
                } return fs.readFileSync(file, encoding); } }, './import.mjs': { discover: () => [] } } });
    const report = mod.exports.detectProject(dir);
    assert.ok(report.recipes.some(row => row.purpose === 'capture-candidate'));
    assert.ok(report.warnings.some(row => row.includes('source unavailable')));
    const blocked = await moduleUnderTest('src/discovery.mjs', { mocks: { 'node:fs': { ...fs, readdirSync: () => { throw Error('directory unavailable'); } }, './import.mjs': { discover: () => [] } } });
    assert.ok(blocked.exports.detectProject(dir).warnings.some(row => row.includes('directory unavailable')));
});
