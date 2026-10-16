const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { renderTimelineAudio } = require('../renderAudio');
function setup({status='Complete',busy=false,missing=false,settings=true}={}) {
 const calls=[]; let running=false;
 const timeline={GetUniqueId:async()=>'t',GetSetting:async()=>24,GetStartFrame:async()=>86400,GetEndFrame:async()=>86640,GetName:async()=>'时间线'};
 const project={GetUniqueId:async()=>'p',GetName:async()=>'项目',GetCurrentTimeline:async()=>timeline,
 IsRenderingInProgress:async()=>busy||running,SaveAsNewRenderPreset:async name=>{calls.push(['save',name]);return true;},
 LoadRenderPreset:async name=>{calls.push(['preset',name]);return true;},DeleteRenderPreset:async name=>{calls.push(['delete-preset',name]);return true;},
 GetRenderJobList:async()=>[{JobId:'own-job',TargetDir:'/previous-output'}],
 GetCurrentRenderMode:async()=>0,SetCurrentRenderMode:async mode=>{calls.push(['mode',mode]);return true;},
 SetRenderSettings:async value=>{calls.push(['settings',value]);return settings;},AddRenderJob:async()=>{calls.push(['add']);return 'own-job';},
 StartRendering:async ids=>{assert.deepEqual(ids,['own-job']);calls.push(['start',ids[0]]);running=true;return true;},GetRenderJobStatus:async()=>({JobStatus:status}),
 StopRendering:async()=>{running=false;calls.push(['stop']);},DeleteRenderJob:async id=>{calls.push(['delete-job',id]);return true;}};
 const resolve={GetCurrentPage:async()=>'edit',OpenPage:async page=>{calls.push(['page',page]);return true;}};
 const outputDir=path.resolve('render-test');
 const deps={getProject:async()=>project,getResolve:async()=>resolve,params:{outputDir},wait:async()=>{running=false;},fileSystem:{mkdirSync(){},statSync(){if(missing)throw new Error('missing WAV');return {isFile:()=>true,size:1000};}}};
 return {deps,calls,project,outputDir};
}
test('renders the complete timeline to WAV and restores settings, mode and page',async()=>{
 const f=setup();const result=await renderTimelineAudio(f.deps);
 assert.equal(result.wavPath,path.join(f.outputDir,'render.wav'));
 assert.equal(result.timelineData.audio_clips[0].duration_sec,10);
 const config=f.calls.find(c=>c[0]==='settings'&&c[1].AudioFormat)[1];
 assert.equal(config.AudioFormat,'wav');assert.equal(config.ExportVideo,false);assert.equal(config.SelectAllFrames,true);
 assert(f.calls.some(c=>c[0]==='delete-job'&&c[1]==='own-job'));
 assert.deepEqual(f.calls.at(-1),['page','edit']);
 assert(f.calls.some(c=>c[0]==='mode'&&c[1]===0));
 assert(f.calls.some(c=>c[0]==='settings'&&c[1].TargetDir==='/previous-output'));
});
test('does not touch an existing render job',async()=>{
 const f=setup({busy:true});await assert.rejects(renderTimelineAudio(f.deps),/正在渲染/);assert.equal(f.calls.length,0);
});
test('cancelled, missing-file and settings failures restore the original preset',async()=>{
 for(const options of [{status:'Cancelled'},{missing:true},{settings:false}]){
  const f=setup(options);await assert.rejects(renderTimelineAudio(f.deps));
  assert(f.calls.some(c=>c[0]==='delete-preset'));assert.deepEqual(f.calls.at(-1),['page','edit']);
 }
});
test('timeout stops only the render started by this operation',async()=>{
 const f=setup();f.deps.wait=async()=>{};f.deps.maxPolls=1;
 await assert.rejects(renderTimelineAudio(f.deps),/超时/);assert(f.calls.some(c=>c[0]==='stop'));
});
