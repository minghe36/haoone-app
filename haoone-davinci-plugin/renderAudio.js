const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function renderTimelineAudio({ getResolve, getProject, params = {}, fileSystem = fs,
    wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {}, maxPolls = 6600 }) {
    if (!path.isAbsolute(params.outputDir || '')) throw new Error('音频输出目录必须为绝对路径');
    const project = await getProject();
    const timeline = project && await project.GetCurrentTimeline();
    if (!timeline) throw new Error('达芬奇中没有打开的时间线');
    if (await project.IsRenderingInProgress()) throw new Error('达芬奇正在渲染，请等待当前任务完成');
    const projectId = String(await project.GetUniqueId());
    const timelineId = String(await timeline.GetUniqueId());
    const frameRate = parseFloat(await timeline.GetSetting('timelineFrameRate'));
    const startFrame = Number(await timeline.GetStartFrame());
    const endFrame = Number(await timeline.GetEndFrame());
    if (!(frameRate > 0) || !Number.isFinite(startFrame) || !Number.isFinite(endFrame) || endFrame <= startFrame) throw new Error('时间线范围无效');
    const resolve = await getResolve();
    const page = await resolve.GetCurrentPage();
    const previousMode = await project.GetCurrentRenderMode();
    const preset = 'HaoOne-temporary-' + randomUUID();
    if (!await project.SaveAsNewRenderPreset(preset)) throw new Error('无法备份达芬奇渲染设置');
    let job;
    let started = false;
    let previousTargetDir;
    try {
        // Resolve presets do not reliably restore the output directory. Read it
        // from a temporary queued job, without running or altering user jobs.
        const backupJob = await project.AddRenderJob();
        if (!backupJob) throw new Error('无法备份渲染输出目录');
        try {
            const jobs = await project.GetRenderJobList();
            const entry = Object.values(jobs || {}).find(value => value.JobId === backupJob);
            previousTargetDir = entry?.TargetDir;
            if (typeof previousTargetDir !== 'string') throw new Error('无法读取原渲染输出目录');
        } finally { await project.DeleteRenderJob(backupJob); }
        fileSystem.mkdirSync(params.outputDir, { recursive: true });
        await resolve.OpenPage('deliver');
        if (!await project.LoadRenderPreset('Audio Only')) throw new Error('无法加载 Audio Only 渲染预设');
        if (!await project.SetCurrentRenderMode(1)) throw new Error('无法设置整条时间线渲染');
        if (!await project.SetRenderSettings({ CustomName: 'render', TargetDir: params.outputDir, UseUniqueFilenames: false,
            ExportVideo: false, ExportAudio: true, AudioFormat: 'wav', AudioCodec: 'lpcm', AudioBitDepth: 16,
            AudioSampleRate: 48000, SelectAllFrames: true })) throw new Error('无法设置 WAV 音频渲染参数');
        const current = await project.GetCurrentTimeline();
        if (!current || String(await current.GetUniqueId()) !== timelineId) throw new Error('达芬奇时间线已切换，请重试');
        job = await project.AddRenderJob();
        if (!job) throw new Error('无法创建音频渲染任务');
        if (!await project.StartRendering([job], false)) throw new Error('无法启动音频渲染');
        started = true;
        let poll = 0;
        while (await project.IsRenderingInProgress()) {
            if (++poll > maxPolls) throw new Error('达芬奇音频渲染超时');
            await wait(500);
        }
        const status = await project.GetRenderJobStatus(job);
        if (status?.JobStatus !== 'Complete') throw new Error('音频渲染失败或已取消：' + (status?.JobStatus || '未知状态'));
        const wavPath = path.join(params.outputDir, 'render.wav');
        if (!fileSystem.statSync(wavPath).isFile() || fileSystem.statSync(wavPath).size <= 44) throw new Error('渲染未生成有效 WAV 文件');
        log('Audio render completed: ' + wavPath);
        return { projectId, projectName: await project.GetName(), timelineId, timelineName: await timeline.GetName(),
            frameRate, startFrame, endFrame, wavPath, audioTracks: [],
            timelineData: { audio_clips: [{ file_path: wavPath, track_index: 1, input_index: 0, timeline_start_sec: 0,
                source_start_sec: 0, duration_sec: (endFrame - startFrame) / frameRate }], video_clips: [],
                timeline_duration_sec: (endFrame - startFrame) / frameRate } };
    } finally {
        // Only the job and preset created by this operation may be removed.
        const cleanup = async action => { try { return await action(); } catch (error) { log('音频渲染清理失败：' + error.message); return false; } };
        await cleanup(async () => { if (started && await project.IsRenderingInProgress()) await project.StopRendering(); });
        if (job) await cleanup(() => project.DeleteRenderJob(job));
        if (await cleanup(() => project.LoadRenderPreset(preset))) {
            await cleanup(() => project.SetCurrentRenderMode(previousMode));
            if (previousTargetDir !== undefined) await cleanup(() => project.SetRenderSettings({ TargetDir: previousTargetDir }));
            await cleanup(() => project.DeleteRenderPreset(preset));
        } else log('无法恢复渲染设置，备份预设保留：' + preset);
        if (page) await cleanup(() => resolve.OpenPage(page));
    }
}
module.exports = { renderTimelineAudio };
