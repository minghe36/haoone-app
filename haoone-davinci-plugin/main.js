const { renderTimelineAudio } = require('./renderAudio');
const { syncPlayhead } = require('./playhead');
const { importManagedSubtitles } = require('./managedSubtitles');
// HaoOne DaVinci Resolve Workflow Integration bridge.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { launchHaoOneApp } = require('./launchApp');
const { HaoOneWsClient } = require('./wsClient');
const { startResolveLifecycle } = require('./resolveLifecycle');
const { replacePreviousInstances } = require('./replaceInstance');
const { createSubtitleImporter, appendSubtitleToTrack, timelineItems } = require('./importSubtitles');
const { collectTimelineAudio, collectProjectTimelines, collectProjectTimelineAudio, withProjectTimeline } = require('./timelineAudio');
const startupSyncId = require('node:crypto').randomUUID();
const { createOgrafImporter } = require('./importOgraf');
const PLUGIN_ID = 'com.haoai.haoone_dev';
const port = Number(process.env.HAOONE_RESOLVE_PORT || 9800);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid HAOONE_RESOLVE_PORT');
const WS_SERVER_URL = `ws://127.0.0.1:${port}`;
const platforms = { darwin: 'macos-universal', win32: 'windows-x64' };
const bundledNative = path.join(__dirname, 'WorkflowIntegration.node');
const nativePath = fs.existsSync(bundledNative) ? bundledNative
    : path.join(__dirname, 'native', platforms[process.platform] || 'unsupported', 'WorkflowIntegration.node');
const WorkflowIntegration = require(nativePath);
app.setName('HaoOne-plugin');
const pluginUserDataPath = path.join(app.getPath('appData'), 'HaoOne-plugin', PLUGIN_ID);
fs.mkdirSync(pluginUserDataPath, { recursive: true });
app.setPath('userData', pluginUserDataPath);
const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit();
app.on('second-instance', () => { app.relaunch(); app.quit(); });
function debugLog(message) {
    const entry = new Date().toISOString() + ' [HaoOne-plugin] ' + String(message);
    console.log(entry);
    try { fs.appendFileSync(path.join(pluginUserDataPath, 'plugin.log'), entry + '\n'); } catch (_) {}
}
let resolveObj;
let initialized = false;
let wsClient;
let stopResolveLifecycle;
let launchTimer;
let resolveExited = false;
let queue = Promise.resolve();
async function getCurrentProject() {
    if (!initialized) {
        if (!await WorkflowIntegration.Initialize(PLUGIN_ID)) throw new Error('无法初始化达芬奇插件');
        initialized = true;
        resolveObj = await WorkflowIntegration.GetResolve();
    }
    if (!resolveObj) throw new Error('无法连接达芬奇');
    const manager = await resolveObj.GetProjectManager();
    return manager ? await manager.GetCurrentProject() : null;
}
async function getCurrentTimeline() {
    const project = await getCurrentProject();
    return project ? await project.GetCurrentTimeline() : null;
}
const importSubtitles = createSubtitleImporter({
    getTimeline: getCurrentTimeline, log: debugLog,
    importItem: async filePath => {
        const project = await getCurrentProject();
        const mediaPool = project ? await project.GetMediaPool() : null;
        if (!mediaPool) return null;
        const previousFolder = await mediaPool.GetCurrentFolder();
        const root = await mediaPool.GetRootFolder();
        const folders = timelineItems(await root.GetSubFolderList());
        let folder;
        for (const value of folders) if (await value.GetName() === 'haoone') { folder = value; break; }
        if (!folder) folder = await mediaPool.AddSubFolder(root, 'haoone');
        if (!folder || !await mediaPool.SetCurrentFolder(folder)) throw new Error('无法打开 HaoOne 媒体目录');
        try {
            const items = timelineItems(await mediaPool.ImportMedia([filePath]));
            const item = items[0];
            return item ? {
                append: trackIndex => appendSubtitleToTrack(mediaPool, item, trackIndex),
                appendRaw: () => mediaPool.AppendToTimeline([item]),
                dispose: () => mediaPool.DeleteClips([item]),
            } : null;
        } finally {
            if (previousFolder) await mediaPool.SetCurrentFolder(previousFolder);
        }
    }
});
const importOgrafSubtitles = createOgrafImporter({
    getResolve: async () => { await getCurrentProject(); return resolveObj; },
    getProject: getCurrentProject, log: debugLog
});
async function handleCommand(command) {
    const params = command.params || {};
    if (command.method === 'render_timeline_audio') return renderTimelineAudio({
        getProject: getCurrentProject, getResolve: async () => { await getCurrentProject(); return resolveObj; }, params, log: debugLog
    });
    if (command.method === 'sync_playhead') return syncPlayhead(getCurrentProject, params);
    const project = await getCurrentProject();
    if (!project) throw new Error('达芬奇中没有打开的项目');
    if (params.projectId && String(await project.GetUniqueId()) !== params.projectId) {
        throw new Error('达芬奇项目已切换，请打开导入音频时的项目');
    }
    switch (command.method) {
        case 'get_project_timelines': return collectProjectTimelines(project);
        case 'get_timeline_audio': return params.timelineId
            ? collectProjectTimelineAudio(project, params) : collectTimelineAudio(project, params);
        case 'import_subtitles': return params.timelineId
            ? withProjectTimeline(project, params, timeline => importManagedSubtitles(timeline, params, importSubtitles))
            : importManagedSubtitles(await project.GetCurrentTimeline(), params, importSubtitles);
        case 'import_ograf_subtitles': return params.timelineId
            ? withProjectTimeline(project, params, () => importOgrafSubtitles(params)) : importOgrafSubtitles(params);
        default: throw new Error('不支持的命令: ' + command.method);
    }
}
function startWsClient() {
    wsClient = new HaoOneWsClient(WS_SERVER_URL, {
        log: debugLog,
        onOpen: () => {
            wsClient.send({ event: 'ready', app: 'HaoOne Resolve Plugin', version: require('./package.json').version, protocol: 1 });
            const task = queue.then(async () => collectProjectTimelines(await getCurrentProject()));
            queue = task.catch(() => {});
            task.then(catalog => wsClient.send({ event: 'sync_timelines', syncId: startupSyncId, catalog }),
                error => debugLog('读取项目时间线失败: ' + error.message));
        },
        onClose: () => debugLog('HaoOne disconnected'),
        onMessage: raw => {
            let command;
            try { command = JSON.parse(raw); } catch (_) { return; }
            if (!command || typeof command.id !== 'string' || typeof command.method !== 'string') return;
            // Closing must not wait behind a long-running timeline operation.
            if (command.method === 'close_connection') {
                wsClient.send({ id: command.id, method: command.method, ok: true, result: { closing: true } });
                app.quit();
                return;
            }
            const task = queue.then(() => handleCommand(command));
            queue = task.catch(() => {});
            task.then(result => wsClient.send({ id: command.id, method: command.method, ok: true, result }),
                error => {
                    debugLog(command.method + ': ' + error.message);
                    wsClient.send({ id: command.id, method: command.method, ok: false, error: error.message });
                });
        }
    });
    wsClient.start();
}
app.whenReady().then(async () => {
    debugLog('Starting plugin instance ' + process.pid);
    if (!ownsInstanceLock) return;
    await replacePreviousInstances({ mainPath: path.join(__dirname, 'main.js'), log: debugLog });
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    // Initialize before advertising readiness, so a failed native bridge cannot
    // appear connected in HaoOne.
    debugLog('Initializing Resolve bridge');
    await getCurrentProject();
    debugLog('Resolve bridge ready');
    startWsClient();
    launchTimer = setTimeout(() => {
        if (!wsClient.isConnected()) launchHaoOneApp({ onError: error => debugLog('启动 HaoOne 失败: ' + error.message) });
    }, 1000);
    stopResolveLifecycle = startResolveLifecycle({
        onExit: () => { resolveExited = true; app.quit(); }, onError: debugLog
    });
    debugLog('HaoOne background plugin started');
}).catch(error => { debugLog('Plugin startup failed: ' + error.message); app.quit(); });
let quitting = false;
let cleaned = false;
function cleanup() {
    if (cleaned || resolveExited || !initialized) return;
    cleaned = true;
    try { WorkflowIntegration.CleanUp(); } catch (error) { debugLog(error.message); }
}
app.on('before-quit', event => {
    clearTimeout(launchTimer);
    if (stopResolveLifecycle) stopResolveLifecycle();
    if (!quitting && wsClient && wsClient.isConnected()) {
        quitting = true;
        event.preventDefault();
        wsClient.sendAndClose({ event: 'goodbye', app: 'HaoOne Resolve Plugin', reason: resolveExited ? 'resolve_exited' : 'plugin_closed' })
            .catch(debugLog).then(() => { wsClient.stop(); cleanup(); app.quit(); });
        return;
    }
    if (wsClient) wsClient.stop();
    cleanup();
});
app.on('window-all-closed', () => {});
if (process.platform !== 'win32') process.on('SIGTERM', () => app.quit());
