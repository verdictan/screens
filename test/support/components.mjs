import { JSDOM } from "jsdom";
import { Script } from "node:vm";
import { takeCoverage } from "node:v8";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { browserDOM, until } from "./ui.mjs";
let built;
export async function components(t, { platform = "MacIntel", motion = true, fetch } = {}) {
    built ||= build({ configFile: false, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent', plugins: [react()], resolve: { alias: { '@': resolve('ui') } }, build: { emptyOutDir: false, outDir: 'dist/ui/assets', minify: false, sourcemap: true, lib: { entry: resolve('test/support/component-entry.jsx'), name: 'ScreensComponents', formats: ['iife'], fileName: () => 'component-harness.js' }, rolldownOptions: { output: { sourcemapPathTransform: (source, map) => resolve(dirname(map), source) } } } });
    await built;
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:4800', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    browserDOM(w);
    Object.defineProperty(w.navigator, 'platform', { value: platform });
    w.matchMedia = media => ({ media, matches: motion, addEventListener() { }, removeEventListener() { } });
    w.ResizeObserver = class {
        observe() { }
        unobserve() { }
        disconnect() { }
    };
    w.Element.prototype.setPointerCapture = () => { };
    w.Element.prototype.releasePointerCapture = () => { };
    w.fetch = fetch || (async () => ({ ok: true, json: async () => ({ id: 'saved' }) }));
    new Script(readFileSync('dist/ui/assets/component-harness.js', 'utf8'), { filename: resolve('dist/ui/assets/component-harness.js') }).runInContext(dom.getInternalVMContext());
    const api = w.ScreensComponents, root = api.createRoot(w.document.getElementById('root'));
    const render = (Component, props = {}, ...children) => api.flushSync(() => root.render(api.React.createElement(Component, props, ...children)));
    const h = api.React.createElement;
    const key = (node, key, extra = {}) => api.flushSync(() => node.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra })));
    const pointer = (node, type, extra = {}) => { const event = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 0, ...extra }); Object.defineProperties(event, { pointerId: { value: extra.pointerId ?? 1 }, isPrimary: { value: extra.isPrimary ?? true } }); api.flushSync(() => node.dispatchEvent(event)); };
    t.after(() => { api.flushSync(() => root.unmount()); takeCoverage(); w.close(); });
    return { w, doc: w.document, api, render, h, key, pointer, $: selector => w.document.querySelector(selector), all: selector => [...w.document.querySelectorAll(selector)], until };
}
