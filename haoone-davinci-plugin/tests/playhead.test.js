const test = require('node:test');
const assert = require('node:assert/strict');
const { syncPlayhead, frameToTimecode } = require('../playhead');
const target = { projectId: 'p', timelineId: 't', time: 5.5 };
function setup() {
 const calls = [];
 const timeline = { GetUniqueId: async () => 't', GetSetting: async () => '24', GetStartFrame: async () => 86400,
  GetEndFrame: async () => 86880, GetStartTimecode: async () => '01:00:00:00', SetCurrentTimecode: async tc => { calls.push(tc); return true; } };
 const project = { GetUniqueId: async () => 'p', GetCurrentTimeline: async () => timeline };
 return { timeline, project, calls, getProject: async () => project };
}
test('paused seek includes timeline origin and exact frame rate', async () => {
 const f=setup(); const result=await syncPlayhead(f.getProject, target);
 assert.equal(result.frame, 86532); assert.deepEqual(f.calls, ['01:00:05:12']);
});
test('other project or timeline is never moved or switched', async () => {
 for (const change of [{projectId:'other'}, {timelineId:'other'}]) {
  const f=setup(); assert.equal((await syncPlayhead(f.getProject, {...target,...change})).synced,false); assert.equal(f.calls.length,0);
 }
});
test('timeline switching during lookup prevents a stale seek', async () => {
 const f=setup(); let calls=0;
 f.project.GetCurrentTimeline=async()=> ++calls===1 ? f.timeline : {GetUniqueId:async()=>'other'};
 assert.equal((await syncPlayhead(f.getProject,target)).synced,false); assert.equal(f.calls.length,0);
});
test('invalid and expired positions do not move the playhead', async () => {
 const f=setup();
 for(const time of [-1,NaN,Infinity]) await assert.rejects(syncPlayhead(f.getProject,{...target,time}));
 assert.equal((await syncPlayhead(f.getProject,{...target,sentAt:Date.now()-3000})).reason,'expired'); assert.equal(f.calls.length,0);
});
test('seek clamps to the end of the current timeline', async () => {
 const f=setup(); assert.equal((await syncPlayhead(f.getProject,{...target,time:100})).frame,86880);
});
test('timecodes support integer, fractional and drop-frame timelines', () => {
 assert.equal(frameToTimecode(86401,24,false),'01:00:00:01');
 assert.equal(frameToTimecode(90025,25,false),'01:00:01:00');
 assert.equal(frameToTimecode(86424,23.976,false),'01:00:01:00');
 assert.equal(frameToTimecode(107892,29.97,true),'01:00:00;00');
 assert.equal(frameToTimecode(1800,29.97,true),'00:01:00;02');
 assert.equal(frameToTimecode(215784,59.94,true),'01:00:00;00');
});
