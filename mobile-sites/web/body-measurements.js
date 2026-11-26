export const BODY_MEASUREMENTS_KEY='football-ai-pro-measurements-v1';

const properNumber=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max;
export function measuredEntry(input) {
  if(!input||typeof input.date!=='string'||!/^\d{4}-\d\d-\d\d$/.test(input.date)||
    !Number.isFinite(Date.parse(input.date))||new Date(input.date).toISOString().slice(0,10)!==input.date)return null;
  const method=typeof input.method==='string'?input.method.trim().slice(0,80):'';
  if(!method)return null;
  const entry={date:input.date,method};
  for(const [field,min,max] of [['weight',10,500],['fat',1,80],['muscle',1,250],['waist',20,300]]) {
    const value=input[field];
    if(value===undefined||value===null||value==='')continue;
    if(typeof value!=='number'&&typeof value!=='string')return null;
    const number=Number(value);
    if(!properNumber(number,min,max))return null;
    entry[field]=number;
  }
  if(!['weight','fat','muscle','waist'].some(field=>Object.hasOwn(entry,field)))return null;
  if(entry.weight!==undefined&&entry.muscle!==undefined&&entry.muscle>entry.weight)return null;
  return entry;
}

export function bodyMeasurementReview(entries,latest) {
  if(!latest)return {fatMass:null,leanMass:null,changes:[]};
  const fatMass=Number.isFinite(latest.weight)&&Number.isFinite(latest.fat)?latest.weight*latest.fat/100:null;
  const changes=[];
  const older=entries.filter(entry=>entry.date<latest.date&&entry.method.toLowerCase()===latest.method.toLowerCase())
    .sort((a,b)=>b.date.localeCompare(a.date));
  for(const field of ['weight','fat','muscle','waist']) {
    if(!Number.isFinite(latest[field]))continue;
    const prior=older.find(entry=>Number.isFinite(entry[field]));
    if(prior)changes.push({field,date:prior.date,difference:latest[field]-prior[field]});
  }
  return {fatMass,leanMass:fatMass===null?null:latest.weight-fatMass,changes};
}

// Relative Fat Mass (Woolcott and Bergman, 2018).
export function relativeFatMass({height,waist,reference,adult}) {
  if(adult!==true||!properNumber(height,100,250)||!properNumber(waist,40,200)||
    !['male','female'].includes(reference))return null;
  const estimate=64-20*(height/waist)+(reference==='female'?12:0);
  return estimate>=3&&estimate<=65?estimate:null;
}
