/** Project video points into a user-marked pitch and aggregate reviewed events. */
const pitchCorners=[[0,0],[1,0],[1,1],[0,1]];
export const eventKinds=Object.freeze({
  pass:{label:'Pass',results:['Completed','Incomplete','Unclear']},
  shot:{label:'Shot',results:['Goal','On target','Off target','Blocked','Unclear']},
  touch:{label:'First touch',results:['Controlled','Lost','Unclear']},
  dribble:{label:'Dribble',results:['Retained','Lost','Unclear']},
  duel:{label:'Defensive duel',results:['Won','Lost','Unclear']},
  offball:{label:'Off-ball run',results:['Opened a lane','No clear lane','Unclear']},
});

export function calibratePitch(points) {
  if (!Array.isArray(points)||points.length!==4||!points.every(point=>
      Array.isArray(point)&&point.length===2&&point.every(value=>Number.isFinite(value)&&value>=0&&value<=1))) return null;
  const winding=points.map(([x,y],i)=>{
    const [a,b]=points[(i+1)%4],[c,d]=points[(i+2)%4];
    return (a-x)*(d-b)-(b-y)*(c-a);
  });
  if(!winding.every(value=>value>.001)&&!winding.every(value=>value<-.001)) return null;
  const rows=[];
  points.forEach(([x,y],i)=>{
    const [u,v]=pitchCorners[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);
  });
  for(let column=0;column<8;column++) {
    let pivot=column;
    for(let row=column+1;row<8;row++) if(Math.abs(rows[row][column])>Math.abs(rows[pivot][column])) pivot=row;
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const scale=rows[column][column];
    if(Math.abs(scale)<1e-8) return null;
    rows[column]=rows[column].map(value=>value/scale);
    for(let row=0;row<8;row++) {
      if(row===column) continue;
      const factor=rows[row][column];
      rows[row]=rows[row].map((value,i)=>value-factor*rows[column][i]);
    }
  }
  const h=rows.map(row=>row[8]);
  return ([x,y])=>{
    const scale=h[6]*x+h[7]*y+1;
    if(Math.abs(scale)<1e-8) return null;
    const u=(h[0]*x+h[1]*y+h[2])/scale,v=(h[3]*x+h[4]*y+h[5])/scale;
    if(u<-.002||v<-.002||u>1.002||v>1.002) return null;
    return [Math.max(0,Math.min(1,u)),Math.max(0,Math.min(1,v))];
  };
}

export function eventTotals(events) {
  return Object.entries(eventKinds).flatMap(([kind,{label,results}])=>{
    const outcomes=events.filter(event=>event.kind===kind&&results.includes(event.outcome));
    if(!outcomes.length) return [];
    const known=outcomes.filter(event=>event.outcome!=='Unclear');
    const success=known.filter(event=>event.outcome===results[0]||(kind==='shot'&&event.outcome==='On target')).length;
    return [{kind,label,success,known:known.length,unclear:outcomes.length-known.length}];
  });
}

export function footLocations(frames) {
  return frames.flatMap(({points})=>{
    if(!points) return [];
    // The lower visible ankle approximates the ground point in this camera view.
    const feet=[points[27],points[28]].filter(point=>point&&(point.visibility??1)>=.65);
    const foot=feet.reduce((base,point)=>!base||point.y>base.y?point:base,null);
    return foot&&[foot.x,foot.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1)?[[foot.x,foot.y]]:[];
  });
}

export function drawPitchMap(canvas, project, samples) {
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pad=24;
  const width=w-2*pad,height=h-2*pad;
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#0e251c';ctx.fillRect(0,0,w,h);
  for(let i=0;i<10;i+=2) {ctx.fillStyle='#163528';ctx.fillRect(pad+width*i/10,pad,width/10,height);}
  ctx.strokeStyle='#9db9a8';ctx.lineWidth=1.4;
  ctx.strokeRect(pad,pad,width,height);ctx.strokeRect(pad,pad+height*.25,width*.16,height*.5);
  ctx.strokeRect(pad+width*.84,pad+height*.25,width*.16,height*.5);
  ctx.beginPath();ctx.moveTo(w/2,pad);ctx.lineTo(w/2,h-pad);ctx.stroke();
  ctx.beginPath();ctx.arc(w/2,h/2,height*.14,0,2*Math.PI);ctx.stroke();
  if(!project) return 0;
  const cells=new Map();
  let mapped=0;
  for(const sample of samples) {
    const pos=project(sample);
    if(!pos) continue;
    mapped++;
    const x=Math.min(31,Math.floor(pos[0]*32)),y=Math.min(19,Math.floor(pos[1]*20)),key=y*32+x;
    cells.set(key,(cells.get(key)||0)+1);
  }
  const peak=Math.max(1,...cells.values());
  for(const [key,value] of cells) {
    const x=pad+(key%32+.5)*width/32,y=pad+(Math.floor(key/32)+.5)*height/20,r=18;
    const strength=Math.sqrt(value/peak),gradient=ctx.createRadialGradient(x,y,0,x,y,r);
    gradient.addColorStop(0,`rgba(255,${Math.round(230-80*strength)},96,${.28+.56*strength})`);
    gradient.addColorStop(1,'rgba(210,194,96,0)');
    ctx.fillStyle=gradient;ctx.fillRect(x-r,y-r,r*2,r*2);
  }
  return mapped;
}

export function goalArea(points) {
  if(!Array.isArray(points)||points.length!==2||!points.every(point=>Array.isArray(point)&&point.length===2&&
      point.every(value=>Number.isFinite(value)&&value>=0&&value<=1))) return null;
  const [[a,b],[c,d]]=points;
  if(Math.abs(a-c)<.018||Math.abs(b-d)<.018) return null;
  return {left:Math.min(a,c),right:Math.max(a,c),top:Math.min(b,d),bottom:Math.max(b,d)};
}

export function suggestBallEvents(samples,goalPoints) {
  const goal=goalArea(goalPoints), findings=[];
  let near=0, nearStrong=0, departure=null, receiver=null, goalHits=0, insideStrong=0, missing=0;
  const reset=()=>{near=0;nearStrong=0;departure=null;receiver=null;goalHits=0;insideStrong=0;missing=0;};
  let previous=-Infinity;
  for(const sample of samples) {
    if(sample.time-previous>.35)reset();
    previous=sample.time;
    if(departure&&sample.time-departure.time>2)reset();
    if(!sample.ball) {
      near=nearStrong=0;receiver=null;goalHits=insideStrong=0;
      if(departure)departure.clean=false;
      if(++missing>=2)reset();
      continue;
    }
    missing=0;
    const strong=(sample.score||0)>=.62;
    if(sample.nearYou) {
      near++;nearStrong=strong?nearStrong+1:0;
      departure=null;receiver=null;goalHits=insideStrong=0;
      continue;
    }
    if(near>=2)departure={time:sample.time,ball:sample.ball,strong:nearStrong>=2&&strong,clean:true};
    near=nearStrong=0;
    if(!departure)continue;
    const travel=Math.hypot(sample.ball[0]-departure.ball[0],sample.ball[1]-departure.ball[1]);
    const [x,y]=sample.ball;
    const inGoal=goal&&x>=goal.left&&x<=goal.right&&y>=goal.top&&y<=goal.bottom;
    const outsideAtStart=goal&&(departure.ball[0]<goal.left||departure.ball[0]>goal.right||
      departure.ball[1]<goal.top||departure.ball[1]>goal.bottom);
    goalHits=inGoal&&outsideAtStart&&travel>.035?goalHits+1:0;
    insideStrong=goalHits&&strong?insideStrong+1:0;
    const next=sample.receiver;
    const consistent=next&&receiver&&next.team===receiver.team&&Math.hypot(next.x-receiver.x,next.y-receiver.y)<.075;
    receiver=next&&travel>=.05?{...next,count:consistent?receiver.count+1:1,
      reliable:strong&&next.clear?(consistent?receiver.reliable+1:1):0}:null;
    if(goalHits>=3||(goalHits>=2&&(!departure.strong||sample.time-departure.time>=1.65))) {
      const automatic=departure.strong&&departure.clean&&insideStrong>=3;
      findings.push({kind:'shot',outcome:'On target',time:departure.time,automatic,
        note:automatic?'Strong ball track into the marked goal area. This is a camera-view estimate of what reached that area.':
          'The detected ball entered the marked goal area. Check its depth and the result on replay.'});
      reset();continue;
    }
    if(inGoal)continue;
    if(receiver&&(receiver.count>=3||(receiver.count>=2&&(!departure.strong||sample.time-departure.time>=1.65)))) {
      const automatic=departure.strong&&departure.clean&&receiver.team==='similar'&&receiver.reliable>=3&&travel>.065;
      findings.push({kind:'pass',outcome:receiver.team==='similar'?'Completed':'Unclear',time:departure.time,automatic,
        note:automatic?'The ball moved from you to a player with closely matching kit and stayed at their feet across three samples.':
          receiver.team==='similar'?'The ball moved toward a player with similar kit. Check team and control on replay.':
            'The ball moved from you to another player. Check the intended recipient and outcome on replay.'});
      reset();
    }
  }
  if(departure&&goalHits>=2)findings.push({kind:'shot',outcome:'On target',time:departure.time,automatic:false,
    note:'The clip ends with the ball in the marked goal area. Review the depth and outcome.'});
  else if(departure&&receiver?.count>=2)findings.push({kind:'pass',outcome:receiver.team==='similar'?'Completed':'Unclear',
    time:departure.time,automatic:false,note:'The clip ends before the receiver could be tracked for three samples.'});
  return findings;
}

export const estimateId=event=>`${event.kind}:${Math.round(event.time*10)}`;
export function unreviewedEstimates(suggestions,confirmed,dismissed) {
  return suggestions.filter(event=>event.automatic&&!dismissed.includes(estimateId(event))&&
    !confirmed.some(review=>review.kind===event.kind&&Math.abs(review.time-event.time)<=.7));
}
export function tacticalZones(samples, project, attack) {
  if(!project) return null;
  const counts={defensive:0,middle:0,attacking:0,left:0,centre:0,right:0};
  let usable=0;
  for(const sample of samples) {
    const mapped=project(sample);
    if(!mapped) continue;
    usable++;
    const longitudinal=attack==='left'?1-mapped[0]:mapped[0];
    const lateral=attack==='left'?mapped[1]:1-mapped[1];
    counts[longitudinal<1/3?'defensive':longitudinal<2/3?'middle':'attacking']++;
    counts[lateral<1/3?'left':lateral<2/3?'centre':'right']++;
  }
  return usable?{usable,counts}:null;
}

const tacticalCues={
  pass:'Pause before you receive and look for a second passing option. Compare where your hips face with the location of the intended receiver.',
  shot:'Replay the last touch before the shot. Check whether it opens a lane and gives you time to set your support foot.',
  touch:'Compare where your first touch ends with where the closest defender is. Try taking the ball toward the space available for your next action.',
  dribble:'Review the touch before the defender closes the gap. Check whether a pass, a change of pace, or protecting the ball was available.',
  duel:'Replay the approach. Check your distance, which direction you showed the attacker, and when you committed.',
  offball:'Pause before the pass. Compare the defender’s sight line with your starting position and the moment you move.',
};
export function tacticalPriorities(events) {
  return eventTotals(events).filter(total=>total.known>total.success)
    .sort((a,b)=>(b.known-b.success)-(a.known-a.success)||b.known-a.known).slice(0,3)
    .map(total=>{
      const best=eventKinds[total.kind].results[0];
      const moment=events.filter(item=>item.kind===total.kind&&item.outcome!=='Unclear'&&
        item.outcome!==best&&!(total.kind==='shot'&&item.outcome==='On target')).sort((a,b)=>a.time-b.time)[0];
      return {label:total.label,time:moment.time,unresolved:total.known-total.success,
        known:total.known,cue:tacticalCues[total.kind]};
    });
}
