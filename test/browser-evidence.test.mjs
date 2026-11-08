import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fixture } from './support/registry.mjs';
import { startBrowserEvidence, attachBrowserEvidence, saveDerived, exportReviewReport } from '../src/evidence-tools.mjs';
import { prepareBrowserPage, readiness } from '../src/capture-scenarios.mjs';
import { mutate } from '../src/operations.mjs';
import { preparePreview, prepareCaptures } from '../src/previews.mjs';
import { join } from 'node:path';
function world(t) {
    const dom = new JSDOM('<!doctype html><html><body><p style="font-family: Wanted">First</p><div></div><p style="font-family:sans-serif">Second</p></body></html>');
    const values = { window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), innerWidth: 100, innerHeight: 80, scrollX: 0, scrollY: 0 };
    const previous = new Map();
    for (const [key, value] of Object.entries(values)) {
        previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    const fonts = [{ family: 'Wanted', status: 'loaded', weight: '400', style: 'normal' }];
    fonts.status = 'loaded';
    fonts.ready = Promise.resolve();
    fonts.load = async () => [];
    Object.defineProperty(dom.window.document, 'fonts', { value: fonts });
    for (const element of dom.window.document.querySelectorAll('*')) {
        element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 60, bottom: 50, width: 50, height: 40 });
        for (const key of ['scrollWidth', 'clientWidth', 'offsetWidth'])
            Object.defineProperty(element, key, { value: 100, configurable: true });
        for (const key of ['scrollHeight', 'clientHeight', 'offsetHeight'])
            Object.defineProperty(element, key, { value: 80, configurable: true });
    }
    t.after(() => { for (const [key, descriptor] of previous) {
        if (descriptor)
            Object.defineProperty(globalThis, key, descriptor);
        else
            delete globalThis[key];
    } dom.window.close(); });
    return dom.window;
}
test('browser collectors isolate navigation generations, clip geometry, and report font fallback', async (t) => {
    const w = world(t), page = new EventEmitter();
    let chromium = true, nodeId = 1;
    Object.assign(page, { url: () => 'http://fixture', title: async () => 'Fixture', content: async () => w.document.documentElement.outerHTML, evaluate: async (fn, input) => typeof fn === 'string' ? undefined : fn(input), locator: selector => ({ count: async () => w.document.querySelectorAll(selector).length, evaluate: async (fn, value) => fn(w.document.querySelector(selector), value) }), context: () => ({ browser: () => ({ browserType: () => ({ name: () => chromium ? 'chromium' : 'firefox' }) }), newCDPSession: async () => ({ send: async (method) => method === 'DOM.getDocument' ? { root: { nodeId: 1 } } : method === 'DOM.querySelector' ? { nodeId } : method === 'CSS.getPlatformFontsForNode' ? { fonts: [{ familyName: 'Fallback', glyphCount: 3 }, { familyName: 'Wanted', glyphCount: 2 }, { familyName: 'Unused', glyphCount: 0 }] } : {}, detach: async () => { } }) }) });
    w.axe = { run: async () => ({ violations: [], incomplete: [], passes: [] }) };
    const previousAxe = globalThis.axe;
    globalThis.axe = w.axe;
    t.after(() => { if (previousAxe === undefined)
        delete globalThis.axe;
    else
        globalThis.axe = previousAxe; });
    const collector = startBrowserEvidence(page, { dom: true, console: true, network: true, fonts: true, accessibility: true, selectors: ['p:first-child', { selector: 'p:last-child', text: 'Review' }] });
    const request = { url: () => 'http://fixture/error', method: () => 'GET', resourceType: () => 'fetch', failure: () => ({ errorText: 'offline' }) };
    page.emit('request', request);
    page.emit('console', { type: () => 'error', text: () => 'Error', location: () => ({ url: 'fixture' }) });
    page.emit('pageerror', Error('page failed'));
    page.emit('requestfailed', request);
    page.emit('response', { status: () => 500, request: () => request, url: request.url });
    page.emit('response', { status: () => 200, request: () => request });
    const result = await collector.collect({ fixture: { version: 'v1' } });
    assert.equal(result.console.items.length, 2);
    assert.equal(result.network.items.length, 2);
    assert.equal(result.fonts.actualFontSupport, true);
    assert.equal(result.fonts.elements[0].fallbackFonts[0].familyName, 'Fallback');
    assert.equal(result.fonts.elements[1].fallbackFonts.length, 0);
    assert.equal(result.selectors.items[0].region.width, .5);
    collector.reset();
    page.emit('requestfailed', request);
    assert.equal((await collector.collect()).network.items.length, 0);
    nodeId = 0;
    assert.deepEqual((await collector.collect()).fonts.elements[0].platformFonts, []);
    chromium = false;
    assert.equal((await collector.collect({ fullPage: false })).fonts.actualFontSupport, false);
    const hidden = w.document.querySelector('p');
    hidden.getBoundingClientRect = () => ({ left: -100, top: -100, right: -10, bottom: -10, width: 90, height: 90 });
    assert.equal((await collector.collect()).selectors.items[0].region, null);
    await assert.rejects(collector.collect({ selectors: ['missing'] }), /must match/);
    collector.dispose();
    for (const key of ['scrollWidth', 'offsetWidth', 'scrollHeight', 'offsetHeight'])
        Object.defineProperty(w.document.body, key, { value: 0, configurable: true });
    await collector.collect();
    const configured = startBrowserEvidence(page, { accessibility: { context: 'main', options: {} } });
    await configured.collect();
    configured.dispose();
    const empty = startBrowserEvidence(page);
    assert.deepEqual(await empty.collect(), {});
    empty.dispose();
    const f = await fixture(t), capture = f.capture();
    attachBrowserEvidence(f.store, capture.id, { ...result, selectors: { items: [{ selector: 'p', region: { x: 0, y: 0, width: .5, height: .5 }, text: 'Region' }] } });
    assert.ok(f.store.getScreen(capture.screen).notes.length);
    const selectorData = { selectors: { items: [{ selector: 'p', region: { x: 0, y: 0, width: .5, height: .5 }, text: 'Region' }] } };
    attachBrowserEvidence(f.store, capture.id, selectorData);
    attachBrowserEvidence(f.store, capture.id, selectorData);
    attachBrowserEvidence(f.store, capture.id, { selectors: { items: [{ text: 'Region', author: 'Other', region: { x: 0, y: 0, width: .25, height: .25 } }, { text: 'No region' }] } });
    for (const state of [{ violations: [{}], incomplete: [], passes: [] }, { violations: [], incomplete: [{}], passes: [], testEngine: { version: 'test' } }])
        attachBrowserEvidence(f.store, capture.id, { accessibility: state });
});
test('browser init scripts seed randomness, remember readiness events and validate app signals', async (t) => {
    const w = world(t), random = Math.random;
    t.after(() => { Math.random = random; });
    const page = { clock: { setFixedTime: async () => { } }, addInitScript: async (fn, input) => fn(input), evaluate: async (fn, arg) => fn(arg), waitForFunction: async (fn, arg) => { if (!fn(arg))
            throw Error('not ready'); }, locator: () => ({ waitFor: async () => { } }) };
    await prepareBrowserPage(page, {}, { fixture: 'seed', determinism: { seed: 'deterministic' } }, { ready: { event: 'capture-ready' } }, '.');
    const first = Math.random();
    assert.ok(first >= 0 && first < 1);
    w.dispatchEvent(new w.Event('capture-ready'));
    assert.equal(w.__SCREENS_READY_EVENTS__['capture-ready'], true);
    assert.equal((await readiness(page, { event: 'capture-ready' })).status, 'passed');
    const request = { version: 1, requestId: 'current', screen: 'home', fixture: 'seed' };
    w.__SCREENS_CAPTURE__ = { ...request, state: 'ready', pending: 0 };
    assert.equal((await readiness(page, {}, request)).status, 'passed');
    w.__SCREENS_CAPTURE__.requestId = 'stale';
    assert.equal((await readiness(page, {}, request)).status, 'failed');
    w.__SCREENS_CAPTURE__ = { state: 'error' };
    assert.equal((await readiness(page, { contract: { required: true } })).reason, 'Application reported an error');
    delete w.__SCREENS_CAPTURE__;
    await prepareBrowserPage(page, {}, {}, {}, '.');
    assert.equal(w.__SCREENS_FIXTURE__.version, undefined);
});
test('idempotent mutations replay matching writes, reject conflicts and preserve preview decoding limits', async (t) => {
    const f = await fixture(t), key = randomUUID();
    const project = await mutate(f.store, 'project', { id: 'other', name: 'Other', metadata: { array: [1, null] } }, key);
    assert.deepEqual(await mutate(f.store, 'project', { name: 'Other', metadata: { array: [1, null] }, id: 'other' }, key), project);
    await assert.rejects(mutate(f.store, 'project', { id: 'different', name: 'Different' }, key), error => error.status === 409);
    await assert.rejects(mutate(f.store, 'project', { id: 'x', name: 'X' }, 'bad'), /UUID/);
    assert.equal(f.store.requestFingerprint('action', { b: 2, a: [1] }), f.store.requestFingerprint('action', { a: [1], b: 2 }));
    const capture = await mutate(f.store, 'capture', { screen: 'demo/home', role: 'current', imageBase64: f.bytes.toString('base64') }, randomUUID());
    assert.ok(capture.preview);
    const target = await mutate(f.store, 'capture', { screen: 'demo/home', role: 'target', bytes: f.bytes });
    await mutate(f.store, 'target', { capture: target.id, expectedRevision: 0 });
    const run = await mutate(f.store, 'run', { project: 'demo', title: 'Mutations', captureIds: [capture.id, target.id] });
    const entry = f.store.compare(run.id).entries[0];
    const set = await mutate(f.store, 'review-set', { run: run.id, title: 'Set', expectedRevision: 0, entries: [`${entry.screen}|${JSON.stringify(entry.variant)}`] });
    assert.equal(set.revision, 1);
    const fresh = await mutate(f.store, 'capture', { screen: 'demo/home', role: 'pr', bytes: f.bytes, revision: 'fresh' });
    const note = await mutate(f.store, 'note', { capture: capture.id, text: 'Review' });
    const submitted = await mutate(f.store, 'note.submit', { id: note.id, expectedRevision: note.revision, evidence: fresh.id, resolution: 'Fixed' });
    await mutate(f.store, 'note.update', { id: note.id, expectedRevision: submitted.revision, status: 'verified' });
    await mutate(f.store, 'diff', { left: capture.id, right: target.id });
    await mutate(f.store, 'screen', { project: 'other', key: 'screen', title: 'Screen' });
    await mutate(f.store, 'evidence', { capture: capture.id, author: 'Reviewer', kind: 'visual', method: 'manual', outcome: 'pass', assertion: 'Matches', procedure: 'Inspect', observation: 'Matches' });
    await assert.rejects(mutate(f.store, 'unknown', {}), /Unknown/);
    await assert.rejects(preparePreview(f.store, Buffer.from('invalid')), /Cannot prepare/);
    const rotated = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const preview = await preparePreview(f.store, rotated);
    assert.equal(preview.width, 3);
    assert.equal(preview.height, 2);
    await prepareCaptures(f.store, [capture, f.capture({ bytes: rotated })]);
    const artifact = Buffer.from('report').toString('base64');
    for (const item of [capture, target])
        f.store.addEvidence({ capture: item.id, author: 'Reviewer', kind: 'visual', method: 'manual', outcome: 'pass', assertion: 'Checked', procedure: 'Inspect', observation: 'Done', artifactType: 'text/plain', artifactBase64: artifact });
    await exportReviewReport(f.store, { run: run.id, output: join(f.dir, 'report') });
});
test('empty capture payloads fail before creating evidence or idempotency results', async (t) => { const { store } = await fixture(t); await assert.rejects(mutate(store, 'capture', { screen: 'demo/home', role: 'current' }), error => error.status === 422); });
test('nested registry writes roll back independently and once reuses its stored result', async (t) => {
    const { store, capture } = await fixture(t), key = randomUUID();
    let calls = 0;
    const input = { name: 'once' };
    assert.deepEqual(store.once(key, 'example', input, () => { calls++; return { saved: true }; }), { saved: true });
    assert.deepEqual(store.once(key, 'example', input, () => { calls++; }), { saved: true });
    assert.equal(calls, 1);
    store.transaction(() => { assert.throws(() => store.transaction(() => { store.project({ id: 'rolled-back', name: 'Rollback' }); throw Error('nested rollback'); }), /nested rollback/); store.project({ id: 'kept', name: 'Kept' }); });
    assert.equal(store.projects().some(row => row.id === 'rolled-back'), false);
    const c = capture(), run = store.run({ project: 'demo', title: 'Sets', captureIds: [c.id] }), entry = store.compare(run.id).entries[0], entries = [`${entry.screen}|${JSON.stringify(entry.variant)}`];
    const set = store.saveReviewSet({ run: run.id, title: 'First', entries, expectedRevision: 0 });
    assert.equal(store.saveReviewSet({ id: set.id, run: run.id, title: 'Updated', entries, expectedRevision: 1 }).revision, 2);
    assert.throws(() => store.saveReviewSet({ id: 'missing', run: run.id, title: 'Missing', entries, expectedRevision: 0 }), error => error.status === 404);
    const report = { violations: [], incomplete: [], passes: [] };
    attachBrowserEvidence(store, c.id, { accessibility: report });
    attachBrowserEvidence(store, c.id, { accessibility: report });
    assert.equal(store.listEvidence({ capture: c.id }).length, 1);
});
