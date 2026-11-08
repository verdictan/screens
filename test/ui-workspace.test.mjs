import test from 'node:test';
import assert from 'node:assert/strict';
import { ui, until, seedReview } from './support/ui.mjs';
const ready = u => until(() => u.$('#review[aria-busy="false"] #title'));
const pause = () => new Promise(done => setTimeout(done, 40));
async function runCommand(u, id) { await u.click('Search screens and actions'); await until(() => u.$(`[cmdk-item][data-value="${id}"]`)); u.$(`[cmdk-item][data-value="${id}"]`).click(); await pause(); }
test('workspace command navigation switches screens, sets, runs and pages with keyboard shortcuts', async (t) => {
    const u = await ui(t, { seed: async (f) => { const value = await seedReview(f); const entries = f.store.compare(value.run.id).entries; const set = f.store.saveReviewSet({ run: value.run.id, title: 'Review flow', expectedRevision: 0, entries: entries.map(e => `${e.screen}|${JSON.stringify(e.variant)}`) }); return { ...value, set }; } });
    await ready(u);
    await u.change('#search', 'no match');
    await u.click('Show all screens');
    for (const id of ['focus', 'focus', 'library', 'library', 'refresh', 'search', `project-demo`, `run-${u.run.id}`, `set-${u.set.id}`, 'page-evidence', 'page-history', 'page-feedback', 'page-compare', 'screen-demo/second', 'screen-demo/home']) {
        await runCommand(u, id);
        await ready(u);
    }
    assert.match(u.w.location.search, /set=|run=/);
    await runCommand(u, 'screen-demo/uncovered');
    await until(() => u.doc.body.textContent.includes('no captures in a review run'));
    await u.click('Dismiss');
    await u.change('#review-set', '');
    await ready(u);
    await u.click('Refresh workspace');
    for (const img of u.all('.capture-image'))
        u.image(img);
    for (const [key, extra] of [['k', { ctrlKey: true }], ['Escape', {}], ['b', { ctrlKey: true }], ['b', { ctrlKey: true }], ['/', {}], ['1', { altKey: true }], ['2', { altKey: true }], ['3', { altKey: true }], ['4', { altKey: true }], ['x', { repeat: true }], ['x', { shiftKey: true }]]) {
        u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
        await pause();
    }
    await u.tab('Review');
    await u.click('Leave feedback');
    await u.tab('Review');
    await u.click('Focus on screenshots');
    await u.click('Show review panel');
    u.$('.review-jump').click();
    await pause();
    u.$('.comparison-jump').click();
    u.all('.review-facts button').find(node => node.textContent.startsWith('Open feedback')).click();
    await pause();
    u.all('.review-facts button').find(node => node.textContent.startsWith('Recorded evidence')).click();
    await pause();
    u.all('.review-facts button').find(node => node.textContent.startsWith('Screenshot history')).click();
});
test('mobile library supports closing, selecting and media changes without losing review state', async (t) => {
    let media, update;
    const u = await ui(t, { seed: seedReview, configure: w => { w.matchMedia = query => { const value = { media: query, matches: true, addEventListener(_name, fn) { if (query.includes('760px')) {
                media = value;
                update = fn;
            } }, removeEventListener() { } }; return value; }; } });
    await ready(u);
    await u.click('Show screen library');
    await until(() => u.$('.library-drawer'));
    await u.click('Close library');
    await pause();
    await u.click('Show screen library');
    await until(() => u.$('.screen-item'));
    u.$('.screen-item').click();
    await pause();
    media.matches = false;
    update();
    await pause();
    assert.equal(u.$('.library-drawer'), null);
});
test('welcome copy and failed read retry use the displayed setup request', async (t) => {
    let copied;
    const u = await ui(t, { configure: w => { Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (value) => copied = value } }); } });
    await until(() => u.doc.body.textContent.includes('Add screenshots to Demo'));
    await u.click('Copy request');
    assert.match(copied, /Screens/);
    let failed = true;
    const retry = await ui(t, { seed: seedReview, respond: async (path, options, next) => failed && path === '/api/projects' ? { ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) } : next(path, options) });
    await until(() => retry.doc.body.textContent.includes('Unavailable'));
    failed = false;
    await retry.click('Try again');
    await ready(retry);
});
test('area feedback can be selected, cleared, compared and measured with keyboard controls', async (t) => {
    const u = await ui(t, { seed: async (f) => { const value = await seedReview(f); f.store.addNote({ capture: value.captures.pr.id, text: 'Area feedback', region: { x: .1, y: .1, width: .4, height: .4 } }); return value; } });
    await ready(u);
    for (const image of u.all('.capture-image'))
        u.image(image);
    u.all('.capture-notes-list button')[0].click();
    await pause();
    await u.tab('Review');
    u.$('.capture-region').click();
    await pause();
    await u.tab('Review');
    await u.click('Leave feedback on update');
    await u.tab('Review');
    await u.click('Select area');
    let surface = u.$('.annotation-surface');
    surface.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await pause();
    await u.click('Select area');
    surface = u.$('.annotation-surface');
    for (const key of ['Enter', 'ArrowRight', 'Enter']) {
        surface.dispatchEvent(new u.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await pause();
    }
    await pause();
    await u.click('Compare selected area');
    assert.ok(u.$('.region-preview'));
    await u.click('Show full screenshots');
    await u.change('[aria-label="Select an annotated area"]', u.store.getScreen('demo/home').notes.find(note => note.region).id);
    await u.click('Compare selected area');
    for (const view of ['Overlay', 'Single', 'Side by side'])
        await u.click(view);
    await u.click('Clear area');
    await u.change('[aria-label="Select an annotated area"]', u.store.getScreen('demo/home').notes.find(note => note.region).id);
    await u.click('Comment on area');
    await u.tab('Feedback');
    await u.change('#author', 'Design reviewer');
    await u.change('#note-capture', u.captures.target.id);
    await u.click('Compare area');
    await u.click('Inspect pixel differences');
    await u.click('Measure selected area');
    await until(() => u.$('#diff-result')?.textContent.includes('compared'));
});
test('review overview opens submitted feedback and overlay image failures remain visible', async (t) => {
    const u = await ui(t, { seed: async (f) => { const value = await seedReview(f); const note = f.store.getScreen('demo/home').notes[0]; f.store.updateNote({ id: note.id, expectedRevision: note.revision, status: 'submitted', evidence: value.captures.pr.id, resolution: 'Fresh implementation' }); return value; } });
    await ready(u);
    await u.click('Review feedback');
    await u.tab('Review');
    for (const image of u.all('.capture-image'))
        u.image(image);
    await u.click('Overlay');
    for (const image of u.all('#comparison img'))
        image.dispatchEvent(new u.w.Event('error'));
    await until(() => u.doc.body.textContent.includes('A capture image could not be loaded'));
});
test('area feedback reports a missing comparison pair and different images show overlay guidance', async (t) => {
    const single = await ui(t, { seed: async (f) => { const value = await seedReview(f, { roles: ['current'], notes: false, extra: false }); f.store.addNote({ capture: value.captures.current.id, text: 'Single area', region: { x: 0, y: 0, width: .5, height: .5 } }); return value; } });
    await ready(single);
    await single.tab('Feedback');
    await single.click('Compare area');
    await single.tab('Review');
    await until(() => single.doc.body.textContent.includes('Add a second screenshot'));
    const different = await ui(t, { seed: async (f) => { const value = await seedReview(f); const sharp = (await import('sharp')).default; const capture = f.capture({ role: 'pr', fixture: 'seed', revision: 'changed', bytes: await sharp({ create: { width: 2, height: 2, channels: 4, background: 'black' } }).png().toBuffer() }); return { ...value, captures: { ...value.captures, pr: capture }, run: f.store.run({ project: 'demo', title: 'Changed images', captureIds: [value.captures.current.id, value.captures.target.id, capture.id] }) }; } });
    await ready(different);
    for (const image of different.all('.capture-image'))
        different.image(image);
    await different.click('Overlay');
    assert.match(different.doc.body.textContent, /Drag to compare/);
});
test('workspace keyboard selection and approved empty-filter states remain available', async (t) => {
    const u = await ui(t, { seed: async (f) => { const value = await seedReview(f, { notes: false }); f.store.approveTarget({ capture: value.captures.target.id, expectedRevision: 0 }, { human: true }); return value; } });
    await ready(u);
    assert.match(u.doc.body.textContent, /Design approved/);
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(() => u.$('#title')?.textContent === 'Second');
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await until(() => u.$('#title')?.textContent === 'Home');
    await u.click('Feedback');
    await until(() => u.doc.body.textContent.includes('Nothing in this view'));
    await u.click('Show all screens');
    await u.click('Open review panel');
    const link = u.$('.screen-item');
    const event = new u.w.MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.addEventListener('click', e => e.preventDefault(), { once: true });
    link.dispatchEvent(event);
    await u.click('Overlay');
    await u.click('Select area');
    assert.equal(u.$('.overlay-stage'), null);
});
test('mobile commands and shortcuts retain library state during resource loading', async (t) => {
    let release;
    const gate = new Promise(done => release = done);
    const u = await ui(t, { seed: seedReview, configure: w => { w.matchMedia = media => ({ media, matches: true, addEventListener() { }, removeEventListener() { } }); }, respond: async (path, options, next) => { if (path.startsWith('/api/review-sets'))
            await gate; return next(path, options); } });
    await ready(u);
    await u.click('Search screens and actions');
    release();
    await until(() => u.$('[cmdk-item][data-value="library"]'));
    u.$('[cmdk-item][data-value="library"]').click();
    await pause();
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    await pause();
    await u.tab('Feedback');
    await u.tab('Review');
    await u.click('Leave feedback');
    await pause();
});
test('command search can open before any registry data arrives', async (t) => {
    let release;
    const gate = new Promise(done => release = done);
    const u = await ui(t, { respond: async (path, options, next) => { await gate; return next(path, options); } });
    await until(() => u.$('#library-toggle'));
    await pause();
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    await until(() => u.$('[cmdk-root]'));
    release();
    await until(() => u.doc.body.textContent.includes('Demo'));
});
test('keyboard navigation remains available while screen details are still loading', async (t) => {
    let release;
    const gate = new Promise(done => release = done);
    const u = await ui(t, { seed: async (f) => { f.store.screen({ project: 'demo', key: 'loading-state', state: 'loading', title: 'Loading state' }); const value = await seedReview(f); const other = f.store.capture({ screen: 'demo/loading-state', role: 'current', bytes: f.bytes }); return { ...value, run: f.store.run({ project: 'demo', title: 'States', captureIds: [...value.run.captureIds, other.id] }) }; }, respond: async (path, options, next) => { if (path.startsWith('/api/screen?') && path.includes('demo%2Fhome'))
            await gate; return next(path, options); } });
    await until(() => u.all('.screen-item').length === 3);
    await pause();
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    release();
    await until(() => u.$('#title')?.textContent === 'Second');
    u.doc.body.dispatchEvent(new u.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await until(() => u.$('#title')?.textContent === 'Loading state');
    assert.match(u.doc.body.textContent, /desktop · light · loading/);
});
