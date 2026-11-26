import {WorkoutCoach,workoutMeasurement} from '../web/workout.js';
import {openWorkoutCamera} from '../web/workout-ui.js';
import {bodyMeasurementReview,measuredEntry} from '../web/body-measurements.js';
import {ballMatchSample,mapCropBall} from '../web/ball-review.js';
import {loadPlayerReference,referenceMemory,savePlayerReference,suggestedAnchor} from '../web/player-reference.js';
import {changedScene} from '../web/scene.js';
import assert from 'node:assert/strict';
import {PlayerLock, attemptReview, coachReview, metrics, seekFrame} from '../web/pose.js';
import {PlayerSelectionError, PoseEngineError, modelWithin, withPoseFallback} from '../web/pose-engine.js';
import {gapCandidate, mergePlayers, playerCrop, reentryCrop, tappedPlayer, uncropPoint} from '../web/player-selection.js';
import {ballProgress, matchKey, matchProgress, nextSection, scanSavedBallSections, scanSections, sectionAt, sectionRange} from '../web/match-review.js';
import {calibratePitch, estimateId, eventTotals, suggestBallEvents, tacticalZones, unreviewedEstimates} from '../web/match.js';
import {outcomeRate, planFor} from '../web/training.js';
import worker from '../dist/server/index.js';
import {poseCoverage,sampleAt,reconnectTrack,skillMoments} from '../web/review-flow.js';
import {ballControl,formationOverview} from '../web/team-tactics.js';
import {clipNarrationWindow,mixPcmTracks} from '../web/export.js';
import {openPoseReview,savePoseReview} from '../web/saved-pose.js';
import {activeCoachingCue,drawBodyOutline,maskContours} from '../web/highlight.js';
import {assignTrackIds,classifyKit,correctTeam,detectionTiles,kitHistogram,teamShape,teamTimeline} from '../web/team.js';

const workoutPose=(style,side=0)=>{
  const points=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
  const keys=side?[12,14,16,24,26,28]:[11,13,15,23,25,27];
  const styles={
    top:[[.48,.18],[.50,.29],[.50,.40],[.48,.40],[.48,.6],[.48,.82]],
    halfway:[[.43,.24],[.48,.36],[.49,.48],[.34,.43],[.49,.55],[.49,.82]],
    low:[[.30,.31],[.40,.43],[.49,.53],[.29,.58],[.49,.58],[.49,.82]],
    plank:[[.25,.45],[.25,.54],[.25,.68],[.45,.45],[.63,.45],[.78,.45]],
    bent:[[.25,.45],[.25,.54],[.25,.68],[.45,.65],[.63,.52],[.78,.45]],
    pushLow:[[.25,.55],[.17,.55],[.17,.69],[.45,.55],[.63,.55],[.78,.55]],
    hingeLow:[[.22,.42],[.20,.54],[.20,.68],[.5,.42],[.5,.61],[.5,.82]],
  };
  styles[style].forEach(([x,y],i)=>{points[keys[i]]={x,y,z:0,visibility:1};});
  return points;
};
assert.equal(workoutMeasurement(workoutPose('top'),'squat',1).metric,180);
assert.equal(workoutMeasurement(workoutPose('low'),'squat',1).metric,90);
assert.equal(workoutMeasurement(workoutPose('top'),'pushup',1),null);
const counting=new WorkoutCoach('squat');
counting.read(workoutPose('top'),1,0);
counting.read(workoutPose('halfway'),1,.2);
counting.read(workoutPose('low'),1,.7);
assert.equal(counting.read(workoutPose('top'),1,1.2).reps,1);
counting.read(workoutPose('low'),1,1.5);
counting.read(null,1,1.6);
assert.equal(counting.read(workoutPose('top'),1,1.8).reps,1);
assert.deepEqual(counting.summary().bottomRange,[90,90]);
assert.ok(counting.summary().coverage<100);
const plankCoach=new WorkoutCoach('plank');
[0,.4,.8,1.2].forEach(time=>plankCoach.read(workoutPose('plank'),1,time));
assert.equal(plankCoach.summary().hold,1);
[1.5,1.7,1.9].forEach(time=>plankCoach.read(workoutPose('bent'),1,time));
assert.match(plankCoach.summary().notes[0].cue,/hips drifted/);
assert.equal(plankCoach.read(workoutPose('plank'),1,9).hold,1);
for(const [mode,up,down] of [['hinge','top','hingeLow'],['pushup','plank','pushLow'],['lunge','top','low']]) {
  const exerciseCoach=new WorkoutCoach(mode);
  const visibleFrame=style=>{
    const base=workoutPose(style);
    if(mode!=='lunge')return base;
    const support=workoutPose('top',1);
    return base.map((joint,index)=>support[index].visibility?support[index]:joint);
  };
  exerciseCoach.read(visibleFrame(up),1,0);
  exerciseCoach.read(visibleFrame(down),1,.5);
  exerciseCoach.read(visibleFrame(down),1,.85);
  assert.equal(exerciseCoach.read(visibleFrame(up),1,1.2).reps,1,mode);
}
const runningCoach=new WorkoutCoach('running');
for(const time of [0,.2,.4])runningCoach.read(workoutPose('hingeLow'),1,time);
assert.match(runningCoach.summary().notes[0].cue,/torso stayed/);
assert.equal(runningCoach.summary().reps,0);
const measured=measuredEntry({date:'2026-11-26',method:'Same scale',weight:'80',fat:25,muscle:36});
assert.deepEqual(measured,{date:'2026-11-26',method:'Same scale',weight:80,fat:25,muscle:36});
assert.equal(measuredEntry({date:'2026-02-30',method:'Scale',weight:80}),null);
assert.equal(measuredEntry({date:'2026-11-26',method:'Scale',weight:80,muscle:90}),null);
const composition=bodyMeasurementReview([
  {date:'2026-11-20',method:'same scale',weight:81,fat:27}, {date:'2026-11-24',method:'Other scale',weight:50,fat:10},
],measured);
assert.deepEqual(composition,{fatMass:20,leanMass:60,changes:[
  {field:'weight',date:'2026-11-20',difference:-1},{field:'fat',date:'2026-11-20',difference:-2},
]});
const permissionAbort=new AbortController();
let resolveCameraGrant,stoppedTrack=0;
const cameraPromise=openWorkoutCamera({getUserMedia(options){
  assert.equal(options.audio,false);
  return new Promise(resolve=>{resolveCameraGrant=resolve;});
}},permissionAbort.signal);
permissionAbort.abort();
await assert.rejects(cameraPromise,{name:'AbortError'});
resolveCameraGrant({getTracks:()=>[{stop(){stoppedTrack++;}}]});
await Promise.resolve();
assert.equal(stoppedTrack,1);
const hostedHome=await worker.fetch(new Request('https://fixture.test/'),{});
assert.match(hostedHome.headers.get('permissions-policy'),/camera=\(self\)/);
assert.deepEqual(sectionRange(39,480),{start:468,end:480});
assert.equal(sectionAt(5400,5400),449);
assert.notEqual(await matchKey(new Blob(['a'])),await matchKey(new Blob(['b'])));
const restart=new AbortController(),records=new Map(),queued=[];
const resumeMemory={last:{center:{x:.3,y:.4}},missing:0};
let checkpoint={anchor:{x:.4,y:.5,time:287},parts:{}};
const sectionOptions={
  duration:480,all:true,load:(_session,index)=>records.get(index),
  scan:async ({index,anchor,memory,start,end})=>{
    assert.ok(end-start<=12);
    assert.ok(anchor.time>=start&&anchor.time<end);
    if(queued.length)assert.ok(memory);
    queued.push(index);
    return {frames:[{points:[1]}],forwardMemory:resumeMemory,backwardMemory:resumeMemory};
  },
  save:(session,index,result)=>{records.set(index,result);checkpoint=structuredClone(session);},
  onSection:()=>{if(queued.length===3)restart.abort();},
};
await assert.rejects(scanSections({...sectionOptions,session:checkpoint,index:23,signal:restart.signal}),{name:'AbortError'});
assert.deepEqual(queued,[23,24,25]);
assert.equal(nextSection(checkpoint,480),26);
const completed=await scanSections({...sectionOptions,session:checkpoint,index:26,signal:new AbortController().signal});
assert.equal(queued.length,40);
assert.equal(new Set(queued).size,40);
assert.equal(nextSection(completed,480),null);
assert.deepEqual(matchProgress(completed,480),{count:40,seconds:480,matched:40,total:40});
queued.length=0;records.clear();
checkpoint={anchor:{x:.4,y:.5,time:2752},parts:{}};
const full=await scanSections({...sectionOptions,duration:5400,session:checkpoint,index:229,signal:new AbortController().signal});
assert.equal(queued.length,450);
assert.equal(new Set(queued).size,450);
assert.equal(nextSection(full,5400),null);
assert.equal(matchProgress(full,5400).seconds,5400);

const ballStop=new AbortController(),ballRecords=new Map();
let ballSession={id:'review',parts:{0:{index:0,matched:10},1:{index:1,matched:0},2:{index:2,matched:4}}};
const ballScans=[];
const ballOptions={
  duration:35,load:()=>({pose:{},forwardMemory:{marker:'player'}}),
  scan:async (_record,index,{start,end})=>{
    assert.ok(end-start<=12);
    ballScans.push(index);return {samples:[{time:start}],observed:2,tried:3,eligible:3,candidates:1};
  },
  save:(session,index,record)=>{ballSession=structuredClone(session);ballRecords.set(index,record);},
  onSection:()=>{if(ballScans.length===1)ballStop.abort();},
};
await assert.rejects(scanSavedBallSections({...ballOptions,session:ballSession,signal:ballStop.signal}),{name:'AbortError'});
assert.deepEqual(ballProgress(ballSession),{ready:2,sections:1,observed:2,tried:3,eligible:3,retry:0});
await scanSavedBallSections({...ballOptions,session:ballSession,signal:new AbortController().signal});
assert.deepEqual(ballScans,[0,2]);
assert.deepEqual(ballRecords.get(2).forwardMemory,{marker:'player'});
assert.equal(ballRecords.get(2).ballSamples[0].time,24);
assert.deepEqual(ballProgress(ballSession),{ready:2,sections:2,observed:4,tried:6,eligible:6,retry:0});
const misses={parts:{0:{index:0,matched:2,ball:{observed:0,tried:3,eligible:3}},
  1:{index:1,matched:2,ball:{observed:0,tried:3,eligible:3,detail:true}},
  2:{index:2,matched:2,ball:{observed:2,tried:3,eligible:3}}}};
assert.equal(ballProgress(misses).retry,1);
const retriedIndices=[];
const detailResult=await scanSavedBallSections({session:misses,duration:36,detail:true,
  signal:new AbortController().signal,load:()=>({pose:{}}),scan:async (_record,index)=>{
    retriedIndices.push(index);return {observed:3,tried:3,eligible:3,samples:[]};
  },save:()=>{},onSection(){}});
assert.deepEqual(retriedIndices,[0]);
assert.equal(ballProgress(detailResult).retry,0);
assert.equal(ballProgress(detailResult).observed,5);
const reconnectSession={anchor:{time:0,x:.3,y:.4},parts:{0:{index:0,matched:2}}};
await scanSections({session:reconnectSession,duration:40,index:0,anchorOverride:{time:6,x:.5,y:.5},
  signal:new AbortController().signal,load:()=>({kept:true}),
  scan:async ({start})=>{assert.equal(start,6);return {frames:[{time:6,points:[1]}]};},
  combine:(current,fresh,time)=>{assert.ok(current.kept);assert.equal(time,6);return {
    frames:[{time:0,points:[1]},...fresh.frames],
  };},
  save:(_session,_index,result)=>assert.deepEqual(result.frames.map(frame=>frame.time),[0,6]),onSection(){}});
assert.equal(changedScene(new Uint8Array(24),new Uint8Array(24).fill(215)),true);
assert.equal(changedScene(new Uint8Array(24).fill(100),new Uint8Array(24).fill(110)),false);

const modes=[],closed=[];
const engineRun=await withPoseFallback(async engine=>{
  if(engine.mode==='simple')throw new PoseEngineError('Aborted(). Build with -sASSERTIONS for more info.');
  return 'tracked';
},{
  compatible:true,signal:new AbortController().signal,onRetry:()=>modes.push('retry'),
  open:async mode=>{modes.push(mode);return {mode,close:()=>closed.push(mode)};},
});
assert.equal(engineRun,'tracked');
assert.deepEqual(modes,['simple','retry','cpu']);
assert.deepEqual(closed,['simple','cpu']);
const engineCancelled=new AbortController();
let settle, late;
const pendingModel=new Promise(resolve=>{settle=resolve;});
const waiting=modelWithin(pendingModel,engineCancelled.signal,1000,resource=>{late=resource;});
engineCancelled.abort();
await assert.rejects(waiting,{name:'AbortError'});
settle('released');
await pendingModel;
assert.equal(late,'released');
let engineOpens=0;
await assert.rejects(withPoseFallback(async()=>{throw new Error('Video stopped seeking.');},{
  compatible:false,signal:new AbortController().signal,
  open:async()=>{engineOpens++;return {close(){}};},
}),/Video stopped seeking/);
assert.equal(engineOpens,1);

const selectionModes=[];
await assert.rejects(withPoseFallback(async()=>{throw new PlayerSelectionError();},{
  compatible:true,signal:new AbortController().signal,
  open:async mode=>{selectionModes.push(mode);return {close(){}};},
}),/Your selection is still marked/);
assert.deepEqual(selectionModes,['simple','cpu']);

const selectedCrop=playerCrop({x:.025,y:.9},.35,1080,1920);
assert.equal(selectedCrop.x,0);
assert.deepEqual(uncropPoint({x:.5,y:0},selectedCrop),
  {x:selectedCrop.side/2160,y:selectedCrop.y/1920});
const candidate=x=>({
  points:[{x,y:.43},{x:x+.013,y:.45},{x:x+.006,y:.50}],
  sig:{center:{x:x+.006,y:.46},torso:.035}
});
const small=candidate(.28),other=candidate(.34);
assert.equal(tappedPlayer([small,other],{x:.286,y:.46},480,854),small);
assert.equal(tappedPlayer([small,other],{x:.20,y:.46},480,854),null);
assert.equal(tappedPlayer([small,candidate(.282)],{x:.286,y:.46},480,854),null);
assert.deepEqual(mergePlayers([small], [candidate(.284),other]),[small,other]);

function kit(bin,x) {
  const bins=new Float32Array(64);
  bins[bin]=1;
  return {sig:{bins,hip:{x,y:.5},shape:.6}};
}
const lock=new PlayerLock(kit(1,.2).sig);
assert.equal(lock.match([kit(1,.24)]).state,'tracked');
assert.equal(lock.match([kit(22,.24)]).state,'ambiguous');
assert.equal(lock.match([kit(1,.8),kit(1,.78)]).state,'ambiguous');
assert.deepEqual([.8,.81,.82].map(x=>lock.match([kit(1,x),kit(22,.24)]).state),
  ['checking','checking','reacquired']);

const afterCut=new PlayerLock(kit(1,.2).sig);
afterCut.markDiscontinuity();
assert.deepEqual([.2,.21,.22,.23].map(x=>afterCut.match([kit(1,x)]).state),
  ['checking','checking','checking','reacquired']);
const bodyReference=kit(1,.2).sig;
bodyReference.lower=kit(5,.2).sig.bins;
const sameShirt=kit(1,.206),sameBody=kit(1,.210);
sameShirt.sig.lower=kit(8,.2).sig.bins;
sameBody.sig.lower=bodyReference.lower;
const bodyLock=new PlayerLock(bodyReference);
assert.equal(bodyLock.match([sameShirt,sameBody]).person,sameBody);

const at=(x,bin=1)=> {
  const person=kit(bin,x);
  person.sig.center={x,y:.48};
  person.sig.torso=.045;
  return person;
};
const moving=new PlayerLock(at(.35).sig);
assert.equal(moving.match([at(.39)]).state,'tracked');
assert.equal(moving.match([at(.43),at(.37)]).person.sig.center.x,.43);
assert.equal(moving.match([]).state,'lost');
assert.equal(moving.match([at(.5,22)]).state,'ambiguous');
const prior=at(.51).sig,next=at(.54).sig,target=at(.525),wrong=at(.525,22);
assert.equal(gapCandidate([wrong,target],prior,next,.5),target);
assert.equal(gapCandidate([at(.53),target],prior,next,.5),null);
assert.equal(gapCandidate([target],prior,at(.80).sig,.5),null);
assert.ok(reentryCrop(0,1920,1080).x<reentryCrop(2,1920,1080).x);
assert.ok(reentryCrop(0,1080,1920).y<reentryCrop(2,1080,1920).y);

const points=Array.from({length:33},()=>({x:.55,y:.3,z:0,visibility:1}));
points[23]={x:.4,y:.5,z:0,visibility:1};
points[24]=points[23];
const frames=Array.from({length:16},(_,i)=>({time:i/8,points,world:null}));
assert.equal(planFor('running',coachReview(frames,1.8).findings).items[0].key,'trunk');
assert.equal(coachReview(frames.slice(0,6),1.8).findings.length,0);
points[25]={x:.39,y:.63,z:0,visibility:1};
points[26]={x:.41,y:.65,z:0,visibility:1};
points[27]={x:.37,y:.78,z:0,visibility:1};
points[28]={x:.47,y:.77,z:0,visibility:1};
assert.ok(metrics(frames[0],1.8).some(([name])=>name==='Left knee (2D)'));
assert.match(attemptReview(frames,.5,'landing','right',1.8).findings[0].observation,/in the camera view/);
const checkedPose={time:1,points};
const sportsBall=(x,y,score=.9)=>({categories:[{categoryName:'sports ball',score}],
  boundingBox:{originX:x-2,originY:y-2,width:4,height:4}});
const ballCtx={canvas:{width:100,height:100},getImageData:(_x,_y,w,h)=>({data:new Uint8Array(w*h*4).fill(110)})};
const projectedBall=mapCropBall(sportsBall(100,100),{x:200,y:100,side:200,width:800,height:400},200,400,200);
assert.deepEqual(projectedBall.boundingBox,{originX:149,originY:99,width:2,height:2});
const nearBall=ballMatchSample([sportsBall(37,78)],checkedPose,100,100,ballCtx);
assert.equal(nearBall.nearYou,true);
assert.equal(ballMatchSample([sportsBall(37,78),sportsBall(80,80,.85)],checkedPose,100,100,ballCtx).ball,null);
const receiver={categories:[{categoryName:'person',score:.95}],boundingBox:{originX:68,originY:30,width:19,height:50}};
const reception=ballMatchSample([sportsBall(77,80),receiver],checkedPose,100,100,ballCtx);
assert.deepEqual(reception.receiver,{x:.775,y:.56,team:'similar',clear:false});
const fakeStorage=new Map();
const testStorage={getItem:key=>fakeStorage.get(key),setItem:(key,value)=>fakeStorage.set(key,value),
  removeItem:key=>fakeStorage.delete(key)};
const referencePose=at(.45).sig;
const reference=savePlayerReference(testStorage,{seed:referencePose,references:[referencePose]});
assert.deepEqual(loadPlayerReference(testStorage),reference);
assert.deepEqual(referenceMemory(reference).last,reference.seed);
assert.equal(referenceMemory(reference).acrossCut,true);
assert.equal(suggestedAnchor([{time:0,points},{time:.125,points:null}]),null);
assert.equal(suggestedAnchor([{time:0,points},{time:.125,points,cut:true}]),null);
assert.equal(suggestedAnchor([{time:0,points},{time:.125,points}]).time,.125);
assert.equal(savePlayerReference(testStorage,null),null);
assert.equal(loadPlayerReference(testStorage),null);
const similarReference=new PlayerLock(referencePose);
similarReference.markDiscontinuity();
assert.equal(similarReference.match([at(.1),at(.8)]).state,'ambiguous');
const coverageExample=poseCoverage([
  {time:0,points},{time:.125,points:null},{time:.25,points:null},{time:.375,points},
],.49);
assert.deepEqual(coverageExample,{start:0,end:.49,matched:2,total:4,gaps:[{start:.125,end:.375}]});
assert.equal(coachReview(frames,1.8).moments[0].focus,'trunk');
const uncertainReview=savePoseReview({frames:[{time:0,points,state:'tracked'},
  {time:.125,points:null,state:'ambiguous'}]},'running',null,'right');
assert.equal(openPoseReview(uncertainReview,1).frames[1].state,'ambiguous');
assert.equal(outcomeRate(10,7),70);
assert.equal(outcomeRate(3,4),null);

const corners=[[.25,.25],[.75,.25],[.9,.9],[.1,.9]], project=calibratePitch(corners);
for(const [index,point] of corners.entries()) {
  const expected=[[0,0],[1,0],[1,1],[0,1]][index], mapped=project(point);
  assert.ok(mapped&&mapped.every((value,i)=>Math.abs(value-expected[i])<1e-8));
}
assert.equal(calibratePitch([corners[0],corners[2],corners[1],corners[3]]),null);
assert.equal(project([0,0]),null);
const [{success,known,unclear}]=eventTotals(
  ['Completed','Incomplete','Unclear'].map(outcome=>({kind:'pass',outcome})));
assert.deepEqual([success,known,unclear],[1,2,1]);

const ball=(time,x,nearYou=false,receiver=null)=>({time,ball:[x,.5],nearYou,receiver});
const peer={team:'similar',x:.52,y:.5};
const departure=[ball(1,.20,true),ball(1.25,.21,true),ball(1.5,.28)];
assert.equal(suggestBallEvents([...departure,{...ball(1.75,.51,false,peer),cut:true},ball(2,.52,false,peer)],[]).length,0);
assert.equal(suggestBallEvents([...departure,ball(1.75,.51,false,peer),ball(2,.52,false,peer)],[])[0].outcome,'Completed');
assert.equal(suggestBallEvents([...departure,ball(2.3,.51,false,peer),ball(2.55,.52,false,peer)],[]).length,0);
assert.equal(suggestBallEvents([...departure,ball(1.75,.82),ball(2,.84)],[[.79,.4],[.9,.6]])[0].kind,'shot');
assert.equal(suggestBallEvents([...departure,ball(1.75,.82)],[[.79,.4],[.9,.6]]).length,0);
assert.deepEqual(['left','right'].map(attack=>tacticalZones([[.26,.26]],project,attack).counts.attacking),[1,0]);

const histogram=color=>kitHistogram(Uint8ClampedArray.from([...color,255,...color,255]));
const shirts={A:histogram([240,20,20]),B:histogram([20,20,240])};
assert.equal(classifyKit(histogram([190,10,10]),shirts),'A');
assert.equal(classifyKit(histogram([20,20,190]),shirts),'B');
assert.equal(classifyKit(histogram([30,190,20]),shirts),null);
assert.equal(classifyKit(shirts.A,{A:shirts.A,B:shirts.A}),null);
const squad=Array.from({length:22},(_,i)=>({team:i<11?'A':'B',
  field:[.07+(i%11)*.077,(i<11?.14:.37)+(i%5)*.10],box:[.2,.2,.06,.1]}));
const scene=assignTrackIds([],squad,0,1);
assert.equal(new Set(scene.players.map(p=>p.id)).size,22);
const moved=assignTrackIds(scene.tracks,squad.map(p=>({...p,field:[p.field[0]+.002,p.field[1]]})),1/3,scene.nextId);
assert.deepEqual(moved.players.map(p=>p.id),scene.players.map(p=>p.id));
assert.equal(teamShape(scene.players,'A').count,11);
assert.deepEqual(teamShape(scene.players,'A').channels,[5,6,0]);
assert.equal(teamShape(scene.players.slice(0,3),'A'),null);
assert.ok(teamShape(scene.players,'A').pressureGap>0);
assert.equal(teamShape(scene.players,'A','left').center,100-teamShape(scene.players,'A','right').center);
assert.ok(teamTimeline(Array.from({length:4},(_,i)=>({time:i/3,players:scene.players})),'right')
  .some(cue=>cue.title==='Closest opposition spacing'));

// Shirt variants, twilight color shifts, and short gaps on a repeated track.
const shades=[histogram([230,19,34]),histogram([255,244,235])];
assert.equal(classifyKit(histogram([160,20,10]),{A:shades,B:[shirts.B]}),'A');
assert.equal(classifyKit(histogram([225,201,187]),{A:shades,B:[shirts.B]}),'A');
assert.equal(detectionTiles(1280,720,true).length,7);
assert.equal(detectionTiles(640,360,false).length,1);
const visible=(field,team)=>({field,team,box:[.14,.20,.08,.19]});
let phase=assignTrackIds([], [visible([.30,.5],'A')],0,1);
const persistent=phase.players[0].id;
phase=assignTrackIds(phase.tracks,[visible([.31,.5],null)],1/3,phase.nextId);
assert.equal(phase.players[0].id,persistent);
assert.equal(phase.players[0].team,'A');
assert.equal(phase.players[0].teamSource,'continuity');
const covered=assignTrackIds(phase.tracks,[],2/3,phase.nextId);
assert.equal(covered.players[0].id,persistent);
assert.equal(covered.players[0].estimated,true);
assert.equal(teamShape([...scene.players.filter(p=>p.team==='A').slice(0,3),...covered.players],'A'),null);
const after=assignTrackIds(covered.tracks,[visible([.332,.5],'B')],1,covered.nextId);
assert.equal(after.players[0].id,persistent);
assert.equal(after.players[0].team,'A');
assert.equal(assignTrackIds(covered.tracks,[],2,covered.nextId).players.length,0);
const mystery=assignTrackIds([], [visible([.2,.2],null)],0,9);
assert.equal(mystery.players[0].id,9);
const review=[{players:mystery.players},{players:mystery.players.map(p=>({...p}))}];
assert.equal(correctTeam(review,9,'B'),true);
assert.deepEqual(review.map(frame=>frame.players[0].team),['B','B']);
assert.equal(correctTeam(review,999,'A'),false);
for(const data of [phase,covered,after]) assert.equal(new Set(data.players.map(p=>p.id)).size,data.players.length);

const mask=new Float32Array(30*30);
for(let y=3;y<23;y++)for(let x=10;x<19;x++)mask[y*30+x]=.9;
mask[29]=1;
const outline=maskContours(mask,30,30);
assert.equal(outline.length,1);
assert.equal(outline[0].length,4);
assert.ok(outline[0].every(([x,y])=>x>=10/30&&x<=19/30&&y>=3/30&&y<=23/30));
assert.equal(maskContours(new Uint8Array(30*30),30,30).length,0);
let filled=0,stroked=0;
const canvasContext={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},
  fill(){filled++;},stroke(){stroked++;}};
assert.equal(drawBodyOutline(canvasContext,{x:0,y:0,w:640,h:360},{points,outline}),true);
assert.equal(filled,1);assert.equal(stroked,2);
assert.equal(drawBodyOutline(canvasContext,{x:0,y:0,w:640,h:360},{points:null,outline}),false);
const cue={start:1,end:2,observation:'Camera-view posture'};
assert.equal(activeCoachingCue([cue],1.5,{points}),cue);
assert.equal(activeCoachingCue([cue],1.5,{points:null}),null);
assert.equal(activeCoachingCue([cue],2,{points}),null);

const oldTrack={frames:[{time:0,points},{time:.125,points:null},{time:4,points}],cues:[{time:.1},{time:4}]};
const repaired=reconnectTrack(oldTrack,{frames:[{time:2.17,points},{time:2.295,points}],cues:[{time:2.2}]},2.17);
assert.deepEqual(repaired.frames.map(p=>p.time),[0,.125,2.17,2.295]);
assert.equal(sampleAt(repaired.frames,2.20).state,'reacquired');
assert.equal(sampleAt(repaired.frames,1),null);
const moments=skillMoments('pass',{frames,ballSamples:[
  {time:.25,ball:[.3,.5],nearYou:true},{time:.5,ball:[.41,.5],nearYou:false},
]});
assert.equal(moments[0].time,.25);
assert.equal(skillMoments('pass',{frames:[],ballSamples:[{time:.25,nearYou:true}]}).length,0);
assert.deepEqual(clipNarrationWindow(1,2,1.5,2.5),{delay:0,offset:.5,duration:1});
assert.deepEqual(clipNarrationWindow(3,3,2,4),{delay:1,offset:0,duration:1});
assert.equal(clipNarrationWindow(5,1,1,4),null);
const stored=savePoseReview({frames:[
  {time:1.25,state:'tracked',points,world:points,outline:[[[.2,.1],[.42,.1],[.2,.5]]]},
  {time:1.375,state:'lost',points:null},
  {time:2.7,state:'reacquired',points,world:points},
],cues:[{time:1.25,title:'Movement',category:'Other',feedback:'Review posture.'}]},'pass',1.25,'left');
const opened=openPoseReview(JSON.parse(JSON.stringify(stored)),4);
assert.equal(opened.frames.length,3);
assert.deepEqual(opened.frames[0].outline,[[[.2,.1],[.42,.1],[.2,.5]]]);
assert.equal(opened.frames[1].state,'lost');
assert.equal(opened.frames[2].state,'reacquired');
assert.equal(opened.mode,'pass');
assert.equal(opened.moment,1.25);
assert.equal(opened.foot,'left');
assert.equal(openPoseReview(stored,.5),null);


const byRole=Array.from({length:10},(_,i)=>({id:i+1,team:'A',
  field:[i<4?.27+(i%4)*.005:i<7?.50+(i%3)*.005:.74+(i%3)*.005,.18+(i%4)*.2]}));
const shape=formationOverview(Array.from({length:5},(_,i)=>({time:i/3,players:byRole})),'right');
assert.equal(shape[0].shape,'4–3–3');
assert.equal(shape[1].shape,null);
const controlPlayers=[
  {id:1,team:'A',field:[.31,.61],box:[.29,.5,.04,.11]},
  {id:2,team:'A',field:[.50,.60],box:[.48,.49,.04,.11]},
  {id:3,team:'B',field:[.67,.61],box:[.65,.5,.04,.11]},
];
const possessionSamples=Array.from({length:8},(_,i)=>{
  const p=i<2?controlPlayers[0]:i<4?controlPlayers[1]:controlPlayers[2];
  return {time:i/3,players:controlPlayers,ball:i===6||i===7?null:{center:p.field,field:p.field}};
});
const control=ballControl(possessionSamples);
assert.equal(control.links.length,1);
assert.equal(control.links[0].from,1);
assert.equal(control.links[0].to,2);
assert.equal(control.events[1].kind,'turnover');
assert.ok(control.seconds.unknown>=.65);
assert.deepEqual(ballControl([{time:0,players:controlPlayers,ball:null},{time:1,players:controlPlayers,ball:null}]).events,[]);

const strong=(time,x,nearYou=false,receiver=null)=>({...ball(time,x,nearYou,receiver),score:.9});
const strongPeer={...peer,clear:true};
const strongStart=[strong(1,.20,true),strong(1.25,.21,true),strong(1.5,.28)];
const automatic=suggestBallEvents([...strongStart,strong(1.75,.51,false,strongPeer),
  strong(2,.52,false,strongPeer),strong(2.25,.53,false,strongPeer)],[]);
assert.equal(automatic[0].automatic,true);
assert.equal(unreviewedEstimates(automatic,[],[]).length,1);
assert.equal(unreviewedEstimates(automatic,[{kind:'pass',time:1.8}],[]).length,0);
assert.equal(unreviewedEstimates(automatic,[],[estimateId(automatic[0])]).length,0);
const weak=suggestBallEvents([...strongStart,strong(1.75,.51,false,peer),strong(2,.52,false,peer)],[]);
assert.equal(weak[0].automatic,false);
const trackedShot=suggestBallEvents([...strongStart,strong(1.75,.82),strong(2,.83),strong(2.25,.84)],[[.78,.4],[.90,.6]]);
assert.equal(trackedShot[0].kind,'shot');
assert.equal(trackedShot[0].automatic,true);
const afterGap=suggestBallEvents([...strongStart,{time:1.75,ball:null},
  strong(2,.82),strong(2.25,.83),strong(2.5,.84)],[[.78,.4],[.90,.6]]);
assert.equal(afterGap.some(item=>item.automatic),false);
const buffer=(...samples)=>({length:samples.length,numberOfChannels:1,getChannelData:()=>Float32Array.from(samples)});
const mix=mixPcmTracks(4,1,[
  {buffer:buffer(.0,.5,.5,.0),delay:0,offset:0,duration:1,gain:1},
  {buffer:buffer(1,1,1,1),delay:.25,offset:.25,duration:.5,gain:.75},
]);
assert.deepEqual([...mix.left],[0,1,1,0]);
assert.deepEqual([...mix.right],[...mix.left]);
assert.deepEqual([...mixPcmTracks(4,1,[{buffer:buffer(.5,.25,.125),delay:.5,offset:.25,duration:.5,gain:1}]).left],
  [0,0,.25,.125]);

const host='https://fixture.test';
const api=(path,options={},env={})=>worker.fetch(new Request(host+path,options),env);
assert.equal((await api('/api/reviews')).status,401);
const headers={'oai-authenticated-user-id':'fixture-user','oai-authenticated-user-email':'owner@fixture.test'};
assert.equal((await api('/api/reviews',{headers})).status,503);
const files=new Map();
const BUCKET={
  async put(key,body,metadata) {files.set(key,{body,...metadata,uploaded:new Date()});},
  async list({prefix=""}={}) {return {objects:[...files].filter(([key])=>key.startsWith(prefix)).map(([key,meta])=>({key,...meta}))};},
  async get(key) {const item=files.get(key);return item&&{...item,size:new Blob([item.body]).size};},
  async delete(keys) {for(const key of [keys].flat()) files.delete(key);},
};
const form=new FormData();
form.set('name','Match review');
form.set('review',JSON.stringify({version:1,source:'test.mp4',tags:[]}));
form.set('video',new File(['fixture-footage'],'test.mp4',{type:'video/mp4'}));
const posted=await api('/api/reviews',{
  method:'POST',body:form,headers:{...headers,origin:host,'content-length':'2000'}
},{BUCKET});
assert.equal(posted.status,201);
const {id}=await posted.json();
const listing=await (await api('/api/reviews',{headers},{BUCKET})).json();
assert.equal(listing.items[0].name,'Match review');
assert.equal(listing.items[0].role,'owner');
const guest={'oai-authenticated-user-id':'guest-id','oai-authenticated-user-email':'coach@fixture.test'};
const opts=(method,headers,data)=>({method,headers:{...headers,origin:host},body:data?JSON.stringify(data):undefined});
const path='/api/reviews/'+id;
assert.equal((await api(path+'/clip',{headers:guest},{BUCKET})).status,404);
assert.equal((await (await api('/api/reviews',{headers:guest},{BUCKET})).json()).items.length,0);
let grant=await api(path+'/access',opts('POST',headers,{email:'coach@fixture.test',role:'viewer'}),{BUCKET});
assert.equal(grant.status,200);assert.equal((await api(path+'/clip',{headers:guest},{BUCKET})).status,200);
assert.equal((await api(path+'/feedback',opts('POST',guest,{time:2,note:'Test'}),{BUCKET})).status,403);
assert.equal((await api(path,opts('DELETE',guest),{BUCKET})).status,403);
assert.equal((await api(path+'/access',opts('POST',guest,{email:'other@fixture.test',role:'coach'}),{BUCKET})).status,403);
grant=await api(path+'/access',opts('POST',headers,{email:'coach@fixture.test',role:'coach'}),{BUCKET});
assert.equal(grant.status,200);
assert.equal((await api(path+'/feedback',opts('POST',guest,{time:2,note:'Review the support foot.'}),{BUCKET})).status,201);
assert.equal((await (await api(path+'/feedback',{headers},{BUCKET})).json()).items[0].note,'Review the support foot.');
assert.equal((await api(path+'/access',opts('POST',headers,{email:'coach@fixture.test',role:'revoke'}),{BUCKET})).status,200);
assert.equal((await api(path+'/clip',{headers:guest},{BUCKET})).status,404);
assert.equal(await (await api('/api/reviews/'+id+'/clip',{headers},{BUCKET})).text(),'fixture-footage');
assert.equal((await api('/api/reviews/'+id,{method:'DELETE',headers:{...headers,origin:'https://other.test'}},{BUCKET})).status,403);
assert.equal((await api('/api/reviews/'+id,{method:'DELETE',headers:{...headers,origin:host}},{BUCKET})).status,204);
assert.equal(files.size,0);
assert.equal((await api('/match.js')).status,200);
class SeekableVideo extends EventTarget {
  duration=5;readyState=2;seeking=false;position=0;
  get currentTime(){return this.position;}
  set currentTime(value){this.position=value;queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}
}
const decoder=new SeekableVideo();
await seekFrame(decoder,1.25,new AbortController().signal);
assert.equal(decoder.currentTime,1.25);
const cancelled=new AbortController();
const pendingFrame=seekFrame(decoder,2,cancelled.signal);
cancelled.abort();
await assert.rejects(pendingFrame,{name:'AbortError'});

console.log('Passed tracking, training, pitch and zone analysis, pass/shot suggestions, kit variants, occlusion recovery, track corrections, body contours, playback cues, reconnect segments, saved pose recovery, skill suggestions, team tactics, narration timing, review grants, feedback, and revocation.');
