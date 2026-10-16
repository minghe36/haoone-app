const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOgrafImporter, prepareOgrafCopy, findManifest } = require('../importOgraf');
const { selectWindowsOgrafDestination } = require('../ografDestination');
function setup(t, options = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haoone-ograf-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'sample.ograf.json'), JSON.stringify({ main: 'main.js', schema: { properties: { subtitlesJson: { default: 'quote " and slash \\ 字幕' } } }, v_bmd: { duration: 99, other: 'preserved' } }));
    fs.writeFileSync(path.join(directory, 'main.js'), '');
    const calls = [];
    let trackCount = options.trackCount || 1;
    let inserted;
    let expectedName;
    const timeline = {
        GetUniqueId: async () => 't1', GetSetting: async () => options.fps || 24,
        GetStartFrame: async () => 86400, GetTrackCount: async () => trackCount,
        AddTrack: async type => { calls.push(['add', type]); trackCount++; return true; },
        GetItemListInTrack: async (type, index) => inserted && !options.noConfirmation ? { 1: {
            GetName: async () => expectedName,
            GetStart: async () => options.wrongStart ? 0 : 86400,
            GetEnd: async () => options.wrongDuration ? 86401 : 86400 + Math.round(6 * (options.fps || 24)),
        } } : [],
    };
    const pool = {
        GetCurrentFolder: async () => 'original', GetRootFolder: async () => 'root',
        SetCurrentFolder: async folder => { calls.push(['folder', folder]); return true; },
        ImportMedia: async files => { calls.push(['import', files[0]]); expectedName = path.basename(files[0]); return [{ GetName: async () => expectedName }]; },
        AppendToTimeline: async clips => { calls.push(['append', clips]); inserted = true; return options.emptyReply ? [] : [{ handle: true }]; },
    };
    const project = { GetUniqueId: async () => 'p1', GetCurrentTimeline: async () => timeline,
        GetMediaPool: async () => pool, SetCurrentTimeline: async () => true };
    const resolve = { GetVersion: async () => [options.version || 21], OpenPage: async () => true };
    const dependencies = { getResolve: async () => resolve, getProject: async () => project,
        platform: options.platform || 'darwin', wait: async () => {},
        selectDestination: async (_resolve, index) => { calls.push(['destination', index]); if (options.destinationFailure) throw new Error('destination failed'); } };
    const params = { projectId: 'p1', timelineId: 't1', duration: 6, animations: [{ language: 'main', directory }] };
    return { directory, calls, timeline, project, pool, resolve, dependencies, params };
}
test('same-directory cache copies set duration and preserve source/subtitle escaping', t => {
    const f = setup(t); const source = fs.readFileSync(path.join(f.directory, 'sample.ograf.json'), 'utf8');
    const first = prepareOgrafCopy(f.directory, 6, { now: () => 1791980000000 });
    const second = prepareOgrafCopy(f.directory, 7, { now: () => 1791980000000 });
    assert.notEqual(first, second); assert.equal(path.dirname(first), f.directory);
    assert.equal(JSON.parse(fs.readFileSync(first)).v_bmd.duration, 6);
    assert.equal(JSON.parse(fs.readFileSync(second)).v_bmd.duration, 7);
    assert.equal(JSON.parse(fs.readFileSync(first)).v_bmd.other, 'preserved');
    assert.equal(JSON.parse(fs.readFileSync(first)).schema.properties.subtitlesJson.default, JSON.parse(source).schema.properties.subtitlesJson.default);
    assert.equal(fs.readFileSync(path.join(f.directory, 'sample.ograf.json'), 'utf8'), source);
    assert.equal(findManifest(f.directory), path.join(f.directory, 'sample.ograf.json'));
});
test('finds a primary manifest among locale variants and numeric import copies', t => {
    const f = setup(t);
    for (const name of ['sample.zh.ograf.json', 'sample.en.ograf.json', 'sample_1791980000000_1.ograf.json']) fs.writeFileSync(path.join(f.directory, name), '{}');
    assert.equal(findManifest(f.directory), path.join(f.directory, 'sample.ograf.json'));
    fs.writeFileSync(path.join(f.directory, 'other.ograf.json'), '{}');
    assert.throws(() => findManifest(f.directory), /多个/);
});
test('native append omits source trims, sets exact origin and verifies new video track', async t => {
    const f = setup(t); const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.equal(result.ok, true); assert.equal(result.inserted, 1); assert.equal(result.tracks[0].trackIndex, 2);
    const payload = f.calls.find(call => call[0] === 'append')[1][0];
    assert.equal(payload.recordFrame, 86400); assert.equal(payload.mediaType, 1);
    assert.equal(payload.startFrame, undefined); assert.equal(payload.endFrame, undefined);
    assert.equal(f.calls.at(-1)[1], 'original');
});
test('each configured language gets its own new video track', async t => {
    const f = setup(t); f.params.animations.push({ language: 'en', directory: f.directory });
    const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.deepEqual(result.tracks.map(track => track.trackIndex), [2, 3]);
    assert.notEqual(result.tracks[0].filePath, result.tracks[1].filePath);
});
test('Windows selects the new destination first and omits mediaType and trim fields', async t => {
    const f = setup(t, { platform: 'win32' }); const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.equal(result.ok, true);
    assert(f.calls.findIndex(c => c[0] === 'destination') < f.calls.findIndex(c => c[0] === 'append'));
    const payload = f.calls.find(c => c[0] === 'append')[1][0];
    assert.equal(payload.mediaType, undefined); assert.equal(payload.startFrame, undefined); assert.equal(payload.endFrame, undefined);
});
test('Windows capacity fails before adding a track or importing media', async t => {
    const f = setup(t, { platform: 'win32', trackCount: 8 });
    await assert.rejects(createOgrafImporter(f.dependencies)(f.params), /V1 至 V8/);
    assert.equal(f.calls.length, 0);
});
test('destination selection failure never attempts native append', async t => {
    const f = setup(t, { platform: 'win32', destinationFailure: true });
    const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.equal(result.ok, false); assert.equal(result.inserted, 0);
    assert(!f.calls.some(c => c[0] === 'append'));
});
test('Resolve 20 and stale targets fail before native timeline mutations', async t => {
    const old = setup(t, { version: 20 }); await assert.rejects(createOgrafImporter(old.dependencies)(old.params), /21/);
    const f = setup(t); await assert.rejects(createOgrafImporter(f.dependencies)({ ...f.params, timelineId: 'other' }), /已切换/);
    assert.equal(f.calls.length, 0);
});
test('bad source and duration fail before native timeline mutations', async t => {
    const f = setup(t);
    await assert.rejects(createOgrafImporter(f.dependencies)({ ...f.params, duration: NaN }), /时长/);
    await assert.rejects(createOgrafImporter(f.dependencies)({ ...f.params, animations: [{ language: 'main', directory: '/missing-directory' }] }));
    assert.equal(f.calls.length, 0);
});
test('returned handles alone cannot confirm a missing or incorrectly placed generator', async t => {
    for (const option of [{ noConfirmation: true }, { wrongStart: true }, { wrongDuration: true }]) {
        const f = setup(t, option); const result = await createOgrafImporter(f.dependencies)(f.params);
        assert.equal(result.ok, false); assert.equal(result.inserted, 0);
        assert.equal(f.calls.filter(c => c[0] === 'append').length, 1);
    }
});
test('actual track contents can confirm insertion even when native reply is empty', async t => {
    const f = setup(t, { emptyReply: true, fps: 29.97 });
    const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.equal(result.ok, true); assert.equal(result.tracks[0].endFrame, 86580);
});
test('a timeline switch during destination selection prevents append', async t => {
    const f = setup(t, { platform: 'win32' });
    f.dependencies.selectDestination = async () => { f.project.GetCurrentTimeline = async () => null; };
    const result = await createOgrafImporter(f.dependencies)(f.params);
    assert.equal(result.ok, false); assert(!f.calls.some(c => c[0] === 'append'));
});
test('Windows helper reads positive acknowledgement and cleans its temporary status', async t => {
    const f = setup(t);
    await selectWindowsOgrafDestination(f.resolve, 2, { tempDirectory: f.directory, execute: (_exe, args, _options, callback) => {
        assert.equal(args[args.indexOf('-TargetTrack') + 1], '2');
        fs.writeFileSync(args[args.indexOf('-StatusPath') + 1], 'OK: V2'); callback(null);
    } });
    assert(!fs.readdirSync(f.directory).some(name => name.startsWith('haoone-ograf-destination-')));
});
