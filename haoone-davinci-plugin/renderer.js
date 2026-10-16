// HaoOne renderer script.
// 精简界面：仅显示连接状态（达芬奇 / HaoOne 服务）与执行日志。

const MAX_LOG_LINES = 500;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
    // 主进程推送的执行日志
    window.haooneAPI.onLog((entry) => {
        appendLog(entry && entry.message, entry && entry.level);
    });

    // WebSocket 连接状态（插件 → HaoOne Tauri 服务端）
    window.haooneAPI.onWsStatus((status) => {
        const dot = document.getElementById('wsDot');
        const text = document.getElementById('wsText');
        if (status && status.connected) {
            dot.className = 'conn-dot online';
            text.textContent = 'HaoOne 服务 已连接';
        } else {
            dot.className = 'conn-dot offline';
            text.textContent = 'HaoOne 服务 未连接';
        }
    });

    // 清空日志按钮（CSP 禁止内联 onclick，必须用 addEventListener 绑定）
    document.getElementById('btnClearLogs').addEventListener('click', clearLogs);

    // 定时轮询达芬奇连接状态与项目信息
    setInterval(pollResolveStatus, 1500);
    pollResolveStatus();
});

window.addEventListener('beforeunload', async () => {
    try {
        await window.haooneAPI.cleanup();
    } catch (e) {
        // ignore
    }
});

// ---------------------------------------------------------------------------
// 达芬奇状态轮询
// ---------------------------------------------------------------------------

async function pollResolveStatus() {
    try {
        const info = await window.haooneAPI.getProjectInfo();
        const connDot = document.getElementById('connDot');
        const connText = document.getElementById('connText');

        if (!info) {
            connDot.className = 'conn-dot offline';
            connText.textContent = '达芬奇 未连接';
            return;
        }

        connDot.className = 'conn-dot online';
        connText.textContent = '达芬奇 已连接';
        document.getElementById('projectName').textContent = info.projectName || '-';
        document.getElementById('timelineName').textContent = info.timelineName || '（无）';
    } catch (e) {
        console.warn('pollResolveStatus failed:', e);
    }
}

// ---------------------------------------------------------------------------
// 日志
// ---------------------------------------------------------------------------

function formatTime() {
    const now = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function appendLog(message, level) {
    if (message == null || message === '') return;

    const listEl = document.getElementById('logList');

    // 移除占位提示（等待日志… / 日志已清空）
    const placeholder = listEl.querySelector('.log-item.dim');
    if (placeholder) {
        placeholder.remove();
    }

    const li = document.createElement('li');
    const text = String(message);
    const isError = level === 'error' || /^Error[:：]/i.test(text) || /失败/.test(text);
    li.className = 'log-item' + (isError ? ' error' : '');

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = formatTime();

    const msgSpan = document.createElement('span');
    msgSpan.className = 'log-message';
    msgSpan.textContent = text; // textContent 天然防注入

    li.appendChild(timeSpan);
    li.appendChild(msgSpan);
    listEl.appendChild(li);

    // 限制日志条数
    while (listEl.children.length > MAX_LOG_LINES) {
        listEl.removeChild(listEl.firstChild);
    }

    // 自动滚动到底部
    listEl.scrollTop = listEl.scrollHeight;
}

async function clearLogs() {
    const listEl = document.getElementById('logList');
    listEl.replaceChildren();

    const li = document.createElement('li');
    li.className = 'log-item dim';
    li.textContent = '日志已清空';
    listEl.appendChild(li);

    await window.haooneAPI.clearLogs();
}
