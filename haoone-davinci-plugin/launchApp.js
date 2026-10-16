const { execFile } = require('node:child_process');

function launchHaoOneApp({ platform = process.platform, execute = execFile,
    appPath = process.env.HAOONE_APP_PATH, onError = () => {} } = {}) {
    const options = { timeout: 10000, windowsHide: true };
    const callback = error => { if (error) onError(error); };
    try {
        if (appPath) {
            execute(appPath, [], options, callback);
        } else if (platform === 'darwin') {
            execute('open', ['-b', 'com.haoone'], options, callback);
        } else if (platform === 'win32') {
            // Resolve the installed NSIS application from the registry, including
            // custom installation directories. HaoOne has no URL protocol.
            const script = "$ErrorActionPreference='Stop'; " +
                "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); " +
                "$entry=Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ieq 'haoone' } | Select-Object -First 1; " +
                "if (!$entry -or !$entry.InstallLocation) { throw '未找到已安装的 HaoOne' }; " +
                "$installDirectory=([string]$entry.InstallLocation).Trim().Trim([char]34); " +
                "$exe=Join-Path $installDirectory 'haoone.exe'; " +
                "if (!(Test-Path -LiteralPath $exe)) { throw 'HaoOne 程序不存在' }; Start-Process -FilePath $exe";
            execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options, callback);
        } else {
            onError(new Error('Unsupported platform: ' + platform));
        }
    } catch (error) { onError(error); }
}
module.exports = { launchHaoOneApp };
