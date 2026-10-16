const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSubtitleImporter, appendSubtitleToTrack, timelineItems, findInsertedSubtitles, prepareSubtitlePosition } = require('../importSubtitles');
const filePath = path.resolve('captions.srt');

function setup({ importFails = false, appendFails = false, empty = false, appendResult = [{}], readFails = false, delayedReads = 0, noTimeline = false, initialCount = 2, keyedList = false } = {}) {
    const calls = [], logs = [], states = [true, false].slice(0, initialCount);
    let count = initialCount, inserted = false, reads = 0;
    const timeline = {
        GetTrackName: async () => 'Subtitle 1',
        GetStartFrame: async () => 108000,
        GetTrackCount: async () => count,
        GetIsTrackEnabled: async (_type, index) => states[index - 1],
        AddTrack: async (type, options) => {
            if (count > 0) assert.deepEqual(options, { index: 1 });
            else assert.equal(options, undefined);
            inserted = false; reads = 0; calls.push(['create', type, options]); count++; states.unshift(false); return true;
        },
        SetTrackEnable: async (type, index, enabled) => { assert.equal(type, 'subtitle'); states[index - 1] = enabled; if (index === 1 && enabled) calls.push(['enable-new']); return true; },
        GetItemListInTrack: async (type, index) => {
            if (readFails) throw new Error('track enumeration unavailable');
            assert.equal(type, 'subtitle');
            if (index !== 1) return [];
            return inserted && !empty && reads++ >= delayedReads ? (keyedList ? { 1: {}, 2: {} } : [{}, {}]) : [];
        },
        DeleteTrack: async (_type, index) => { calls.push(['delete', index]); states.splice(index - 1, 1); count--; return true; }
    };
    const run = createSubtitleImporter({
        preparePosition: async () => {},
        log: entry => logs.push(entry),
        wait: async () => {},
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        getTimeline: async () => noTimeline ? null : timeline,
        importItem: async value => {
            calls.push(['import', value]);
            if (importFails) return null;
            return { append: async targetTrackIndex => {
                assert.equal(targetTrackIndex, 1);
                calls.push(['append']);
                assert.equal(states[0], true);
                assert(states.slice(1).every(enabled => !enabled));
                if (appendFails) throw new Error('append failed');
                inserted = true; return appendResult;
            } };
        }
    });
    return { run, calls, states, logs };
}

test('creates track, imports file, appends and confirms new-track subtitles', async () => {
    const { run, calls, states } = setup();
    assert.deepEqual(await run({ filePath }), { ok: true, trackIndex: 1, inserted: 2, filePath });
    assert.deepEqual(calls.map(call => call[0]), ['create', 'enable-new', 'import', 'append']);
    assert.deepEqual(states, [true, true, false]);
});

test('successive imports preserve all existing subtitle track states', async () => {
    const { run, states } = setup();
    await run({ filePath });
    await run({ filePath });
    assert.deepEqual(states, [true, true, true, false]);
});

test('import failure preserves the new empty track without native cleanup', async () => {
    const { run, calls, states } = setup({ importFails: true });
    await assert.rejects(run({ filePath }), /media pool/);
    assert.deepEqual(states.slice(-2), [true, false]);
    assert.equal(calls.some(call => call[0] === 'delete'), false);
});

test('append exception leaves track states unchanged and permits a subsequent request', async () => {
    const { run, states } = setup({ appendFails: true });
    await assert.rejects(run({ filePath }), /append failed/);
    assert.deepEqual(states.slice(-2), [true, false]);
    await assert.rejects(run({ filePath }), /append failed/);
});

test('returned append handles do not falsely confirm an empty subtitle track', async () => {
    const { run, calls } = setup({ empty: true });
    await assert.rejects(run({ filePath }), /No new subtitles/);
    assert.equal(calls.some(call => call[0] === 'delete'), false);
});

test('track enumeration failure is reported even when append returns handles', async () => {
    const { run, calls } = setup({ readFails: true });
    await assert.rejects(run({ filePath }), /track enumeration unavailable/);
    assert.equal(calls.some(call => call[0] === 'delete'), false);
});

test('accepts indexed native track lists as well as arrays', async () => {
    const { run } = setup({ keyedList: true });
    assert.equal((await run({ filePath })).inserted, 2);
});

test('empty or rejected append results still fail', async () => {
    for (const appendResult of [[], [''], ['native error'], false, null]) {
        const { run } = setup({ empty: true, appendResult });
        await assert.rejects(run({ filePath }), /Cannot append/);
    }
});

test('an acknowledgement without returned items requires track confirmation and does not delete an accepted track', async () => {
    const { run, calls } = setup({ empty: true, appendResult: true });
    await assert.rejects(run({ filePath }), /No new subtitles/);
    assert.equal(calls.some(call => call[0] === 'delete'), false);
});

test('invalid file paths and absent timelines fail before creating tracks', async () => {
    const { run, calls } = setup({ noTimeline: true });
    await assert.rejects(run({ filePath: 'relative.srt' }), /absolute SRT/);
    await assert.rejects(run({ filePath: filePath.replace('.srt', '.mp4') }), /absolute SRT/);
    await assert.rejects(run({ filePath }), /No current timeline/);
    assert.deepEqual(calls, []);
});

test('concurrent imports cannot switch each other subtitle tracks', async () => {
    let unblock;
    const pending = new Promise(resolve => { unblock = resolve; });
    const run = createSubtitleImporter({
        preparePosition: async () => {},
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        getTimeline: async () => { await pending; return null; },
        importItem: async () => null
    });
    const first = run({ filePath });
    await assert.rejects(run({ filePath }), /already running/);
    unblock(); await assert.rejects(first, /No current timeline/);
});

test('refuses subtitle import when the active timeline changed', async () => {
    let created = false;
    const run = createSubtitleImporter({
        preparePosition: async () => {},
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        getTimeline: async () => ({ GetUniqueId: async () => 'different-timeline', AddTrack: async () => { created = true; } }),
        importItem: async () => { throw new Error('should not import'); }
    });
    await assert.rejects(run({ filePath, timelineId: 'original-timeline' }), /timeline changed/);
    assert.equal(created, false);
});

test('waits for new-track subtitles without appending the file twice', async () => {
    const { run, calls } = setup({ delayedReads: 3 });
    assert.equal((await run({ filePath })).inserted, 2);
    assert.equal(calls.filter(call => call[0] === 'append').length, 1);
});

test('subtitle append never passes video trim fields or unverified placement parameters', async () => {
    const mediaPoolItem = {}, result = [{}];
    const mediaPool = { AppendToTimeline: async clips => {
        assert.deepEqual(clips, [{ mediaPoolItem, trackIndex: 4 }]);
        assert.deepEqual(Object.keys(clips[0]).sort(), ['mediaPoolItem', 'trackIndex']);
        return result;
    } };
    assert.equal(await appendSubtitleToTrack(mediaPool, mediaPoolItem, 4), result);
});

test('failed destination-only append is not retried using a different API shape', async () => {
    let calls = 0;
    const mediaPool = { AppendToTimeline: async () => { calls++; throw new Error('native failed'); } };
    await assert.rejects(appendSubtitleToTrack(mediaPool, {}, 1), /native failed/);
    assert.equal(calls, 1);
});

test('invalid subtitle destination is rejected before native append', async () => {
    const mediaPool = { AppendToTimeline: async () => { throw new Error('must not append'); } };
    for (const index of [0, -1, 1.5, undefined]) {
        await assert.rejects(appendSubtitleToTrack(mediaPool, {}, index), /Invalid subtitle track/);
    }
});

test('persists the last started native stage when subtitle append fails', async () => {
    const { run, logs } = setup({ appendFails: true });
    await assert.rejects(run({ filePath }), /append failed/);
    assert(logs.some(entry => entry.includes('stage=AddSubtitleTrack status=end')));
    assert(logs.some(entry => entry.includes('stage=ImportSubtitleMedia status=end')));
    assert(logs.some(entry => entry.includes('stage=AppendSubtitles status=begin')));
    assert(logs.at(-1).includes('Subtitle operation failed: stage=append'));
    assert(!logs.some(entry => entry.includes('stage=AppendSubtitles status=end')));
});

test('creates the first subtitle track without an out-of-bounds index', async () => {
    const { run, states } = setup({ initialCount: 0 });
    assert.equal((await run({ filePath })).trackIndex, 1);
    assert.deepEqual(states, [true]);
});

test('existing single subtitle track uses explicit insertion and retains its state', async () => {
    const { run, calls, states } = setup({ initialCount: 1 });
    assert.equal((await run({ filePath })).trackIndex, 1);
    assert.deepEqual(calls[0], ['create', 'subtitle', { index: 1 }]);
    assert.deepEqual(states, [true, true]);
});


test('native function proxies are valid timeline items', () => {
    const proxy = () => {};
    assert.deepEqual(timelineItems([null, proxy, false]), [proxy]);
    assert.deepEqual(timelineItems({ 1: proxy }), [proxy]);
});

test('finds new captions on the actual destination instead of fixed track one', () => {
    const before = [
        { index: 1, name: 'New', items: [], ids: [] },
        { index: 2, name: 'Existing', items: [{}], ids: ['old'] }
    ];
    const after = [
        before[0],
        { index: 2, name: 'Existing', items: [{}, {}, {}], ids: ['old', 'new1', 'new2'] }
    ];
    assert.deepEqual(findInsertedSubtitles(before, after), [{ trackIndex: 2, inserted: 2 }]);
});

test('detects a track created by native SRT append without counting old captions', () => {
    const before = [{ index: 1, name: 'Old', items: [{}], ids: ['old'] }];
    const after = [
        { index: 1, name: 'Imported', items: [{}, {}], ids: ['new1', 'new2'] },
        { index: 2, name: 'Old', items: [{}], ids: ['old'] }
    ];
    assert.deepEqual(findInsertedSubtitles(before, after), [{ trackIndex: 1, inserted: 2 }]);
    assert.deepEqual(findInsertedSubtitles(before, [{ index: 2, name: 'Old', items: [{}], ids: ['old'] }]), []);
});

test('old nonempty tracks cannot falsely confirm an accepted append', () => {
    const track = { index: 1, name: 'Old', items: [{}, {}], ids: ['a', 'b'] };
    assert.deepEqual(findInsertedSubtitles([track], [track]), []);
});

test('does not infer new captions from shifted legacy tracks without item IDs', () => {
    const old = { index: 1, name: 'Old', items: [{}, {}], ids: [] };
    const after = [{ index: 1, name: 'New', items: [], ids: [] }, { ...old, index: 2 }];
    assert.deepEqual(findInsertedSubtitles([old], after), []);
});


test('importer rejects captions inserted on a different track even with valid function handles', async () => {
    let count = 2, appended = false; const enabled = [true, true, true];
    const old = { GetUniqueId: async () => 'existing-caption' };
    const fresh = () => {};
    fresh.GetUniqueId = async () => 'imported-caption';
    const timeline = {
        GetStartFrame: async () => 86400,
        GetTrackCount: async () => count,
        GetTrackName: async (_type, index) => 'Subtitle ' + index,
        AddTrack: async () => { count++; return true; },
        GetItemListInTrack: async (_type, index) => index === 2 ? [old]
            : index === 3 && appended ? [fresh] : [],
        GetIsTrackEnabled: async (_, i) => enabled[i - 1],
        SetTrackEnable: async (_, i, on) => { enabled[i - 1] = on; return true; }
    };
    const run = createSubtitleImporter({
        preparePosition: async () => {},
        getTimeline: async () => timeline,
        importItem: async () => ({ append: async () => { appended = true; return [fresh]; } }),
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        wait: async () => {}
    });
    await assert.rejects(run({ filePath }), /different track/);
    assert(enabled.every(Boolean));
});


test('native empty-string append result is rejected immediately with diagnostic evidence', async () => {
    const { run, logs, calls } = setup({ appendResult: [''], empty: true });
    await assert.rejects(run({ filePath }), /Cannot append subtitle file/);
    assert(logs.includes('Subtitle append primitive values: [""]'));
    assert.equal(calls.some(call => call[0] === 'delete'), false);
});


test('every import failure avoids DeleteTrack and releases the request lock', async () => {
    for (const options of [
        { importFails: true }, { appendFails: true }, { appendResult: [''], empty: true },
        { appendResult: [], empty: true }, { readFails: true }, { empty: true }
    ]) {
        const { run, calls } = setup(options);
        await assert.rejects(run({ filePath }));
        await assert.rejects(run({ filePath }), error => !/already running/.test(error.message));
        assert.equal(calls.some(call => call[0] === 'delete'), false);
    }
});


test('position preparation completes before formal SRT import and append', async () => {
    const sequence = [];
    let count = 0, inserted = false;
    const run = createSubtitleImporter({
        fileSystem: { statSync: () => ({ isFile: () => true }) }, wait: async () => {},
        getTimeline: async () => ({
            GetTrackCount: async () => count,
            AddTrack: async () => { count++; return true; },
            GetIsTrackEnabled: async () => true,
            GetTrackName: async () => 'Subtitle 1',
            GetItemListInTrack: async () => inserted ? [{}] : []
        }),
        preparePosition: async () => { sequence.push('position'); },
        importItem: async () => { sequence.push('formal-import'); return {
            append: async () => { throw new Error('must use raw SRT append'); },
            appendRaw: async () => { sequence.push('formal-append'); inserted = true; return [{}]; }
        }; }
    });
    assert.equal((await run({ filePath })).inserted, 1);
    assert.deepEqual(sequence, ['position', 'formal-import', 'formal-append']);
});


test('failed position preparation stops formal media import and releases the lock', async () => {
    let count = 0; const enabled = [];
    const run = createSubtitleImporter({
        fileSystem: { statSync: () => ({ isFile: () => true }) }, wait: async () => {},
        getTimeline: async () => ({
            GetTrackCount: async () => count,
            AddTrack: async () => { count++; enabled.unshift(true); return true; },
            GetIsTrackEnabled: async (_, i) => enabled[i - 1],
            SetTrackEnable: async (_, i, on) => { enabled[i - 1] = on; return true; },
            GetTrackName: async () => 'Subtitle 1'
        }),
        preparePosition: async () => { throw new Error('position failed'); },
        importItem: async () => { throw new Error('formal import must not run'); }
    });
    await assert.rejects(run({ filePath }), /position failed/);
    await assert.rejects(run({ filePath }), /position failed/);
});


test('disabled new first track is activated before temporary position preparation', async () => {
    const { run, calls, states } = setup({ initialCount: 0 });
    await run({ filePath });
    assert.deepEqual(calls.map(call => call[0]), ['create', 'enable-new', 'import', 'append']);
    assert.deepEqual(states, [true]);
});


test('native track creation exceptions are caught with stage and stop later operations', async () => {
    let imports = 0;
    const logs = [];
    const run = createSubtitleImporter({
        getTimeline: async () => ({ GetTrackCount: async () => 0,
            AddTrack: async () => { throw new Error('native track failure'); } }),
        importItem: async () => { imports++; },
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        log: value => logs.push(value)
    });
    for (let attempt = 0; attempt < 2; attempt++) {
        await assert.rejects(run({ filePath }), error => error.message === 'native track failure'
            && error.subtitleStage === 'create-track');
    }
    assert.equal(imports, 0);
    assert(logs.some(value => value.includes('Subtitle operation failed: stage=create-track')));
});

test('filesystem and non-Error failures are normalized at the subtitle boundary', async () => {
    const run = createSubtitleImporter({
        getTimeline: async () => null, importItem: async () => null,
        fileSystem: { statSync: () => { throw 'file unavailable'; } }
    });
    await assert.rejects(run({ filePath }), error => error instanceof Error
        && error.message === 'file unavailable' && error.subtitleStage === 'validation');
});

function replacementSetup(enabled = [false, true], rejectDelete = false) {
    const tracks = enabled.map((on, i) => ({ on, name: 'Subtitle ' + i, items: [{ GetUniqueId: async () => 'old-' + i }] }));
    const calls = []; let serial = 0;
    const timeline = {
        GetTrackCount: async () => tracks.length,
        GetTrackName: async (_, i) => tracks[i - 1].name,
        GetIsTrackEnabled: async (_, i) => tracks[i - 1].on,
        SetTrackEnable: async (_, i, on) => { tracks[i - 1].on = on; return true; },
        AddTrack: async () => { calls.push('create'); tracks.unshift({ on: false, name: 'new', items: [] }); return true; },
        GetItemListInTrack: async (_, i) => tracks[i - 1].items,
        DeleteClips: async (items, ripple) => {
            assert.equal(ripple, false); calls.push('clear');
            if (rejectDelete) return false;
            for (const track of tracks) track.items = track.items.filter(item => !items.includes(item));
            return true;
        },
    };
    const run = createSubtitleImporter({
        getTimeline: async () => timeline, preparePosition: async () => {}, wait: async () => {},
        fileSystem: { statSync: () => ({ isFile: () => true }) },
        importItem: async () => ({
            append: async () => { throw new Error('clip-info append shifts subtitles to the timeline end'); },
            appendRaw: async () => {
                const i = tracks.findIndex(track => track.on) + 1;
                calls.push('append-' + i);
                const id = 'new-' + (++serial);
                tracks[i - 1].items.push({ GetUniqueId: async () => id });
                return [{}];
            },
        }),
    });
    return { run, tracks, calls };
}
test('repeated modification sync clears and reuses the enabled track while preserving disabled captions', async () => {
    const f = replacementSetup(); const disabled = f.tracks[0].items[0];
    for (let i = 0; i < 2; i++) {
        const result = await f.run({ filePath, replace: true });
        assert.equal(result.trackIndex, 2); assert.equal(f.tracks.length, 2);
        assert.equal(f.tracks[1].items.length, 1); assert.equal(f.tracks[0].items[0], disabled);
    }
    assert.deepEqual(f.calls, ['clear', 'append-2', 'clear', 'append-2']);
});
test('missing or all-disabled subtitle tracks create a new enabled track without clearing disabled tracks', async () => {
    for (const enabled of [[], [false, false]]) {
        const f = replacementSetup(enabled);
        await f.run({ filePath, replace: true });
        assert.equal(f.tracks.length, enabled.length + 1);
        assert.equal(f.tracks[0].on, true); assert.equal(f.tracks[0].items.length, 1);
        assert.ok(!f.calls.includes('clear'));
        for (const track of f.tracks.slice(1)) { assert.equal(track.on, false); assert.equal(track.items.length, 1); }
    }
});
test('failed old-caption deletion stops modification sync before appending', async () => {
    const f = replacementSetup([true], true);
    await assert.rejects(f.run({ filePath, replace: true }), /Cannot clear/);
    assert.deepEqual(f.calls, ['clear']); assert.equal(f.tracks[0].items.length, 1);
});

test('each generated language gets a new isolated track and restores existing enabled tracks', async () => {
 const f=replacementSetup([true,true]);
 const originals=f.tracks.map(track=>track.items[0]);
 for(let i=0;i<2;i++) {
  const result=await f.run({filePath,replace:false});
  assert.equal(result.trackIndex,1);
  assert.equal(f.tracks[0].items.length,1);
  assert(f.tracks.every(track=>track.on));
 }
 assert.equal(f.tracks.length,4);
 assert.equal(f.tracks[2].items[0],originals[0]);
 assert.equal(f.tracks[3].items[0],originals[1]);
 assert(!f.calls.includes('clear'));
});
