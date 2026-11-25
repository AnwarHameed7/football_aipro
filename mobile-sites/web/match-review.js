export const SECTION_SECONDS=12;
export const LONG_CLIP_SECONDS=45;
const STORE='checkpoints';

export function sectionAt(time,duration) {
  return Math.max(0,Math.min(Math.ceil(duration/SECTION_SECONDS)-1,Math.floor(time/SECTION_SECONDS)));
}

export function sectionRange(index,duration) {
  return {start:index*SECTION_SECONDS,end:Math.min(duration,(index+1)*SECTION_SECONDS)};
}

export function nextSection(session,duration) {
  const total=Math.ceil(duration/SECTION_SECONDS),first=sectionAt(session.anchor.time,duration);
  for(let i=first;i<total;i++)if(!session.parts[i])return i;
  for(let i=first-1;i>=0;i--)if(!session.parts[i])return i;
  return null;
}

export function matchProgress(session,duration) {
  const parts=Object.values(session?.parts||{});
  return parts.reduce((summary,part)=>{
    const range=sectionRange(part.index,duration);
    return {count:summary.count+1,seconds:summary.seconds+range.end-range.start,
      matched:summary.matched+part.matched,total:summary.total+part.total};
  },{count:0,seconds:0,matched:0,total:0});
}

export async function matchKey(file) {
  const block=32768;
  const offsets=[0,Math.max(0,Math.floor(file.size/2)-block),Math.max(0,file.size-block)];
  const samples=await Promise.all(offsets.map(start=>file.slice(start,start+block).arrayBuffer()));
  const digest=await crypto.subtle.digest('SHA-256',await new Blob([String(file.size),...samples]).arrayBuffer());
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

let database;
function openDatabase() {
  database ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('football-ai-pro-match-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Match storage is busy in another tab.'));
  }).catch(error=>{database=null;throw error;});
  return database;
}

async function transact(mode,operate) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(STORE,mode);
    const result=operate(transaction.objectStore(STORE));
    transaction.oncomplete=()=>resolve(result?.result);
    transaction.onabort=()=>reject(transaction.error||new Error('Match storage was interrupted.'));
    transaction.onerror=()=>reject(transaction.error||new Error('Match storage could not be written.'));
  });
}

const sectionKey=(key,session,index)=>`${key}:${session.id}:${index}`;
export const readMatch=key=>transact('readonly',store=>store.get(key));
export const readSection=(key,session,index)=>transact('readonly',store=>store.get(sectionKey(key,session,index)));

export const startMatch=(key,session,previous)=>transact('readwrite',store=>{
  store.put(session,key);
  if(previous)for(const part of Object.values(previous.parts))store.delete(sectionKey(key,previous,part.index));
});

export const saveSection=(key,session,index,record)=>transact('readwrite',store=>{
  const read=store.get(key);
  read.onsuccess=()=>{
    const saved=read.result;
    if(saved?.id!==session.id){store.transaction.abort();return;}
    store.put(record,sectionKey(key,session,index));
    store.put({...session,parts:{...saved.parts,...session.parts}},key);
  };
});

export async function scanSections({session,duration,index,all=false,anchorOverride,signal,load,scan,save,onSection}) {
  const original=sectionAt(session.anchor.time,duration);
  let current=session,part=index;
  while(part!==null) {
    signal.throwIfAborted();
    const {start,end}=sectionRange(part,duration);
    const backward=part<original;
    const neighborIndex=backward?part+1:part-1;
    const adjacent=current.parts[neighborIndex]?await load(current,neighborIndex):null;
    const otherDirection=backward&&!adjacent?.backwardMemory&&adjacent?.forwardMemory;
    const memory=otherDirection?{...otherDirection,missing:Math.max(7,otherDirection.missing)}:
      backward?adjacent?.backwardMemory:adjacent?.forwardMemory;
    const selection=anchorOverride||(part===original?current.anchor:null);
    if(!selection&&!memory)throw new Error('Select yourself in this section to continue the review.');
    const time=backward?Math.max(start,end-.125):start;
    const sourceAnchor=selection||{...memory.last.center,time};
    const result=await scan({index:part,start,end,anchor:sourceAnchor,memory:selection?null:memory});
    signal.throwIfAborted();
    const matched=result.frames.filter(frame=>frame.points).length;
    const summary={index:part,matched,total:result.frames.length};
    const next={...current,parts:{...current.parts,[part]:summary}};
    await save(next,part,result);
    current=next;
    onSection(current,part,result);
    part=all?nextSection(current,duration):null;
    anchorOverride=null;
  }
  return current;
}
