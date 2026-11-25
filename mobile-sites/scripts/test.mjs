import assert from 'node:assert/strict';
import {PlayerLock, coachReview, seekFrame} from '../web/pose.js';
import {calibratePitch, eventTotals, suggestBallEvents, tacticalZones} from '../web/match.js';
import {outcomeRate, planFor} from '../web/training.js';
import worker from '../dist/server/index.js';
import {activeCoachingCue,drawBodyOutline,maskContours} from '../web/highlight.js';
import {assignTrackIds,classifyKit,correctTeam,detectionTiles,kitHistogram,teamShape,teamTimeline} from '../web/team.js';

function kit(bin,x) {
  const bins=new Float32Array(64);
  bins[bin]=1;
  return {sig:{bins,hip:{x,y:.5},shape:.6}};
}
const lock=new PlayerLock(kit(1,.2).sig);
assert.equal(lock.match([kit(1,.24)]).state,'tracked');
assert.equal(lock.match([kit(22,.24)]).state,'lost');
assert.equal(lock.match([kit(1,.8),kit(1,.78)]).state,'lost');
assert.deepEqual([.8,.81,.82].map(x=>lock.match([kit(1,x),kit(22,.24)]).state),
  ['checking','checking','reacquired']);

const points=Array.from({length:33},()=>({x:.55,y:.3,z:0,visibility:1}));
points[23]={x:.4,y:.5,z:0,visibility:1};
points[24]=points[23];
const frames=Array.from({length:16},(_,i)=>({time:i/8,points,world:null}));
assert.equal(planFor('running',coachReview(frames,1.8).findings).items[0].key,'trunk');
assert.equal(coachReview(frames.slice(0,6),1.8).findings.length,0);
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
assert.equal((await api('/analysis-assets/v1/not-listed')).status,404);
assert.equal((await api('/analysis-assets/v1/pose.task',{method:'POST'})).status,404);
const originalFetch=globalThis.fetch;
try {
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task');
    assert.equal(options.headers,undefined);
    return new Response(new Uint8Array([4,3,2,1]));
  };
  const asset=await api('/analysis-assets/v1/pose.task',{headers:{'oai-authenticated-user-id':'test'}});
  assert.equal(asset.status,200);
  assert.equal(asset.headers.get('content-type'),'application/octet-stream');
  assert.deepEqual([...new Uint8Array(await asset.arrayBuffer())],[4,3,2,1]);
} finally {globalThis.fetch=originalFetch;}
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

console.log('Passed tracking, training, pitch and zone analysis, pass/shot suggestions, kit variants, occlusion recovery, track corrections, body contours, playback cues, review grants, feedback, and revocation.');
