const { timelineItems } = require('./importSubtitles');

function positiveNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) throw new Error('无法读取' + label);
    return number;
}

// Audio tracks already contain the audio side of linked video/audio clips.
// Reading video tracks again would double the linked audio in the mix.
async function collectTimelineAudio(project, params = {}, targetTimeline = null) {
    if (!project) throw new Error('达芬奇中没有打开的项目');
    const timeline = targetTimeline || await project.GetCurrentTimeline();
    if (!timeline) throw new Error('达芬奇中没有打开的时间线');
    const projectId = String(await project.GetUniqueId());
    const timelineId = String(await timeline.GetUniqueId());
    const frameRate = positiveNumber(await timeline.GetSetting('timelineFrameRate'), '时间线帧率');
    const startFrame = Number(await timeline.GetStartFrame());
    const endFrame = Number(await timeline.GetEndFrame());
    if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) {
        throw new Error('时间线范围无效');
    }
    const excluded = new Set(params.excludedTrackIndices || []);
    const audioClips = [];
    const tracks = [];
    const inputFiles = new Map();
    const count = await timeline.GetTrackCount('audio');
    for (let trackIndex = 1; trackIndex <= count; trackIndex++) {
        const enabled = await timeline.GetIsTrackEnabled('audio', trackIndex);
        const trackName = await timeline.GetTrackName('audio', trackIndex);
        tracks.push({ index: trackIndex, name: trackName, enabled });
        const excludedByName = ['bgm', '音乐', '音效'].includes(String(trackName || '').trim().toLowerCase());
        if (!enabled || excluded.has(trackIndex) || excludedByName) continue;
        for (const item of timelineItems(await timeline.GetItemListInTrack('audio', trackIndex))) {
            if (!await item.GetClipEnabled()) continue;
            let media;
            try {
                media = await item.GetMediaPoolItem();
            } catch (error) {
                // WorkflowIntegration throws for transition items rather than
                // returning null like the Python scripting API.
                if (/GetMediaPoolItem:.*Item is not a media.*errorCode:6/.test(String(error))) continue;
                throw error;
            }
            const name = await item.GetName();
            if (!media) {
                // Resolve includes transition objects in audio track items. Unlike
                // source clips, they have no media, trim offsets or clip properties.
                const left = await item.GetLeftOffset(true);
                const right = await item.GetRightOffset(true);
                const properties = await item.GetProperty();
                if (left == null && right == null && properties
                    && typeof properties === 'object' && Object.keys(properties).length === 0) continue;
                throw new Error('无法读取音频素材: ' + name);
            }
            const filePath = await media.GetClipProperty('File Path');
            if (typeof filePath !== 'string' || !filePath.trim()) {
                throw new Error('片段没有可读取的源文件，请先将嵌套/多机位音频转为普通素材: ' + name);
            }
            const fpsValue = await media.GetClipProperty('FPS');
            const sourceFps = fpsValue ? positiveNumber(fpsValue, '素材帧率: ' + name) : frameRate;
            const itemStart = Number(await item.GetStart(true));
            const itemEnd = Number(await item.GetEnd(true));
            const leftOffset = Number(await item.GetLeftOffset(true));
            if (![itemStart, itemEnd, leftOffset].every(Number.isFinite) || leftOffset < 0 || itemEnd <= itemStart) {
                throw new Error('片段范围无效: ' + name);
            }
            const clippedStart = Math.max(itemStart, startFrame);
            const clippedEnd = Math.min(itemEnd, endFrame);
            if (clippedEnd <= clippedStart) continue;
            // GetLeftOffset is measured in source frames, unlike GetStart/End.
            // Collect at normal speed; source-frame extents are not a reliable
            // retime signal for audio clips and must not block timeline sync.
            if (!inputFiles.has(filePath)) inputFiles.set(filePath, inputFiles.size);
            audioClips.push({
                track_index: trackIndex,
                input_index: inputFiles.get(filePath),
                timeline_start_sec: (clippedStart - startFrame) / frameRate,
                source_start_sec: leftOffset / sourceFps + (clippedStart - itemStart) / frameRate,
                duration_sec: (clippedEnd - clippedStart) / frameRate,
                file_path: filePath,
                clip_id: String(await item.GetUniqueId()),
                clip_name: name,
            });
        }
    }
    if (!audioClips.length && !params.allowEmptyAudio) throw new Error('时间线上没有启用的音频片段');
    if (String(await project.GetUniqueId()) !== projectId
        || (!targetTimeline && String(await (await project.GetCurrentTimeline()).GetUniqueId()) !== timelineId)) {
        throw new Error('读取时达芬奇时间线已切换，请重新导入');
    }
    return {
        projectId, projectName: await project.GetName(), timelineId,
        timelineName: await timeline.GetName(), frameRate, startFrame, endFrame,
        audioTracks: tracks,
        timelineData: { audio_clips: audioClips, video_clips: [], timeline_duration_sec: (endFrame - startFrame) / frameRate }
    };
}
async function collectProjectTimelines(project) {
    if (!project) throw new Error('达芬奇中没有打开的项目');
    const timelines = [];
    const count = await project.GetTimelineCount();
    for (let index = 1; index <= count; index++) {
        const timeline = await project.GetTimelineByIndex(index);
        if (!timeline) throw new Error('无法读取时间线 ' + index);
        timelines.push({ timelineId: String(await timeline.GetUniqueId()), timelineName: await timeline.GetName() });
    }
    const current = await project.GetCurrentTimeline();
    return { projectId: String(await project.GetUniqueId()), projectName: await project.GetName(),
        currentTimelineId: current ? String(await current.GetUniqueId()) : null, timelines };
}
async function findProjectTimeline(project, timelineId) {
    for (let index = 1; index <= await project.GetTimelineCount(); index++) {
        const timeline = await project.GetTimelineByIndex(index);
        if (timeline && String(await timeline.GetUniqueId()) === timelineId) return timeline;
    }
    throw new Error('时间线已删除或不属于当前达芬奇项目');
}
async function withProjectTimeline(project, params, action, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    const original = await project.GetCurrentTimeline();
    const target = await findProjectTimeline(project, params.timelineId);
    const changed = !original || String(await original.GetUniqueId()) !== params.timelineId;
    if (changed && !await project.SetCurrentTimeline(target)) throw new Error('无法激活待同步的时间线');
    try {
        if (changed) await wait(200);
        const result = await action(target);
        const current = await project.GetCurrentTimeline();
        if (!current || String(await current.GetUniqueId()) !== params.timelineId) throw new Error('读取时用户已切换时间线');
        return result;
    } finally {
        const current = await project.GetCurrentTimeline();
        // Restore only our own temporary switch; never override a user switch.
        if (changed && original && current && String(await current.GetUniqueId()) === params.timelineId) {
            if (!await project.SetCurrentTimeline(original)) throw new Error('无法还原同步前的时间线');
        }
    }
}
async function collectProjectTimelineAudio(project, params, wait) {
    return withProjectTimeline(project, params, target => collectTimelineAudio(project, params, target), wait);
}
module.exports = { collectTimelineAudio, collectProjectTimelines, findProjectTimeline, collectProjectTimelineAudio, withProjectTimeline };
