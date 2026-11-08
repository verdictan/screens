import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { fixture } from './support/registry.mjs';
import { protocol } from '../src/mcp.mjs';
import { headlessActions, runHeadless } from '../src/headless.mjs';
import { requestHandler } from '../src/server.mjs';
async function request(handler, url, input, headers = {}) {
    const req = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
    Object.assign(req, { url, method: input === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:4800', 'content-type': 'application/json', ...headers } });
    const res = { status: 0, headers: {}, setHeader(key, value) { this.headers[key] = value; }, writeHead(status) { this.status = status; }, end(bytes) { this.bytes = bytes; } };
    await handler(req, res);
    return res;
}
test('MCP exposes permitted headless actions through the same registry service', async (t) => {
    const { store } = await fixture(t);
    const rpc = protocol(store);
    const result = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'storage_report', arguments: {} } });
    assert.equal(result.result.isError, undefined);
    assert.ok(JSON.parse(result.result.content[0].text).assets >= 0);
    headlessActions['test-delegate'] = { inputSchema: { required: [], properties: {} }, run: (_store, _input, context) => context.runAction('storage-report', {}) };
    t.after(() => delete headlessActions['test-delegate']);
    assert.ok((await runHeadless(store, 'test-delegate')).assets >= 0);
    headlessActions['test-delegate'].run = (_store, _input, context) => context.runAction('storage-report', {}, { cli: true });
    assert.ok((await runHeadless(store, 'test-delegate')).assets >= 0);
});
test('HTTP automation, speculation rules and preview reads preserve explicit scope', async (t) => {
    const { store, capture } = await fixture(t), handler = requestHandler(store, () => 4800), value = capture();
    for (const url of ['/api/automation', '/speculation-rules.json', `/api/captures/${value.id}/image`]) {
        const res = await request(handler, url);
        assert.equal(res.status, 200);
    }
    const report = await request(handler, '/api/automation/storage-report', {});
    assert.equal(report.status, 200);
    assert.ok(JSON.parse(report.bytes).assets >= 0);
    const invalid = await request(handler, '/api/automation/unknown', {});
    assert.equal(invalid.status, 404);
});
test('MCP review-set listing reports missing run identities through the tool response', async (t) => { const { store } = await fixture(t); const rpc = protocol(store); const response = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'review_sets_list', arguments: { run: 'missing' } } }); assert.ok(response.result.isError); });
