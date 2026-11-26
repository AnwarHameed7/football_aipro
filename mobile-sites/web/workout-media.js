import {playerCrop,uncropPoint} from './player-selection.js';
import {PoseEngineError} from './pose-engine.js';
import {seekFrame} from './pose.js';
import {workoutMeasurement} from './workout.js';

export const WORKOUT_VIDEO_SECONDS=90;

async function inferWorkout(detector,canvas) {
  let landmarks=[],worldLandmarks=[];
  try {
    await detector.read(canvas,result=>{
      landmarks=result.landmarks||[];
      worldLandmarks=result.worldLandmarks||[];
    });
  } catch {throw new PoseEngineError('The workout pose model could not read the image.');}
  return {landmarks,worldLandmarks};
}

function workoutPoseQuality(points) {
  const joints=[11,12,23,24,25,26,27,28];
  return joints.reduce((sum,index)=>sum+(points[index]?.visibility??0),0)/joints.length;
}

export async function readWorkoutFrame(detector,input,source,width,height,time,{zoom,previous,detail=false,wide=false}={}) {
  if(!width||!height)throw new Error('The media has no usable image size.');
  const scale=Math.min(1,640/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(input.width!==w||input.height!==h){input.width=w;input.height=h;}
  const context=input.getContext('2d');
  if(!context)throw new Error('This browser could not prepare an image for analysis.');
  context.drawImage(source,0,0,input.width,input.height);
  let {landmarks,worldLandmarks}=await inferWorkout(detector,input);
  if(!landmarks.length&&zoom&&Math.min(width,height)>=240) {
    const torso=[11,12,23,24].map(i=>previous?.[i]).filter(p=>p?.visibility>=.55);
    const center=torso.length>=2?{
      x:torso.reduce((sum,p)=>sum+p.x,0)/torso.length,
      y:torso.reduce((sum,p)=>sum+p.y,0)/torso.length,
    }:{x:.5,y:.46};
    const closer=zoom.getContext('2d');
    const regions=detail?[[center,.60],[center,.43]]:[[center,.50]];
    if(wide&&torso.length<2) {
      regions.push([{x:.36,y:.42},.34],[{x:.64,y:.42},.34],
        [{x:.36,y:.63},.34],[{x:.64,y:.63},.34]);
    }
    if(closer)for(const [aim,fraction] of regions) {
      const crop=playerCrop(aim,fraction,width,height);
      closer.drawImage(source,crop.x,crop.y,crop.side,crop.side,0,0,zoom.width,zoom.height);
      const local=await inferWorkout(detector,zoom);
      if(!local.landmarks.length)continue;
      landmarks=local.landmarks.map(points=>points.map(p=>uncropPoint(p,crop)));
      worldLandmarks=local.worldLandmarks;
      break;
    }
    if(closer&&wide&&landmarks.length===1&&workoutPoseQuality(landmarks[0])<.65) {
      const joints=[11,12,23,24].map(index=>landmarks[0][index]).filter(point=>point?.visibility>=.34);
      if(joints.length>=2) {
        const aim={x:joints.reduce((sum,p)=>sum+p.x,0)/joints.length,y:joints.reduce((sum,p)=>sum+p.y,0)/joints.length};
        const crop=playerCrop(aim,.25,width,height);
        closer.drawImage(source,crop.x,crop.y,crop.side,crop.side,0,0,zoom.width,zoom.height);
        const closerPose=await inferWorkout(detector,zoom);
        if(closerPose.landmarks.length===1&&workoutPoseQuality(closerPose.landmarks[0])>workoutPoseQuality(landmarks[0])) {
          landmarks=closerPose.landmarks.map(points=>points.map(point=>uncropPoint(point,crop)));
          worldLandmarks=closerPose.worldLandmarks;
        }
      }
    }
  }
  return {time,points:landmarks.length===1?landmarks[0]:null,
    world:landmarks.length===1&&worldLandmarks[0]?.length===33?worldLandmarks[0]:null,
    people:landmarks.length,aspect:width/height};
}

export async function scanWorkoutVideo(video,read,{start,end,signal,onFrame,seek=seekFrame}) {
  const frames=[],step=1/6;
  const stop=Math.min(end,video.duration-.001,start+WORKOUT_VIDEO_SECONDS);
  if(stop<start)throw new Error('Move the video playhead before the end of the clip.');
  const total=Math.floor((stop-start)/step+.0001)+1;
  for(let i=0;i<total;i++) {
    signal.throwIfAborted();
    const time=start+i*step;
    await seek(video,time,signal);
    const frame=await read(time);
    signal.throwIfAborted();
    frames.push(frame);
    onFrame(frame,(i+1)/total);
    if(i%4===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  return frames;
}

export function workoutFrameAt(frames,time) {
  let left=0,right=frames.length;
  while(left<right) {
    const middle=(left+right)>>>1;
    if(frames[middle].time<time)left=middle+1;
    else right=middle;
  }
  const [a,b]=[frames[left-1],frames[left]];
  const closest=!a?b:!b||time-a.time<=b.time-time?a:b;
  return closest&&Math.abs(closest.time-time)<.17?closest:null;
}

export function photoWorkoutReview(frame,mode) {
  const measurement=workoutMeasurement(frame?.points,mode,frame?.aspect);
  if(!measurement)return null;
  let cue='';
  if((mode==='plank'||mode==='pushup')&&measurement.bodyLine!==null&&measurement.bodyLine<152)
    cue='Your hips sit away from the shoulder-to-ankle line in this photo. Compare with a position where those points line up more closely.';
  if(mode==='hinge'&&measurement.kneeAngle!==null&&measurement.kneeAngle<114)
    cue='Your knees are substantially bent in this photo. If this is a hip hinge, compare with a frame where your hips travel back with less knee bend.';
  if(mode==='running'&&measurement.lean>=28)
    cue='Your trunk is tilted in this view. Use a video at a steady pace to check whether the tilt persists.';
  return {measurement,cue};
}

export function workoutCueMoments(frames) {
  const moments=[];
  for(const frame of frames) {
    if(!frame.cue)continue;
    const previous=moments.at(-1);
    if(previous?.cue===frame.cue&&frame.time-previous.end<.9)previous.end=frame.time;
    else moments.push({time:frame.time,end:frame.time,cue:frame.cue});
  }
  return moments.slice(0,8);
}
