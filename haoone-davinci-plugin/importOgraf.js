const fs = require('node:fs');
const path = require('node:path');
const { timelineItems } = require('./importSubtitles');
const { selectWindowsOgrafDestination } = require('./ografDestination');

function findManifest(directory, fileSystem = fs) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory) || !fileSystem.statSync(directory).isDirectory()) {
        throw new Error('字幕动画目录必须是存在的绝对路径');
    }
    const names = fileSystem.readdirSync(directory).filter(name => /\.ograf\.json$/i.test(name)
        && !/_\d{8,}(?:_\d+)?\.ograf\.json$/i.test(name) && fileSystem.statSync(path.join(directory, name)).isFile());
    if (!names.length) throw new Error('未找到字幕动画 manifest: ' + directory);
    const primary = names.find(name => {
        const base = name.slice(0, -'.ograf.json'.length);
        return names.every(candidate => candidate === name || (candidate.startsWith(base + '.')
            && /^[a-z]{2,3}(?:-[a-z0-9]+)*\.ograf\.json$/i.test(candidate.slice(base.length + 1))));
    });
    if (!primary) throw new Error('目录包含多个字幕动画，无法确定 manifest: ' + directory);
    return path.join(directory, primary);
}

// Same-directory copies keep relative main.js/assets intact and force Resolve
// to reload edited config instead of reusing its source-path media cache.
function prepareOgrafCopy(directory, duration, { fileSystem = fs, now = Date.now } = {}) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('字幕动画时长无效');
    const manifestPath = findManifest(directory, fileSystem);
    const manifest = JSON.parse(fileSystem.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || typeof manifest.main !== 'string') {
        throw new Error('字幕动画 manifest 无效: ' + manifestPath);
    }
    manifest.v_bmd = { ...(manifest.v_bmd || {}), duration };
    const prefix = manifestPath.slice(0, -'.ograf.json'.length);
    const timestamp = now();
    let importPath = `${prefix}_${timestamp}.ograf.json`;
    let index = 1;
    for (;;) {
        try {
            fileSystem.writeFileSync(importPath, JSON.stringify(manifest, null, 2), { encoding: 'utf8', flag: 'wx' });
            break;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            importPath = `${prefix}_${timestamp}_${index++}.ograf.json`;
        }
    }
    return importPath;
}

function createOgrafImporter({ getResolve, getProject, fileSystem = fs, platform = process.platform,
    selectDestination = selectWindowsOgrafDestination,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} }) {
    return async function importOgrafSubtitles(params = {}) {
        if (!Number.isFinite(params.duration) || params.duration <= 0) throw new Error('字幕动画时长无效');
        if (!Array.isArray(params.animations) || !params.animations.length) throw new Error('没有已配置的字幕动画');
        if (params.animations.some(animation => !animation || typeof animation.language !== 'string' || !animation.language)) {
            throw new Error('字幕动画语言参数无效');
        }
        const resolve = await getResolve();
        const version = await resolve.GetVersion();
        if (!Number.isFinite(Number(version[0])) || Number(version[0]) < 21) throw new Error('字幕动画插入需要 DaVinci Resolve 21 及以上版本');
        const project = await getProject();
        const timeline = project && await project.GetCurrentTimeline();
        if (!project || !timeline) throw new Error('达芬奇中没有打开的项目或时间线');
        const projectId = String(await project.GetUniqueId());
        const timelineId = String(await timeline.GetUniqueId());
        if (params.projectId && projectId !== params.projectId) throw new Error('达芬奇项目已切换');
        if (params.timelineId && timelineId !== params.timelineId) throw new Error('达芬奇时间线已切换');
        const assertTarget = async () => {
            const currentProject = await getProject();
            const currentTimeline = currentProject && await currentProject.GetCurrentTimeline();
            if (!currentProject || String(await currentProject.GetUniqueId()) !== projectId
                || !currentTimeline || String(await currentTimeline.GetUniqueId()) !== timelineId) {
                throw new Error('达芬奇项目或时间线已切换，停止插入字幕动画');
            }
        };
        const fps = Number(await timeline.GetSetting('timelineFrameRate'));
        const origin = Number(await timeline.GetStartFrame());
        if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(origin)) throw new Error('时间线帧率或起点无效');
        const initialTracks = await timeline.GetTrackCount('video');
        if (!Number.isInteger(initialTracks) || initialTracks < 0) throw new Error('视频轨道计数无效');
        if (platform === 'win32' && initialTracks + params.animations.length > 8) {
            throw new Error('Windows 源轨道选择器仅支持自动指派 V1 至 V8，视频轨道不足');
        }
        // Validate every source before mutating the media pool or timeline.
        const copies = params.animations.map(animation => ({ language: animation.language,
            filePath: prepareOgrafCopy(animation.directory, params.duration, { fileSystem }) }));
        const mediaPool = await project.GetMediaPool();
        const previousFolder = await mediaPool.GetCurrentFolder();
        const tracks = [];
        const failures = [];
        try {
            await assertTarget();
            if (!await mediaPool.SetCurrentFolder(await mediaPool.GetRootFolder())) throw new Error('无法打开媒体池根目录');
            for (const animation of copies) {
                try {
                    await assertTarget();
                    const imported = timelineItems(await mediaPool.ImportMedia([animation.filePath]));
                    if (imported.length !== 1) throw new Error('未导入字幕动画媒体');
                    const media = imported[0];
                    const before = await timeline.GetTrackCount('video');
                    if (!Number.isInteger(before) || before < 0) throw new Error('视频轨道计数无效');
                    if (platform === 'win32' && before >= 8) throw new Error('Windows 只能自动指派 V1 至 V8');
                    await assertTarget();
                    if (!await project.SetCurrentTimeline(timeline)) throw new Error('无法激活目标时间线');
                    if (!await timeline.AddTrack('video')) throw new Error('无法新建视频轨道');
                    await wait(500);
                    const trackIndex = await timeline.GetTrackCount('video');
                    if (trackIndex !== before + 1) throw new Error('新建视频轨道计数异常');
                    if (platform === 'win32') await selectDestination(resolve, trackIndex);
                    await assertTarget();
                    const clipInfo = { mediaPoolItem: media, recordFrame: origin, trackIndex };
                    // Native OGraf generators crash if ordinary-media source trim
                    // startFrame/endFrame are passed. Duration comes from v_bmd.
                    if (platform !== 'win32') clipInfo.mediaType = 1;
                    log(`插入 ${animation.language} 字幕动画到 V${trackIndex}`);
                    await mediaPool.AppendToTimeline([clipInfo]);
                    const expectedName = await media.GetName();
                    let confirmed;
                    for (let attempt = 0; attempt < 20 && !confirmed; attempt++) {
                        await wait(200);
                        await assertTarget();
                        for (const clip of timelineItems(await timeline.GetItemListInTrack('video', trackIndex))) {
                            if (await clip.GetName() !== expectedName) continue;
                            const start = Number(await clip.GetStart());
                            const end = Number(await clip.GetEnd());
                            if (Math.abs(start - origin) <= 1 && Math.abs((end - start) - Math.round(params.duration * fps)) <= 1) {
                                confirmed = { language: animation.language, trackIndex, filePath: animation.filePath, startFrame: start, endFrame: end };
                                break;
                            }
                        }
                    }
                    if (!confirmed) throw new Error(`未在 V${trackIndex} 确认位置与时长正确的字幕动画`);
                    tracks.push(confirmed);
                } catch (error) {
                    failures.push({ language: animation.language, error: String(error.message || error) });
                    // Never delete a track/media item during native error cleanup.
                    // The imported file remains available for manual recovery.
                }
            }
        } finally {
            if (previousFolder) await mediaPool.SetCurrentFolder(previousFolder);
        }
        const error = failures.length ? `字幕动画已插入 ${tracks.length}/${copies.length} 个视频轨道；`
            + failures.map(failure => `${failure.language}: ${failure.error}`).join('；') : undefined;
        return { ok: !failures.length, inserted: tracks.length, tracks, failures, error };
    };
}
module.exports = { createOgrafImporter, prepareOgrafCopy, findManifest };
