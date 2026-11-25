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
