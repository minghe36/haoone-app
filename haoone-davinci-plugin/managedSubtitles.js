function subtitleSyncTrackName(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}
async function importManagedSubtitles(timeline, params, importer, now = () => new Date()) {
    const result = await importer(params);
    const trackName = subtitleSyncTrackName(now());
    if (!await timeline.SetTrackName('subtitle', result.trackIndex, trackName)
        || await timeline.GetTrackName('subtitle', result.trackIndex) !== trackName) {
        throw new Error('字幕已同步，但无法更新字幕轨道名称');
    }
    return { ...result, trackName };
}
module.exports = { importManagedSubtitles, subtitleSyncTrackName };
