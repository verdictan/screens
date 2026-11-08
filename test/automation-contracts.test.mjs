import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/registry.mjs";
import { fixtureBoundaries } from "../src/fixture-boundaries.mjs";
import { nativeContract, nativeApplications, nativeReadySpec, waitNativeReady } from "../src/native-contract.mjs";
import { expandCaptureConfig, diagnoseCaptureConfig, captureConfig, recipeScenarios, scenarioSelected, recipeHash } from "../src/capture-recipe.mjs";
import { classifySource, literalValue, discoverCaptureAssets } from "../src/capture-assets.mjs";
import { parseSourceGraph } from "../src/source-graph.mjs";
import { captureSummary, formatCaptureSummary } from "../src/capture-summary.mjs";
import { configurationDecisions, automaticInput, draftAutomaticPlan, identityHash } from "../src/automatic-plan.mjs";
import { detectProject } from "../src/discovery.mjs";
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const app = () => ({ path: ".", adapter: "browser", serve: ["node", "server.mjs"], scenarios: [{ key: "home", path: "/", ready: "main" }] });
const config = () => ({ version: 1, project: { id: "demo", name: "Demo" }, applications: [app()] });
test("fixture boundaries reset independent scenarios, preserve groups and always tear down", async () => {
    assert.throws(() => fixtureBoundaries({ scope: "bad" }), /scope/);
    const empty = fixtureBoundaries();
    await empty.close();
    await empty.start();
    await empty.start();
    await empty.enter({});
    await empty.close();
    await empty.close();
    assert.equal(empty.epoch, 1);
    assert.equal(empty.reusable({}), false);
    for (const scope of ["run", "scenario", "group"]) {
        const calls = [], context = { signal: new AbortController().signal };
        const boundary = fixtureBoundaries({ scope, setup: [["setup", "{scenario}", "{group}", "{device}", "{baseUrl}"]], reset: [["reset"]], teardown: [["close"]] }, context, async (args, ctx) => calls.push({ args, signal: ctx.signal }));
        await boundary.enter({ application: ".", scenario: "a", group: "pair", variant: { device: "phone" }, baseUrl: "http://fixture" });
        await boundary.enter({ application: ".", scenario: "b", group: "pair", variant: { device: "phone" } });
        await boundary.enter({ application: ".", scenario: "c", variant: { device: "phone" } });
        await boundary.close();
        assert.equal(boundary.epoch, scope === "run" ? 1 : scope === "group" ? 2 : 3);
        assert.deepEqual(calls[0].args, ["setup", "a", "pair", "phone", "http://fixture"]);
        assert.equal(calls.at(-1).signal, undefined);
        assert.equal(boundary.reusable({ readOnly: true }), scope === "scenario");
    }
    assert.equal(fixtureBoundaries({ independent: true }).reusable({}), true);
    assert.equal(fixtureBoundaries({ scope: "scenario" }).reusable({ readOnly: true }), true);
    assert.equal(fixtureBoundaries({ scope: "scenario" }).reusable({}), false);
    assert.equal(fixtureBoundaries({ scope: "run", reset: [["reset"]], independent: true }).reusable({}), false);
    const failed = fixtureBoundaries({ setup: [["bad"]] }, {}, async () => { throw Error("offline"); });
    await assert.rejects(failed.start(), /Fixture setup failed: offline/);
    await failed.close();
});
test("native contracts keep profile, screen and readiness identity explicit", async (t) => {
    const { dir } = await fixture(t), file = join(dir, "screens.native.json");
    assert.equal(nativeContract(dir), null);
    assert.deepEqual(nativeApplications(null), []);
    for (const value of [{}, { version: 1, applications: [{}] }, { version: 1, applications: [{ path: "app", screens: [] }] }, { version: 1, applications: [{ path: "app", screens: [{ id: "bad key" }] }] }, { version: 1, applications: [{ path: "app", screens: [{ id: "a" }, { id: "a" }] }] }]) {
        write(file, value);
        assert.throws(() => nativeContract(dir));
    }
    const value = { version: 1, applications: [{ path: "App.xcodeproj", fixture: "base", args: ["base"], env: { BASE: "1" }, defaultProfile: "demo", profiles: { demo: { fixture: "profile", args: ["sample"], env: { SAMPLE: "1" }, readiness: { file: "profile.json", command: ["check"] } } }, screens: [{ id: "home", title: "Home", fixture: "screen", args: ["home"], covers: ["explicit"], readiness: { file: "screen.json", command: ["verify"] } }, { id: "settings" }] }] };
    write(file, value);
    const declared = nativeContract(dir), prepared = nativeApplications(declared)[0];
    assert.deepEqual(prepared.scenarios[0].args, ["base", "sample", "home"]);
    assert.equal(prepared.scenarios[0].fixture, "screen");
    assert.equal(prepared.scenarios[1].fixture, "profile");
    assert.deepEqual(prepared.env, { BASE: "1", SAMPLE: "1" });
    assert.equal(prepared.scenarios[0].covers.length, 2);
    assert.throws(() => nativeApplications(declared, "missing"), /Unknown/);
    const bare = nativeApplications({ applications: [{ path: "app", readiness: { command: ["app-check"] }, screens: [{ id: "plain" }] }] })[0];
    assert.equal(bare.scenarios[0].title, "plain");
    assert.deepEqual(bare.scenarios[0].readinessCommand, ["app-check"]);
    assert.equal(nativeReadySpec({}, { output: dir }), null);
    assert.equal(nativeReadySpec({ ready: {} }, { output: dir }), null);
    const context = { output: dir };
    const spec = nativeReadySpec({ key: "home", ready: { file: "ready.json", timeoutMs: 10, platforms: { iphone: { file: "Documents/ready.json" } } } }, context, { requestId: "request", fixture: "seed", profile: "demo" });
    assert.equal(spec.file, join(dir, "ready.json"));
    const simulator = nativeReadySpec({ key: "home", fixture: "own", ready: { file: "base", platforms: { iphone: { file: "Documents/ready.json" } } } }, context, { platform: "iphone", container: dir });
    assert.equal(simulator.request.fixture, "own");
    assert.equal(simulator.file, join(dir, "Documents/ready.json"));
    assert.equal(nativeReadySpec({ ready: { file: join(dir, "absolute") } }, context).file, join(dir, "absolute"));
    for (const path of ["../outside", join(dir, "absolute")])
        assert.throws(() => nativeReadySpec({ ready: { file: path } }, context, { container: dir }), /relative/);
    assert.equal((await waitNativeReady(null)).status, "unverified");
    write(spec.file, { ...spec.request, state: "ready", pending: 0 });
    assert.equal((await waitNativeReady(spec)).status, "passed");
    for (const error of [undefined, "fixture failure"]) {
        write(spec.file, { ...spec.request, state: "error", error });
        assert.equal((await waitNativeReady(spec)).status, "failed");
    }
    const noFixture = { ...spec, request: { ...spec.request, fixture: undefined } };
    write(spec.file, { ...noFixture.request, state: "ready", pending: 0 });
    assert.equal((await waitNativeReady(noFixture)).status, "passed");
    for (const content of ['{"version":1}', 'not json']) {
        fs.writeFileSync(spec.file, content);
        assert.match((await waitNativeReady(spec)).reason, /timed out/);
    }
    fs.rmSync(spec.file);
    assert.equal((await waitNativeReady(spec)).status, "failed");
    const controller = new AbortController();
    controller.abort(Error("cancelled"));
    await assert.rejects(waitNativeReady(spec, controller.signal), /cancelled/);
    await assert.rejects(waitNativeReady({ ...spec, file: dir }), /EISDIR/);
});
test("capture recipes expand profiles and matrices without widening selected scope", async (t) => {
    const { dir } = await fixture(t), file = join(dir, "recipe.json");
    for (const value of [null, [], 1, { version: 2 }, { serve: [] }, { scope: "bad" }, { applications: [{ routes: [] }] }, { applications: [{ states: [] }] }, { applications: [{ coverageBindings: [] }] }, { applications: [{ readiness: {} }] }, { applications: [{ path: "../app" }] }, { applications: [{ path: dir }] }])
        assert.throws(() => expandCaptureConfig(value));
    assert.throws(() => expandCaptureConfig({}, { profile: "unknown" }), /Unknown/);
    const source = config();
    source.defaults = { env: { A: "a" }, ready: { selector: "main" } };
    source.applications[0].matrix = { devices: [{ device: "phone", width: 390, height: 844 }], themes: ["light", "dark"], locales: ["en", "fr"], textScales: [1, 2] };
    source.applications[0].browsers = ["chromium", "firefox"];
    source.profiles = { quick: { defaults: { env: { B: "b" } }, applications: [{ path: ".", env: { A: "override" }, scenarios: [{ path: "/quick" }] }, { path: "native", adapter: "command", command: ["capture"] }] } };
    const expanded = expandCaptureConfig(source, { profile: "quick" });
    assert.equal(expanded.applications[0].variants.length, 16);
    assert.equal(expanded.applications[0].env.A, "override");
    assert.equal(expanded.applications[0].env.B, "b");
    assert.equal(expanded.applications.length, 2);
    assert.equal(recipeScenarios(expanded)[0].application, ".");
    assert.match(expanded.applications[0].scenarios[0].key, /^route-/);
    assert.equal(expandCaptureConfig({ applications: [{ adapter: "browser", matrix: { devices: [{ device: "x" }] } }] }).applications[0].variants.length, 1);
    assert.deepEqual(expandCaptureConfig({ applications: [{ adapter: "browser", matrix: {} }] }).applications[0].variants, []);
    assert.equal(scenarioSelected({ selection: { scenarios: ["web/home"] } }, { path: "web" }, { key: "home" }), true);
    assert.equal(scenarioSelected({ selection: { scenarios: ["home"] } }, {}, { selectionKey: "home" }), true);
    assert.equal(expandCaptureConfig(config(), { screens: ["missing"] }).applications[0].scenarios.length, 0);
    const invalid = [
        { project: { id: "bad key", name: "" } }, { applications: [] },
        ...[{ adapter: "bad" }, { command: [] }, { prepare: ["bad"] }, { scenarios: [] }, { scenarios: [{ key: "bad key", path: "relative" }] },
            { variants: [{ device: "x", width: 1, height: 2, browser: "bad", theme: "other", textScale: "no" }] },
            { variants: [] }, { determinism: { time: "no" } }, { animationTime: -1 }, { network: { har: "../secret.har" } }, { network: { har: dir } },
            { scenarios: Array.from({ length: 10001 }, (_, i) => ({ key: `s${i}`, path: "/" })) }
        ].map(patch => ({ applications: [{ ...app(), ...patch }] }))
    ];
    for (const patch of invalid) {
        write(file, { ...config(), scope: "configured", ...patch });
        assert.equal(diagnoseCaptureConfig(file).valid, false, JSON.stringify(patch).slice(0, 100));
    }
    fs.writeFileSync(file, "bad");
    assert.equal(diagnoseCaptureConfig(file).valid, false);
    const valid = config();
    valid.applications[0].scenarios.push({ key: "settings", path: "/settings" });
    write(file, valid);
    assert.equal(captureConfig(file).value.applications[0].variants.length, 3);
    assert.equal(recipeHash(Buffer.from("same")), recipeHash("same"));
});
test("literal assets distinguish data, code, environment requirements and archive files", () => {
    for (const [file, kind] of [["archive/a.js", "generated"], ["x.stories.tsx", "story"], ["tests/a.js", "fixture"], ["x.spec.ts", "fixture"], ["api/a.ts", "api"], ["app/route.ts", "api"], ["app/page.tsx", "application"]])
        assert.equal(classifySource(file), kind);
    assert.deepEqual(literalValue(`/* data */ { 'x': [true, false, null, -1.5e2,], escaped: 'a\\n\\r\\t\\u0041\\q', }`).value, { x: [true, false, null, -150], escaped: "a\n\r\tAq" });
    for (const value of ["'unterminated", "{ [key]: 1 }", "{ a() {} }", "{a:1 b:2}", "undefined", "[...values]"])
        assert.throws(() => literalValue(value));
    const sources = {
        "README.md": "## Required settings\n- `API_KEY`\n### Details\n- `OTHER_KEY`\n## Optional\n- `OPTIONAL_KEY` defaults to empty",
        ".env.example": "API_KEY=\nDEFAULT_KEY=value",
        "web/capture.js": `process.env.API_KEY; import.meta.env['OTHER_KEY']; throw Error('MISSING_TOKEN is required'); window.__SCREENS_CAPTURE__ = {}; export const scenarios = [{path:'/home', ready:'main'}]; export const routeParams = {id:'one'}; export const fixtureParams = {id:'two'}; export const dynamicSegmentDefaults = {id:'three'}; export const computed = [unknown]; export async function buildScenarios(){}; routeStory('/p/:id','/p/one','Ready')`,
        "web/ui.stories.tsx": "export const Primary = {}; export function Secondary() {}",
        "web/fixtures.json": "{\"items\":[{\"id\":1}]}",
        "web/scenarios-bad.json": "not json", "archive/capture.js": "process.env.LEAK", "tests/helper.js": "process.env.SECRET; throw Error('TEST_ONLY is required')",
        "image.png": "skip", "orphan/app.js": "process.env.ORPHAN"
    };
    const found = discoverCaptureAssets([{ path: "." }, { path: "web" }], Object.keys(sources), file => sources[file]);
    assert.ok(found.environment.some(item => item.name === "API_KEY" && item.required));
    assert.equal(found.environment.some(item => item.name === "TEST_ONLY"), false);
    assert.equal(found.environment.some(item => item.name === "LEAK"), false);
    assert.equal(found.modules[0].export, "buildScenarios");
    assert.equal(found.stories.length, 2);
    assert.equal(found.fixtures.filter(item => item.params).length, 3);
    assert.equal(found.scenarios.some(item => item.storyOnly), true);
    assert.equal(found.readiness[0].application, "web");
});
test("source graph maps nested JSX, object routers, aliases, lazy components and readiness", () => {
    const files = {
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"], exact: ["src/Page"], ignored: "bad" } } }),
        "other/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "other/*": ["*end"] } } }),
        "src/Page.tsx": "export default function Page(){return <main/>}",
        "src/Nested/index.ts": "export class Nested {}",
        "src/router.tsx": `import Page from '@/Page'; import {Nested as View} from './Nested'; import {createBrowserRouter} from 'react-router-dom'; import * as Missing from 'missing'; const routes = createBrowserRouter([{path:'/parent',children:[{path:'child',component: View},{path:'lazy',loadComponent:()=>import('./Page').then(m=>m.Other)}]},{path:'/jsx',element:<Page/>},{path:'/as',component:(Page as unknown)},{path:'/satisfies',component:Page satisfies unknown},{path:'relative',component:()=>import(variable)},{path:'/unknown',element:<div/>}]); const tree = <Route path={'/parent'} element={<Page></Page>}><Route path='child' element={<View/>}/><Route index/><Link to='/jsx'/><NavLink href={'/as'}/></Route>; navigate('/parent'); router.push('/jsx'); router.replace('/as'); router.navigate('/satisfies'); window.__SCREENS_CAPTURE__ = {};`,
        "src/alias.ts": "import Page from 'exact'; export default Page;",
        "src/anonymous.ts": "export default function(){}", "src/class.ts": "export default class {}",
        "src/export.ts": "const Local = 1; export default (Local);",
        "src/export-empty.ts": "export default {};",
        "src/broken.ts": "const = ;",
        "src/page.vue": "<template><p>content</p></template>\n<script>import {createRouter} from 'vue-router'; const r=[{path:'/vue',component:()=>import('./Page')}];</script>",
        "src/page.svelte": "<p>view</p><script>navigate('/svelte')</script>",
        "src/page.astro": "---\nrouter.push('/astro');\n---\n<p>content</p>",
        "readme.md": "ignored"
    };
    const owned = Object.keys(files).filter(file => /alias|anonymous|class|export/.test(file)).map(source => ({ source, path: '/' + source }));
    const graph = parseSourceGraph([{ path: ".", routes: owned }], Object.keys(files), file => files[file]);
    assert.ok(graph.records.some(item => item.route === "/parent/child"));
    assert.ok(graph.records.some(item => item.kind === "readiness-contract"));
    assert.ok(graph.records.some(item => item.route === "/astro"));
    assert.ok(graph.relationships.some(item => item.symbol === "Other"));
    assert.equal(graph.warnings.length, 1);
    assert.equal(graph.parser, "typescript");
});
test("draft decisions are recomputed from current settings and summaries retain actionable causes", async (t) => {
    const { dir } = await fixture(t), root = join(dir, "project");
    fs.mkdirSync(root);
    write(join(root, "package.json"), { dependencies: { react: "1" }, scripts: { dev: "node server.mjs", storybook: "storybook dev", "mock-server": "node mock.mjs" } });
    fs.writeFileSync(join(root, "app.tsx"), "export function HomePage(){return <main/>} window.__SCREENS_CAPTURE__ = {}; process.env.API_KEY;");
    fs.writeFileSync(join(root, "capture-one.mjs"), "export const fixtureParams={id:'one'}; export function buildScenarios(){};");
    fs.writeFileSync(join(root, "capture-two.mjs"), "export const fixtureParams={id:'two'};");
    fs.writeFileSync(join(root, "capture-three.mjs"), "export const fixtureParams={id:'three'};");
    const draft = draftAutomaticPlan(root, { project: "demo" });
    assert.equal(draft.execution, "not-run");
    assert.ok(draft.decisions.some(item => item.blocking));
    assert.ok(draft.discovery.backlog.length);
    const detected = detectProject(root);
    assert.ok(configurationDecisions({ applications: [{ path: ".", adapter: "unknown" }, { path: ".", adapter: "command" }, { path: ".", adapter: "apple" }] }, detected).every(item => item.blocking));
    const proposals = [{ application: ".", kind: "fixture-conflict", name: "id" }, { application: ".", kind: "scenario-import", evidence: ["capture-one.mjs"] }, { application: ".", kind: "environment", name: "API_KEY" }, { application: ".", kind: "readiness" }, { application: "missing", kind: "readiness" }, { kind: "classify-candidate" }, { kind: "old", blocking: true }];
    const prepared = { applications: [{ ...app(), fixtureParams: { id: "one" }, scenarioImports: [{ file: "capture-one.mjs" }] }], env: { API_KEY: "provided" } };
    assert.deepEqual(configurationDecisions(prepared, detected, proposals), []);
    const unresolved = configurationDecisions({ applications: [{ path: ".", adapter: "browser", baseUrl: "http://fixture" }] }, detected, proposals);
    assert.ok(unresolved.some(item => item.kind === "environment"));
    fs.writeFileSync(join(root, ".env"), "API_KEY=file");
    assert.equal(configurationDecisions(prepared, detected, [proposals[2]]).length, 0);
    const recipe = config(), recipeFile = join(dir, "capture.json");
    write(recipeFile, recipe);
    const first = automaticInput(root, { config: recipeFile });
    assert.ok(first.inputHash);
    assert.equal(automaticInput(root, { recipe }).configPath, null);
    assert.throws(() => automaticInput(root, { config: join(dir, "missing") }), /not found/);
    const planFile = join(dir, "plan.json");
    write(planFile, { version: 2 });
    assert.throws(() => automaticInput(root, { plan: planFile }), /version 1/);
    write(planFile, draft);
    assert.throws(() => automaticInput(root, { plan: planFile }), /Set/);
    write(planFile, { version: 1, configuration: recipe });
    assert.ok(automaticInput(root, { plan: planFile }).inputHash);
    write(join(root, "screens.capture.json"), recipe);
    assert.ok(automaticInput(root).configPath);
    assert.equal(identityHash({ run: () => 1 }).length, 64);
    const report = { status: "partial", job: "job", run: { captureIds: ["a"] }, coverage: { metrics: { screens: { ready: 1, total: 2 }, scenarios: { ready: 1, total: 2 }, variants: { ready: 1, total: 2 }, candidates: { unresolved: 1 } } }, fixtureErrors: ["Fixture reset failed"], error: "Source or capture inputs changed", applications: [{ path: "app", issues: ["readiness failure", "other failure"] }], scenarios: [{ applicationIndex: 0, key: "a", variant: { device: "phone" }, readiness: { status: "failed", reason: "readiness failure" }, reused: true }], url: "http://review" };
    const summary = captureSummary(report);
    assert.equal(summary.reused, 1);
    assert.match(formatCaptureSummary(summary), /Review: http/);
    const duplicates = captureSummary({ applications: [{ path: "app", issues: Array(7).fill("same failure") }], scenarios: Array.from({ length: 7 }, (_, i) => ({ key: `s${i}`, variant: {}, readiness: { status: "failed", reason: "login failure" } })) });
    assert.match(formatCaptureSummary(duplicates), /more in report/);
    assert.match(formatCaptureSummary(captureSummary({})), /0 images/);
});
test('recipe edge cases retain explicit profile overrides and diagnose incomplete adapter declarations', async (t) => {
    const { dir } = await fixture(t), file = join(dir, 'edge.json');
    assert.deepEqual(expandCaptureConfig({}).applications, []);
    const source = { applications: [{ adapter: 'browser', scenarios: [{}] }], profiles: { quick: { defaults: { env: { TEST: 'value' } }, applications: [{ ready: 'main' }, { path: 'other', adapter: 'command', command: ['capture'] }] } } };
    const expanded = expandCaptureConfig(source, { profile: 'quick' });
    assert.equal(expanded.applications.length, 2);
    assert.equal(expanded.applications[0].env.TEST, 'value');
    for (const applications of [[app(), app()], [{ adapter: 'command', command: ['capture'] }], [{ adapter: 'command', command: ['capture'], scenarioImports: [] }], [{ adapter: 'apple' }], [{ ...app(), scenarios: [{}] }]]) {
        write(file, { version: 1, scope: 'configured', project: { id: 'demo', name: 'Demo' }, applications });
        const result = diagnoseCaptureConfig(file);
        assert.ok(Array.isArray(result.issues));
    }
    assert.equal(captureSummary({ applications: [{ path: 'app', issues: ['service unavailable'] }] }).groups.length, 1);
    assert.equal(captureSummary({ applications: [{ path: 'app' }] }).groups.length, 0);
});
test('draft plans distinguish runnable frontends, unsupported native tools and unresolved Apple platforms', async (t) => {
    const { dir } = await fixture(t), root = join(dir, 'mixed');
    fs.mkdirSync(root);
    fs.writeFileSync(join(root, 'index.html'), '<main>Static</main>');
    fs.writeFileSync(join(root, '.env.example'), 'API_KEY=\n');
    const put = (file, value) => { fs.mkdirSync(join(root, file, '..'), { recursive: true }); fs.writeFileSync(join(root, file), typeof value === 'string' ? value : JSON.stringify(value)); };
    put('web/package.json', { dependencies: { react: '1' }, scripts: { start: 'vite' } });
    put('web/capture.mjs', 'export function buildScenarios(){return []}');
    put('empty/package.json', { dependencies: { react: '1' } });
    put('tool/Package.swift', '.executableTarget(name:"Tool")');
    put('native/Unknown.xcodeproj/project.pbxproj', 'com.apple.product-type.application');
    put('screens.native.json', { version: 1, applications: [{ path: 'Declared.xcodeproj', platforms: ['iphone'], screens: [{ id: 'home' }] }] });
    const plan = draftAutomaticPlan(root);
    assert.ok(plan.decisions.some(item => item.kind === 'adapter'));
    assert.ok(plan.decisions.some(item => item.kind === 'startup'));
    assert.ok(plan.decisions.some(item => item.kind === 'native-platforms'));
    assert.ok(plan.decisions.some(item => item.kind === 'environment'));
    const detected = detectProject(root);
    assert.deepEqual(configurationDecisions({}, detected), []);
    assert.ok(configurationDecisions({ services: [{ name: 'api', command: ['node'], ready: { url: ' ' } }], applications: [] }, detected).length);
    assert.ok(configurationDecisions({ applications: [{ path: 'missing', adapter: 'apple' }] }, detected).length);
    fs.writeFileSync(join(root, 'custom.env'), 'EXPLICIT_SETTING=value');
    const simple = config();
    simple.envFiles = ['custom.env'];
    simple.env = { API_KEY: 'configured', OTHER: '{env.EXPLICIT_SETTING}' };
    const file = join(dir, 'inherited.json');
    write(file, simple);
    assert.ok(automaticInput(root, { config: file }).inputHash);
    const proposals = [{ kind: 'environment', name: 'EXPLICIT_SETTING' }];
    assert.equal(configurationDecisions({ applications: [], envFiles: ['custom.env'] }, detected, proposals).length, 0);
});
