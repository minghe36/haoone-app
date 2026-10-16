const { execFile } = require('node:child_process');

function execute(file, args) {
    return new Promise((resolve, reject) => execFile(file, args,
        { windowsHide: true, timeout: 3000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => error ? reject(error) : resolve(stdout)));
}

function processRows(output) {
    return String(output).split(/\r?\n/).flatMap(line => {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        return match ? [{ pid: Number(match[1]), value: match[2].trim() }] : [];
    });
}

async function listProcesses(platform = process.platform, run = execute) {
    if (platform === 'win32') {
        const json = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name = 'electron.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"]);
        const value = json.trim() ? JSON.parse(json) : [];
        return (Array.isArray(value) ? value : [value]).map(row => ({
            pid: row.ProcessId, executable: row.ExecutablePath, commandLine: row.CommandLine
        }));
    }
    const [executables, commands] = await Promise.all([
        run('ps', ['-axo', 'pid=,comm=']), run('ps', ['-axo', 'pid=,args='])
    ]);
    const argumentsByPid = new Map(processRows(commands).map(row => [row.pid, row.value]));
    return processRows(executables).map(row => ({
        pid: row.pid, executable: row.value, commandLine: argumentsByPid.get(row.pid) || ''
    }));
}

function isSamePlugin(row, { pid, execPath, mainPath, platform }) {
    if (!Number.isInteger(row.pid) || row.pid <= 0 || row.pid === pid) return false;
    const normalize = value => platform === 'win32'
        ? String(value || '').replace(/\\/g, '/').toLowerCase() : String(value || '');
    if (normalize(row.executable) !== normalize(execPath)) return false;
    const args = normalize(row.commandLine);
    const entry = normalize(mainPath);
    // Require the whole script argument, not a sibling plugin or a filename prefix.
    const offset = args.indexOf(entry);
    if (offset < 0 || /(?:^|\s)--type=/.test(args)) return false;
    const before = offset === 0 ? ' ' : args[offset - 1];
    const after = args[offset + entry.length] || ' ';
    return /[\s"']/.test(before) && /[\s"']/.test(after);
}

async function replacePreviousInstances({ pid = process.pid, execPath = process.execPath,
    mainPath, platform = process.platform, list = listProcesses,
    kill = (target, signal) => process.kill(target, signal),
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    log = () => {} } = {}) {
    const identity = { pid, execPath, mainPath, platform };
    const previous = (await list(platform)).filter(row => isSamePlugin(row, identity));
    for (const row of previous) {
        try { kill(row.pid, 'SIGTERM'); log('Stopping previous plugin process: ' + row.pid); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    for (let attempt = 0; attempt < 40; attempt++) {
        const remaining = (await list(platform)).filter(row =>
            previous.some(old => old.pid === row.pid) && isSamePlugin(row, identity));
        if (!remaining.length) return previous.length;
        if (attempt === 39) {
            for (const row of remaining) {
                // Rechecked executable and script identity before forced termination.
                try { kill(row.pid, 'SIGKILL'); }
                catch (error) { if (error.code !== 'ESRCH') throw error; }
            }
            await wait(50);
            if ((await list(platform)).some(row => remaining.some(old => old.pid === row.pid)
                && isSamePlugin(row, identity))) throw new Error('Previous plugin process did not exit');
            return previous.length;
        }
        await wait(50);
    }
    return previous.length;
}

module.exports = { listProcesses, isSamePlugin, replacePreviousInstances };
