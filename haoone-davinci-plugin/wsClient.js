// HaoOne 内置 WebSocket 客户端（零依赖实现）。
// 仅使用 Node.js 内置的 http / crypto 模块完成 RFC 6455 客户端握手与帧编解码，
// 避免在达芬奇 Workflow Integration 插件环境中依赖第三方 node_modules。
//
// 连接模型：
//   HaoOne Tauri 应用启动 WebSocket Server（ws://127.0.0.1:9800），
//   本插件作为 Client 连接。若服务端尚未就绪，会自动重连。
//
// 服务端下发 JSON 命令：{ "id": "request-id", "method": "get_timeline_audio", "params": {...} }
// 客户端回复 JSON 结果：{ "id": "request-id", "method": "...", "ok": true, "result": {...} }

const http = require('http');
const crypto = require('crypto');

const WS_MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'; // RFC 6455
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xA;

const RECONNECT_DELAY_MS = 3000;      // 断线重连间隔
const PING_INTERVAL_MS = 25000;       // 心跳间隔
const PONG_TIMEOUT_MS = 60000;        // 心跳超时
const CLOSE_FLUSH_MS = 500;           // 退出前等待关闭消息刷出的上限

class HaoOneWsClient {
    // url: ws://host:port/path
    // handlers: { onOpen(), onMessage(object|string), onClose(), log(msg) }
    constructor(url, handlers) {
        this.url = url;
        this.onOpen = (handlers && handlers.onOpen) || function () {};
        this.onMessage = (handlers && handlers.onMessage) || function () {};
        this.onClose = (handlers && handlers.onClose) || function () {};
        this.log = (handlers && handlers.log) || console.log;

        this.socket = null;
        this.connected = false;
        this.stopped = true;
        this.buffer = Buffer.alloc(0);
        this.fragments = [];
        this.reconnectTimer = null;
        this.pingTimer = null;
        this.lastPongTime = 0;
    }

    isConnected() {
        return this.connected;
    }

    // 启动客户端（开始连接，失败自动重连）。
    start() {
        this.stopped = false;
        this._connect();
    }

    // 停止客户端并断开连接。
    stop() {
        this.stopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
        if (this.socket) {
            try {
                this.socket.write(encodeControlFrame(OPCODE_CLOSE, true));
                this.socket.destroy();
            } catch (e) {
                // ignore
            }
            this.socket = null;
        }
        this.connected = false;
    }

    // 发送 JSON 对象（或字符串）。
    send(data) {
        if (!this.connected || !this.socket || !this.socket.writable) return false;

        const text = typeof data === 'string' ? data : JSON.stringify(data);
        try {
            this.socket.write(encodeTextFrame(text));
            return true;
        } catch (e) {
            this.log('WebSocket send failed: ' + e.message);
            return false;
        }
    }

    // 发送最后一条消息后优雅关闭（插件退出前推送关闭通知用）。
    // 返回 Promise，在消息刷出并发送 close 帧后 resolve（最多等 CLOSE_FLUSH_MS）。
    sendAndClose(data) {
        return new Promise((resolve) => {
            this.stopped = true;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
            if (this.pingTimer) {
                clearInterval(this.pingTimer);
                this.pingTimer = null;
            }

            const socket = this.socket;
            this.socket = null;
            this.connected = false;

            if (!socket || !socket.writable) {
                resolve();
                return;
            }

            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                try {
                    socket.write(encodeControlFrame(OPCODE_CLOSE, true));
                    socket.end();
                } catch (e) {
                    // ignore
                }
                setTimeout(() => {
                    try {
                        socket.destroy();
                    } catch (e) {
                        // ignore
                    }
                    resolve();
                }, 100);
            };

            try {
                if (data != null) {
                    const text = typeof data === 'string' ? data : JSON.stringify(data);
                    socket.write(encodeTextFrame(text));
                }
            } catch (e) {
                // 关闭消息发送失败不阻断退出
            }

            // socket.end() 会先刷出已写入的数据再关闭；等待刷出完成
            socket.once('finish', finish);
            socket.end();
            setTimeout(finish, CLOSE_FLUSH_MS);
        });
    }

    // -----------------------------------------------------------------------
    // 内部实现
    // -----------------------------------------------------------------------

    _connect() {
        if (this.stopped) return;

        let parsedUrl;
        try {
            parsedUrl = new URL(this.url);
        } catch (e) {
            this.log('Invalid WebSocket url: ' + this.url);
            return;
        }

        const wsKey = crypto.randomBytes(16).toString('base64');
        const req = http.request({
            host: parsedUrl.hostname,
            port: parsedUrl.port || 80,
            path: (parsedUrl.pathname || '/') + (parsedUrl.search || ''),
            headers: {
                'Connection': 'Upgrade',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': wsKey
            }
        });

        req.setTimeout(5000, () => {
            req.destroy(new Error('connect timeout'));
        });

        req.on('upgrade', (res, socket) => {
            // 校验 Sec-WebSocket-Accept
            const expected = crypto.createHash('sha1')
                .update(wsKey + WS_MAGIC_STRING)
                .digest('base64');
            if (res.headers['sec-websocket-accept'] !== expected) {
                this.log('WebSocket handshake rejected (bad accept key)');
                socket.destroy();
                this._scheduleReconnect();
                return;
            }

            this._onConnected(socket);
        });

        req.on('response', (res) => {
            // 服务端未升级协议（如返回 4xx）
            this.log('WebSocket upgrade failed, HTTP status: ' + res.statusCode);
            res.resume();
            this._scheduleReconnect();
        });

        req.on('error', (err) => {
            this.log('WebSocket connect error: ' + (err && err.message || err) +
                '（HaoOne 服务端可能尚未启动，' + (RECONNECT_DELAY_MS / 1000) + ' 秒后重试）');
            this._scheduleReconnect();
        });

        req.end();
    }

    _onConnected(socket) {
        this.socket = socket;
        this.connected = true;
        this.buffer = Buffer.alloc(0);
        this.fragments = [];
        this.lastPongTime = Date.now();

        socket.setNoDelay(true);
        this.log('WebSocket connected: ' + this.url);

        socket.on('data', (chunk) => this._onData(chunk));

        socket.on('close', () => this._onDisconnected());

        socket.on('error', (err) => {
            this.log('WebSocket socket error: ' + (err && err.message || err));
            socket.destroy();
        });

        // 心跳：定期 ping，长时间无 pong 则强制断开重连
        this.pingTimer = setInterval(() => {
            if (!this.socket || !this.socket.writable) return;
            if (Date.now() - this.lastPongTime > PONG_TIMEOUT_MS) {
                this.log('WebSocket pong timeout, reconnecting…');
                this.socket.destroy();
                return;
            }
            try {
                this.socket.write(encodeControlFrame(OPCODE_PING, true));
            } catch (e) {
                // ignore
            }
        }, PING_INTERVAL_MS);

        try {
            this.onOpen();
        } catch (e) {
            this.log('onOpen handler error: ' + e.message);
        }
    }

    _onDisconnected() {
        if (!this.connected && !this.socket) return;

        this.connected = false;
        this.socket = null;
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }

        this.log('WebSocket disconnected');
        try {
            this.onClose();
        } catch (e) {
            // ignore
        }

        this._scheduleReconnect();
    }

    _scheduleReconnect() {
        if (this.stopped || this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this._connect();
        }, RECONNECT_DELAY_MS);
    }

    _onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);

        let frame = parseFrame(this.buffer);
        while (frame) {
            this.buffer = this.buffer.slice(frame.totalLength);

            switch (frame.opcode) {
                case OPCODE_CLOSE:
                    try {
                        this.socket.write(encodeControlFrame(OPCODE_CLOSE, true));
                    } catch (e) {
                        // ignore
                    }
                    this.socket.end();
                    break;

                case OPCODE_PING:
                    try {
                        this.socket.write(encodeControlFrame(OPCODE_PONG, true, frame.payload));
                    } catch (e) {
                        // ignore
                    }
                    break;

                case OPCODE_PONG:
                    this.lastPongTime = Date.now();
                    break;

                case OPCODE_CONTINUATION:
                case OPCODE_TEXT:
                case OPCODE_BINARY: {
                    this.fragments.push(frame.payload);
                    if (frame.fin) {
                        const message = Buffer.concat(this.fragments).toString('utf8');
                        this.fragments = [];
                        try {
                            this.onMessage(message);
                        } catch (e) {
                            this.log('onMessage handler error: ' + e.message);
                        }
                    }
                    break;
                }

                default:
                    break;
            }

            frame = parseFrame(this.buffer);
        }
    }
}

// ---------------------------------------------------------------------------
// 帧编解码
// ---------------------------------------------------------------------------

// 编码文本帧。客户端发送的帧必须掩码（RFC 6455）。
function encodeTextFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    return buildFrame(OPCODE_TEXT, payload, true);
}

// 编码控制帧（close / ping / pong），payload 可选。
function encodeControlFrame(opcode, mask, payload) {
    return buildFrame(opcode, payload || Buffer.alloc(0), !!mask);
}

function buildFrame(opcode, payload, mask) {
    const length = payload.length;
    let header;

    if (length < 126) {
        header = Buffer.alloc(2);
        header[1] = length;
    } else if (length < 65536) {
        header = Buffer.alloc(4);
        header[1] = 126;
        header.writeUInt16BE(length, 2);
    } else {
        header = Buffer.alloc(10);
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(length), 2);
    }

    header[0] = 0x80 | opcode; // FIN + opcode

    if (mask) {
        header[1] |= 0x80;
        const maskKey = crypto.randomBytes(4);
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) {
            masked[i] ^= maskKey[i % 4];
        }
        return Buffer.concat([header, maskKey, masked]);
    }

    return Buffer.concat([header, payload]);
}

// 从缓冲区解析一个完整帧。返回 { fin, opcode, payload, totalLength } 或 null（数据不足）。
function parseFrame(buffer) {
    if (buffer.length < 2) return null;

    const first = buffer[0];
    const second = buffer[1];
    const fin = (first & 0x80) === 0x80;
    const opcode = first & 0x0F;
    const masked = (second & 0x80) === 0x80;
    let payloadLength = second & 0x7F;
    let offset = 2;

    if (payloadLength === 126) {
        if (buffer.length < offset + 2) return null;
        payloadLength = buffer.readUInt16BE(offset);
        offset += 2;
    } else if (payloadLength === 127) {
        if (buffer.length < offset + 8) return null;
        payloadLength = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
    }

    let maskKey = null;
    if (masked) {
        if (buffer.length < offset + 4) return null;
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
    }

    if (buffer.length < offset + payloadLength) return null;

    let payload = buffer.slice(offset, offset + payloadLength);
    if (masked && maskKey) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) {
            payload[i] ^= maskKey[i % 4];
        }
    }

    return { fin, opcode, payload, totalLength: offset + payloadLength };
}

module.exports = { HaoOneWsClient };
