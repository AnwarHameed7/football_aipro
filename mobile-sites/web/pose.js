import {maskContours} from './highlight.js';

const MODEL_ROUTE = '/analysis-assets/v1';
export const BONES = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],
  [23,25],[25,27],[27,29],[29,31],[24,26],[26,28],[28,30],[30,32]];
let runtime, posePromise, ballPromise, peoplePromise;
const visible = point => point && (point.visibility ?? 1) >= .55;

async function tasks() {
  try {
    const library=await import(`${MODEL_ROUTE}/vision_bundle.mjs`);
    const files=await library.FilesetResolver.forVisionTasks(`${MODEL_ROUTE}/wasm`);
    return {library,files};
  } catch {
    throw new Error('Could not load the analysis engine. Refresh the page in Safari and try again on a stable connection.');
  }
}
function model(kind) {
  runtime ||= tasks().catch(error => { runtime = null; throw error; });
  if (kind === 'pose') return posePromise ||= runtime.then(({library,files}) =>
    library.PoseLandmarker.createFromOptions(files,{
      baseOptions:{modelAssetPath:`${MODEL_ROUTE}/pose.task`},
      runningMode:'IMAGE',numPoses:4,outputSegmentationMasks:false,minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55
    })).catch(error => { posePromise=null; throw error; });
  if(kind==='people') return peoplePromise ||= runtime.then(({library,files}) =>
    library.ObjectDetector.createFromOptions(files,{
      baseOptions:{modelAssetPath:`${MODEL_ROUTE}/detector.tflite`},
      runningMode:'IMAGE',categoryAllowlist:['person'],scoreThreshold:.35,maxResults:35
    })).catch(error => {peoplePromise=null;throw error;});
  return ballPromise ||= runtime.then(({library,files}) =>
    library.ObjectDetector.createFromOptions(files,{
      baseOptions:{modelAssetPath:`${MODEL_ROUTE}/detector.tflite`},
      runningMode:'IMAGE',categoryAllowlist:['sports ball'],scoreThreshold:.45
    })).catch(error => { ballPromise=null; throw error; });
}

export const playerDetector=()=>model('people');

function average(a,b) { return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}; }
function signature(points, context) {
  const torsoPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??1)>=.30;
  const shoulders=[points[11],points[12]].filter(torsoPoint),hips=[points[23],points[24]].filter(torsoPoint);
  if(!shoulders.length||!hips.length||shoulders.length+hips.length<3)return null;
  const shoulder=shoulders.length===2?average(...shoulders):shoulders[0];
  const hip=hips.length===2?average(...hips):hips[0];
  const torso=Math.hypot(shoulder.x-hip.x,shoulder.y-hip.y);
  if (torso < .018) return null;
  const center=average(shoulder,hip);
  const width=context.canvas.width, height=context.canvas.height;
  const halfX=Math.max(3,Math.min(.12,Math.max(Math.abs(points[11].x-points[12].x)*.28,torso*.19))*width);
  const halfY=Math.max(3,Math.min(.13,Math.abs(shoulder.y-hip.y)*.30)*height);
  const x=Math.max(0,Math.floor(center.x*width-halfX)), y=Math.max(0,Math.floor(center.y*height-halfY));
  const w=Math.min(width-x,Math.ceil(halfX*2)), h=Math.min(height-y,Math.ceil(halfY*2));
  if (w<3 || h<3) return null;
  const data=context.getImageData(x,y,w,h).data, bins=new Float32Array(64);
  for(let i=0;i<data.length;i+=4) {
    const r=data[i],g=data[i+1],b=data[i+2];
    const light=Math.max(55,r,g,b);
    const bin=(Math.min(3,Math.floor(4*r/(light+1)))<<4) |
      (Math.min(3,Math.floor(4*g/(light+1)))<<2) | Math.min(3,Math.floor(4*b/(light+1)));
    bins[bin]+=1/(data.length/4);
  }
  return {bins,hip,center,torso,shape:shoulders.length===2?Math.abs(shoulders[0].x-shoulders[1].x)/torso:0};
}
function kitDistance(a,b) {
  let shared=0;
  for(let i=0;i<a.bins.length;i++) shared+=Math.sqrt(a.bins[i]*b.bins[i]);
  return Math.sqrt(Math.max(0,1-shared)) + .07*Math.min(1,Math.abs(a.shape-b.shape));
}

export class PlayerLock {
  constructor(signature) {
    this.seed=signature;
    this.last=signature;
    this.missing=0;
    this.pending=null;
    this.streak=0;
  }

  match(people) {
    const distance=(a,b)=>Math.hypot(a.hip.x-b.hip.x,a.hip.y-b.hip.y);
    const scores=people.map(person=>{
      const colour=kitDistance(this.seed,person.sig);
      const spatial=distance(this.last,person.sig);
      return {person,colour,spatial,score:colour+(this.missing ? 0 : Math.min(.30,spatial*1.2))};
    }).sort((a,b)=>a.score-b.score);
    const [best,second]=scores;
    let person=null,state='lost';
    if (best && best.colour<(this.missing ? .36 : .50) &&
        (!second || second.score-best.score>(this.missing ? .10 : .05))) {
      if(!this.missing && best.spatial<.16) {
        person=best.person;
        state='tracked';
      } else {
        const sameCandidate=this.pending && kitDistance(this.pending,best.person.sig)<.20 &&
          distance(this.pending,best.person.sig)<.12;
        this.streak=sameCandidate ? this.streak+1 : 1;
        this.pending=best.person.sig;
        state='checking';
        if(this.streak>=3) {
          person=best.person;
          state='reacquired';
        }
      }
    } else {
      this.pending=null;
      this.streak=0;
    }
    if(person) {
      this.last=person.sig;
      this.missing=0;
      this.pending=null;
      this.streak=0;
    } else this.missing++;
    return {person,state};
  }
}

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

function waitForModel(promise,signal) {
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=(error,result)=>{
      clearTimeout(timer);signal.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(result);
    };
    const cancel=()=>finish(signal.reason);
    signal.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>finish(new Error('The pose model did not load. Check your connection and tap Track me again.')),45000);
    promise.then(result=>finish(null,result),finish);
  });
}
export async function openDecoder(url,signal) {
  const video=document.createElement('video');
  video.muted=true; video.playsInline=true; video.preload='auto';
  try { await metadata(video,url,signal); return video; }
  catch(error) { video.removeAttribute('src');video.load();throw error; }
}
export function closeDecoder(video) { video.pause();video.removeAttribute('src');video.load(); }

export async function analyze({url,sourceVideo,anchor,end,lookForBall,signal,progress}) {
  signal.throwIfAborted();
  const detector=await waitForModel(model('pose'),signal);
  signal.throwIfAborted();
  let ball=null, ballUnavailable=false;
  if(lookForBall) {
    try { ball=await waitForModel(model('ball'),signal); } catch { signal.throwIfAborted();ballUnavailable=true; }
  }
  const video=sourceVideo||await openDecoder(url,signal);
  const image=document.createElement('canvas');
  const scale=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
  image.width=Math.max(1,Math.round(video.videoWidth*scale));
  image.height=Math.max(1,Math.round(video.videoHeight*scale));
  const ctx=image.getContext('2d',{willReadFrequently:true});
  const frames=[], cues=[], ballSamples=[];
  const stop=Math.min(end,video.duration-.001,anchor.time+180);
  let lock, last, fast=0, nearby=0,lastBall=-10,lastFast=-10,maskEnabled=true;
  try {
    try {await waitForModel(detector.setOptions({outputSegmentationMasks:true}),signal);}
    catch {signal.throwIfAborted();maskEnabled=false;await waitForModel(detector.setOptions({outputSegmentationMasks:false}),signal);}
    for(let i=0, time=anchor.time;time<=stop+.0001;i++,time=anchor.time+i/8) {
      signal.throwIfAborted();
      await seekFrame(video,time,signal);ctx.drawImage(video,0,0,image.width,image.height);
      let chosen,state,people=[],outline=[];
      const onResult=result=>{
        people=result.landmarks.map((points,index)=>({points,world:result.worldLandmarks[index],index,sig:signature(points,ctx)}))
          .filter(person=>person.sig);
        if(!lock) {
          const sorted=people.map(person=>{
            const valid=person.points.filter(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&(p.visibility??1)>=.30);
            const xs=valid.map(p=>p.x), ys=valid.map(p=>p.y);
            const margin=i===0?.045:.07;
            const contains=anchor.x>=Math.min(...xs)-margin && anchor.x<=Math.max(...xs)+margin &&
              anchor.y>=Math.min(...ys)-margin && anchor.y<=Math.max(...ys)+margin;
            return {person,contains,distance:Math.hypot(person.sig.center.x-anchor.x,person.sig.center.y-anchor.y)};
          }).filter(item=>item.contains).sort((a,b)=>a.distance-b.distance);
          if(!sorted.length || (sorted.length>1 && sorted[1].distance-sorted[0].distance<.035))
            return;
          chosen=sorted[0].person;
          lock=new PlayerLock(chosen.sig);
          state='tracked';
        } else {
          ({person:chosen,state}=lock.match(people));
        }
        const mask=chosen&&result.segmentationMasks?.[chosen.index];
        if(mask) {
          try {
            const values=mask.hasUint8Array()?mask.getAsUint8Array():mask.getAsFloat32Array();
            outline=maskContours(values,mask.width,mask.height);
          } catch {
            // Leave the pose visible if the device cannot read the mask.
          }
        }
      };
      try {
        detector.detect(image,onResult);
      } catch(error) {
        if(!maskEnabled)throw error;
        await waitForModel(detector.setOptions({outputSegmentationMasks:false}),signal);
        maskEnabled=false;
        detector.detect(image,onResult);
      }
      if(!lock&&i>=6)throw new Error('No clear person matched your tap. Pause where you are closer and fully visible, then tap your chest again.');
      if(!chosen) {
        fast=nearby=0;
        frames.push({time,points:null,world:null,state});
      } else {
        frames.push({time,points:chosen.points,world:chosen.world,outline,state});
        if(last && state==='tracked') {
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
      if(ball && lock && i%2===0) {
        const balls=ball.detect(image).detections.map(d=>({
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
          receiver={...person.sig.hip,team:kitDistance(lock.seed,person.sig)<.28?'similar':'unknown'};
        }
        ballSamples.push({time,ball:center,nearYou,receiver});
        nearby=nearYou?nearby+1:0;
        if(nearby===2&&time-lastBall>2) {
          lastBall=time;
          cues.push({time,title:'Ball proximity candidate',category:'Other',
            feedback:'The detected ball stayed near a visible ankle. Review the clip to confirm the touch.'});
        }
      }
      if(i%4===0) {progress((time-anchor.time)/Math.max(.125,stop-anchor.time));await new Promise(r=>setTimeout(r,0));}
    }
  } finally { if(!sourceVideo)closeDecoder(video); }
  if(!lock)throw new Error('No clear player was detected. Try a brighter, closer shot with your shoulders and hips visible.');
  return {frames,cues,ballSamples,ballUnavailable};
}

function angle(a,b,c) {
  if(![a,b,c].every(visible)) return null;
  const u=[a.x-b.x,a.y-b.y,a.z-b.z],v=[c.x-b.x,c.y-b.y,c.z-b.z];
  const norm=Math.hypot(...u)*Math.hypot(...v);
  if(norm<1e-9) return null;
  return Math.round(Math.acos(Math.max(-1,Math.min(1,u.reduce((sum,x,i)=>sum+x*v[i],0)/norm)))*180/Math.PI);
}
export function metrics(sample) {
  if(!sample?.world) return [];
  const w=sample.world;
  return [['Left knee',angle(w[23],w[25],w[27])],['Right knee',angle(w[24],w[26],w[28])],
    ['Left elbow',angle(w[11],w[13],w[15])],['Right elbow',angle(w[12],w[14],w[16])]]
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
    ctx.fillText('No pose at this moment',w/2,h*.47);
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
    run.push(sample);
    if(run.length===16) flush();
  }
  flush();
  const matched=frames.filter(sample=>sample.points).length;
  const findings=[];
  const best={};
  const record=(key,score,span,observation,cue)=>{
    if(best[key] && best[key].score>=score) return;
    best[key]={focus:key,score,start:span[0].time,end:span.at(-1).time+.125,observation,cue};
  };
  const median=items=>[...items].sort((a,b)=>a-b)[Math.floor(items.length/2)];
  for(const span of windows) {
    const trunks=[], knees=[], elbows=[];
    for(const {points,world} of span) {
      if([11,12,23,24].every(i=>visible(points[i]))) {
        const shoulders=average(points[11],points[12]), hips=average(points[23],points[24]);
        const dx=(shoulders.x-hips.x)*aspect, dy=shoulders.y-hips.y;
        if(Math.hypot(dx,dy)>.035) trunks.push(Math.atan2(Math.abs(dx),Math.abs(dy))*180/Math.PI);
      }
      if(!world) continue;
      for(const [output,left,right] of [
        [knees,[23,25,27],[24,26,28]],[elbows,[11,13,15],[12,14,16]],
      ]) {
        const a=angle(...left.map(i=>world[i])), b=angle(...right.map(i=>world[i]));
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
        `Your estimated ${name} angle moved through a wider range on the ${delta>0?'left':'right'} in this segment.`,cue);
    }
  }
  for(const key of ['trunk','knee','elbow']) if(best[key]) findings.push(best[key]);
  return {matched,total:frames.length,usableWindows:windows.length,findings};
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
    const first=before.world && angle(before.world[hip],before.world[knee],before.world[foot]);
    const hit=contact.world && angle(contact.world[hip],contact.world[knee],contact.world[foot]);
    const follow=after.world && angle(after.world[hip],after.world[knee],after.world[foot]);
    if([first,hit,follow].every(Number.isFinite)) add(
      `Your estimated ${side} knee angle was ${first}° on approach, ${hit}° at marked contact, and ${follow}° in follow-through.`,
      mode==='pass'?'Compare your plant step and whether your follow-through points toward the target.':
        mode==='cross'?'Use the same approach and compare your plant step before sending the ball into a marked target zone.':
        'Compare two kicks from the same camera angle. Check whether your swing continues through the ball and you land in balance.');
  } else if(mode==='landing') {
    const kneeAngles=sample=>sample.world&&[
      angle(sample.world[23],sample.world[25],sample.world[27]),
      angle(sample.world[24],sample.world[26],sample.world[28]),
    ];
    const a=kneeAngles(contact),b=kneeAngles(after);
    if(a&&b&&[...a,...b].every(Number.isFinite))
      add(`Estimated knee angles at landing were ${a[0]}° left and ${a[1]}° right, changing to ${b[0]}° and ${b[1]}° after landing.`,
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
