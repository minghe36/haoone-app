const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function selectWindowsOgrafDestination(resolve, trackIndex, { execute = execFile,
    fileSystem = fs, tempDirectory = os.tmpdir() } = {}) {
    if (!Number.isInteger(trackIndex) || trackIndex < 1 || trackIndex > 8) {
        throw new Error('源轨道选择器仅支持自动指派 V1 至 V8');
    }
    if (!await resolve.OpenPage('edit')) throw new Error('无法打开达芬奇剪辑页面');
    const directory = fileSystem.mkdtempSync(path.join(tempDirectory, 'haoone-ograf-destination-'));
    const statusPath = path.join(directory, 'status.txt');
    try {
        let executionError;
        await new Promise(resolveDone => {
            execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
                '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windowsOgrafDestination.ps1'),
                '-TargetTrack', String(trackIndex), '-StatusPath', statusPath],
                { windowsHide: true, timeout: 25000 }, error => { executionError = error; resolveDone(); });
        });
        const status = fileSystem.existsSync(statusPath) ? fileSystem.readFileSync(statusPath, 'utf8') : '';
        if (executionError || !status.startsWith('OK:')) {
            throw new Error('自动目标轨道切换失败；停止插入：' + (status || String(executionError || '辅助脚本没有返回状态')));
        }
    } finally {
        if (fileSystem.existsSync(statusPath)) fileSystem.unlinkSync(statusPath);
        fileSystem.rmdirSync(directory);
    }
}
module.exports = { selectWindowsOgrafDestination };
