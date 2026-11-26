const REFERENCE_KEY='football-ai-pro-player-reference-v1';

const fraction=value=>Number.isFinite(value)&&value>=0&&value<=1;
const point=value=>value&&fraction(value.x)&&fraction(value.y)?{x:value.x,y:value.y}:null;
function histogram(value) {
  if(!value||value.length!==64)return null;
  const bins=Array.from(value);
  return bins.every(fraction)&&Math.abs(bins.reduce((sum,bin)=>sum+bin,0)-1)<.08?bins:null;
}
function descriptor(signature) {
  const bins=histogram(signature?.bins),center=point(signature?.center),hip=point(signature?.hip);
  if(!bins||!center||!hip||!Number.isFinite(signature.torso)||signature.torso<.006||signature.torso>.8)return null;
  const pattern=Array.isArray(signature.pattern)&&signature.pattern.length===9&&
    signature.pattern.every(row=>Array.isArray(row)&&row.length===3&&row.every(fraction))?signature.pattern:null;
  return {bins,center,hip,torso:signature.torso,lower:histogram(signature.lower),socks:histogram(signature.socks),
    shape:Number.isFinite(signature.shape)&&signature.shape>0?Math.min(5,signature.shape):0,pattern};
}

export function referenceFromTrack(memory) {
  const seed=descriptor(memory?.seed);
  if(!seed)return null;
  const refs=Array.isArray(memory.references)?memory.references.slice(1,8).map(descriptor).filter(Boolean):[];
  return {seed,references:[seed,...refs]};
}

export function loadPlayerReference(storage) {
  try {return referenceFromTrack(JSON.parse((storage||globalThis.localStorage).getItem(REFERENCE_KEY)));}
  catch {return null;}
}

export function savePlayerReference(storage,memory) {
  if(!memory) {storage.removeItem(REFERENCE_KEY);return null;}
  const reference=referenceFromTrack(memory);
  if(!reference)throw new Error('Track yourself in a clear clip before saving a reference.');
  storage.setItem(REFERENCE_KEY,JSON.stringify(reference));
  return reference;
}

export function referenceMemory(reference) {
  if(!reference)return null;
  return {...reference,last:reference.seed,missing:7,acrossCut:true,referenceSearch:true};
}

export function suggestedAnchor(frames) {
  const visible=point=>point&&(point.visibility??1)>=.55&&fraction(point.x)&&fraction(point.y);
  for(let i=1;i<frames.length;i++) {
    const current=frames[i],prior=frames[i-1];
    if(!current.points||!prior.points||current.cut||current.time-prior.time>.2)continue;
    const torso=[11,12,23,24].map(index=>current.points[index]).filter(visible);
    if(torso.length<3)continue;
    return {time:current.time,x:torso.reduce((sum,p)=>sum+p.x,0)/torso.length,
      y:torso.reduce((sum,p)=>sum+p.y,0)/torso.length};
  }
  return null;
}
