// HaoOne preload script.
// 通过 contextBridge 以安全方式（沙箱 + 上下文隔离）向渲染进程暴露最小能力。

const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('haooneAPI', {
    // 头部状态轮询
    getProjectInfo: () => ipcRenderer.invoke('haoone:getProjectInfo'),
    // 日志
    clearLogs: () => ipcRenderer.invoke('haoone:clearLogs'),
    onLog: (callback) => {
        ipcRenderer.on('haoone:log', (event, entry) => callback(entry));
    },
    // WebSocket 连接状态（插件 → HaoOne Tauri 服务端）
    onWsStatus: (callback) => {
        ipcRenderer.on('haoone:wsStatus', (event, status) => callback(status));
    },
    // 退出清理
    cleanup: () => ipcRenderer.invoke('haoone:cleanup')
});
