import {openDecoder,closeDecoder,seekFrame} from './pose.js';
import {closeModel,objectModel} from './pose-engine.js';

export const TEAM_STEP=.333333;
export const TEAM_COLORS={A:'#b1f58b',B:'#71c8ff'};
const distance=(a,b)=>Math.hypot(a[0]-b[0],(a[1]-b[1])*.65);

export function kitHistogram(data) {
  const bins=new Float32Array(20);
  for(let i=0;i<data.length;i+=4) {
    const r=data[i]/255,g=data[i+1]/255,b=data[i+2]/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    const saturation=max?delta/max:0;
    if(saturation<.20||max<.15) {
      const light=max*3, bin=Math.floor(light);
      bins[16+bin]+=1-(light-bin);
      bins[16+Math.min(3,bin+1)]+=light-bin;
    } else {
      const angle=max===r?(g-b)/delta:max===g?2+(b-r)/delta:4+(r-g)/delta;
      const hue=((angle/6+1)%1)*8, bin=Math.floor(hue);
      const fraction=hue-bin;
      const vivid=clamp((saturation-.43)/.28);
      bins[bin]+=(1-fraction)*(1-vivid);
      bins[(bin+1)%8]+=fraction*(1-vivid);
      bins[8+bin]+=(1-fraction)*vivid;
      bins[8+(bin+1)%8]+=fraction*vivid;
    }
  }
  const total=data.length/4;
  return total?bins.map(value=>value/total):bins;
}
function similarity(a,b) {
  let sum=0;
  for(let i=0;i<a.length;i++) sum+=Math.sqrt(a[i]*b[i]);
  return sum;
}
export function classifyKit(sample,references) {
  const score=team=>{
    const variants=Array.isArray(references[team])?references[team]:[references[team]];
    return Math.max(0,...variants.filter(Boolean).map(reference=>similarity(sample,reference)));
  };
  const home=score('A'),away=score('B');
  if(Math.max(home,away)<.56||Math.abs(home-away)<.19) return null;
  return home>away?'A':'B';
}
function sampleKit(ctx,box) {
  const [x,y,w,h]=box;
  const x1=Math.max(0,Math.floor(x+w*.30)),y1=Math.max(0,Math.floor(y+h*.27));
  const width=Math.min(ctx.canvas.width-x1,Math.max(2,Math.round(w*.40)));
  const height=Math.min(ctx.canvas.height-y1,Math.max(2,Math.round(h*.24)));
  return width>1&&height>1?kitHistogram(ctx.getImageData(x1,y1,width,height).data):null;
}

const VISIBLE_FOR=1.05;
const clamp=(n,limit=1)=>Math.min(limit,Math.max(0,n));
const positionAt=(track,time)=>track.field.map((v,i)=>clamp(v+(track.velocity?.[i]||0)*(time-track.time)));

export function assignTrackIds(previous,players,time,nextId) {
  const active=previous.filter(track=>time-track.time<=VISIBLE_FOR);
  const assigned=players.map(player=>({...player,team:player.team||null}));
  const claims=[];
  for(let i=0;i<assigned.length;i++) {
    const player=assigned[i];
    for(const track of active) {
      const age=Math.max(0,time-track.time);
      const d=distance(positionAt(track,time),player.field);
      if(d>.027+age*.07)continue;
      const contradict=!!(player.team&&track.team&&player.team!==track.team);
      if(contradict&&d>.026)continue;
      const resize=player.box&&track.box?Math.min(.028,Math.abs(Math.log((player.box[3]+.002)/(track.box[3]+.002)))*.018):0;
      claims.push({i,track,score:d+resize+(contradict?.027:0)});
    }
  }
  claims.sort((a,b)=>a.score-b.score);
  const used=new Set(),matched=new Map();
  for(const claim of claims) {
    const {i,track,score}=claim;
    if(matched.has(i)||used.has(track.id))continue;
    const contested=claims.some(other=>other!==claim&&Math.abs(other.score-score)<.009&&
      (other.i===i||other.track.id===track.id));
    if(contested)continue;
    matched.set(i,track);used.add(track.id);
  }
  const current=assigned.map((player,i)=>{
    const track=matched.get(i);
    player.id=track?.id??nextId++;
    const observedTeam=player.team;
    const contradict=!!(track?.team&&observedTeam&&observedTeam!==track.team);
    const priorDisputes=track?.disputes||0;
    const disputes=contradict?priorDisputes+1:observedTeam?0:priorDisputes;
    if(contradict)player.team=disputes<3?track.team:null;
    else if(!observedTeam&&track?.team)player.team=track.team;
    if(player.team&&player.team!==observedTeam)player.teamSource='continuity';
    const age=track?Math.max(.1,time-track.time):1;
    const velocity=track?player.field.map((v,k)=>{
      const incoming=Math.min(.28,Math.max(-.28,(v-track.field[k])/age));
      return (track.velocity?.[k]||0)*.28+incoming*.72;
    }):[0,0];
    const imageVelocity=track?.box&&player.box?player.box.slice(0,2).map((v,k)=>
      Math.min(.4,Math.max(-.4,(v-track.box[k])/age))):[0,0];
    return {id:player.id,team:player.team,field:player.field,box:player.box,time,velocity,imageVelocity,
      hits:(track?.hits||0)+1,disputes};
  });
  const lost=active.filter(track=>!used.has(track.id));
  const estimates=lost.flatMap(track=>{
    if(track.hits<2||!track.box)return [];
    const age=time-track.time;
    const field=positionAt(track,time);
    if(assigned.some(player=>distance(player.field,field)<.023))return [];
    const [x,y,w,h]=track.box;
    const box=[clamp(x+track.imageVelocity[0]*age,1-w),clamp(y+track.imageVelocity[1]*age,1-h),w,h];
    return [{id:track.id,team:track.team,field,box,estimated:true}];
  });
  return {players:[...assigned,...estimates],tracks:[...current,...lost],nextId};
}

export function correctTeam(frames,id,team) {
  if(!Number.isSafeInteger(id)||!['A','B',null].includes(team))return false;
  let found=false;
  for(const frame of frames)for(const player of frame.players) {
    if(player.id!==id)continue;
    found=true;player.team=team;player.teamSource='manual';
  }
  return found;
}
export function teamShape(players,team,attack='right') {
  const positions=players.filter(player=>player.team===team&&!player.estimated).map(player=>player.field);
  if(positions.length<4)return null;
  const xs=positions.map(([x])=>x),ys=positions.map(([,y])=>y);
  const range=axis=>Math.round(100*(Math.max(...axis)-Math.min(...axis)));
  const center=xs.reduce((sum,x)=>sum+x,0)/positions.length;
  const line=positions.map(([x])=>(attack==='left'?1-x:x)).sort((a,b)=>a-b);
  const gaps=line.slice(1).map((x,i)=>x-line[i]);
  const opponents=players.filter(player=>player.team&&player.team!==team&&!player.estimated).map(player=>player.field);
  const nearest=opponents.length>=4?positions.map(p=>Math.min(...opponents.map(other=>distance(p,other)))).sort((a,b)=>a-b):[];
  const pressureGap=nearest.length?Math.round(100*nearest[Math.floor(nearest.length/2)]):null;
  const channels=[0,0,0];
  for(const y of ys)channels[Math.min(2,Math.floor(y*3))]++;
  return {count:positions.length,width:range(ys),depth:range(xs),center:Math.round(100*(attack==='left'?1-center:center)),
    gap:Math.round(100*Math.max(...gaps)),pressureGap,channels};
}
export function teamTimeline(frames,attack) {
  const cues=[];
  for(const team of ['A','B']) {
    const direction=team==='A'?attack:attack==='left'?'right':'left';
    const eligible=frames.flatMap(frame=>{
      const shape=teamShape(frame.players,team,direction);
      return shape?[{time:frame.time,shape}]:[];
    });
    if(eligible.length<4)continue;
    const wide=eligible.reduce((best,item)=>item.shape.width>best.shape.width?item:best);
    const gap=eligible.reduce((best,item)=>item.shape.gap>best.shape.gap?item:best);
    cues.push({team,time:wide.time,title:'Widest visible shape',detail:`${wide.shape.width}% of pitch width across ${wide.shape.count} classified players. Replay to check where the wide outlet was.`},
      {team,time:gap.time,title:'Largest visible gap along pitch',detail:`${gap.shape.gap}% of pitch length between adjacent visible players. Check whether support was available in that space.`});
    const paired=eligible.filter(item=>item.shape.pressureGap!==null);
    if(paired.length>=4) {
      const close=paired.reduce((best,item)=>item.shape.pressureGap<best.shape.pressureGap?item:best);
      cues.push({team,time:close.time,title:'Closest opposition spacing',detail:
        `The median nearest-opponent gap was ${close.shape.pressureGap}% of pitch length among visible players. Replay to check whether players had support or a way out.`});
    }
  }
  return cues.sort((a,b)=>a.time-b.time);
}

function overlaps(a,b) {
  const [x,y,w,h]=a,[u,v,l,k]=b;
  const area=Math.max(0,Math.min(x+w,u+l)-Math.max(x,u))*Math.max(0,Math.min(y+h,v+k)-Math.max(y,v));
  const iou=area/(w*h+l*k-area||1);
  const contained=area/(Math.min(w*h,l*k)||1);
  // Tile-edge fragments can be mostly contained in a complete box.
  return iou>=.36 || contained>=.74&&Math.abs(x+w/2-u-l/2)<Math.min(w,l)*.42;
}

export function detectionTiles(width,height,detailed) {
  const tiles=[{x:0,y:0,w:width,h:height}];
  if(!detailed)return tiles;
  const w=Math.round(width*.51),h=Math.round(height*.61);
  for(const x of [0,Math.round((width-w)/2),width-w])for(const y of [0,height-h])
    tiles.push({x,y,w,h});
  return tiles;
}

function boxes(detector,canvas,tile,wide) {
  const {width:w,height:h}=canvas,entries=[],balls=[];
  for(const region of detectionTiles(w,h,wide)) {
    let surface=canvas;
    if(region.w!==w||region.h!==h) {
      tile.width=region.w;tile.height=region.h;
      tile.getContext('2d').drawImage(canvas,region.x,region.y,region.w,region.h,0,0,region.w,region.h);
      surface=tile;
    }
    for(const d of detector.detect(surface).detections) {
      const b=d.boundingBox;
      const x=Math.max(0,region.x+b.originX),y=Math.max(0,region.y+b.originY);
      const width=Math.min(w-x,b.width),height=Math.min(h-y,b.height);
      const score=d.categories[0]?.score||0;
      if(d.categories[0]?.categoryName==='sports ball') {
        if(score>=.47&&width>1&&height>1&&width<.08*w&&height<.12*h)
          balls.push({center:[(x+width/2)/w,(y+height/2)/h],score});
        continue;
      }
      if(d.categories[0]?.categoryName!=='person'||width<3||height<6||height<width*.65)continue;
      const clipped=(region.x>0&&b.originX<=1)||(region.y>0&&b.originY<=1)||
        (region.x+region.w<w&&b.originX+b.width>=region.w-1)||
        (region.y+region.h<h&&b.originY+b.height>=region.h-1);
      entries.push({box:[x,y,width,height],score:(d.categories[0]?.score||0)-(clipped?.20:0)});
    }
  }
  const selected=[];
  for(const item of entries.sort((a,b)=>b.score-a.score)) {
    if(selected.every(other=>!overlaps(item.box,other.box)))selected.push(item);
    if(selected.length===35)break;
  }
  balls.sort((a,b)=>b.score-a.score);
  const top=balls[0];
  const ball=top&&!balls.some(other=>other!==top&&top.score-other.score<.17&&distance(top.center,other.center)>.024)
    ?top.center:null;
  return {players:selected,ball};
}

export async function scanTeams({url,sourceVideo,anchors,project,start,end,wide,signal,progress}) {
  signal.throwIfAborted();
  const video=sourceVideo||await openDecoder(url,signal);
  const canvas=document.createElement('canvas'),tile=document.createElement('canvas');
  const scale=Math.min(1,(wide?1280:768)/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const references={};
  const stop=Math.min(end,video.duration-.004,start+90);
  const frames=[];
  let detector;
  try {
    if(stop<start)throw new Error('Choose an interval inside the clip.');
    detector=await objectModel('people',signal);
    signal.throwIfAborted();
    for(const team of ['A','B']) {
      const samples=Array.isArray(anchors[team])?anchors[team]:[anchors[team]];
      references[team]=[];
      for(const anchor of samples) {
        signal.throwIfAborted();
        await seekFrame(video,anchor.time,signal);ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const x=anchor.x*canvas.width,y=anchor.y*canvas.height;
        const candidate=boxes(detector,canvas,tile,wide).players.find(({box:[a,b,w,h]})=>
          x>=a&&x<=a+w&&y>=b+h*.12&&y<=b+h*.6);
        const kit=candidate&&sampleKit(ctx,candidate.box);
        if(kit)references[team].push(kit);
      }
      if(!references[team].length)
        throw new Error(`No clear Team ${team} shirt was visible at the marked points. Try a closer frame.`);
    }
    let tracks=[],nextId=1;
    for(let i=0,time=start;time<=stop+.00001;i++,time=start+i/3) {
      signal.throwIfAborted();
      await seekFrame(video,time,signal);ctx.drawImage(video,0,0,canvas.width,canvas.height);
      const detections=boxes(detector,canvas,tile,wide);
      const players=detections.players.flatMap(({box})=>{
        const [x,y,w,h]=box;
        const coords=project([(x+w/2)/canvas.width,Math.min(1,(y+h)/canvas.height)]);
        if(!coords)return [];
        const kit=sampleKit(ctx,box);
        return [{field:coords,team:kit?classifyKit(kit,references):null,
          box:[x/canvas.width,y/canvas.height,w/canvas.width,h/canvas.height]}];
      });
      const assigned=assignTrackIds(tracks,players,time,nextId);
      tracks=assigned.tracks;nextId=assigned.nextId;
      const center=detections.ball,field=center&&project(center);
      frames.push({time,players:assigned.players,ball:field?{center,field}:null});
      progress((time-start)/Math.max(.334,stop-start));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  } finally {
    if(detector)closeModel(detector);
    for(const surface of [canvas,tile]){surface.width=1;surface.height=1;}
    if(!sourceVideo)closeDecoder(video);
  }
  return frames;
}
