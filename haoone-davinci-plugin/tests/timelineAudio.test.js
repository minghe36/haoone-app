const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectTimelineAudio, collectProjectTimelines, findProjectTimeline, collectProjectTimelineAudio } = require('../timelineAudio');
function fixture({ fps = 25, sourceFps = 50, clip = {}, trackEnabled = true } = {}) {
    const item = {
        GetName: async () => 'clip', GetUniqueId: async () => 'c1', GetClipEnabled: async () => true,
        GetStart: async () => 90050, GetEnd: async () => 90100, GetLeftOffset: async () => 150,
        GetRightOffset: async () => 0, GetProperty: async () => ({}),
        GetMediaPoolItem: async () => ({ GetClipProperty: async key => key === 'FPS' ? sourceFps : '/volume/素材.mov' }), ...clip,
    };
    const timeline = {
        GetUniqueId: async () => 't1', GetSetting: async () => fps,
        GetStartFrame: async () => 90000, GetEndFrame: async () => 90250,
        GetTrackCount: async type => { assert.equal(type, 'audio'); return 1; },
        GetIsTrackEnabled: async () => trackEnabled, GetTrackName: async () => 'dialogue',
        GetItemListInTrack: async () => ({ 1: item }), GetName: async () => 'timeline',
    };
    const project = { GetUniqueId: async () => 'p1', GetName: async () => 'project', GetCurrentTimeline: async () => timeline };
    return { project, timeline, item };
}
test('preserves source fps trim, timeline origin and full timeline duration', async () => {
    const f = fixture(); const result = await collectTimelineAudio(f.project);
    assert.equal(result.projectId, 'p1'); assert.equal(result.timelineId, 't1');
    assert.deepEqual(result.timelineData.audio_clips[0], { track_index: 1, input_index: 0, timeline_start_sec: 2, source_start_sec: 3, duration_sec: 2, file_path: '/volume/素材.mov', clip_id: 'c1', clip_name: 'clip' });
    assert.equal(result.timelineData.timeline_duration_sec, 10);
});
test('fractional timeline rate is preserved', async () => {
    const f = fixture({ fps: 29.97 }); const result = await collectTimelineAudio(f.project);
    assert.equal(result.frameRate, 29.97);
    assert.equal(result.timelineData.audio_clips[0].timeline_start_sec, 50 / 29.97);
});
test('audio-only media without a video FPS uses the timeline frame basis', async () => {
    const f = fixture({ sourceFps: '' }); const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips[0].source_start_sec, 6);
});
test('muted tracks, disabled clips and excluded tracks are not mixed', async () => {
    for (const options of [{ trackEnabled: false }, { clip: { GetClipEnabled: async () => false } }]) {
        await assert.rejects(collectTimelineAudio(fixture(options).project), /没有启用/);
    }
    await assert.rejects(collectTimelineAudio(fixture().project, { excludedTrackIndices: [1] }), /没有启用/);
});
test('clips crossing timeline origin advance their source in-point', async () => {
    const f = fixture({ clip: { GetStart: async () => 89975, GetEnd: async () => 90025 } });
    const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips[0].timeline_start_sec, 0);
    assert.equal(result.timelineData.audio_clips[0].source_start_sec, 4);
    assert.equal(result.timelineData.audio_clips[0].duration_sec, 1);
});
test('nested clips and invalid timing fail without producing an incomplete mix', async () => {
    await assert.rejects(collectTimelineAudio(fixture({ clip: { GetMediaPoolItem: async () => null } }).project), /素材/);
    await assert.rejects(collectTimelineAudio(fixture({ clip: { GetStart: async () => NaN } }).project), /范围/);
});
test('source-frame extent differences do not block normal-speed timeline sync', async () => {
    const f = fixture({ clip: { GetSourceStartFrame: async () => 0, GetSourceEndFrame: async () => 200 } });
    const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips.length, 1);
    assert.equal(result.timelineData.audio_clips[0].source_start_sec, 3);
    assert.equal(result.timelineData.audio_clips[0].duration_sec, 2);
});
test('timeline sync does not query unsupported source-frame methods', async () => {
    const fail = async () => { throw new Error('unsupported source frames'); };
    const f = fixture({ clip: { GetSourceStartFrame: fail, GetSourceEndFrame: fail } });
    const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips.length, 1);
});
test('a switched timeline invalidates the snapshot', async () => {
    const f = fixture(); let calls = 0;
    f.project.GetCurrentTimeline = async () => ++calls === 1 ? f.timeline : { GetUniqueId: async () => 'other' };
    await assert.rejects(collectTimelineAudio(f.project), /已切换/);
});

test('enumerates every timeline with stable IDs even when names are equal', async () => {
    const f = fixture();
    const other = { ...f.timeline, GetUniqueId: async () => 't2' };
    f.project.GetTimelineCount = async () => 2;
    f.project.GetTimelineByIndex = async index => index === 1 ? f.timeline : other;
    const catalog = await collectProjectTimelines(f.project);
    assert.deepEqual(catalog.timelines.map(t => t.timelineId), ['t1','t2']);
    assert.equal(catalog.projectName, 'project');
    assert.equal(catalog.currentTimelineId, await f.timeline.GetUniqueId());
    assert.equal(await findProjectTimeline(f.project, 't2'), other);
    await assert.rejects(findProjectTimeline(f.project, 'deleted'), /已删除/);
});
test('reads a non-current timeline without changing the active timeline', async () => {
    const f = fixture(); const other = { ...f.timeline, GetUniqueId: async () => 't2' };
    const result = await collectTimelineAudio(f.project, {}, other);
    assert.equal(result.timelineId, 't2');
    assert.equal(await f.project.GetCurrentTimeline(), f.timeline);
});
test('bulk sync can return a positive-duration silent timeline', async () => {
    const f = fixture({ trackEnabled: false });
    const result = await collectTimelineAudio(f.project, { allowEmptyAudio: true });
    assert.deepEqual(result.timelineData.audio_clips, []);
    assert.equal(result.timelineData.timeline_duration_sec, 10);
});

test('host-dependent collection temporarily activates the target and restores the original', async () => {
    const f = fixture(); const other = { ...f.timeline, GetUniqueId: async () => 't2' };
    let current=f.timeline; const switches=[];
    f.project.GetTimelineCount=async()=>2;
    f.project.GetTimelineByIndex=async i=>i===1?f.timeline:other;
    f.project.GetCurrentTimeline=async()=>current;
    f.project.SetCurrentTimeline=async value=>{current=value;switches.push(await value.GetUniqueId());return true;};
    const result=await collectProjectTimelineAudio(f.project,{timelineId:'t2'},async()=>{});
    assert.equal(result.timelineId,'t2'); assert.deepEqual(switches,['t2','t1']); assert.equal(current,f.timeline);
});
test('temporary activation is restored even when audio collection fails', async () => {
    const f=fixture(); const other={...f.timeline,GetUniqueId:async()=>'t2',GetIsTrackEnabled:async()=>{throw new Error('failed');}};
    let current=f.timeline;
    f.project.GetTimelineCount=async()=>2;f.project.GetTimelineByIndex=async i=>i===1?f.timeline:other;
    f.project.GetCurrentTimeline=async()=>current;f.project.SetCurrentTimeline=async t=>{current=t;return true;};
    await assert.rejects(collectProjectTimelineAudio(f.project,{timelineId:'t2'},async()=>{}),/failed/);
    assert.equal(current,f.timeline);
});


test('subtitle action targets its bound timeline and restores the previous timeline on success or failure', async () => {
    const { withProjectTimeline } = require('../timelineAudio');
    for (const fail of [false, true]) {
        const f = fixture(); const other = { ...f.timeline, GetUniqueId: async () => 't2' };
        let current = f.timeline;
        f.project.GetTimelineCount = async () => 2;
        f.project.GetTimelineByIndex = async i => i === 1 ? f.timeline : other;
        f.project.GetCurrentTimeline = async () => current;
        f.project.SetCurrentTimeline = async t => { current = t; return true; };
        const action = async target => {
            assert.equal(target, other); assert.equal(current, other);
            if (fail) throw new Error('subtitle failed');
            return { inserted: 2 };
        };
        const result = withProjectTimeline(f.project, { timelineId: 't2' }, action, async () => {});
        if (fail) await assert.rejects(result, /subtitle failed/);
        else assert.deepEqual(await result, { inserted: 2 });
        assert.equal(current, f.timeline);
    }
});
test('a user timeline switch during subtitle insertion is not overwritten by restoration', async () => {
    const { withProjectTimeline } = require('../timelineAudio');
    const f = fixture(); const other = { ...f.timeline, GetUniqueId: async () => 't2' };
    const user = { GetUniqueId: async () => 'user-choice' }; let current = f.timeline;
    f.project.GetTimelineCount = async () => 2;
    f.project.GetTimelineByIndex = async i => i === 1 ? f.timeline : other;
    f.project.GetCurrentTimeline = async () => current;
    f.project.SetCurrentTimeline = async t => { current = t; return true; };
    await assert.rejects(withProjectTimeline(f.project, { timelineId: 't2' }, async () => { current = user; }, async () => {}), /已切换/);
    assert.equal(current, user);
});

test('Resolve audio transitions without media, offsets or clip properties do not block source clips', async () => {
    const f = fixture();
    const transition = { ...f.item, GetName: async () => '交叉淡变 0dB',
        GetMediaPoolItem: async () => null, GetLeftOffset: async () => null,
        GetRightOffset: async () => null, GetProperty: async () => ({}) };
    f.timeline.GetItemListInTrack = async () => [f.item, transition];
    const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips.length, 1);
    assert.equal(result.timelineData.audio_clips[0].clip_name, 'clip');
});
test('a missing media clip with trim offsets still fails instead of silently omitting audio', async () => {
    const f = fixture({ clip: { GetMediaPoolItem: async () => null,
        GetRightOffset: async () => 0, GetProperty: async () => ({}) } });
    await assert.rejects(collectTimelineAudio(f.project), /无法读取音频素材/);
});

test('native bridge non-media transition exception does not abort the timeline', async () => {
    const f = fixture();
    const transition = { ...f.item, GetMediaPoolItem: async () => {
        throw new Error('Execute: GetMediaPoolItem: Error response (errorStr:Item is not a media) (errorCode:6)');
    } };
    f.timeline.GetItemListInTrack = async () => [f.item, transition];
    const result = await collectTimelineAudio(f.project);
    assert.equal(result.timelineData.audio_clips.length, 1);
});
test('unrelated native media access errors still fail timeline sync', async () => {
    const f = fixture({ clip: { GetMediaPoolItem: async () => { throw new Error('bridge disconnected'); } } });
    await assert.rejects(collectTimelineAudio(f.project), /bridge disconnected/);
});

test('muted BGM is never read or mixed while dialogue and full timeline length are preserved', async () => {
    const f = fixture();
    let bgmMuted = true;
    const reads = [];
    f.timeline.GetTrackCount = async () => 2;
    f.timeline.GetTrackName = async (_type, index) => index === 1 ? '人声' : '伴奏';
    f.timeline.GetIsTrackEnabled = async (_type, index) => index === 1 || !bgmMuted;
    f.timeline.GetItemListInTrack = async (_type, index) => {
        reads.push(index);
        if (index === 2 && bgmMuted) throw new Error('must not access muted track media');
        return [f.item];
    };
    const muted = await collectTimelineAudio(f.project);
    assert.deepEqual(reads, [1]);
    assert.deepEqual(muted.timelineData.audio_clips.map(clip => clip.track_index), [1]);
    assert.equal(muted.timelineData.timeline_duration_sec, 10);
    assert.equal(muted.audioTracks[1].enabled, false);
    bgmMuted = false;
    const unmuted = await collectTimelineAudio(f.project);
    assert.deepEqual(unmuted.timelineData.audio_clips.map(clip => clip.track_index), [1, 2]);
});

test('all muted tracks produce an empty audio mix with unchanged duration for silent audio generation', async () => {
    const f = fixture({ trackEnabled: false });
    f.timeline.GetItemListInTrack = async () => { throw new Error('muted media must not be read'); };
    const result = await collectTimelineAudio(f.project, { allowEmptyAudio: true });
    assert.deepEqual(result.timelineData.audio_clips, []);
    assert.equal(result.timelineData.timeline_duration_sec, 10);
});

test('named BGM, music and effects tracks are excluded even when enabled', async () => {
    for (const excludedName of ['BGM', 'bgm', '音乐', '音效', ' BGM ', 'Bgm']) {
        const f = fixture();
        const reads = [];
        f.timeline.GetTrackCount = async () => 2;
        f.timeline.GetTrackName = async (_type, index) => index === 1 ? '人声' : excludedName;
        f.timeline.GetItemListInTrack = async (_type, index) => {
            reads.push(index);
            if (index === 2) throw new Error('must not access excluded source');
            return [f.item];
        };
        const result = await collectTimelineAudio(f.project);
        assert.deepEqual(reads, [1], excludedName);
        assert.deepEqual(result.timelineData.audio_clips.map(clip => clip.track_index), [1]);
        assert.equal(result.timelineData.timeline_duration_sec, 10);
    }
});
test('track exclusion matches whole names and preserves other track names', async () => {
    for (const name of ['人声', '音乐讲解', '音效说明', 'BGM narration', '音频 1']) {
        const f = fixture();
        f.timeline.GetTrackName = async () => name;
        const result = await collectTimelineAudio(f.project);
        assert.equal(result.timelineData.audio_clips.length, 1, name);
    }
});
test('a timeline containing only excluded tracks retains duration for silent audio generation', async () => {
    const f = fixture();
    f.timeline.GetTrackName = async () => 'BGM';
    f.timeline.GetItemListInTrack = async () => { throw new Error('excluded track read'); };
    const result = await collectTimelineAudio(f.project, { allowEmptyAudio: true });
    assert.deepEqual(result.timelineData.audio_clips, []);
    assert.equal(result.timelineData.timeline_duration_sec, 10);
});
