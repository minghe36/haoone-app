const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hasResolveProcess, startResolveLifecycle } = require('../resolveLifecycle');

test('matches executable names without mistaking plugin arguments for Resolve', () => {
    assert.equal(hasResolveProcess('/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/MacOS/Resolve', 'darwin'), true);
    assert.equal(hasResolveProcess('/Applications/DaVinci Resolve/plugin', 'darwin'), false);
    assert.equal(hasResolveProcess('"Resolve.exe","123"', 'win32'), true);
    assert.equal(hasResolveProcess('"Resolve.exe Helper","123"', 'win32'), false);
});

test('two absent probes trigger exit; running or failed queries reset confirmation', async () => {
    const results = [false, true, false, new Error('query failed'), false, false];
    let tick, exited = 0, errors = 0;
    const stop = startResolveLifecycle({
        probe: async () => { const value = results.shift(); if (value instanceof Error) throw value; return value; },
        schedule: fn => { tick = fn; return 1; }, cancel: () => {},
        onExit: () => exited++, onError: () => errors++
    });
    for (let i = 0; i < 5; i++) { await tick(); assert.equal(exited, 0); }
    await tick(); assert.equal(exited, 1); assert.equal(errors, 1); stop();
});

test('stopping an in-flight query prevents exit and rescheduling', async () => {
    let tick, finish, scheduled = 0, exited = 0;
    const stop = startResolveLifecycle({
        probe: () => new Promise(resolve => { finish = resolve; }),
        schedule: fn => { tick = fn; scheduled++; return 1; }, cancel: () => {}, onExit: () => exited++
    });
    const pending = tick(); stop(); finish(false); await pending;
    assert.equal(scheduled, 1); assert.equal(exited, 0);
});

async function boot(connected, rejectClose = false, pluginId = 'com.haoai.haoone_dev') {
    const handlers = {}, calls = { cleanup: 0, quit: 0, stop: 0, dock: 0, launch: 0, relaunch: 0, userData: null, logs: [], goodbye: [] };
    let onExit, clientOptions;
    const app = { getPath: () => '/runtime/app-data', setPath(_name, value) { calls.userData = value; }, requestSingleInstanceLock: () => true, relaunch() { calls.relaunch++; }, setName() {}, dock: { hide() { calls.dock++; } }, whenReady: () => Promise.resolve(),
        on: (name, fn) => { handlers[name] = fn; },
        quit() { calls.quit++; handlers['before-quit']({ preventDefault() {} }); } };
    class Client {
        constructor(url, options) { calls.url = url; clientOptions = options; }
        send(payload) { calls.reply = payload; }
        start() {} isConnected() { return connected; } stop() { calls.stop++; }
        sendAndClose(payload) { calls.goodbye.push(payload); return rejectClose ? Promise.reject(new Error('closed')) : Promise.resolve(); }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8').replace("'com.haoai.haoone_dev'", JSON.stringify(pluginId)), {
        __dirname: path.join(__dirname, '..'), process: { platform: 'darwin', arch: 'arm64', env: {}, on() {} },
        console: { log() {} }, setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
        require(name) {
            if (name === 'electron') return { app };
            if (name === './package.json') return { version: '1.0.1' };
            if (name === 'node:crypto') return { randomUUID: () => 'startup-sync' };
            if (name === 'path' || name === 'node:path') return path;
            if (name === 'fs' || name === 'node:fs') return { existsSync: () => true, mkdirSync() {}, appendFileSync(file, entry) { calls.logs.push({ file, entry }); } };
            if (name === './replaceInstance') return { replacePreviousInstances: async () => 0 };
            if (name === './managedSubtitles') return { importManagedSubtitles: async () => ({}) };
            if (name === './importOgraf') return { createOgrafImporter: () => async () => ({ ok: true }) };
            if (name === './timelineAudio') return { collectTimelineAudio: async () => ({}) };
            if (name === './importSubtitles') return { createSubtitleImporter: () => async () => ({ ok: true }) };
            if (name === './renderAudio') return { renderTimelineAudio: async () => ({}) };
            if (name === './playhead') return { syncPlayhead: async () => ({ synced: true }) };
            if (name === './launchApp') return { launchHaoOneApp() { calls.launch++; } };
            if (name === './wsClient') return { HaoOneWsClient: Client };
            if (name === './resolveLifecycle') return { startResolveLifecycle: options => { onExit = options.onExit; return () => {}; } };
            if (name.endsWith('.node')) return { Initialize: async () => true, GetResolve: async () => ({ GetProjectManager: async () => ({ GetCurrentProject: async () => null }) }), CleanUp() { calls.cleanup++; } };
            throw new Error('Unexpected dependency: ' + name);
        }
    });
    await new Promise(resolve => setImmediate(resolve));
    return { handlers, calls, exit: () => onExit(), app, message: payload => clientOptions.onMessage(JSON.stringify(payload)) };
}

test('background startup stays alive without windows and quits after Resolve exits', async () => {
    const runtime = await boot(true);
    assert.equal(runtime.calls.dock, 1);
    assert.equal(runtime.calls.launch, 0);
    assert(runtime.calls.logs.some(log => log.entry.includes('background plugin started')));
    assert(runtime.calls.logs.every(log => log.file === path.join(runtime.calls.userData, 'plugin.log')));
    runtime.handlers['window-all-closed'](); assert.equal(runtime.calls.quit, 0);
    runtime.exit(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.calls.quit, 2); assert.equal(runtime.calls.cleanup, 0);
    assert.equal(runtime.calls.goodbye[0].reason, 'resolve_exited');
});

test('explicit quit cleans up once even if goodbye fails', async () => {
    const runtime = await boot(true, true);
    runtime.app.quit(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.calls.cleanup, 1); assert.equal(runtime.calls.quit, 2);
    assert.equal(runtime.calls.goodbye[0].reason, 'plugin_closed');
});

test('Resolve exit without a socket skips native cleanup', async () => {
    const runtime = await boot(false); runtime.exit();
    assert.equal(runtime.calls.quit, 1); assert.equal(runtime.calls.cleanup, 0);
});

for (const id of ['com.haoai.haoone_dev', 'com.haoai.haoone']) {
    test(id + ' has its own instance lock and relaunches when opened again', async () => {
        const runtime = await boot(false, false, id);
        assert.equal(runtime.calls.userData, path.join('/runtime/app-data', 'HaoOne-plugin', id));
        runtime.handlers['second-instance']();
        assert.equal(runtime.calls.relaunch, 1);
        assert.equal(runtime.calls.quit, 1);
        assert.equal(runtime.calls.cleanup, 1);
    });
}

test('disconnected startup launches HaoOne', async () => { const runtime = await boot(false); assert.equal(runtime.calls.launch, 1); });

test('close connection exits the plugin without requiring a current Resolve project', async () => {
    const runtime = await boot(true);
    runtime.message({ id: 'close-1', method: 'close_connection', params: {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.reply)), {
        id: 'close-1', method: 'close_connection', ok: true, result: { closing: true }
    });
    assert.equal(runtime.calls.quit, 2);
    assert.equal(runtime.calls.stop, 2);
    assert.equal(runtime.calls.cleanup, 1);
    assert.equal(runtime.calls.relaunch, 0);
});

test('HaoOne uses a port separate from HaoOgraf 9798 and 9799', async () => {
    const runtime = await boot(false);
    assert.equal(runtime.calls.url, 'ws://127.0.0.1:9800');
    assert.equal(runtime.calls.launch, 1);
});
