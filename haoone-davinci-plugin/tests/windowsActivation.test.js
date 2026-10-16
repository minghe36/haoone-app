const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('Windows activation restores minimized windows and detaches input on denial or exception', { skip: process.platform !== 'win32' }, () => {
    const source = fs.readFileSync(path.join(__dirname, '../windowsOgrafDestination.ps1'), 'utf8');
    let native = source.split("Add-Type @'\n")[1].split("\n'@")[0];
    const implementations = {
        IsIconic: 'return Minimized;',
        ShowWindowAsync: 'Restored = command == 9; return true;',
        GetForegroundWindow: 'return Foreground;',
        SetForegroundWindow: 'if (Attached) Foreground = h; return Attached;',
        GetWindowThreadProcessId: 'p = 10; return 20;',
        GetCurrentThreadId: 'return 30;',
        AttachThreadInput: 'if (attach) { Attached = AllowAttach; return Attached; } Detached = true; Attached = false; return true;',
        BringWindowToTop: 'if (ThrowOnBring) throw new InvalidOperationException("activation failure"); return true;',
        EnumWindows: 'return true;',
        GetWindowText: 'return 0;',
        IsWindowVisible: 'return true;'
    };
    native = native.replace(/\[DllImport\([^\n]+?\)\] public static extern (\w+) (\w+)\(([^;]*)\);/g,
        (_match, type, name, parameters) => {
            assert(implementations[name], name);
            return 'public static ' + type + ' ' + name + '(' + parameters + ') { ' + implementations[name] + ' }';
        });
    native = native.replace('public delegate bool EnumProc', 'public static IntPtr Foreground = new IntPtr(1); public static bool Minimized, Restored, Attached, Detached, ThrowOnBring; public static bool AllowAttach = true; public delegate bool EnumProc');
    const script = "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type @'\n" + native + "\n'@\n" + `
$target=[IntPtr]2
if (![OgrafDestination]::Activate($target)) { throw 'fallback failed' }
if (![OgrafDestination]::Detached -or [OgrafDestination]::Attached) { throw 'input remained attached' }
[OgrafDestination]::Minimized=$true
if (![OgrafDestination]::Activate($target) -or ![OgrafDestination]::Restored) { throw 'minimized window not restored' }
[OgrafDestination]::Foreground=[IntPtr]1
[OgrafDestination]::AllowAttach=$false
if ([OgrafDestination]::Activate($target)) { throw 'denial incorrectly acknowledged' }
[OgrafDestination]::AllowAttach=$true
[OgrafDestination]::Detached=$false
[OgrafDestination]::ThrowOnBring=$true
$failed=$false
try { [void][OgrafDestination]::Activate($target) } catch { $failed=$true }
if (!$failed -or ![OgrafDestination]::Detached -or [OgrafDestination]::Attached) { throw 'exception did not detach input' }
'PASS'
`;
    const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
    assert(result.includes('PASS'));
});
