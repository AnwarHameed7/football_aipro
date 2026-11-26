export const exercises={
  squat:{title:'Squat',view:'Side view. Keep shoulders, hips, knees and ankles in frame.',low:118,high:155},
  hinge:{title:'Hip hinge',view:'Side view. Keep shoulders, hips and knees in frame.',low:136,high:157},
  lunge:{title:'Lunge',view:'Side view. Keep both legs and feet in frame.',low:115,high:153},
  pushup:{title:'Full push-up',view:'Low side view. Keep your hands, shoulders, hips and ankles in frame.',low:112,high:153},
  plank:{title:'High plank',view:'Low side view. Keep shoulders, hips and ankles in frame.'},
  running:{title:'Upright running drill',view:'Use a fixed side view. Keep your shoulders and hips visible throughout the drill.'},
  free:{title:'Free movement',view:'Keep the joints you want to review in frame.'},
};
const sides=[[11,13,15,23,25,27],[12,14,16,24,26,28]];
const visibility=p=>p&&(p.visibility??1)>=.57&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&
  p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1;
const magnitude=(a,b,aspect)=>Math.hypot((a.x-b.x)*aspect,a.y-b.y);
const lineAngle=(a,b,aspect)=>Math.atan2(Math.abs(a.y-b.y),Math.abs(a.x-b.x)*aspect)*180/Math.PI;

function angle(a,b,c,aspect) {
  if(![a,b,c].every(visibility))return null;
  const u=[(a.x-b.x)*aspect,a.y-b.y],v=[(c.x-b.x)*aspect,c.y-b.y];
  const norm=Math.hypot(...u)*Math.hypot(...v);
  if(norm<.00025)return null;
  return Math.round(Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/norm)))*180/Math.PI);
}

export function workoutMeasurement(points,mode,aspect,preferredSide) {
  if(!points||!Number.isFinite(aspect)||aspect<=0)return null;
  const candidates=sides.map((jointIds,side)=>{
    const [shoulder,elbow,wrist,hip,knee,ankle]=jointIds.map(index=>points[index]);
    const kneeAngle=angle(hip,knee,ankle,aspect),hipAngle=angle(shoulder,hip,knee,aspect);
    const elbowAngle=angle(shoulder,elbow,wrist,aspect),bodyLine=angle(shoulder,hip,ankle,aspect);
    const floor=visibility(shoulder)&&visibility(ankle)&&lineAngle(shoulder,ankle,aspect)<=48;
    const torso=visibility(shoulder)&&visibility(hip)?magnitude(shoulder,hip,aspect):0;
    const lean=torso>.05?Math.round(90-lineAngle(shoulder,hip,aspect)):null;
    const metric={squat:kneeAngle,lunge:kneeAngle,hinge:hipAngle,pushup:floor?elbowAngle:null,
      plank:floor?bodyLine:null,running:lean,free:kneeAngle??elbowAngle??hipAngle}[mode];
    const required=mode==='hinge'?[shoulder,hip,knee]:mode==='squat'||mode==='lunge'?[hip,knee,ankle]:
      mode==='pushup'?[shoulder,elbow,wrist,hip,ankle]:mode==='plank'?[shoulder,hip,ankle]:mode==='running'?[shoulder,hip]:[];
    if(metric===null||metric===undefined||!required.every(visibility))return null;
    const quality=required.reduce((sum,p)=>sum+(p.visibility??1),0)/Math.max(1,required.length);
    return {side,metric,kneeAngle,hipAngle,elbowAngle,bodyLine,lean,quality};
  });
  if(mode==='lunge') {
    if(candidates.some(candidate=>!candidate))return null;
    const [first,second]=candidates.sort((a,b)=>a.metric-b.metric);
    return {...first,metric:Math.min(first.metric,second.metric)};
  }
  return candidates[preferredSide]||candidates.filter(Boolean).sort((a,b)=>b.quality-a.quality)[0]||null;
}

const cues={
  haste:'Slow the lowering phase. Try one controlled second down.',
  hinge:'Your knees bent substantially during the hinge. Try sending your hips back with a softer knee bend.',
  body:'Your hips drifted away from the shoulder-to-ankle line. Bring them back toward that line.',
  running:'Your torso stayed noticeably tilted in this camera view. If this is an upright drill, try a taller posture at the same pace.',
  repeat:'This rep used a different range from earlier reps. Compare the bottom positions and use a comfortable range you can repeat.',
};

export class WorkoutCoach {
  constructor(mode) {
    this.mode=mode;
    this.phase='setup';this.side=undefined;this.reps=0;this.hold=0;this.good=0;this.samples=0;
    this.last=null;this.lowest=null;this.lowTime=null;this.descended=null;
    this.depths=[];this.aligned=false;this.notes=new Map();this.streak=0;this.flag='';
  }

  flagCue(flag) {
    if(flag===this.flag)this.streak++;else {this.flag=flag;this.streak=flag?1:0;}
    if(flag&&this.streak===3)this.notes.set(flag,(this.notes.get(flag)||0)+1);
    return flag&&this.streak>=3?cues[flag]:'';
  }

  gap() {
    this.last=null;this.phase='setup';this.side=undefined;this.lowest=this.lowTime=this.descended=null;
    this.streak=0;this.flag='';this.aligned=false;
  }

  read(points,aspect,time) {
    this.samples++;
    const value=workoutMeasurement(points,this.mode,aspect,this.side);
    if(!value) {this.gap();return null;}
    this.good++;
    const prior=this.last,delta=prior===null?0:time-prior;
    if(delta<0||delta>.7||(this.mode!=='lunge'&&this.side!==undefined&&this.side!==value.side))this.gap();
    this.side=value.side;
    this.last=time;
    let flag='',cue='';
    if((this.mode==='plank'||this.mode==='pushup')&&value.bodyLine!==null&&value.bodyLine<152)flag='body';
    if(this.mode==='running'&&value.lean>=28)flag='running';
    if(this.mode==='hinge'&&value.kneeAngle!==null&&value.kneeAngle<114&&value.hipAngle>112)flag='hinge';
    if(this.mode==='plank') {
      const aligned=value.bodyLine>=160;
      if(delta>0&&delta<=.7&&aligned&&this.aligned)this.hold+=delta;
      this.aligned=aligned;
    } else if(Object.hasOwn(exercises[this.mode],'low')) {
      const {low,high}=exercises[this.mode];
      const atTop=value.metric>=high;
      if(this.phase==='setup'&&atTop){this.phase='ready';this.lowest=null;}
      if(this.phase==='ready'&&!atTop&&value.metric<=high-8) {
        this.phase='lowering';this.descended=time;this.lowest=value.metric;
      }
      if(this.phase==='lowering') {
        this.lowest=Math.min(this.lowest,value.metric);
        if(value.metric<=low) {this.phase='bottom';this.lowTime=time;}
        else if(atTop)this.phase='ready';
      }
      if(this.phase==='bottom') {
        this.lowest=Math.min(this.lowest,value.metric);
        if(atTop&&time-this.descended>=.45) {
          this.reps++;
          const earlier=this.depths.slice(-5);
          const difference=earlier.length>=3&&Math.abs(this.lowest-earlier.reduce((sum,v)=>sum+v,0)/earlier.length)>=18;
          this.depths.push(this.lowest);
          cue=this.lowTime-this.descended<.5?cues.haste:difference?cues.repeat:'';
          if(cue) {
            const key=cue===cues.haste?'haste':'repeat';
            this.notes.set(key,(this.notes.get(key)||0)+1);
          }
          this.phase='ready';this.lowest=null;
        } else if(atTop)this.phase='ready';
      }
    }
    return {value,cue:this.flagCue(flag)||cue,reps:this.reps,hold:Math.floor(this.hold),phase:this.phase};
  }

  summary() {
    return {reps:this.reps,hold:Math.floor(this.hold),
      bottomRange:this.depths.length?[Math.min(...this.depths),Math.max(...this.depths)]:null,coverage:this.samples?Math.round(100*this.good/this.samples):0,
      notes:[...this.notes].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([key,count])=>({cue:cues[key],count}))};
  }
}
