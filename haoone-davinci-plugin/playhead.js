function frameToTimecode(frame, rate, dropFrame) {
    const fps = Math.round(rate);
    if (!Number.isFinite(frame) || frame < 0 || !Number.isFinite(rate) || fps < 1) throw new Error('Invalid playhead position');
    let frames = Math.round(frame);
    if (dropFrame) {
        if (![30, 60].includes(fps) || Math.abs(rate - fps * 1000 / 1001) > 0.01) throw new Error('Unsupported drop-frame rate');
        const drop = fps === 60 ? 4 : 2;
        const perMinute = fps * 60 - drop;
        const perTenMinutes = fps * 600 - drop * 9;
        const blocks = Math.floor(frames / perTenMinutes);
        const rest = frames % perTenMinutes;
        frames += drop * 9 * blocks + drop * Math.max(0, Math.floor((rest - drop) / perMinute));
    }
    const pad = n => String(n).padStart(2, '0');
    return [pad(Math.floor(frames / (fps * 3600))), pad(Math.floor(frames / (fps * 60)) % 60), pad(Math.floor(frames / fps) % 60)].join(':')
        + (dropFrame ? ';' : ':') + pad(frames % fps);
}

async function syncPlayhead(getProject, params) {
    if (!params.projectId || !params.timelineId || !Number.isFinite(params.time) || params.time < 0) throw new Error('Invalid playhead target');
    if (params.sentAt && Date.now() - params.sentAt > 2000) return { synced: false, reason: 'expired' };
    const project = await getProject();
    if (!project || String(await project.GetUniqueId()) !== params.projectId) return { synced: false, reason: 'project-mismatch' };
    const timeline = await project.GetCurrentTimeline();
    if (!timeline || String(await timeline.GetUniqueId()) !== params.timelineId) return { synced: false, reason: 'timeline-mismatch' };
    const rate = parseFloat(await timeline.GetSetting('timelineFrameRate'));
    const start = Number(await timeline.GetStartFrame());
    const end = Number(await timeline.GetEndFrame());
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error('Invalid timeline frame range');
    const frame = Math.min(end, start + Math.round(params.time * rate));
    const timecode = frameToTimecode(frame, rate, String(await timeline.GetStartTimecode()).includes(';'));
    // Never switch the user's project or timeline, including during async API calls.
    const currentProject = await getProject();
    if (!currentProject || String(await currentProject.GetUniqueId()) !== params.projectId) return { synced: false, reason: 'project-mismatch' };
    const currentTimeline = await currentProject.GetCurrentTimeline();
    if (!currentTimeline || String(await currentTimeline.GetUniqueId()) !== params.timelineId) return { synced: false, reason: 'timeline-mismatch' };
    if (params.sentAt && Date.now() - params.sentAt > 2000) return { synced: false, reason: 'expired' };
    if (!await timeline.SetCurrentTimecode(timecode)) throw new Error('Cannot set Resolve playhead');
    return { synced: true, timecode, frame };
}
module.exports = { syncPlayhead, frameToTimecode };
