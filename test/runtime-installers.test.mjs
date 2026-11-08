import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { EventEmitter } from "node:events";
import { fixture } from "./support/registry.mjs";
import { moduleUnderTest } from "./support/module.mjs";
const root = resolve('.');
test("runtime installers propagate platform options, failed spawns, and exit status", async () => {
    for (const platform of ["linux", "darwin"])
        for (const status of [0, 2, null]) {
            const calls = [];
            const result = await moduleUnderTest("scripts/bundle-runtime.mjs", { platform, mocks: { "node:child_process": { spawnSync: (...args) => { calls.push(args); return { status }; } } } });
            assert.equal(result.process.exitCode, status ?? 1);
            assert.equal(calls[0][1].includes('--with-deps'), platform === 'linux');
            assert.equal(calls[0][2].env.PLAYWRIGHT_BROWSERS_PATH, '0');
        }
    const failed = await moduleUnderTest('scripts/bundle-runtime.mjs', { mocks: { 'node:child_process': { spawnSync: () => ({ error: Error('spawn failed') }) } } });
    assert.match(failed.error.message, /spawn failed/);
    for (const result of [{ status: 0 }, { status: 2 }, { status: null }, { error: Error('build failed') }]) {
        const value = await moduleUnderTest('scripts/prepare-release.mjs', { mocks: { 'node:child_process': { spawnSync: () => result } } });
        if (result.error)
            assert.match(value.error.message, /build failed/);
        else if (result.status !== 0)
            assert.equal(value.error.code, result.status ?? 1);
        else
            assert.equal(value.error, undefined);
    }
});
test("release archives contain declared files and clean their staging directory on failure", async (t) => {
    const { dir } = await fixture(t);
    for (const mode of ['ok', 'spawn-error', 'build-error', 'archive-error']) {
        const copied = [], removed = [], calls = [];
        const value = await moduleUnderTest('scripts/package-release.mjs', { mocks: {
                'node:util': { parseArgs: () => ({ values: { output: dir } }) },
                'node:child_process': { spawnSync: (command, args) => { calls.push([command, args]); return mode === 'spawn-error' ? { error: Error('spawn') } : { status: mode === 'build-error' ? 1 : mode === 'archive-error' && command === 'tar' ? 2 : 0 }; } },
                'node:fs': { ...fs, readFileSync: (file, ...args) => String(file).endsWith('package.json') ? JSON.stringify({ version: '1.2.3', files: ['src/', 'src/'] }) : fs.readFileSync(file, ...args), cpSync: (...args) => copied.push(args), rmSync: (file, ...args) => { removed.push(file); return fs.rmSync(file, ...args); } },
            } });
        if (mode === 'ok') {
            assert.equal(value.error, undefined);
            assert.equal(copied.length, 2);
            assert.equal(calls[1][0], 'tar');
        }
        else
            assert.ok(value.error);
        assert.equal(removed.length, mode === 'ok' || mode === 'archive-error' ? 1 : 0);
    }
});
test("development supervisor stops both child processes for signals and failures", async () => {
    for (const mode of ['SIGINT', 'SIGTERM', 'exit', 'signal', 'error']) {
        const children = [], handlers = {};
        const value = await moduleUnderTest('scripts/dev.mjs', { env: { SCREENS_API_PORT: mode === 'exit' ? '4900' : '' }, processOverrides: { once: (event, fn) => handlers[event] = fn }, mocks: { 'node:child_process': { spawn: () => { const child = new EventEmitter(); child.exitCode = null; child.signalCode = null; child.kill = () => { child.exitCode = 0; child.emit('close', 0); }; children.push(child); return child; } } } });
        assert.equal(children.length, 2);
        if (mode === 'exit')
            children[0].emit('exit', 3, null);
        else if (mode === 'signal')
            children[0].emit('exit', null, 'SIGTERM');
        else if (mode === 'error')
            children[0].emit('error', Error('cannot run'));
        else
            handlers[mode]();
        handlers.SIGINT();
        handlers.exit();
        await new Promise(done => setImmediate(done));
        assert.equal(value.process.exitCode, mode === 'exit' ? 3 : mode === 'signal' || mode === 'error' ? 1 : 0);
    }
});
test("user-wide setup preserves client settings, detects executables, and rejects invalid files", async (t) => {
    const { dir } = await fixture(t);
    const load = async ({ env = {}, platform = 'darwin', exists, access } = {}) => moduleUnderTest('scripts/install-user-agents.mjs', { platform, env: { PATH: '', XDG_CONFIG_HOME: '', CLAUDE_CONFIG_DIR: '', COPILOT_HOME: '', CODEX_HOME: '', SCREENS_HOME: '', SCREENS_PORT: '', PORT: '', ...env }, mocks: { 'node:os': { homedir: () => dir }, 'node:fs': { ...fs, ...(exists ? { existsSync: exists } : {}), ...(access ? { accessSync: access } : {}) } } });
    const basic = await load();
    assert.equal(basic.exports.userConnectionDirectory(), join(dir, '.config/screens'));
    basic.exports.installUserAgents(root, { client: 'all' });
    const codex = join(dir, '.codex/config.toml'), cursor = join(dir, '.cursor/mcp.json');
    fs.writeFileSync(codex, 'unrelated = true\n[mcp_servers.other]\ncommand="other"\n');
    fs.writeFileSync(cursor, '{ // keep this comment\n "other": true, "mcpServers": {"existing":{"command":"other"}}\n}');
    basic.exports.installUserAgents(root, { client: 'all', port: '4901', data: join(dir, 'custom') });
    assert.match(fs.readFileSync(codex, 'utf8'), /unrelated = true/);
    assert.match(fs.readFileSync(cursor, 'utf8'), /keep this comment/);
    assert.match(fs.readFileSync(cursor, 'utf8'), /existing/);
    assert.throws(() => basic.exports.installUserAgents(root, { runtime: 'bad' }), /runtime/);
    assert.throws(() => basic.exports.installUserAgents(root, { runtime: 'docker', data: 'bad' }), /omit/);
    basic.exports.installUserAgents(root, { client: 'generic', runtime: 'docker' });
    fs.writeFileSync(cursor, 'invalid json');
    assert.throws(() => basic.exports.installUserAgents(root, { client: 'cursor' }), /invalid JSON/);
    fs.writeFileSync(cursor, '{}');
    const custom = join(dir, 'custom-config');
    fs.mkdirSync(join(custom, 'opencode'), { recursive: true });
    fs.writeFileSync(join(custom, 'opencode/opencode.jsonc'), '{}');
    const windows = await load({ platform: 'win32', env: { PATH: dir, PATHEXT: '.EXE', XDG_CONFIG_HOME: custom, CLAUDE_CONFIG_DIR: join(dir, 'claude-custom'), COPILOT_HOME: join(dir, 'copilot-custom'), CODEX_HOME: join(dir, 'codex-custom') }, access: file => { if (!String(file).endsWith('claude.EXE'))
            throw Error('missing'); } });
    windows.exports.installUserAgents(root, { client: 'auto' });
    assert.ok(fs.existsSync(join(dir, 'claude-custom/.claude.json')));
    const noClients = await load({ exists: () => false });
    noClients.exports.installUserAgents(root, {});
    assert.match(noClients.logs.at(-1), /No supported agents/);
    const windowsDefault = await load({ platform: 'win32', env: { PATH: dir }, exists: () => false, access: () => { throw Error('missing'); } });
    windowsDefault.exports.installUserAgents(root, { client: 'auto' });
});
test('project installer runs captures only for an explicit capture request and forwards failures', async (t) => {
    const { dir } = await fixture(t);
    for (const [index, status] of [0, 2, null].entries()) {
        const project = join(dir, `project-${index}`);
        fs.mkdirSync(project);
        const calls = [];
        const result = await moduleUnderTest('scripts/install-skills.mjs', { argv: ['--project', project, '--capture', 'yes'], mocks: { 'node:child_process': { spawnSync: (...args) => { calls.push(args); return { status }; } } } });
        assert.equal(result.error, undefined);
        assert.equal(result.process.exitCode, status ?? 1);
        assert.equal(calls.length, 1);
    }
    const project = join(dir, 'spawn-error');
    fs.mkdirSync(project);
    const failed = await moduleUnderTest('scripts/install-skills.mjs', { argv: ['--project', project, '--capture', 'yes'], mocks: { 'node:child_process': { spawnSync: () => ({ error: Error('capture spawn failed') }) } } });
    assert.match(failed.error.message, /capture spawn/);
    for (const argv of [['--capture', 'yes'], ['--capture', 'invalid']])
        assert.ok((await moduleUnderTest('scripts/install-skills.mjs', { argv })).error);
    let installed = false;
    const user = await moduleUnderTest('scripts/install-skills.mjs', { mocks: { './install-user-agents.mjs': { installUserAgents: () => installed = true } } });
    assert.equal(installed, true);
    assert.equal(user.error.code, 0);
    for (const argv of [['capture-auto'], ['capture-auto', '--format', 'json'], ['load', dir, '--capture', 'yes']]) {
        const result = await moduleUnderTest('skills/screens/scripts/screens.mjs', { argv, mocks: { 'node:fs': { ...fs, existsSync: file => String(file).endsWith('screens-config.json') || fs.existsSync(file), readFileSync: (file, ...args) => String(file).endsWith('screens-config.json') ? JSON.stringify({ runtime: 'docker', cli: join(root, 'src/cli.mjs') }) : fs.readFileSync(file, ...args) }, 'node:child_process': { spawnSync: () => ({ status: 0 }) } } });
        assert.equal(result.error.code, 0);
    }
});
test('setup preserves unrelated service settings and reports Homebrew prefix failures', async (t) => {
    const { dir } = await fixture(t);
    for (const [index, mode] of ['normal', 'port-env', 'default', 'spawn-error', 'prefix-error', 'prefix-message'].entries()) {
        const home = join(dir, `home-${index}`);
        fs.mkdirSync(join(home, '.homebrew/services'), { recursive: true });
        const file = join(home, '.homebrew/services/screens.env');
        fs.writeFileSync(file, 'UNRELATED=keep\nPORT=old\nSCREENS_HOME=old\n');
        const calls = [];
        const result = await moduleUnderTest('scripts/setup.mjs', { argv: mode === 'normal' ? ['--client', 'generic', '--capture', 'no', '--replace', 'yes'] : [], env: { HOMEBREW_USER_CONFIG_HOME: '', SCREENS_HOME: mode === 'normal' ? join(home, 'registry') : '', SCREENS_PORT: mode === 'normal' ? '4900' : '', PORT: mode === 'port-env' ? '4901' : '', XDG_CONFIG_HOME: mode === 'normal' ? join(home, 'config') : '' }, mocks: { 'node:os': { homedir: () => home }, 'node:child_process': { spawnSync: (command, args) => { calls.push([command, args]); if (command === 'brew' && args[0] === '--prefix' && args.length === 1)
                        return { status: 0 }; if (command === 'brew' && args[0] === '--prefix') {
                        if (mode === 'spawn-error')
                            return { error: Error('cannot spawn brew') };
                        if (mode === 'prefix-error')
                            return { status: 1 };
                        if (mode === 'prefix-message')
                            return { status: 1, stderr: 'formula missing' };
                        return { status: 0, stdout: home };
                    } return { status: 0 }; } } } });
        if (mode === 'spawn-error' || mode.startsWith('prefix-'))
            assert.ok(result.error);
        else {
            assert.equal(result.error, undefined);
            assert.match(fs.readFileSync(file, 'utf8'), /UNRELATED=keep/);
            assert.equal(fs.readFileSync(file, 'utf8').includes('PORT=old'), false);
        }
    }
});
test('project workflow replaces its old skill reference with a relative connection guide', async (t) => { const { dir } = await fixture(t); fs.writeFileSync(join(dir, 'AGENTS.md'), 'For Screens capture and review tasks, read [Screens](skills/screens/SKILL.md).\n'); const result = await moduleUnderTest('scripts/install-skills.mjs', { argv: ['--project', dir, '--client', 'generic'] }); assert.equal(result.error, undefined); assert.match(fs.readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /\.screens\/AGENTS.md/); });
