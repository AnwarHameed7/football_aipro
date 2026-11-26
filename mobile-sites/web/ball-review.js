import {seekFrame} from './pose.js';
import {sampleAt} from './review-flow.js';
import {colourPatch,kitDistance,located,playerCrop} from './player-selection.js';
import {changedScene,sceneSample} from './scene.js';

const confident=point=>located(point)&&(point.visibility??1)>=.55;

export function ballMatchSample(detections,sample,width,height,context,cut=false) {
  const time=sample.time,aspect=width/height;
  const result={time,ball:null,nearYou:false,receiver:null,score:0,cut};
  if(!sample.points)return result;
  const balls=detections.flatMap(item=>{
    if(item.categories[0]?.categoryName!=='sports ball'||item.categories[0].score<.48)return [];
    const {originX,originY,width:w,height:h}=item.boundingBox;
    if(w<=0||h<=0||w/h<.45||w/h>2.2)return [];
    const size=Math.max(w/width,h/height);
    if(size>.45||(size>.14&&item.categories[0].score<.65))return [];
    const x=(originX+w/2)/width,y=(originY+h/2)/height;
    return x>=0&&x<=1&&y>=0&&y<=1?[{x,y,score:item.categories[0].score}]:[];
  }).sort((a,b)=>b.score-a.score);
  const [ball,other]=balls;
  if(!ball||(other&&ball.score-other.score<.15))return result;
  result.ball=[ball.x,ball.y];
  result.score=ball.score;
  const points=sample.points;
  const distance=(a,b)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
  const shoulders=[points[11],points[12]].filter(confident),hips=[points[23],points[24]].filter(confident);
  const ankles=[points[27],points[28]].filter(confident);
  const average=values=>({x:values.reduce((sum,p)=>sum+p.x,0)/values.length,
    y:values.reduce((sum,p)=>sum+p.y,0)/values.length});
  if(!shoulders.length||!hips.length||!ankles.length)return result;
  const shoulder=average(shoulders),hip=average(hips),foot=average(ankles);
  const torso=distance(shoulder,hip);
  if(torso<.008)return result;
  result.nearYou=ankles.some(ankle=>distance(ankle,ball)<torso*.63);
  if(result.nearYou)return result;
  const matches=detections.flatMap(item=>{
    if(item.categories[0]?.categoryName!=='person'||item.categories[0].score<.55)return [];
    const {originX,originY,width:w,height:h}=item.boundingBox;
    if(w<=0||h<=0)return [];
    const left=originX/width,top=originY/height,center=left+w/(2*width),bottom=top+h/height;
    if((hip.x>=left&&hip.x<=left+w/width&&hip.y>=top&&hip.y<=bottom)||
      distance(foot,{x:center,y:bottom})<torso*.6)return [];
    const range=distance(ball,{x:center,y:bottom})/(h/height);
    return range<.19?[{x:center,y:top+h*.52/height,range,shirt:{x:center,y:top+h*.32/height},radius:w/width*.14}]:[];
  }).sort((a,b)=>a.range-b.range);
  const [best,next]=matches;
  if(!best||(next&&next.range-best.range<.09))return result;
  const ownShirt={x:(shoulder.x+hip.x)/2,y:(shoulder.y+hip.y)/2};
  const ownKit=colourPatch(context,ownShirt,torso*.16);
  const theirKit=colourPatch(context,best.shirt,best.radius);
  const similar=ownKit&&theirKit&&kitDistance({bins:ownKit},{bins:theirKit})<.24;
  result.receiver={x:best.x,y:best.y,team:similar?'similar':'unknown',clear:false};
  return result;
}

export function mapCropBall(item,crop,zoomWidth,surfaceWidth,surfaceHeight) {
  const box=item.boundingBox,scale=crop.side/zoomWidth;
  return {...item,boundingBox:{
    originX:(crop.x+box.originX*scale)*surfaceWidth/crop.width,
    originY:(crop.y+box.originY*scale)*surfaceHeight/crop.height,
    width:box.width*scale*surfaceWidth/crop.width,
    height:box.height*scale*surfaceHeight/crop.height,
  }};
}

export async function analyzeSectionBall(video,detector,frames,start,end,{signal,progress}) {
  const surface=document.createElement('canvas'),scene=document.createElement('canvas'),zoom=document.createElement('canvas');
  const scale=Math.min(1,768/Math.max(video.videoWidth,video.videoHeight));
  surface.width=Math.max(1,Math.round(video.videoWidth*scale));
  surface.height=Math.max(1,Math.round(video.videoHeight*scale));
  scene.width=16;scene.height=9;zoom.width=zoom.height=352;
  const context=surface.getContext('2d',{willReadFrequently:true});
  const sceneContext=scene.getContext('2d',{willReadFrequently:true}),zoomContext=zoom.getContext('2d');
  const samples=[];
  let previous,previousBall,observed=0,eligible=0,tried=0;
  const length=Math.ceil((end-start)*4);
  try {
    for(let i=0;i<length;i++) {
      signal.throwIfAborted();
      const time=start+i*.25;
      const sample=sampleAt(frames,time);
      if(sample?.points) {
        await seekFrame(video,time,signal);
        context.drawImage(video,0,0,surface.width,surface.height);
        const current=sceneSample(surface,sceneContext),cut=!previous||changedScene(previous,current);
        const full=detector.detect(surface).detections;
        const frame={...sample,time},ankles=[sample.points[27],sample.points[28]].filter(confident);
        const ballIn=(detections)=>ballMatchSample(detections,frame,surface.width,surface.height,context,cut);
        let findings=ballIn(full);
        if(cut)previousBall=null;
        if(!findings.ball&&zoomContext&&(previousBall||ankles.length)&&
          !full.some(item=>item.categories[0]?.categoryName==='sports ball'&&item.categories[0].score>=.48)) {
          const center=previousBall||{x:ankles[0].x,y:ankles[0].y};
          const crop=playerCrop(center,.42,video.videoWidth,video.videoHeight);
          zoomContext.drawImage(video,crop.x,crop.y,crop.side,crop.side,0,0,zoom.width,zoom.height);
          const local=detector.detect(zoom).detections.filter(item=>item.categories[0]?.categoryName==='sports ball')
            .map(item=>mapCropBall(item,crop,zoom.width,surface.width,surface.height));
          if(local.length)findings=ballIn([...full,...local]);
        }
        previousBall=findings.ball?{x:findings.ball[0],y:findings.ball[1]}:null;
        if(ankles.length)eligible++;
        if(findings.ball)observed++;
        samples.push(findings);
        previous=current;
        tried++;
      } else previous=previousBall=null;
      if(i%4===0){progress((i+1)/length);await new Promise(resolve=>setTimeout(resolve,0));}
    }
    progress(1);
    return {samples,observed,eligible,tried};
  } finally {
    for(const canvas of [surface,scene,zoom]){canvas.width=1;canvas.height=1;}
  }
}
