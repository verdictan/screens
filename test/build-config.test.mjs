import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleUnderTest } from './support/module.mjs';
test('Vite uses explicit local ports, mode-specific source maps and narrow proxy origin rewriting', async () => {
    for (const env of [{ SCREENS_DEV_PORT: '', SCREENS_API_PORT: '' }, { SCREENS_DEV_PORT: '5174', SCREENS_API_PORT: '4802' }]) {
        const value = await moduleUnderTest('vite.config.mjs', { env });
        const configure = value.exports.default;
        for (const mode of ['coverage', 'production']) {
            const config = configure({ mode });
            assert.equal(config.build.sourcemap, mode === 'coverage');
            assert.equal(config.build.minify, mode === 'coverage' ? false : 'oxc');
            assert.equal(config.server.port, Number(env.SCREENS_DEV_PORT || 5170));
            assert.ok(config.build.rolldownOptions.output.sourcemapPathTransform('../App.jsx', '/project/dist/bundle.js.map').endsWith('/App.jsx'));
            for (const key of ['/api', '/mcp', '/speculation-rules.json']) {
                let handler;
                config.server.proxy[key].configure({ on: (name, fn) => { assert.equal(name, 'proxyReq'); handler = fn; } });
                for (const origin of [`http://127.0.0.1:${config.server.port}`, `http://localhost:${config.server.port}`, 'https://outside.example']) {
                    let rewritten;
                    handler({ setHeader: (name, value) => { assert.equal(name, 'Origin'); rewritten = value; } }, { headers: { origin } });
                    assert.equal(Boolean(rewritten), !origin.includes('outside'));
                }
            }
        }
    }
});
test('Playwright keeps phase output isolated and rejects unknown proof phases', async () => {
    for (const phase of ['', 'workflow', 'deployment', 'restart', 'invalid']) {
        const value = await moduleUnderTest('playwright.config.mjs', { env: { SCREENS_PROOF_PHASE: phase } });
        if (phase === 'invalid') {
            assert.match(value.error.message, /Invalid proof phase/);
            continue;
        }
        assert.equal(value.exports.default.workers, 1);
        assert.equal(value.exports.default.outputDir, phase ? `test-results/${phase}/browser` : 'test-results/browser');
    }
});
test('proof app serves its actual HTML on the configured capture port', async () => {
    for (const port of ['', '4902']) {
        let handler, listening, status, bytes;
        const value = await moduleUnderTest('examples/proof-app/server.mjs', { env: { SCREENS_CAPTURE_PORT: port }, mocks: { 'node:http': { createServer: fn => { handler = fn; return { listen: (port, host) => listening = { port, host } }; } } } });
        assert.equal(value.error, undefined);
        handler({}, { writeHead: code => status = code, end: value => bytes = value });
        assert.equal(status, 200);
        assert.match(bytes.toString(), /Project overview/);
        assert.equal(listening.port, Number(port || 4901));
        assert.equal(listening.host, '127.0.0.1');
    }
});
