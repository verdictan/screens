import test from 'node:test';
import assert from 'node:assert/strict';
import { components } from './support/components.mjs';
test('annotation geometry supports pointer cancellation, thresholds and every keyboard direction', async (t) => {
    const u = await components(t), selected = [], opened = [];
    let cancelled = 0;
    const props = { capture: { id: 'capture' }, notes: [{ id: 'area', text: 'Area', region: { x: .1, y: .2, width: .3, height: .4 } }, { id: 'plain' }], pin: { capture: 'capture', region: { x: 0, y: 0, width: .1, height: .1 } }, selecting: true, onSelect: value => selected.push(value), onOpen: value => opened.push(value), onCancel: () => cancelled++ };
    u.render(u.api.AnnotationLayer, props);
    u.$('button').click();
    assert.equal(opened[0].noteId, 'area');
    const surface = u.$('.annotation-surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    u.pointer(surface, 'pointerdown', { button: 1 });
    u.pointer(surface, 'pointerdown', { isPrimary: false });
    u.pointer(surface, 'pointermove', { pointerId: 2 });
    u.pointer(surface, 'pointerup', { pointerId: 2 });
    assert.equal(selected.length, 0);
    u.pointer(surface, 'pointerdown');
    u.pointer(surface, 'pointermove', { clientX: 80, clientY: 90 });
    u.pointer(surface, 'pointerup', { clientX: 80, clientY: 90 });
    assert.equal(selected.length, 1);
    assert.ok(Math.abs(selected[0].region.width - .7) < 1e-12);
    u.pointer(surface, 'pointerdown');
    u.pointer(surface, 'pointerup', { clientX: 11, clientY: 11 });
    assert.equal(selected.length, 1);
    u.pointer(surface, 'pointerdown');
    u.pointer(surface, 'pointercancel');
    u.pointer(surface, 'lostpointercapture');
    u.key(surface, 'a');
    u.key(surface, 'ArrowLeft');
    u.key(surface, 'Enter');
    for (const shiftKey of [false, true])
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])
            u.key(surface, key, { shiftKey });
    u.key(surface, ' ');
    assert.equal(selected.length, 2);
    u.key(surface, 'Enter');
    u.key(surface, 'Escape');
    assert.equal(cancelled, 1);
    u.render(u.api.AnnotationLayer, { ...props, selecting: false, pin: { capture: 'other' } });
    assert.equal(u.$('.annotation-surface'), null);
});
test('region comparison uses exact crop bounds in split, single, overlay and loading states', async (t) => {
    const u = await components(t), left = { id: 'left', url: '/left', preview: { width: 100, height: 80 } }, right = { id: 'right', url: '/right' };
    const props = { left, right, roles: ['current', 'pr'], region: { x: .1, y: .1, width: .5, height: .5 }, dimensions: { right: { width: 100, height: 80 } }, blend: 40 };
    for (const view of ['split', 'left', 'right', 'overlay']) {
        u.render(u.api.RegionComparison, { ...props, view });
        assert.equal(u.all('svg').length, view === 'left' || view === 'right' ? 1 : 2);
        assert.equal(u.$('svg').getAttribute('viewBox'), '10 8 50 40');
    }
    u.render(u.api.RegionComparison, { ...props, dimensions: {}, view: 'split' });
    assert.match(u.doc.body.textContent, /Loading selected area/);
});
test('control primitives retain labels, keyboard interaction and close controls', async (t) => {
    const u = await components(t), a = u.api, h = u.h;
    u.render('div', {}, h(a.Separator), h(a.Separator, { orientation: 'vertical', decorative: false }), h(a.Button, { shortcut: 'Mod+k' }, 'Search'), h(a.Button, { shortcut: 'Alt+ArrowRight', 'aria-label': 'Next' }, h('span', {}, 'Icon')), h(a.Button, { shortcut: 'Mod+x' }, h('span', {}, 'Action')), h(a.Button, { asChild: true }, h('a', { href: '#link' }, 'Link')), h(a.Slider, { defaultValue: [20] }), h(a.Slider));
    assert.equal(u.all('[data-slot=separator]').length, 2);
    assert.match(u.$('button').title, /⌘/);
    assert.ok(u.$('a[data-slot=button]'));
    u.render(a.Dialog, { open: true }, h(a.DialogTrigger, {}, 'Open'), h(a.DialogContent, {}, h(a.DialogHeader, {}, h(a.DialogTitle, {}, 'Title'), h(a.DialogDescription, {}, 'Description')), h(a.DialogFooter, { showCloseButton: true }, h(a.DialogClose, {}, 'Done'))));
    assert.match(u.doc.body.textContent, /Title/);
    assert.ok(u.$('[data-slot=dialog-footer]'));
    u.render(a.Dialog, { open: true }, h(a.DialogContent, { showCloseButton: false }, h(a.DialogTitle, {}, 'Title'), h(a.DialogDescription, {}, 'Description'), h(a.DialogFooter)));
    assert.equal(u.$('[data-slot=dialog-close]'), null);
    u.render(a.Drawer, { open: true }, h(a.DrawerTrigger, {}, 'Open'), h(a.DrawerContent, {}, h(a.DrawerHeader, {}, h(a.DrawerTitle, {}, 'Drawer'), h(a.DrawerDescription, {}, 'Description')), h(a.DrawerFooter, {}, h(a.DrawerClose, {}, 'Close'))));
    await u.until(() => u.$('[data-slot=drawer-title]'));
    assert.match(u.doc.body.textContent, /Drawer/);
    u.render(a.CommandDialog, { open: true }, h(a.CommandInput), h(a.CommandList, {}, h(a.CommandEmpty), h(a.CommandGroup, { heading: 'Actions' }, h(a.CommandItem, {}, 'Open', h(a.CommandShortcut, {}, '⌘K'))), h(a.CommandSeparator)));
    assert.ok(u.$('[data-slot=command-group]'));
});
test('command discovery reveals nested actions and handles selects, context, and unnamed controls', async (t) => {
    const u = await components(t), pages = [];
    u.doc.body.insertAdjacentHTML('beforeend', `<main><button disabled>Skip</button><button role="tab">Tab</button><div class="is-loading"><button>Loading</button></div><button></button><input id="name" aria-label="Name"><input type="file" aria-label="Upload"><select aria-label="Choice"><option value="a">A</option><option disabled value="b">B</option></select><div data-page="feedback"><article id="notes"><p>Context</p><button>Resolve</button></article></div><div data-slot="collapsible" data-state="closed"><button data-slot="collapsible-trigger">Reveal</button><div class="history-entry"><h3>Old capture</h3><a href="#old">Open old</a></div></div></main>`);
    const actions = u.api.collectActions(page => pages.push(page));
    assert.equal(actions.some(item => item.label === 'Skip'), false);
    assert.equal(actions.some(item => item.label === 'Choice: B'), false);
    for (const action of actions)
        await action.run();
    await new Promise(done => setTimeout(done, 40));
    assert.ok(pages.includes('feedback'));
    assert.equal(u.$('select').value, 'a');
    let closed = 0, ran = 0;
    const commands = [{ id: 'run', label: 'Run action', group: 'Workspace', shortcut: 'Mod+k', run: () => ran++ }];
    u.render(u.api.CommandMenu, { open: true, commands, mobile: false, onClose: () => { closed++; u.render(u.api.CommandMenu, { open: false, commands, mobile: false, onClose: () => { } }); } });
    await u.until(() => u.$('[cmdk-item]'));
    u.$('[cmdk-item]').click();
    await new Promise(done => setTimeout(done, 50));
    assert.equal(ran, 1);
    assert.equal(closed, 1);
    u.render(u.api.CommandMenu, { open: true, commands: [], mobile: true, onClose: () => closed++ });
    await u.until(() => u.$('[aria-label="Close command menu"]'));
    u.$('[aria-label="Close command menu"]').click();
    assert.equal(closed, 2);
});
test('review sets preserve order, remove members, report failures and save expected revisions', async (t) => {
    let fail = true;
    const requests = [];
    const u = await components(t, { fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: !fail, status: 409, json: async () => fail ? { error: 'Changed revision' } : { id: 'saved' } }; } }), a = u.api;
    const entries = [{ screen: 'app/a', title: 'First', variant: { device: 'desktop' } }, { screen: 'app/b', title: 'Second', variant: { device: 'phone' } }];
    const set = { id: 'flow', title: 'Flow', entries: entries.map(a.entryKey), revision: 2 };
    let selected;
    const props = { run: { id: 'run', entries }, sets: [set], active: set, onSelect: value => selected = value };
    const click = text => u.api.flushSync(() => [...u.doc.querySelectorAll('button')].find(node => node.textContent === text || node.getAttribute('aria-label')?.startsWith(text)).click());
    const change = (selector, value) => { const node = u.$(selector); Object.getOwnPropertyDescriptor(node.tagName === 'INPUT' ? u.w.HTMLInputElement.prototype : u.w.HTMLSelectElement.prototype, 'value').set.call(node, value); u.api.flushSync(() => node.dispatchEvent(new u.w.Event(node.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }))); };
    u.render(a.ReviewSets, props);
    click('Edit set');
    click('Move First');
    click('Move Second');
    click('Remove First');
    change('#review-set-add', '');
    change('#review-set-add', a.entryKey(entries[0]));
    u.api.flushSync(() => u.$('form').dispatchEvent(new u.w.Event('submit', { bubbles: true, cancelable: true })));
    await u.until(() => u.doc.body.textContent.includes('Changed revision'));
    fail = false;
    u.api.flushSync(() => u.$('form').dispatchEvent(new u.w.Event('submit', { bubbles: true, cancelable: true })));
    await u.until(() => selected === 'saved');
    assert.equal(requests.at(-1).expectedRevision, 2);
    click('New set');
    change('#review-set-title', 'New flow');
    change('#review-set-add', a.entryKey(entries[0]));
    click('Cancel');
    assert.equal(u.$('form'), null);
    click('New set');
    u.$('[data-slot=dialog-close]').click();
    await u.until(() => !u.$('form'));
});
test('shortcuts distinguish platform modifiers and typing targets', async (t) => {
    for (const platform of ['MacIntel', 'Linux']) {
        const u = await components(t, { platform }), a = u.api;
        assert.equal(a.shortcutLabel('Mod+Alt+ArrowLeft'), platform === 'MacIntel' ? '⌘+⌥+←' : 'Ctrl+Alt+←');
        assert.equal(a.shortcutLabel('ArrowRight'), '→');
        assert.equal(a.matchesShortcut({ key: 'k', altKey: false, shiftKey: false, ctrlKey: platform !== 'MacIntel', metaKey: platform === 'MacIntel' }, 'Mod+k'), true);
        assert.equal(a.matchesShortcut({ key: 'k', altKey: false, shiftKey: false, ctrlKey: true, metaKey: true }, 'Mod+k'), false);
        assert.equal(a.typing({ isComposing: true }), true);
        assert.equal(a.typing({ target: null }), false);
        const input = u.doc.createElement('input');
        assert.equal(a.typing({ target: input }), true);
        assert.equal(a.typing({ target: u.doc.body }), false);
    }
});
test('resource requests deduplicate writes, retry failures, and protect refreshes against stale results', async (t) => {
    let status = 503, release;
    const calls = [];
    const u = await components(t, { fetch: async (url, options = {}) => { calls.push([url, options]); if (url === '/slow')
            await new Promise(done => release = done); return { ok: status === 200, status, json: async () => ({ error: status === 200 ? undefined : 'Unavailable', value: status }) }; } }), a = u.api;
    await assert.rejects(a.api('/read'), /Unavailable/);
    await assert.rejects(a.api('/write', { value: 1 }), /Unavailable/);
    const first = calls.at(-1)[1].headers['Idempotency-Key'];
    status = 200;
    const p = a.api('/write', { value: 1 }), q = a.api('/write', { value: 1 });
    assert.deepEqual(await p, await q);
    assert.equal(calls.at(-1)[1].headers['Idempotency-Key'], first);
    status = 400;
    await assert.rejects(a.api('/bad', { value: 2 }));
    const old = calls.at(-1)[1].headers['Idempotency-Key'];
    status = 200;
    await a.api('/bad', { value: 2 });
    assert.notEqual(calls.at(-1)[1].headers['Idempotency-Key'], old);
    let snapshot;
    function Probe({ url }) { snapshot = a.useResource(url); return a.React.createElement('p', {}, snapshot.data ? 'Loaded' : 'Pending'); }
    u.render(Probe, { url: '/resource' });
    await u.until(() => snapshot.data);
    u.w.dispatchEvent(new u.w.Event('focus'));
    u.w.dispatchEvent(new u.w.Event('online'));
    await a.refreshResources();
    const pending = a.revalidate('/slow');
    assert.equal(a.revalidate('/slow'), pending);
    release();
    await pending;
    u.render(Probe, { url: null });
    await a.refreshResources();
    assert.equal(snapshot.data, undefined);
});
test('Undo confirms after its delay and restores pending actions on unmount', async (t) => {
    const u = await components(t), a = u.api;
    let undo;
    const realSet = u.w.setTimeout.bind(u.w), realClear = u.w.clearTimeout.bind(u.w);
    let timer;
    u.w.setTimeout = (fn, ms, ...args) => ms === 7000 ? (timer = fn, 7000) : realSet(fn, ms, ...args);
    u.w.clearTimeout = id => { if (id !== 7000)
        realClear(id); };
    function Probe() { undo = a.useUndo(); return u.h('span', {}, 'ready'); }
    u.render(a.UndoProvider, {}, u.h(Probe), u.h(a.Toaster));
    const confirmed = undo('Reopened');
    timer();
    assert.equal(await confirmed, true);
    const reversed = undo('Reopened');
    await u.until(() => u.doc.body.textContent.includes('Undo'));
    u.$('.undo-toast button').click();
    assert.equal(await reversed, false);
    const pending = undo('Pending');
    u.render('div');
    assert.equal(await pending, false);
});
test('springs can be interrupted while held and view transitions can be skipped', async (t) => {
    const u = await components(t, { motion: false }), a = u.api;
    let paint, rest = 0;
    u.w.document.startViewTransition = update => { update(); return { ready: Promise.reject(Error('interrupted')), finished: Promise.reject(Error('interrupted')), updateCallbackDone: Promise.resolve(), skipTransition() { rest++; } }; };
    await a.changeView(() => rest++);
    await a.changeView(() => rest++);
    assert.equal(rest, 3);
    function Spring({ target, held = false }) { const ref = a.React.useRef(null); paint = a.useSpring(ref, '--value', target, { held, onRest: () => rest++ }); return u.h('div', { ref }); }
    u.render(Spring, { target: 1 });
    paint(.2, 1);
    u.render(Spring, { target: 0, held: true });
    paint(.5);
    assert.equal(u.$('#root > div').style.getPropertyValue('--value'), '0.5');
    u.render(Spring, { target: 0 });
    await new Promise(done => setTimeout(done, 1500));
    assert.equal(u.$('#root > div').style.getPropertyValue('--value'), '0');
    u.w.matchMedia = () => ({ matches: true });
    await a.changeView(() => rest++);
    u.render(Spring, { target: 1 });
    await new Promise(done => setTimeout(done, 40));
    assert.equal(u.$('#root > div').style.getPropertyValue('--value'), '1');
});
test('capture images handle missing previews, empty hashes and already cached images', async (t) => {
    const u = await components(t);
    u.render(u.api.CaptureImage, { capture: { id: 'plain', url: '/plain' }, alt: 'Plain' });
    await new Promise(done => setTimeout(done, 20));
    assert.equal(u.$('.capture-image-frame').style.getPropertyValue('--image-ratio'), '1');
    Object.defineProperties(u.w.HTMLImageElement.prototype, { complete: { configurable: true, get: () => true }, naturalWidth: { configurable: true, get: () => 100 } });
    u.render(u.api.CaptureImage, { capture: { id: 'cached', url: '/cached', preview: { width: 100, height: 50 } }, alt: 'Cached' });
    await u.until(() => u.$('.capture-image-frame').dataset.loaded === 'true');
    assert.equal(u.$('.capture-image-frame').style.aspectRatio, '100 / 50');
    const failed = await components(t, { fetch: async () => ({ ok: false, status: 502, json: async () => ({}) }) });
    await assert.rejects(failed.api.api('/missing'), /HTTP 502/);
});
test('Undo ignores an already completed timer callback', async (t) => {
    const u = await components(t);
    let undo, timer;
    const set = u.w.setTimeout.bind(u.w);
    u.w.setTimeout = (fn, ms, ...args) => ms === 7000 ? (timer = fn, 1) : set(fn, ms, ...args);
    function Probe() { undo = u.api.useUndo(); return null; }
    u.render(u.api.UndoProvider, {}, u.h(Probe));
    const action = undo('Change');
    timer();
    timer();
    assert.equal(await action, true);
});
test('feedback forms preserve point and area annotations and restore cancelled removals', async (t) => {
    const writes = [];
    const u = await components(t, { fetch: async (_url, options) => { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; } }), a = u.api;
    let setPin, update;
    const capture = { id: 'current', url: '/current' }, entry = { captures: { current: capture } }, region = { x: .1, y: .1, width: .3, height: .3 };
    const note = { id: 'note', capture: 'current', status: 'verified', revision: 1, author: 'Reviewer', text: 'Text', createdAt: new Date().toISOString() };
    const perform = async (fn) => fn();
    function Probe() { const [pin, change] = a.React.useState({ capture: 'current', point: { x: .2, y: .3 } }); setPin = change; return u.h(a.Feedback, { entry, notes: [note], pin, setPin: change, perform, onCompareArea: () => { } }); }
    u.render(a.UndoProvider, {}, u.h(Probe), u.h(a.Toaster));
    const click = text => u.api.flushSync(() => u.all('button').find(node => node.textContent === text).click());
    const submit = async () => { u.$('#note-text').value = 'Annotation'; u.$('#note-form').dispatchEvent(new u.w.Event('submit', { bubbles: true, cancelable: true })); await u.until(() => writes.length > 0); await new Promise(done => setTimeout(done, 10)); };
    await submit();
    assert.equal(writes.at(-1).point.x, .2);
    a.flushSync(() => setPin({ capture: 'current', region }));
    await submit();
    assert.equal(writes.at(-1).region.width, .3);
    a.flushSync(() => setPin({ capture: 'current', region }));
    click('Remove selection');
    await u.until(() => u.$('.undo-toast button'));
    u.$('.undo-toast button').click();
    await u.until(() => u.$('.pin-context'));
    assert.match(u.$('.pin-context').textContent, /Selected area/);
    click('Reopen');
    await u.until(() => u.$('.undo-toast button'));
    u.$('.undo-toast button').click();
    await new Promise(done => setTimeout(done, 20));
    assert.equal(writes.filter(value => value.status === 'open').length, 0);
    const author = u.$('#author');
    Object.getOwnPropertyDescriptor(u.w.HTMLInputElement.prototype, 'value').set.call(author, '');
    a.flushSync(() => author.dispatchEvent(new u.w.Event('input', { bubbles: true })));
    assert.match(u.doc.body.textContent, /Posting as reviewer/);
});
test('pixel mask Undo restores the previous excluded regions and overlay has no-preview sizing', async (t) => {
    const u = await components(t), a = u.api, variant = { device: 'desktop', theme: 'light', locale: 'en', viewport: '100x100' }, capture = id => ({ id, url: `/${id}`, variant, revision: id, fixture: 'seed' }), entry = { screen: 'demo/home', captures: { current: capture('current'), target: capture('target') }, variant };
    u.render(a.UndoProvider, {}, u.h(a.Comparison, { entry, detail: { notes: [], diffs: [], captures: Object.values(entry.captures) }, pin: null, setPin: () => { }, perform: async (fn) => fn(), onFeedback: () => { } }), u.h(a.Toaster));
    const click = async (text) => { a.flushSync(() => u.all('button').find(node => node.textContent.trim() === text || node.getAttribute('aria-label') === text).click()); await new Promise(done => setTimeout(done, 10)); };
    await click('Overlay');
    assert.equal(u.$('.overlay-images').style.getPropertyValue('--image-ratio'), '1.5');
    await click('Inspect pixel differences');
    for (const [field, value] of Object.entries({ x: 0, y: 0, width: 1, height: 1 })) {
        const node = u.$('#mask-' + field);
        Object.getOwnPropertyDescriptor(u.w.HTMLInputElement.prototype, 'value').set.call(node, String(value));
        a.flushSync(() => node.dispatchEvent(new u.w.Event('input', { bubbles: true })));
    }
    await click('Add region');
    await click('Clear');
    await u.until(() => u.$('.undo-toast button'));
    u.$('.undo-toast button').click();
    await u.until(() => !u.doc.body.textContent.includes('No excluded regions'));
});
test('write failures without an error body show the HTTP status', async (t) => { const u = await components(t, { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }); await assert.rejects(u.api.api('/write', { value: 1 }), /HTTP 500/); });
