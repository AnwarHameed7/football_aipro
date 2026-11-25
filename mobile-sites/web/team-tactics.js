const pointGap=(a,b)=>Math.hypot(a[0]-b[0],.65*(a[1]-b[1]));

function ownerAt(frame) {
  if(!frame.ball?.field||!frame.ball?.center)return null;
  const [bx,by]=frame.ball.center;
  const options=frame.players.filter(p=>p.team&&p.id&&!p.estimated).flatMap(p=>{
    const [x,y,w,h]=p.box;
    const footGap=Math.hypot((bx-x-w/2)/Math.max(.012,w),(by-y-h)/Math.max(.025,h));
    const fieldGap=pointGap(frame.ball.field,p.field);
    return footGap<=.92&&fieldGap<=.045?[{player:p,score:footGap+fieldGap*8}]:[];
  }).sort((a,b)=>a.score-b.score);
  return options[0]&&(!options[1]||options[1].score-options[0].score>.24)?options[0].player:null;
}

export function ballControl(frames) {
  const seconds={A:0,B:0,unknown:0};
  const links=new Map(),events=[];
  let stable=null,trial=null,run=0,lastTime=null,committedTime=null,committedFrame=null;
  for(const frame of frames) {
    const dt=lastTime===null?0:Math.max(0,frame.time-lastTime);
    lastTime=frame.time;
    if(dt>.65) {stable=null;trial=null;run=0;committedTime=null;committedFrame=null;}
    const observed=ownerAt(frame);
    if(observed&&trial?.id===observed.id)run++;
    else {trial=observed;run=observed?1:0;}
    if(run>=2) {
      seconds[observed.team]+=Math.min(.4,dt);
      if(stable&&stable.id!==observed.id&&frame.time-committedTime<=1.65&&committedFrame) {
        const fromStillVisible=frame.players.some(p=>p.id===stable.id&&!p.estimated);
        const toAlreadyVisible=committedFrame.players.some(p=>p.id===observed.id&&!p.estimated);
        if(fromStillVisible&&toAlreadyVisible&&pointGap(stable.field,observed.field)>.045) {
          const same=stable.team===observed.team;
          const event={time:frame.time,from:stable.id,to:observed.id,team:stable.team,newTeam:observed.team,
            kind:same?'pass':'turnover',fromField:stable.field,toField:observed.field};
          events.push(event);
          if(same) {
            const key=[stable.team,stable.id,observed.id].join(':');
            const prior=links.get(key);
            links.set(key,{...event,count:(prior?.count||0)+1});
          }
        }
      }
      stable=observed;committedTime=frame.time;committedFrame=frame;
    } else seconds.unknown+=Math.min(.4,dt);
  }
  return {seconds,events,links:[...links.values()].sort((a,b)=>b.count-a.count)};
}

function observedLines(players,team,direction) {
  const list=players.filter(p=>p.team===team&&!p.estimated)
    .map(p=>direction==='left'?1-p.field[0]:p.field[0]).sort((a,b)=>a-b);
  if(list.length===11&&list[1]-list[0]>.11)list.shift();
  if(list.length!==10)return null;
  const breaks=[];
  for(let i=1;i<list.length;i++) {
    const gap=list[i]-list[i-1];
    if(gap>.055)breaks.push(i);
  }
  if(breaks.length<2||breaks.length>3)return null;
  return [...breaks,10].map((end,i)=>end-(breaks[i-1]||0)).join('–');
}

export function formationOverview(frames,attack) {
  return ['A','B'].map(team=>{
    const side=team==='A'?attack:attack==='left'?'right':'left';
    const counts=new Map();let eligible=0;
    for(const frame of frames) {
      const shape=observedLines(frame.players,team,side);
      if(!shape)continue;
      eligible++;counts.set(shape,(counts.get(shape)||0)+1);
    }
    const [shape,count]=[...counts].sort((a,b)=>b[1]-a[1])[0]||[];
    return {team,shape:count>=5&&count/eligible>=.65?shape:null,eligible,support:count||0};
  });
}
