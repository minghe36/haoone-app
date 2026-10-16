const test = require('node:test');
const assert = require('node:assert/strict');
const { importManagedSubtitles, subtitleSyncTrackName } = require('../managedSubtitles');
const now = () => new Date(2026, 9, 15, 10, 2, 3);
function setup() {
    const names = ['disabled', 'HaoOne[old-id] old'];
    return { names, timeline: {
        SetTrackName: async (_, i, name) => { names[i - 1] = name; return true; },
        GetTrackName: async (_, i) => names[i - 1],
    } };
}
test('track names use readable local synchronization time', () => {
    assert.equal(subtitleSyncTrackName(now()), '2026-10-15 10:02:03');
});
test('modification sync renames only the reused track after successful import', async () => {
    const f = setup(); let received;
    const result = await importManagedSubtitles(f.timeline, { replace: true, trackKey: 'id' }, async params => {
        assert.equal(f.names[1], 'HaoOne[old-id] old'); received = params;
        return { trackIndex: 2, inserted: 3 };
    }, now);
    assert.equal(received.replace, true); assert.equal(result.inserted, 3);
    assert.deepEqual(f.names, ['disabled', '2026-10-15 10:02:03']);
    assert.equal(result.trackName, f.names[1]);
});
test('new subtitle tracks also receive synchronization time without requiring ownership keys', async () => {
    const f = setup();
    await importManagedSubtitles(f.timeline, {}, async () => ({ trackIndex: 2 }), now);
    assert.equal(f.names[1], '2026-10-15 10:02:03');
});
test('failed import does not rename existing tracks and failed renaming reports completed sync accurately', async () => {
    const f = setup();
    await assert.rejects(importManagedSubtitles(f.timeline, {}, async () => { throw new Error('failed import'); }, now), /failed import/);
    assert.equal(f.names[1], 'HaoOne[old-id] old');
    f.timeline.SetTrackName = async () => false;
    await assert.rejects(importManagedSubtitles(f.timeline, {}, async () => ({ trackIndex: 2 }), now), /字幕已同步.*名称/);
});
test('each subsequent sync refreshes the timestamp', async () => {
    const f = setup(); const importer = async () => ({ trackIndex: 2 });
    await importManagedSubtitles(f.timeline, { replace: true }, importer, now);
    await importManagedSubtitles(f.timeline, { replace: true }, importer, () => new Date(2026, 9, 15, 11, 4, 5));
    assert.equal(f.names[1], '2026-10-15 11:04:05');
});
