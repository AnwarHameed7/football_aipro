export function sceneSample(surface,ctx) {
  if(!ctx)return null;
  ctx.drawImage(surface,0,0,16,9);
  return ctx.getImageData(0,0,16,9).data;
}

export function changedScene(before,after) {
  if(!before||!after||before.length!==after.length)return false;
  let changed=0,sum=0;
  const pixels=before.length/4;
  for(let i=0;i<before.length;i+=4) {
    const difference=(Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+
      Math.abs(before[i+2]-after[i+2]))/765;
    sum+=difference;
    if(difference>.23)changed++;
  }
  return changed/pixels>.63&&sum/pixels>.29;
}
