const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { prepareSubtitlePosition } = require('../importSubtitles');

function setup({ rejected = false, extraCue = false, deleteFails = false, disposeFails = false, missingId = false, appendThrows = false } = {}) {
    const calls = [];
    const existing = { GetUniqueId: async () => 'existing' };
    const temporary = { GetUniqueId: async () => 'temporary' };
    const extra = { GetUniqueId: async () => 'unexpected' };
    let added = false, importedPath;
    const timeline = {
        GetTrackCount: async () => 2,
        GetTrackName: async (_type, index) => 'Subtitle ' + index,
        GetItemListInTrack: async (_type, index) => index === 1 ? []
            : [missingId ? {} : existing, ...(added ? [temporary, ...(extraCue ? [extra] : [])] : [])],
        DeleteClips: async (items, ripple) => {
            calls.push('delete-temporary');
            assert.deepEqual(items, [temporary]);
            assert.equal(ripple, false);
            if (deleteFails) return false;
            added = false; return true;
        },
        DeleteTrack: async () => { throw new Error('must never delete a track'); },
        SetTrackEnable: async () => { throw new Error('must never change track states'); }
    };
    const run = () => prepareSubtitlePosition({
        timeline, trackIndex: 1,
        wait: async () => {},
        importItem: async filePath => {
            importedPath = filePath; calls.push('import-temporary');
            assert.equal(fs.readFileSync(filePath, 'utf8'), '1\n00:00:00,000 --> 00:00:01,000\ntemp\n');
            return {
                appendRaw: async () => {
                    calls.push('append-temporary');
                    if (appendThrows) throw new Error('native temporary append failed');
                    if (rejected) return [''];
                    added = true; return [{}];
                },
                dispose: async () => { calls.push('dispose-media'); return !disposeFails; }
            };
        }
    });
    return { run, calls, filePath: () => importedPath };
}

test('haoone position preparation inserts then deletes only its temporary cue on the actual track', async () => {
    const { run, calls, filePath } = setup();
    await run();
    assert.deepEqual(calls, ['import-temporary', 'append-temporary', 'delete-temporary', 'dispose-media']);
    assert.equal(fs.existsSync(filePath()), false);
    assert.equal(fs.existsSync(path.dirname(filePath())), false);
});

test('rejected temporary append fails without deleting existing subtitles', async () => {
    const { run, calls, filePath } = setup({ rejected: true });
    await assert.rejects(run(), /Cannot append temporary subtitle/);
    assert.equal(calls.includes('delete-temporary'), false);
    assert.equal(calls.includes('dispose-media'), false);
    assert.equal(fs.existsSync(filePath()), true);
    fs.unlinkSync(filePath()); fs.rmdirSync(path.dirname(filePath()));
});

test('unexpected additional captions stop preparation without broad deletion', async () => {
    const { run, calls, filePath } = setup({ extraCue: true });
    await assert.rejects(run(), /Cannot isolate temporary subtitle/);
    assert.equal(calls.includes('delete-temporary'), false);
    assert.equal(calls.includes('dispose-media'), false);
    assert.equal(fs.existsSync(filePath()), true);
    fs.unlinkSync(filePath()); fs.rmdirSync(path.dirname(filePath()));
});

test('failed temporary cue deletion stops the workflow', async () => {
    const { run, calls, filePath } = setup({ deleteFails: true });
    await assert.rejects(run(), /Cannot remove temporary subtitle/);
    assert.equal(calls.includes('dispose-media'), false);
    fs.unlinkSync(filePath()); fs.rmdirSync(path.dirname(filePath()));
});

test('unidentifiable existing captions stop preparation before adding media', async () => {
    const { run, calls } = setup({ missingId: true });
    await assert.rejects(run(), /Cannot identify existing subtitles/);
    assert.deepEqual(calls, []);
});

test('failed media cleanup retains its source file instead of leaving an offline item', async () => {
    const { run, filePath } = setup({ disposeFails: true });
    await run();
    assert.equal(fs.existsSync(filePath()), true);
    fs.unlinkSync(filePath()); fs.rmdirSync(path.dirname(filePath()));
});


test('temporary native exceptions are caught with their stage and skip native cleanup', async () => {
    const { run, calls, filePath } = setup({ appendThrows: true });
    await assert.rejects(run(), error => error.message === 'native temporary append failed'
        && error.subtitleStage === 'temporary-append');
    assert.deepEqual(calls, ['import-temporary', 'append-temporary']);
    fs.unlinkSync(filePath()); fs.rmdirSync(path.dirname(filePath()));
});
