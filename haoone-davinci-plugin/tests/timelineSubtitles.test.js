const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapTimelineSubtitles } = require('../timelineSubtitles');
const timeline = { GetStartFrame: async () => 86400, GetUniqueId: async () => 'timeline-1' };
function source(start, end, text) {
    return { inFrame: start * 24, outFrame: end * 24 - 1, sourceFps: 24,
        highlight: { subtitles: [{ startSeconds: start, endSeconds: end, text }] } };
}
function item(start, duration) {
    return { GetStart: async () => 86400 + start * 24, GetDuration: async () => duration * 24 };
}
test('compact clips follow actual placement including existing timeline content', async () => {
    const result = await mapTimelineSubtitles({ timeline, fps: 24, mode: 'trim',
        appended: [item(10, 2), item(12, 3)], resolved: [source(1, 3, 'one'), source(20, 23, 'two')] });
    assert.deepEqual(result.timelineSubtitles, [
        { startSeconds: 10, endSeconds: 12, text: 'one' },
        { startSeconds: 12, endSeconds: 15, text: 'two' }]);
});
test('uncompacted clips preserve gaps and clip captions to retained ranges', async () => {
    const first = source(1, 3, 'one'); first.highlight.subtitles[0].startSeconds = 0;
    const result = await mapTimelineSubtitles({ timeline, fps: 24, mode: 'preserve-position',
        appended: [item(1, 2), item(20, 3)], resolved: [first, source(20, 23, 'two')] });
    assert.deepEqual(result.timelineSubtitles.map(cue => cue.startSeconds), [1, 20]);
});
test('uses fractional frame rate without rounding to nominal fps', async () => {
    const result = await mapTimelineSubtitles({ timeline, fps: 29.97, mode: 'trim',
        appended: [{ GetStart: async () => 86400 + 300, GetDuration: async () => 60 }], resolved: [source(1, 3, 'one')] });
    assert.equal(result.timelineSubtitles[0].startSeconds, 300 / 29.97);
});
test('does not guess mapping for missing items or full-clip fallback', async () => {
    await assert.rejects(mapTimelineSubtitles({ timeline, fps: 24, mode: 'trim', appended: [], resolved: [source(1, 3, 'one')] }));
    await assert.rejects(mapTimelineSubtitles({ timeline, fps: 24, mode: 'full', appended: [item(1, 3)], resolved: [source(1, 3, 'one')] }));
});

test('missing native timing is rejected rather than treated as frame zero', async () => {
    await assert.rejects(mapTimelineSubtitles({
        timeline: { GetStartFrame: async () => 0, GetUniqueId: async () => 'id' },
        fps: 24, mode: 'trim', resolved: [source(1, 3, 'one')],
        appended: [{ GetStart: async () => null, GetDuration: async () => 48 }]
    }));
});
