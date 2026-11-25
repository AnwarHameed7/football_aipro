/** Compact silhouettes derived from the segmentation mask for the selected pose. */
export function maskContours(values,width,height) {
  if(width<2||height<2||values.length<width*height)return [];
  const scale=Math.min(1,112/Math.max(width,height));
  const w=Math.max(2,Math.round(width*scale)),h=Math.max(2,Math.round(height*scale));
  const grid=new Uint8Array(w*h);
  const threshold=values instanceof Uint8Array?133:.52;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const px=Math.min(width-1,Math.floor((x+.5)*width/w));
    const py=Math.min(height-1,Math.floor((y+.5)*height/h));
    grid[y*w+x]=values[py*width+px]>=threshold?1:0;
  }
  const stride=w+1, edges=new Map();
  const has=(x,y)=>x>=0&&x<w&&y>=0&&y<h&&grid[y*w+x];
  const edge=(x1,y1,x2,y2)=>{
    const from=y1*stride+x1,to=y2*stride+x2;
    if(!edges.has(from))edges.set(from,[]);
    edges.get(from).push(to);
  };
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    if(!has(x,y))continue;
    if(!has(x,y-1))edge(x,y,x+1,y);
    if(!has(x+1,y))edge(x+1,y,x+1,y+1);
    if(!has(x,y+1))edge(x+1,y+1,x,y+1);
    if(!has(x-1,y))edge(x,y+1,x,y);
  }
  const loops=[];
  while(edges.size) {
    const start=edges.keys().next().value;
    let current=start;
    const loop=[];
    do {
      loop.push([current%stride,Math.floor(current/stride)]);
      const next=edges.get(current);
      if(!next?.length)break;
      const end=next.pop();
      if(!next.length)edges.delete(current);
      current=end;
    } while(current!==start);
    if(current!==start||loop.length<8)continue;
    const area=loop.reduce((sum,[x,y],i)=>{
      const [a,b]=loop[(i+1)%loop.length];return sum+x*b-y*a;
    },0)/2;
    if(area<7)continue;
    const outline=loop.filter(([x,y],i)=>{
      const [a,b]=loop[(i+loop.length-1)%loop.length], [c,d]=loop[(i+1)%loop.length];
      return (x-a)*(d-y)!==(y-b)*(c-x);
    }).map(([x,y])=>[x/w,y/h]);
    loops.push({area,outline});
  }
  return loops.sort((a,b)=>b.area-a.area).slice(0,5).map(item=>item.outline);
}

export function drawBodyOutline(ctx,rect,sample) {
  if(!sample?.points||!sample.outline?.length)return false;
  ctx.save();
  ctx.lineJoin='round';ctx.lineCap='round';
  for(const contour of sample.outline) {
    if(contour.length<3)continue;
    ctx.beginPath();
    contour.forEach(([x,y],i)=>i===0?ctx.moveTo(rect.x+x*rect.w,rect.y+y*rect.h):
      ctx.lineTo(rect.x+x*rect.w,rect.y+y*rect.h));
    ctx.closePath();
    ctx.fillStyle='rgba(131,255,128,.18)';ctx.fill();
    ctx.strokeStyle='#142c16';ctx.lineWidth=5;ctx.stroke();
    ctx.strokeStyle='#bbff91';ctx.lineWidth=2.6;
    ctx.shadowColor='#a8ff75';ctx.shadowBlur=7;ctx.stroke();
    ctx.shadowBlur=0;
  }
  ctx.restore();
  return true;
}

export function activeCoachingCue(findings,time,sample) {
  if(!sample?.points||!Array.isArray(findings))return null;
  return findings.find(item=>time>=item.start&&time<item.end)||null;
}

// Trace a rounded silhouette from visible joints when pixel segmentation is unavailable.
export function poseContours(points,ctx) {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  const point=i=>{
    const p=points[i];
    return p&&(p.visibility??1)>=.40&&Number.isFinite(p.x)&&Number.isFinite(p.y)
      ?[p.x*w,p.y*h]:null;
  };
  const shoulders=[point(11),point(12)].filter(Boolean),hips=[point(23),point(24)].filter(Boolean);
  if(!shoulders.length||!hips.length)return [];
  const center=list=>list.reduce(([x,y],[a,b])=>[x+a/list.length,y+b/list.length],[0,0]);
  const top=center(shoulders),bottom=center(hips);
  const torso=Math.hypot(top[0]-bottom[0],top[1]-bottom[1]);
  const radius=Math.max(1.3,torso*.15);
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle=ctx.strokeStyle='#fff';
  ctx.lineCap=ctx.lineJoin='round';
  const stroke=(a,b,size)=>{
    if(!a||!b)return;
    ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.lineWidth=size;ctx.stroke();
  };
  if(shoulders.length===2&&hips.length===2) {
    ctx.beginPath();ctx.moveTo(...shoulders[0]);ctx.lineTo(...shoulders[1]);
    ctx.lineTo(...hips[1]);ctx.lineTo(...hips[0]);ctx.closePath();ctx.lineWidth=radius;ctx.fill();ctx.stroke();
  }
  stroke(top,bottom,radius*2.8);
  const head=[point(0),point(7),point(8)].filter(Boolean);
  if(head.length) {
    const p=center(head);
    stroke(top,p,radius*1.1);
    ctx.beginPath();ctx.ellipse(p[0],p[1],radius*1.05,radius*1.35,0,0,2*Math.PI);ctx.fill();
  }
  for(const [a,b,size] of [
    [11,13,.85],[13,15,.72],[12,14,.85],[14,16,.72],[23,25,1.5],[25,27,1.05],
    [24,26,1.5],[26,28,1.05],[27,31,.85],[28,32,.85],
  ]) stroke(point(a),point(b),radius*size);
  const rgba=ctx.getImageData(0,0,w,h).data;
  const alpha=Uint8Array.from({length:w*h},(_,i)=>rgba[i*4+3]);
  return maskContours(alpha,w,h);
}
