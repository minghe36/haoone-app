const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSamePlugin, listProcesses, replacePreviousInstances } = require('../replaceInstance');
const executable = '/Applications/DaVinci Resolve/Electron';
const entry = id => '/runtime/Workflow Integration Plugins/' + id + '/main.js';
const row = (pid, id) => ({ pid, executable, commandLine: executable + ' "' + entry(id) + '" --plugin-id=' + id });

for (const id of ['com.haoai.haoone_dev', 'com.haoai.haoone']) {
    test(id + ' replaces only its own old main process', async () => {
        const other = id.endsWith('_dev') ? 'com.haoai.haoone' : 'com.haoai.haoone_dev';
        const rows = [row(10, id), row(20, id), row(30, other), row(40, 'com.haoai.haoograf_dev'),
            { pid: 50, executable: '/Applications/Resolve', commandLine: 'Resolve' },
            { pid: 60, executable: '/bin/sh', commandLine: entry(id) }];
        const killed = [];
        const result = await replacePreviousInstances({ pid: 20, execPath: executable, mainPath: entry(id), platform: 'darwin',
            list: async () => rows.filter(value => !killed.includes(value.pid)),
            kill: (pid, signal) => { assert.equal(signal, 'SIGTERM'); killed.push(pid); }, wait: async () => {} });
        assert.equal(result, 1); assert.deepEqual(killed, [10]);
    });
}

test('does not match helpers, script-name prefixes, or another executable', () => {
    const identity = { pid: 20, execPath: executable, mainPath: entry('com.haoai.haoone'), platform: 'darwin' };
    assert.equal(isSamePlugin({ ...row(10, 'com.haoai.haoone'), commandLine: entry('com.haoai.haoone') + '.backup' }, identity), false);
    assert.equal(isSamePlugin({ ...row(10, 'com.haoai.haoone'), commandLine: entry('com.haoai.haoone') + ' --type=gpu-process' }, identity), false);
    assert.equal(isSamePlugin({ ...row(10, 'com.haoai.haoone'), executable: '/bin/sh' }, identity), false);
});

test('Windows matches quoted paths case-insensitively without fixed installation paths', () => {
    assert.equal(isSamePlugin({ pid: 10, executable: 'D:\\Resolve\\Electron.exe',
        commandLine: '"D:\\Resolve\\Electron.exe" "C:\\Plugins\\com.haoai.haoone\\main.js"' },
        { pid: 20, execPath: 'd:\\resolve\\electron.exe', mainPath: 'c:\\plugins\\com.haoai.haoone\\main.js', platform: 'win32' }), true);
});

test('rechecks process identity before forced shutdown and ignores reused pids', async () => {
    let query = 0;
    const killed = [];
    await replacePreviousInstances({ pid: 20, execPath: executable, mainPath: entry('com.haoai.haoone'), platform: 'darwin',
        list: async () => ++query === 1 ? [row(10, 'com.haoai.haoone')] : [row(10, 'com.haoai.haoograf_dev')],
        kill: (pid, signal) => killed.push([pid, signal]), wait: async () => {} });
    assert.deepEqual(killed, [[10, 'SIGTERM']]);
});

test('forces termination only after the same old process refuses to exit', async () => {
    const signals = [];
    await replacePreviousInstances({ pid: 20, execPath: executable, mainPath: entry('com.haoai.haoone'), platform: 'darwin',
        list: async () => signals.includes('SIGKILL') ? [] : [row(10, 'com.haoai.haoone')],
        kill: (_pid, signal) => signals.push(signal), wait: async () => {} });
    assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});

test('process enumeration preserves executable paths containing spaces', async () => {
    const rows = await listProcesses('darwin', async (_file, args) => args[1] === 'pid=,comm='
        ? ' 10 /Applications/DaVinci Resolve/Electron\n'
        : ' 10 /Applications/DaVinci Resolve/Electron "' + entry('com.haoai.haoone') + '"\n');
    assert.equal(rows[0].executable, '/Applications/DaVinci Resolve/Electron');
});

test('failed process query prevents startup instead of guessing which process to kill', async () => {
    let killed = false;
    await assert.rejects(replacePreviousInstances({ mainPath: entry('com.haoai.haoone'),
        list: async () => { throw new Error('query failed'); }, kill: () => { killed = true; } }), /query failed/);
    assert.equal(killed, false);
});
