const assets = __ASSETS__;
const LIMIT = 32 * 1024 * 1024;
const json = (body, status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
const idPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const emailKey=async email=>{
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email));
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
};
const validEmail=email=>email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const grantPath=(emailHash,id)=>`access/${emailHash}/${id}.json`;
async function jsonBody(request, max) {
  const raw=await request.text();
  if(raw.length>max) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function library(request, env, url) {
  const identity=request.headers.get('oai-authenticated-user-id');
  if (!identity) return json({error:'Sign in to open the review library.'},401);
  const email=normalizeEmail(request.headers.get('oai-authenticated-user-email'));
  const legacyOwner=!!email&&email===normalizeEmail(env.LIBRARY_OWNER_EMAIL);
  const owns=meta=>meta?.owner?meta.owner===identity:legacyOwner;
  const emailHash=email?await emailKey(email):null;
  const bucket = env.BUCKET;
  if (!bucket) return json({error:'Cloud storage is unavailable.'},503);
  const root = 'reviews/';
  if (request.method === 'GET' && url.pathname === '/api/reviews') {
    const [objects,grants]=await Promise.all([
      bucket.list({prefix:root,limit:100,include:['customMetadata']}),
      emailHash?bucket.list({prefix:`access/${emailHash}/`,limit:100,include:['customMetadata']}):{objects:[]},
    ]);
    const shared=new Map(grants.objects.map(item=>[item.key.split('/')[2].replace(/\.json$/,''),item.customMetadata?.role]));
    return json({items:objects.objects.filter(object=>object.key.endsWith('/review.json')).flatMap(object=>{
      const id=object.key.split('/')[1], meta=object.customMetadata||{};
      const role=owns(meta)?'owner':shared.get(id);
      if(!['owner','coach','viewer'].includes(role))return [];
      return [{id,name:meta.name,source:meta.source,hasClip:meta.hasClip,role,date:object.uploaded.toISOString()}];
    }).sort((a,b)=>b.date.localeCompare(a.date))});
  }
  if (request.method === 'POST' && url.pathname === '/api/reviews') {
    if (request.headers.get('origin') !== url.origin) return json({error:'Invalid source.'},403);
    const length = Number(request.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) return json({error:'Upload length unavailable.'},411);
    if (length > LIMIT) return json({error:'Review package exceeds the upload limit.'},413);
    const form=await request.formData(), name=String(form.get('name')||'').trim().slice(0,100);
    const raw=form.get('review'), file=form.get('video');
    if(!name || typeof raw!=='string' || raw.length>10*1024*1024)
      return json({error:'A review name and valid review file are required.'},400);
    let review;
    try { review=JSON.parse(raw); }
    catch { return json({error:'Invalid review JSON.'},400); }
    if(review?.version!==1 || typeof review.source!=='string' || !Array.isArray(review.tags))
      return json({error:'Invalid review data.'},400);
    if(file && (!(file instanceof File) || file.size>20*1024*1024))
      return json({error:'The clip must be 20 MB or smaller.'},413);
    const id=crypto.randomUUID(), key=root+id+'/';
    if (file) {
      const contentType = /^(video\/(mp4|webm|quicktime|x-m4v|ogg))$/.test(file.type) ? file.type : 'application/octet-stream';
      await bucket.put(key+'clip',file,{httpMetadata:{contentType}});
    }
    try {
      await bucket.put(key+'review.json',raw,{httpMetadata:{contentType:'application/json'},
        customMetadata:{name,source:review.source.slice(0,150),hasClip:file?'yes':'no',owner:identity}});
    } catch(error) {
      if(file) await bucket.delete(key+'clip');
      throw error;
    }
    return json({id},201);
  }
  const match=url.pathname.match(new RegExp('^/api/reviews/('+idPattern+')(?:/(clip|review|access|feedback))?$'));
  if(!match) return json({error:'Review not found.'},404);
  const id=match[1], key=root+id+'/';
  const review=await bucket.get(key+'review.json');
  if(!review) return json({error:'Review not found.'},404);
  let role=owns(review.customMetadata)?'owner':null;
  if(!role && emailHash) {
    const grant=await bucket.get(grantPath(emailHash,id));
    if(['coach','viewer'].includes(grant?.customMetadata?.role))role=grant.customMetadata.role;
  }
  if(!role) return json({error:'Review not found.'},404);
  if(['POST','DELETE','PUT'].includes(request.method)&&request.headers.get('origin')!==url.origin)
    return json({error:'Invalid source.'},403);
  if(request.method==='DELETE' && !match[2]) {
    if(role!=='owner')return json({error:'Only the review owner can delete it.'},403);
    const notes=await bucket.list({prefix:key+'feedback/',limit:100});
    await bucket.delete([key+'review.json',key+'clip',...notes.objects.map(note=>note.key)]);
    return new Response(null,{status:204});
  }
  if(match[2]==='access'&&request.method==='POST') {
    if(role!=='owner')return json({error:'Only the review owner can manage access.'},403);
    const data=await jsonBody(request,2048);
    const recipient=normalizeEmail(data?.email);
    if(!validEmail(recipient)||recipient===email||!['coach','viewer','revoke'].includes(data?.role))
      return json({error:'Choose a valid collaborator email and role.'},400);
    const path=grantPath(await emailKey(recipient),id);
    if(data.role==='revoke')await bucket.delete(path);
    else await bucket.put(path,'{}',{customMetadata:{role:data.role}});
    return json({role:data.role});
  }
  if(match[2]==='feedback'&&request.method==='GET') {
    const notes=await bucket.list({prefix:key+'feedback/',limit:100,include:['customMetadata']});
    return json({items:notes.objects.map(note=>({...note.customMetadata,date:note.uploaded.toISOString()}))
      .sort((a,b)=>a.date.localeCompare(b.date))});
  }
  if(match[2]==='feedback'&&request.method==='POST') {
    if(role==='viewer')return json({error:'Viewers can read feedback. Ask the owner for Coach access to contribute.'},403);
    const data=await jsonBody(request,4096);
    if(!data||typeof data.note!=='string'||!data.note.trim()||data.note.length>850||
      !Number.isFinite(data.time)||data.time<0||data.time>86400)
      return json({error:'Enter a valid timestamp and feedback.'},400);
    const notes=await bucket.list({prefix:key+'feedback/',limit:100});
    if(notes.objects.length>=100)return json({error:'This review has reached its feedback limit.'},409);
    await bucket.put(key+'feedback/'+crypto.randomUUID()+'.json','{}',{customMetadata:{
      note:data.note.trim(),time:String(data.time),author:role==='owner'?'Owner':'Coach'
    }});
    return json({saved:true},201);
  }
  if(request.method==='GET' && ['clip','review'].includes(match[2])) {
    const file=await bucket.get(key+(match[2]==='clip'?'clip':'review.json'));
    if(!file) return json({error:'File not found.'},404);
    return new Response(file.body,{headers:{'content-type':file.httpMetadata?.contentType||'application/octet-stream',
      'content-length':String(file.size),'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
  }
  return json({error:'Method not supported.'},405);
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/')) {
      try { return await library(request,env,url); }
      catch(error) {
        console.error('Review library request failed',error?.name);
        return json({error:'Cloud review storage could not complete the request.'},500);
      }
    }
    const path=url.pathname==='/'?'/index.html':url.pathname;
    const asset=Object.hasOwn(assets,path)?assets[path]:null;
    if(!asset || !['GET','HEAD'].includes(request.method)) return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:asset.body,{headers:{'content-type':asset.type,
      'cache-control':'no-cache','x-content-type-options':'nosniff',
      'permissions-policy':'microphone=(self), camera=()'}});
  }
};
