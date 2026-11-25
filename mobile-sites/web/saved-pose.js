const states=['tracked','reacquired','lost','checking'];
const MAX_FRAMES=2400;
const quantize=value=>Number.isFinite(value)?Math.round(Math.max(-15,Math.min(15,value))*2000):0;
const validTime=(value,duration)=>Number.isFinite(value)&&value>=0&&value<=duration+.05;
function encode(numbers) {
  const view=new DataView(new ArrayBuffer(numbers.length*2));
  for(let i=0;i<numbers.length;i++)view.setInt16(i*2,quantize(numbers[i]),true);
  return btoa(String.fromCharCode(...new Uint8Array(view.buffer)));
}
function decode(text,max) {
  if(typeof text!=='string'||text.length>max*3+10)return [];
  try {
    const bytes=Uint8Array.from(atob(text),char=>char.charCodeAt(0));
    if(bytes.length%2||bytes.length>max*2)return [];
    const view=new DataView(bytes.buffer);
    return Array.from({length:bytes.length/2},(_,i)=>view.getInt16(i*2,true)/2000);
  } catch { return []; }
}
function pointValues(points) {
  return points?.length===33?encode(points.flatMap(p=>[p.x,p.y,p.z,p.visibility??1])):null;
}
function readPoints(data) {
  const values=decode(data,132);
  if(values.length!==132)return null;
  return Array.from({length:33},(_,i)=>({x:values[i*4],y:values[i*4+1],z:values[i*4+2],visibility:values[i*4+3]}));
}

export function savePoseReview(pose,mode,moment,foot) {
  if(!pose?.frames.length)return null;
  const frames=pose.frames.slice(0,MAX_FRAMES).map(sample=>[
    Math.round(sample.time*1000),Math.max(0,states.indexOf(sample.state)),
    pointValues(sample.points),pointValues(sample.world),
    (sample.outline||[]).slice(0,5).map(contour=>encode(contour.slice(0,320).flat())),
  ]);
  return {format:1,frames,mode,moment,foot,truncated:pose.frames.length>MAX_FRAMES,cues:(pose.cues||[]).slice(0,240)};
}
export function openPoseReview(data,duration) {
  if(data?.format!==1||!Array.isArray(data.frames))return null;
  const frames=[];
  let last=-1;
  for(const entry of data.frames.slice(0,MAX_FRAMES)) {
    if(!Array.isArray(entry)||!Number.isSafeInteger(entry[0]))continue;
    const time=entry[0]/1000;
    if(!validTime(time,duration)||time<=last)continue;
    last=time;
    const points=readPoints(entry[2]);
    const outline=points&&Array.isArray(entry[4])?entry[4].slice(0,5).flatMap(item=>{
      const coordinates=decode(item,640);
      if(coordinates.length<6||coordinates.length%2||coordinates.some(v=>v<0||v>1))return [];
      return [Array.from({length:coordinates.length/2},(_,i)=>[coordinates[i*2],coordinates[i*2+1]])];
    }):[];
    frames.push({time,state:points?(entry[1]===1?'reacquired':'tracked'):(entry[1]===3?'checking':'lost'),
      points,world:points?readPoints(entry[3]):null,outline});
  }
  if(!frames.some(frame=>frame.points))return null;
  const cues=Array.isArray(data.cues)?data.cues.slice(0,240).filter(item=>item&&validTime(item.time,duration)&&
    ['title','category','feedback'].every(key=>typeof item[key]==='string'&&item[key].length<500)):[];
  return {frames,cues,truncated:!!data.truncated,mode:data.mode,moment:validTime(data.moment,duration)?data.moment:null,foot:data.foot};
}
