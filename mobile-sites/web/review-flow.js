export function sampleAt(frames,time) {
  if(!frames?.length||!Number.isFinite(time))return null;
  let a=0,b=frames.length;
  while(a<b) {
    const mid=(a+b)>>>1;
    if(frames[mid].time<time)a=mid+1;
    else b=mid;
  }
  const before=frames[a-1],after=frames[a];
  const item=!before?after:!after||time-before.time<=after.time-time?before:after;
  return item&&Math.abs(item.time-time)<.13?item:null;
}

export function reconnectTrack(previous,next,from) {
  if(!previous)return next;
  const collect=(key)=>[...(previous[key]||[]).filter(item=>item.time<from-.001),...(next[key]||[])];
  const frames=collect('frames');
  const restart=frames.find(frame=>frame.time>=from-.001&&frame.points);
  if(restart)restart.state='reacquired';
  return {...next,frames,cues:collect('cues'),ballSamples:collect('ballSamples')};
}

const ballSkills=['kick','pass','cross','touch','dribble'];
const timeDistance=(a,b)=>Math.abs(a-b);
export function skillMoments(mode,{frames=[],ballSamples=[],eventSuggestions=[]}={}) {
  const options=[];
  const add=(time,label)=>{if(!options.some(item=>timeDistance(item.time,time)<.5))options.push({time,label});};
  if(ballSkills.includes(mode)) {
    const reversed=[...ballSamples].reverse();
    for(const candidate of eventSuggestions) {
      if((mode==='kick'&&candidate.kind==='shot')||((mode==='pass'||mode==='cross')&&candidate.kind==='pass')) {
        const before=reversed.find(sample=>sample.nearYou&&sample.time<=candidate.time&&candidate.time-sample.time<.55);
        if(before)add(before.time,'Ball release before a suggested '+candidate.kind);
      }
    }
    let prior=null;
    for(const sample of ballSamples) {
      if(prior&&sample.time-prior.time<.36) {
        if(mode==='touch'&&!prior.nearYou&&sample.nearYou&&prior.ball)add(sample.time,'Possible first touch');
        if(['kick','pass','cross'].includes(mode)&&prior.nearYou&&!sample.nearYou&&sample.ball&&prior.ball&&
          Math.hypot(sample.ball[0]-prior.ball[0],sample.ball[1]-prior.ball[1])>.025)
          add(prior.time,'Possible ball release');
      }
      prior=sample;
    }
  }
  const hip=item=>{
    const a=item?.points?.[23],b=item?.points?.[24];
    return a&&b&&(a.visibility??1)>=.55&&(b.visibility??1)>=.55?[(a.x+b.x)/2,(a.y+b.y)/2]:null;
  };
  if(['dribble','acceleration','braking','defending','landing'].includes(mode)) {
    for(let i=3;i<frames.length-3;i++) {
      const a=frames[i-3],b=frames[i],c=frames[i+3];
      if(c.time-a.time>.8||b.time<=a.time||c.time<=b.time)continue;
      const x=hip(a),y=hip(b),z=hip(c);
      if(!x||!y||!z)continue;
      const u=[y[0]-x[0],y[1]-x[1]],v=[z[0]-y[0],z[1]-y[1]];
      const first=Math.hypot(...u),second=Math.hypot(...v);
      if(mode==='dribble'&&Math.min(first,second)>.025&&u[0]*v[0]+u[1]*v[1]<=0)
        add(b.time,'Possible change of direction');
      if(mode==='acceleration'&&second>.04&&second>first*1.9)add(b.time,'Possible acceleration');
      if(['braking','defending'].includes(mode)&&first>.04&&first>second*1.9)add(b.time,'Possible deceleration');
      if(mode==='landing'&&u[1]>.025&&Math.abs(v[1])<u[1]*.40)add(b.time,'Possible landing');
    }
  }
  return options.filter(item=>sampleAt(frames,item.time)?.points&&item.time>=frames[0].time+.16&&
    item.time<=frames.at(-1).time-.16).slice(0,16);
}
