import {changedScene,sceneSample} from './scene.js';
import {maskContours,poseContours} from './highlight.js';
import {appleMobile,closeModel,objectModel,PlayerSelectionError,PoseEngineError,withPoseFallback} from './pose-engine.js';
import {gapCandidate,kitDistance,mergePlayers,PlayerLock,playerCrop,playerSignature,reentryCrop,tappedPlayer,uncropPoint} from './player-selection.js';
export {PlayerLock} from './player-selection.js';
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
  [23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
let peoplePromise;
const visible = point => point && (point.visibility ?? 1) >= .55;
export const playerDetector=()=>peoplePromise ||= objectModel('people')
  .catch(error=>{peoplePromise=null;throw error;});

function average(a,b) { return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }
function mediaEvent(video,{success,signal,timeout=4500,message,action}) {
  return new Promise((resolve,reject)=>{
    signal.throwIfAborted();
    let timer;
    const finish=error=>{
      clearTimeout(timer);
      video.removeEventListener(success,done);
      video.removeEventListener('error',bad);
      signal.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve();
    };
    const done=()=>finish(),bad=()=>finish(new Error(message)),cancel=()=>finish(signal.reason);
    video.addEventListener(success,done,{once:true});
    video.addEventListener('error',bad,{once:true});
    signal.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(bad,timeout);
    try {action?.();} catch(error) {finish(error);}
  });
}

function metadata(video,url,signal) {
  return mediaEvent(video,{success:'loadedmetadata',signal,timeout:8000,
    message:'Could not open the video. Try an H.264 MP4 clip.',action:()=>{video.src=url;}});
}
export async function seekFrame(video,time,signal) {
  signal.throwIfAborted();
  const target=Math.min(Math.max(0,time),video.duration-.001);
  if(Math.abs(video.currentTime-target)>=.002||video.seeking)
    await mediaEvent(video,{success:'seeked',signal,
      message:'The video stopped seeking. Try a shorter H.264 MP4 clip.',
      action:()=>{video.currentTime=target;}});
  if(video.readyState<2)
    await mediaEvent(video,{success:'loadeddata',signal,
      message:'The video frame could not be decoded. Play the clip once, then pause and retry.'});
}

export async function openDecoder(url,signal) {
  const video=document.createElement('video');
  video.muted=true; video.playsInline=true; video.preload='auto';
  try { await metadata(video,url,signal); return video; }
  catch(error) { video.removeAttribute('src');video.load();throw error; }
}
export function closeDecoder(video) { video.pause();video.removeAttribute('src');video.load(); }

export async function analyze({url,sourceVideo,anchor,start=anchor.time,end,lookForBall,signal,progress,onRetry,compact=false,memory=null,engine=null}) {
  signal.throwIfAborted();
  const video=sourceVideo||await openDecoder(url,signal);
  try {
    const scan=detector=>scanPose(video,detector,{anchor,start,end,lookForBall,signal,progress,compact,memory});
    return engine?await scan(engine):await withPoseFallback(scan,{signal,compatible:compact||appleMobile(),onRetry});
  } finally {
    if(!sourceVideo)closeDecoder(video);
  }
}

async function scanPose(video,detector,{anchor,start,end,lookForBall,signal,progress,compact=false,memory=null}) {
  let ball=null,ballUnavailable=lookForBall&&!detector.ballSupported,ballAttempted=ballUnavailable;
  const image=document.createElement('canvas');
  const scale=Math.min(1,(compact?480:640)/Math.max(video.videoWidth,video.videoHeight));
  image.width=Math.max(1,Math.round(video.videoWidth*scale));
  image.height=Math.max(1,Math.round(video.videoHeight*scale));
  const ctx=image.getContext('2d',{willReadFrequently:true});
  const zoomed=document.createElement('canvas');
  zoomed.width=zoomed.height=compact?352:480;
  const zoomContext=zoomed.getContext('2d');
  const scene=document.createElement('canvas');
  scene.width=16;scene.height=9;
  const sceneContext=scene.getContext('2d',{willReadFrequently:true});
  const trace=document.createElement('canvas');
  const traceScale=112/Math.max(image.width,image.height);
  trace.width=Math.max(2,Math.round(image.width*traceScale));
  trace.height=Math.max(2,Math.round(image.height*traceScale));
  const traceContext=trace.getContext('2d',{willReadFrequently:true});
  const frames=[], cues=[], ballSamples=[];
  const begin=Math.max(0,start,anchor.time-165);
  const stop=Math.min(end-.0001,video.duration-.001,begin+180);
  const forward=[],backward=[];
  for(let time=anchor.time;time<=stop+.0001;time+=.125)forward.push(time);
  for(let time=anchor.time-.125;time>=begin-.0001;time-=.125)backward.push(Math.max(0,time));
  const times=[...forward,...backward];
  let lock,origin=memory?.seed,last,fast=0,nearby=0,lastBall=-10,lastFast=-10;
  if(memory) {
    lock=new PlayerLock(memory.seed,memory.references);
    lock.last=memory.last;
    lock.missing=memory.missing;
    if(memory.acrossCut)lock.markDiscontinuity();
  }
  let previousScene=memory?.scene,anchorScene;
  let poseOutline=false,tile=0;
  let forwardMemory=null;
  const trackMemory=()=>lock?{seed:origin,references:lock.references,last:lock.last,missing:lock.missing,
    acrossCut:lock.acrossCut,scene:previousScene}:null;
  const signatures=new Map();
  const read=async ({crop=null,preferred})=>{
    let people=[];
    if(crop)zoomContext.drawImage(video,crop.x,crop.y,crop.side,crop.side,0,0,zoomed.width,zoomed.height);
    const onResult=result=>{
      people=result.landmarks.flatMap((raw,index)=>{
        const points=crop?raw.map(point=>uncropPoint(point,crop)):raw;
        const sig=playerSignature(points,ctx);
        return sig?[{points,world:result.worldLandmarks[index],index,sig}]:[];
      });
      const candidate=preferred(people),mask=candidate&&result.segmentationMasks?.[candidate.index];
      if(!mask)return;
      try {
        const values=mask.hasUint8Array()?mask.getAsUint8Array():mask.getAsFloat32Array();
        const loops=maskContours(values,mask.width,mask.height);
        candidate.outline=crop?loops.map(loop=>loop.map(([x,y])=>{
          const point=uncropPoint({x,y},crop);return [point.x,point.y];
        })):loops;
      } catch { /* The visible joints can still be used to draw an outline. */ }
    };
    try {await detector.read(crop?zoomed:image,onResult);}
    catch {throw new PoseEngineError('The pose model stopped while reading a frame.');}
    signal.throwIfAborted();
    return people;
  };
  try {
    for(const [i,time] of times.entries()) {
      const reverse=i>=forward.length;
      if(reverse&&i===forward.length) {
        if(!origin)break;
        forwardMemory=trackMemory();
        if(!memory) {
          lock=new PlayerLock(origin,lock.references);
          previousScene=anchorScene;
        }
        last=null;
      }
      signal.throwIfAborted();
      await seekFrame(video,time,signal);ctx.drawImage(video,0,0,image.width,image.height);
      const sceneNow=sceneSample(image,sceneContext);
      if(i===0)anchorScene=sceneNow;
      const cut=changedScene(previousScene,sceneNow);
      previousScene=sceneNow;
      if(cut&&lock) {
        lock.markDiscontinuity();
        last=null;fast=nearby=0;
      }
      let chosen,state='lost';
      const tapCandidates=people=>tappedPlayer(people,anchor,image.width,image.height,i===0?.014:.021);
      const preferred=people=>lock?lock.rank(people)[0]?.person:tapCandidates(people);
      let people=await read({preferred});
      if(!lock&&!tapCandidates(people)) {
        for(const zoom of [.64,.34,.18]) {
          const crop=playerCrop(anchor,zoom,video.videoWidth,video.videoHeight);
          people=mergePlayers(people,await read({crop,preferred}));
          if(tapCandidates(people))break;
        }
      } else if(lock) {
        const [best,second]=lock.rank(people);
        const near=Math.max(.018,Math.min(.11,lock.last.torso*2));
        const needsZoom=!best||best.colour>.32||best.spatial>near||(second&&second.score-best.score<.08);
        if(needsZoom&&(lock.missing<5||lock.pending||i%4===0)) {
          const target=lock.pending?.center||lock.predicted();
          const side=Math.min(video.videoWidth,video.videoHeight);
          const zoom=Math.min(.82,Math.max(.18,lock.last.torso*image.height/Math.min(image.width,image.height)*5));
          if(side>=160) {
            const crop=playerCrop(target,zoom,video.videoWidth,video.videoHeight);
            people=mergePlayers(people,await read({crop,preferred}));
          }
        }
      }
      if(lock&&lock.missing>=5&&!lock.pending&&i%4===0) {
        people=mergePlayers(people,await read({
          crop:reentryCrop(tile++,video.videoWidth,video.videoHeight),preferred,
        }));
      }
      if(lock)({person:chosen,state}=lock.match(people));
      else {
        chosen=tapCandidates(people);
        if(chosen) {
          origin=chosen.sig;
          lock=new PlayerLock(origin);
          state='tracked';
        }
      }
      let outline=chosen?.outline||[];
      if(chosen&&!outline.length&&traceContext) {
        outline=poseContours(chosen.points,traceContext);
        poseOutline ||= outline.length>0;
      }
      if(!lock&&i>=4)throw new PlayerSelectionError();
      if(!chosen) {
        fast=nearby=0;
        frames.push({time,points:null,world:null,state,cut});
      } else {
        frames.push({time,points:chosen.points,world:chosen.world,outline,state,cut});
        signatures.set(time,chosen.sig);
        if(!reverse && last && state==='tracked') {
          const s=chosen.sig, motion=Math.hypot(s.hip.x-last.hip.x,s.hip.y-last.hip.y)/s.torso;
          fast=motion>.21 ? fast+1 : 0;
          if(fast===3 && time-lastFast>2) {
            lastFast=time;
            cues.push({time,title:'Movement burst candidate',category:'Acceleration',
              feedback:'The selected player moved quickly in the image. Verify against camera panning before treating this as acceleration.'});
          }
        }
        last=chosen.sig;
      }
      if(!reverse&&lookForBall&&!ballAttempted&&chosen) {
        ballAttempted=true;
        try {ball=await objectModel('ball',signal);}
        catch {signal.throwIfAborted();ballUnavailable=true;}
      }
      let detections;
      if(ball&&lock&&i%2===0) {
        try {detections=ball.detect(image).detections;}
        catch {closeModel(ball);ball=null;ballUnavailable=true;}
      }
      if(detections) {
        const balls=detections.map(d=>({
          center:[(d.boundingBox.originX+d.boundingBox.width/2)/image.width,
            (d.boundingBox.originY+d.boundingBox.height/2)/image.height],
          score:d.categories[0]?.score||0,
        })).sort((a,b)=>b.score-a.score);
        const center=balls.length && (balls.length===1||balls[0].score-balls[1].score>.18)
          ? balls[0].center : null;
        const distance=person=>Math.min(...[person.points[27],person.points[28]].filter(visible)
          .map(point=>Math.hypot(center[0]-point.x,center[1]-point.y)));
        const nearYou=!!(chosen&&center&&distance(chosen)<chosen.sig.torso*.63);
        const receivers=center&&!nearYou?people.filter(person=>person!==chosen)
          .map(person=>({person,range:distance(person)/person.sig.torso}))
          .filter(item=>item.range<.6).sort((a,b)=>a.range-b.range):[];
        let receiver=null;
        if(receivers.length===1 || (receivers.length>1 && receivers[1].range-receivers[0].range>.25)) {
          const person=receivers[0].person;
          const kit=kitDistance(lock.seed,person.sig);
          receiver={...person.sig.hip,team:kit<.28?'similar':'unknown',
            clear:kit<.18&&receivers[0].range<.48&&state!=='checking'};
        }
        ballSamples.push({time,ball:center,nearYou,receiver,score:center?balls[0].score:0,cut});
        nearby=nearYou?nearby+1:0;
        if(!reverse&&nearby===2&&time-lastBall>2) {
          lastBall=time;
          cues.push({time,title:'Ball proximity candidate',category:'Other',
            feedback:'The detected ball stayed near a visible ankle. Review the clip to confirm the touch.'});
        }
      }
      if(i%4===0) {progress(.90*(i+1)/times.length);await new Promise(r=>setTimeout(r,0));}
    }
    if(ball){closeModel(ball);ball=null;}
    if(!origin)throw new PlayerSelectionError();
    const sorted=frames.sort((a,b)=>a.time-b.time);
    let retried=0,refined=0;
    for(let i=1;i<sorted.length-1&&retried<24;i++) {
      if(sorted[i].points||!sorted[i-1].points)continue;
      const left=sorted[i-1];
      const stop=Math.min(sorted.length-1,i+3);
      let j=i;
      while(j<=stop&&!sorted[j].points)j++;
      if(j>stop)continue;
      const right=sorted[j],before=signatures.get(left.time),after=signatures.get(right.time);
      if(!before||!after||right.time-left.time>.51||sorted.slice(i-1,j+1).some(sample=>sample.cut))continue;
      for(let k=i;k<j&&retried<24;k++) {
        signal.throwIfAborted();
        retried++;
        const sample=sorted[k],mix=(sample.time-left.time)/(right.time-left.time);
        const center={x:before.center.x+(after.center.x-before.center.x)*mix,
          y:before.center.y+(after.center.y-before.center.y)*mix};
        await seekFrame(video,sample.time,signal);ctx.drawImage(video,0,0,image.width,image.height);
        const zoom=Math.min(.76,Math.max(.18,Math.max(before.torso,after.torso)*4));
        const crop=playerCrop(center,zoom,video.videoWidth,video.videoHeight);
        const preferred=people=>gapCandidate(people,before,after,mix);
        const candidates=await read({crop,preferred});
        const candidate=preferred(candidates);
        if(candidate) {
          const outline=candidate.outline?.length?candidate.outline:traceContext?poseContours(candidate.points,traceContext):[];
          poseOutline ||= !candidate.outline?.length&&outline.length>0;
          Object.assign(sample,{points:candidate.points,world:candidate.world,outline,state:'tracked'});
          refined++;
        }
        if(retried%4===0) {
          progress(.90+retried/240);
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      i=j-1;
    }
    for(let i=0;i<sorted.length;i++) {
      const sample=sorted[i];
      if(!sample.points)continue;
      sample.state=i>0&&!sorted[i-1].points&&sorted[i-1].time<sample.time-.05?'reacquired':'tracked';
    }
    progress(1);
    return {frames:sorted,cues,ballSamples:ballSamples.sort((a,b)=>a.time-b.time),ballUnavailable,poseOutline,refined,
      forwardMemory:forwardMemory||trackMemory(),backwardMemory:backward.length?trackMemory():null};
  } finally {
    if(ball)closeModel(ball);
    for(const canvas of [image,zoomed,trace,scene]) {canvas.width=1;canvas.height=1;}
  }
}

function angle(a,b,c) {
  if(![a,b,c].every(visible)) return null;
  const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[c.x-b.x,c.y-b.y,c.z-b.z];
  const norm=Math.hypot(...u)*Math.hypot(...v);
  if(norm<1e-9) return null;
  return Math.round(Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,i)=>sum+x*v[i],0)/norm)))*180/Math.PI);
}
function jointAngle(sample,indices,aspect,projected) {
  if(projected) {
    const points=indices.map(i=>sample.points?.[i]);
    if(!points.every(visible))return null;
    return angle(...points.map(p=>({...p,x:p.x*aspect,z:0})));
  }
  return angle(...indices.map(i=>sample.world?.[i]));
}

export function metrics(sample,aspect) {
  if(!sample?.points&&!sample?.world)return [];
  const projected=!sample.world;
  if(projected&&!aspect)return [];
  const types=[['Left knee',[23,25,27]],['Right knee',[24,26,28]],
    ['Left elbow',[11,13,15]],['Right elbow',[12,14,16]]];
  return types.map(([name,indices])=>[projected?name+' (2D)':name,jointAngle(sample,indices,aspect,projected)])
    .filter(([,value])=>value!==null);
}

export function skeleton(ctx,rect,points) {
  if(!points) return;
  ctx.save();ctx.strokeStyle='#affb9e';ctx.fillStyle='#e7ffdc';ctx.lineWidth=Math.max(2,rect.w/240);
  for(const [a,b] of BONES) {
    if(!visible(points[a])||!visible(points[b])) continue;
    ctx.beginPath();ctx.moveTo(rect.x+points[a].x*rect.w,rect.y+points[a].y*rect.h);
    ctx.lineTo(rect.x+points[b].x*rect.w,rect.y+points[b].y*rect.h);ctx.stroke();
  }
  for(const i of [11,12,13,14,15,16,23,24,25,26,27,28,29,30,31,32]) {
    if(!visible(points[i])) continue;
    ctx.beginPath();ctx.arc(rect.x+points[i].x*rect.w,rect.y+points[i].y*rect.h,ctx.lineWidth,0,2*Math.PI);ctx.fill();
  }
  ctx.restore();
}
export function render3d(canvas,sample,angleDegrees) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#396158';ctx.lineWidth=1;
  for(let i=-4;i<=4;i++) {ctx.beginPath();ctx.moveTo(w/2+i*28,h*.66);ctx.lineTo(w/2+i*66,h*.97);ctx.stroke();}
  for(let i=0;i<5;i++) {ctx.beginPath();ctx.moveTo(w*.11,h*(.66+i*.075));ctx.lineTo(w*.89,h*(.66+i*.075));ctx.stroke();}
  if(!sample?.world) {
    ctx.fillStyle='#c0d4cc';ctx.font='17px system-ui';ctx.textAlign='center';
    ctx.fillText(sample?.points?'2D pose available':'No pose at this moment',w/2,h*.47);
    return;
  }
  const rad=angleDegrees*Math.PI/180;
  const projected=sample.world.map(p=>{
    const x=p.x*Math.cos(rad)-p.z*Math.sin(rad),z=p.x*Math.sin(rad)+p.z*Math.cos(rad);
    const scale=169/(1+Math.max(-.45,Math.min(.45,z))*.35);
    return {x:w/2+x*scale,y:h*.51+(p.y-z*.12)*scale,z};
  });
  for(const [a,b] of [...BONES].sort(([a,b],[c,d])=>(projected[c].z+projected[d].z)-(projected[a].z+projected[b].z))) {
    if(!visible(sample.world[a])||!visible(sample.world[b])) continue;
    const p=projected[a],q=projected[b];
    ctx.lineWidth=5;ctx.lineCap='round';ctx.strokeStyle=p.z+q.z>.15?'#6ba595':'#b1f58b';
    ctx.shadowColor='#7dffb470';ctx.shadowBlur=12;
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke();
    ctx.shadowBlur=0;ctx.fillStyle='#edffd7';ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fill();
  }
}

export function coachReview(frames, aspect) {
  const windows=[];
  let run=[];
  const flush=()=>{if(run.length>=4)windows.push(run);run=[];};
  for(const sample of frames) {
    if(!sample.points) {flush();continue;}
    if(run.length&&sample.time-run.at(-1).time>.2)flush();
    run.push(sample);
    if(run.length===16) flush();
  }
  flush();
  const matched=frames.filter(sample=>sample.points).length;
  const findings=[],moments=[];
  const best={};
  const record=(key,score,span,observation,cue)=>{
    const item={focus:key,score,start:span[0].time,end:span.at(-1).time+.125,observation,cue};
    moments.push(item);
    if(!best[key]||best[key].score<score)best[key]=item;
  };
  const median=items=>[...items].sort((a,b)=>a-b)[Math.floor(items.length/2)];
  for(const span of windows) {
    const trunks=[], knees=[], elbows=[];
    const projected=span.every(sample=>!sample.world);
    for(const sample of span) {
      const {points}=sample;
      if([11,12,23,24].every(i=>visible(points[i]))) {
        const shoulders=average(points[11],points[12]), hips=average(points[23],points[24]);
        const dx=(shoulders.x-hips.x)*aspect, dy=shoulders.y-hips.y;
        if(Math.hypot(dx,dy)>.035) trunks.push(Math.atan2(Math.abs(dx),Math.abs(dy))*180/Math.PI);
      }
      for(const [output,left,right] of [
        [knees,[23,25,27],[24,26,28]],[elbows,[11,13,15],[12,14,16]],
      ]) {
        const a=jointAngle(sample,left,aspect,projected),b=jointAngle(sample,right,aspect,projected);
        if(a!==null&&b!==null) output.push([a,b]);
      }
    }
    if(trunks.length>=8 && median(trunks)>=27) {
      const lean=Math.round(median(trunks));
      record('trunk',lean,span,
        `Your trunk was tilted about ${lean}° from vertical in this camera view.`,
        'If this was upright running, repeat at the same pace and try staying tall through the hips. A forward lean can be expected during acceleration.');
    }
    for(const [name,pairs,cue] of [
      ['knee',knees,'Compare several strides from each side at the same speed. Check whether the difference repeats before changing your stride.'],
      ['elbow',elbows,'Try relaxed shoulders and an easy backward arm drive. Film another pass at the same speed to compare.'],
    ]) {
      if(pairs.length<12) continue;
      const spread=i=>Math.max(...pairs.map(pair=>pair[i]))-Math.min(...pairs.map(pair=>pair[i]));
      const delta=spread(0)-spread(1);
      if(Math.abs(delta)<26) continue;
      record(name,Math.abs(delta),span,
        `Your estimated ${name} angle moved through a wider range on the ${delta>0?'left':'right'} in this segment${projected?' of the camera view':''}.`,cue);
    }
  }
  for(const key of ['trunk','knee','elbow']) if(best[key]) findings.push(best[key]);
  return {matched,total:frames.length,usableWindows:windows.length,findings,moments};
}

export function attemptReview(frames, time, mode, side, aspect) {
  const all=frames.filter(item=>item.time>=time-.5&&item.time<=time+.5);
  const matched=all.filter(item=>item.points);
  const out={matched:matched.length,total:all.length,usableWindows:0,findings:[]};
  if(matched.length<5) return out;
  const nearest=sampleTime=>matched.reduce((best,item)=>Math.abs(item.time-sampleTime)<Math.abs(best.time-sampleTime)?item:best);
  const contact=nearest(time), before=nearest(time-.30), after=nearest(time+.30);
  if(Math.abs(contact.time-time)>.14 || before.time>time-.12 || after.time<time+.12) return out;
  out.usableWindows=1;
  const add=(observation,cue)=>out.findings.push({focus:mode,start:Math.max(0,time-.35),end:time+.4,observation,cue});
  const [foot,plant,hip,knee]=side==='left'?[27,28,23,25]:[28,27,24,26];
  if(['kick','pass','cross'].includes(mode)) {
    const projected=contact.points;
    if([11,12,23,24,foot,plant].every(i=>visible(projected[i]))) {
      const shoulders=average(projected[11],projected[12]),hips=average(projected[23],projected[24]);
      const torso=Math.hypot((shoulders.x-hips.x)*aspect,shoulders.y-hips.y);
      const separation=Math.hypot((projected[foot].x-projected[plant].x)*aspect,projected[foot].y-projected[plant].y);
      if(torso>.035) add(`At the marked contact, your ankles were about ${(separation/torso).toFixed(1)} torso lengths apart in the image.`,
        'Replay the approach and plant step. Check that the support foot lands in a repeatable spot relative to the ball.');
    }
    const flat=![before,contact,after].every(sample=>sample.world);
    const [first,hit,follow]=[before,contact,after].map(sample=>jointAngle(sample,[hip,knee,foot],aspect,flat));
    if([first,hit,follow].every(Number.isFinite)) add(
      `Your estimated ${side} knee angle was ${first}° on approach, ${hit}° at marked contact, and ${follow}° in follow-through${flat?' in the camera view':''}.`,
      mode==='pass'?'Compare your plant step and whether your follow-through points toward the target.':
        mode==='cross'?'Use the same approach and compare your plant step before sending the ball into a marked target zone.':
        'Compare two kicks from the same camera angle. Check whether your swing continues through the ball and you land in balance.');
  } else if(mode==='landing') {
    const flat=!(contact.world&&after.world);
    const kneeAngles=sample=>[[23,25,27],[24,26,28]].map(indices=>jointAngle(sample,indices,aspect,flat));
    const a=kneeAngles(contact),b=kneeAngles(after);
    if(a&&b&&[...a,...b].every(Number.isFinite))
      add(`Estimated knee angles at landing were ${a[0]}° left and ${a[1]}° right, changing to ${b[0]}° and ${b[1]}° after landing${flat?' in the camera view':''}.`,
        'Replay the following steps and check whether you can hold the finish comfortably on repeated low jumps.');
  } else {
    const center=item=>{
      const p=item.points;
      return [23,24].every(i=>visible(p[i]))?average(p[23],p[24]):null;
    };
    const a=center(before), b=center(contact), c=center(after);
    if(a&&b&&c) {
      const u=[(b.x-a.x)*aspect,b.y-a.y],v=[(c.x-b.x)*aspect,c.y-b.y];
      const beforeMotion=Math.hypot(...u),afterMotion=Math.hypot(...v);
      if(mode==='dribble'&&Math.min(beforeMotion,afterMotion)>.012) {
        const change=Math.round(Math.atan2(Math.abs(u[0]*v[1]-u[1]*v[0]),u[0]*v[0]+u[1]*v[1])*180/Math.PI);
        add(`Your hips changed direction by about ${change}° in the picture around the marked cut.`,
          'Replay the last step before the cut and check how close the ball stays on the first step out.');
      } else if(mode==='touch') {
        const p=contact.points;
        if([11,12,23,24,27,28].every(i=>visible(p[i]))) {
          const top=average(p[11],p[12]),torso=Math.hypot((top.x-b.x)*aspect,top.y-b.y);
          if(torso>.035) {
            const gap=Math.hypot((p[27].x-p[28].x)*aspect,p[27].y-p[28].y)/torso;
            add(`At your marked first touch, your ankles were ${gap.toFixed(1)} torso lengths apart in the picture.`,
              'Replay the ball after contact and check whether the touch leaves you set up for your next action.');
          }
        }
      } else if(['acceleration','braking','defending'].includes(mode)) {
        const pre=beforeMotion/(contact.time-before.time),post=afterMotion/(after.time-contact.time);
        if(Math.max(pre,post)>.025) {
          const movement=Math.abs(post-pre)<Math.max(pre,post)*.2?'similar':post>pre?'greater':'smaller';
          add(`Your hip movement per second in the picture was ${movement} after the marked step.`,
            'Use a fixed camera and replay the steps around the marker. Confirm the change against the field markings before treating this as a change in speed.');
        }
      }
    }
  }
  return out;
}

export function drawMovementMap(canvas, frames) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#0b1714';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#34574a';ctx.lineWidth=1;
  for(let x=0;x<w;x+=w/8){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=0;y<h;y+=h/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const points=frames.flatMap(({points})=>points&&[23,24].every(i=>visible(points[i]))?[average(points[23],points[24])]:[]);
  if(!points.length) {
    ctx.fillStyle='#bad1c4';ctx.textAlign='center';ctx.font='19px system-ui';
    ctx.fillText('Track yourself to see your movement here',w/2,h/2);return;
  }
  const cells=new Map();
  for(const p of points) {
    const x=Math.max(0,Math.min(23,Math.floor(p.x*24))),y=Math.max(0,Math.min(13,Math.floor(p.y*14)));
    const key=y*24+x;cells.set(key,(cells.get(key)||0)+1);
  }
  const max=Math.max(...cells.values());
  ctx.globalCompositeOperation='screen';
  for(const [key,value] of cells) {
    const x=(key%24+.5)*w/24,y=(Math.floor(key/24)+.5)*h/14,r=23;
    const strength=Math.sqrt(value/max);
    const gradient=ctx.createRadialGradient(x,y,0,x,y,r);
    gradient.addColorStop(0,`rgba(${Math.round(105+150*strength)},${Math.round(250-95*strength)},95,${.24+.55*strength})`);
    gradient.addColorStop(1,'rgba(70,130,80,0)');
    ctx.fillStyle=gradient;ctx.fillRect(x-r,y-r,2*r,2*r);
  }
  ctx.globalCompositeOperation='source-over';
}
