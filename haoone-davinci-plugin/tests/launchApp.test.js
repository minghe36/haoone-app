const { test } = require('node:test');
const assert = require('node:assert/strict');
const { launchHaoOneApp } = require('../launchApp');
test('macOS uses the actual HaoOne bundle ID', () => {
    let invocation;
    launchHaoOneApp({ platform: 'darwin', appPath: '', execute: (...args) => { invocation = args; } });
    assert.equal(invocation[0], 'open');
    assert.deepEqual(invocation[1], ['-b', 'com.haoone']);
});
test('launch failures are reported without stopping the plugin', () => {
    let error;
    launchHaoOneApp({ platform: 'darwin', appPath: '', execute: (_file, _args, _options, callback) => callback(new Error('not installed')), onError: value => { error = value; } });
    assert.equal(error.message, 'not installed');
});
test('Windows discovers custom installation directories from registry', () => {
    let invocation;
    launchHaoOneApp({ platform: 'win32', appPath: '', execute: (...args) => { invocation = args; } });
    assert.equal(invocation[0], 'powershell.exe');
    assert(invocation[1].at(-1).includes('InstallLocation'));
    assert(!invocation[1].at(-1).includes('C:\\Program Files'));
});
test('explicit developer executable is passed as a filename rather than shell text', () => {
    let invocation;
    launchHaoOneApp({ platform: 'darwin', appPath: '/developer folder/haoone', execute: (...args) => { invocation = args; } });
    assert.equal(invocation[0], '/developer folder/haoone');
    assert.deepEqual(invocation[1], []);
});

for (const location of ['C:\\Program Files\\HaoOne', '"C:\\Program Files\\HaoOne"', '"C:\\中文目录\\HaoOne"']) {
    test('Windows PowerShell resolves installer directory: ' + location, { skip: process.platform !== 'win32' }, () => {
        let invocation;
        launchHaoOneApp({ platform: 'win32', appPath: '', execute: (...args) => { invocation = args; } });
        const literal = value => "'" + value.replace(/'/g, "''") + "'";
        const setup = '$ProgressPreference="SilentlyContinue"; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); function Get-ItemProperty { [pscustomobject]@{ DisplayName="haoone"; InstallLocation=' + literal(location) + ' } }; ' +
            'function Test-Path { return $true }; function Start-Process { param($FilePath) [Console]::Write($FilePath) }; ';
        const script = setup + invocation[1].at(-1);
        const actual = require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
        assert.equal(actual, location.replace(/^"|"$/g, '') + '\\haoone.exe');
    });
}
