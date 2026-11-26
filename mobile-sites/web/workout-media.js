import {PoseEngineError} from './pose-engine.js';
import {seekFrame} from './pose.js';
import {workoutMeasurement} from './workout.js';

export const WORKOUT_VIDEO_SECONDS=90;

export async function readWorkoutFrame(detector,input,source,width,height,time) {
  if(!width||!height)throw new Error('The media has no usable image size.');
  const scale=Math.min(1,640/Math.max(width,height));
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(input.width!==w||input.height!==h){input.width=w;input.height=h;}
  const context=input.getContext('2d');
  if(!context)throw new Error('This browser could not prepare an image for analysis.');
  context.drawImage(source,0,0,input.width,input.height);
  let landmarks=[],worldLandmarks=[];
  try {
    await detector.read(input,result=>{
      landmarks=result.landmarks||[];
      worldLandmarks=result.worldLandmarks||[];
    });
  } catch {throw new PoseEngineError('The workout pose model could not read the image.');}
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
