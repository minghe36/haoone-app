#!/usr/bin/env node
// HaoOne 插件压缩打包脚本。
// 将插件运行所需文件打包为 dist/<productName>-v<version>.zip（如 HaoOne-v1.0.0.zip），
// 排除开发文件（node_modules、scripts、dist、README 等）。
// 开发态目录/插件 Id 为 com.haoai.haoone_dev（haoone_dev），打包时统一还原为
// 发布态：zip 内根目录与插件 Id 为 com.haoai.haoone、插件名称为 haoone，
// 这样安装发布包不会覆盖开发态插件。
// JS 默认不压缩；可传入 --minify 生成压缩包。
// 用法：node scripts/build.js --platform <windows|macos> [--minify]

const fs = require('fs');
const path = require('path');

// 默认保留原始 JS，确保与 DaVinci Resolve 内嵌 Electron 兼容；传入 --minify 时才压缩。
const MINIFY = process.argv.includes('--minify');

function getOption(name) {
    const prefix = `--${name}=`;
    const inline = process.argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

const PLATFORM_ALIASES = {
    windows: 'windows-x64',
    win32: 'windows-x64',
    'windows-x64': 'windows-x64',
    macos: 'macos-universal',
    darwin: 'macos-universal',
    'macos-universal': 'macos-universal'
};

const HOST_PLATFORM = {
    win32: 'windows',
    darwin: 'macos'
}[process.platform];
const requestedPlatform = getOption('platform') || HOST_PLATFORM;
const PLATFORM = PLATFORM_ALIASES[requestedPlatform];
if (!PLATFORM) {
    const supported = 'windows 或 macos';
    throw new Error(requestedPlatform
        ? `不支持的平台: ${requestedPlatform}（可选: ${supported}）`
        : `缺少 --platform 参数（可选: ${supported}）`);
}

// 创建 zip 归档实例，兼容 archiver v7（CJS，archiver('zip', opts)）
// 与 v8（ESM，new ZipArchive(opts)，无默认导出）。
// 统一用动态 import()：对 CJS 模块返回 { default: module.exports }，对 ESM 返回命名导出。
async function createArchive() {
    const opts = { zlib: { level: 9 } };
    const mod = await import('archiver');

    // v7：导出函数 archiver(format, opts)
    if (typeof mod.default === 'function') return mod.default('zip', opts);
    // v8：命名导出 ZipArchive 类
    if (typeof mod.ZipArchive === 'function') return new mod.ZipArchive(opts);
    if (typeof mod === 'function') return mod('zip', opts);
    throw new Error('无法加载 archiver 模块');
}

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 发布态标识：zip 内根目录与 manifest Id/Name（开发态为 *_dev 后缀）
const RELEASE_ID = 'com.haoai.haoone';
const RELEASE_NAME = 'haoone';
const DEV_ID = 'com.haoai.haoone_dev';

// zip 内的根目录名（Resolve 按目录安装，发布态不带 _dev）
const ZIP_ROOT_DIR = RELEASE_ID;

// 需要打进 zip 的文件/目录（相对插件根目录）
const INCLUDE = [
    'main.js',
    'playhead.js',
    'renderAudio.js',
    'wsClient.js',
    'resolveLifecycle.js',
    'replaceInstance.js',
    'launchApp.js',
    'importSubtitles.js',
    'timelineAudio.js', 'managedSubtitles.js',
    'importOgraf.js',
    'ografDestination.js',
    'windowsOgrafDestination.ps1',
    'manifest.xml',
    'package.json'
];

const NATIVE_MODULE = path.join(ROOT, 'native', PLATFORM, 'WorkflowIntegration.node');

// 打包时排除的模式（兜底，INCLUDE 已限定范围）
const EXCLUDE_PATTERNS = [/node_modules/, /\.env/, /dist/, /scripts/, /\.git/, /^_tmp/];

// 需要内容还原发布态标识的文本文件（其余如 .node 为二进制，原样拷贝）
const TEXT_FILES = new Set(['playhead.js', 'renderAudio.js', 'main.js', 'resolveLifecycle.js', 'replaceInstance.js', 'launchApp.js', 'importSubtitles.js', 'timelineAudio.js', 'managedSubtitles.js', 'importOgraf.js', 'ografDestination.js', 'windowsOgrafDestination.ps1', 'wsClient.js', 'preload.js', 'renderer.js', 'index.html', 'manifest.xml', 'package.json']);

// JS 压缩混淆：esbuild transform（同步），失败时报错退出避免发出未压缩包而无提示
function minifyJs(item, content) {
    if (!MINIFY || !item.endsWith('.js')) return content;
    try {
        const { transformSync } = require('esbuild');
        return transformSync(content, {
            minify: true,
            target: ['chrome120'], // Resolve 内置 Electron 的 Chromium 内核
            format: 'cjs'
        }).code;
    } catch (e) {
        throw new Error(`压缩 ${item} 失败: ${e.message}`);
    }
}

// 将开发态文本内容还原为发布态标识（manifest Id/Name、main.js 的 PLUGIN_ID）
function toReleaseContent(item, content) {
    if (item === 'manifest.xml') {
        return content
            .replace(`<Id>${DEV_ID}</Id>`, `<Id>${RELEASE_ID}</Id>`)
            .replace(/<Name>[^<]*<\/Name>/, `<Name>${RELEASE_NAME}</Name>`);
    }
    if (item === 'main.js') {
        return content.replace(`'${DEV_ID}'`, `'${RELEASE_ID}'`);
    }
    return content;
}

async function main() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const name = pkg.productName || pkg.name || 'haoone';
    const version = pkg.version || '0.0.0';
    const zipName = `${name}-v${version}-${PLATFORM}.zip`;

    if (!fs.existsSync(NATIVE_MODULE)) {
        throw new Error(`缺少 ${PLATFORM} 原生模块: ${NATIVE_MODULE}`);
    }

    fs.mkdirSync(DIST, { recursive: true });
    const zipPath = path.join(DIST, zipName);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    const output = fs.createWriteStream(zipPath);
    const archive = await createArchive();

    const done = new Promise((resolve, reject) => {
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
    });

    archive.pipe(output);
    archive.on('entry', (entry) => console.log('  + ' + entry.name));

    let added = 0;
    for (const item of INCLUDE) {
        const fullPath = path.join(ROOT, item);
        if (!fs.existsSync(fullPath)) {
            console.warn(`⚠️ 跳过不存在的条目: ${item}`);
            continue;
        }
        if (EXCLUDE_PATTERNS.some((re) => re.test(item))) continue;

        if (fs.statSync(fullPath).isDirectory()) {
            archive.directory(fullPath, path.posix.join(ZIP_ROOT_DIR, item));
        } else if (TEXT_FILES.has(item)) {
            // 文本文件：内容还原发布态标识后写入（JS 额外压缩混淆）
            const content = minifyJs(item, toReleaseContent(item, fs.readFileSync(fullPath, 'utf8')));
            archive.append(Buffer.from(content, 'utf8'), { name: path.posix.join(ZIP_ROOT_DIR, item) });
        } else {
            // 二进制文件（如 WorkflowIntegration.node）：原样拷贝
            archive.file(fullPath, { name: path.posix.join(ZIP_ROOT_DIR, item) });
        }
        added++;
    }

    archive.file(NATIVE_MODULE, {
        name: path.posix.join(ZIP_ROOT_DIR, 'WorkflowIntegration.node')
    });
    added++;

    if (added === 0) throw new Error('没有任何可打包的文件');

    await archive.finalize();
    await done;

    const sizeKB = (fs.statSync(zipPath).size / 1024).toFixed(1);
    console.log(`✅ 打包完成: ${zipPath} (${sizeKB} KB)${MINIFY ? '，JS 已压缩混淆' : '，JS 未压缩（--no-minify）'}`);
}

main().catch((err) => {
    console.error('❌ 打包失败: ' + err.message);
    process.exit(1);
});
