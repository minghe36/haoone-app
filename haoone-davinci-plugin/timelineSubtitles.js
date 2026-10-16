function frameNumber(value) { return value == null || value === '' ? NaN : Number(value); }

async function mapTimelineSubtitles({ timeline, appended, resolved, mode, fps }) {
    if (!Number.isFinite(fps) || fps <= 0 || !Array.isArray(appended)
        || appended.length !== resolved.length || !['trim', 'preserve-position'].includes(mode)) {
        throw new Error('Cannot confirm trimmed timeline clip positions');
    }
    const timelineStart = frameNumber(await timeline.GetStartFrame());
    const timelineId = await timeline.GetUniqueId();
    if (!Number.isFinite(timelineStart) || !timelineId) throw new Error('Cannot identify current timeline');
    const subtitles = [];
    for (let index = 0; index < resolved.length; index++) {
        const clip = appended[index];
        const source = resolved[index];
        const startFrame = frameNumber(await clip.GetStart());
        const durationFrames = frameNumber(await clip.GetDuration());
        if (!Number.isFinite(startFrame) || !Number.isFinite(durationFrames) || durationFrames <= 0
            || startFrame < timelineStart || !Number.isFinite(source.sourceFps) || source.sourceFps <= 0) {
            throw new Error('Cannot read inserted clip timing');
        }
        const targetStart = (startFrame - timelineStart) / fps;
        const targetEnd = targetStart + durationFrames / fps;
        const sourceStart = source.inFrame / source.sourceFps;
        const sourceEnd = (source.outFrame + 1) / source.sourceFps;
        for (const cue of source.highlight.subtitles || []) {
            const start = Math.max(cue.startSeconds, sourceStart);
            const end = Math.min(cue.endSeconds, sourceEnd);
            const mappedStart = targetStart + start - sourceStart;
            const mappedEnd = Math.min(targetEnd, targetStart + end - sourceStart);
            if (end > start && mappedEnd > mappedStart && String(cue.text).trim()) {
                subtitles.push({ startSeconds: mappedStart, endSeconds: mappedEnd, text: cue.text });
            }
        }
    }
    return { timelineId: String(timelineId), timelineSubtitles: subtitles };
}
module.exports = { mapTimelineSubtitles };
