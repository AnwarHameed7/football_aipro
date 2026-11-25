import {calibratePitch,drawPitchMap} from './match.js';
import {scanTeams,TEAM_COLORS,correctTeam,teamShape,teamTimeline} from './team.js';

export function teamWorkspace({video,sourceURL,hasVideo,pitchPoints,selectedRange,attackDirection,seek,armPick,repaint,download}) {
  const $=id=>document.getElementById(id);
  let anchors={},picking=null,frames=[],job=null,fixtureGeneration=0,frameShown=null,selectedTrack=null;
  let scannedPitch=null;
  const text=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  const node=(tag,value)=>{const item=document.createElement(tag);item.textContent=value;return item;};
  const button=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=fn;return b;};
  const color=player=>TEAM_COLORS[player.team]||'#eac983';
  const direction=team=>team==='A'?attackDirection():attackDirection()==='left'?'right':'left';
  function samePitch(a,b) {return JSON.stringify(a)===JSON.stringify(b);}
  function at(time) {
    if(!frames.length)return null;
    const frame=frames[Math.round((time-frames[0].time)*3)];
    return frame&&Math.abs(frame.time-time)<.205?frame:null;
  }
  function draw(frame) {
    const map=$('squadMap'),ctx=map.getContext('2d'),w=map.width,h=map.height;
    drawPitchMap(map,null,[]);
    if(!frame) return;
    for(const p of frame.players) {
      const x=24+(w-48)*p.field[0],y=24+(h-48)*p.field[1];
      ctx.save();
      ctx.beginPath();ctx.arc(x,y,p.id===selectedTrack?12:9,0,Math.PI*2);
      ctx.fillStyle=ctx.strokeStyle=color(p);
      if(p.estimated) {ctx.setLineDash([3,3]);ctx.stroke();}
      else ctx.fill();
      if(p.id) {
        ctx.fillStyle=p.estimated?color(p):'#10191a';
        ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(String(p.id),x,y);
      }
      ctx.restore();
    }
  }
  function showFrame(force=false) {
    const frame=at(video.currentTime);
    if(!force&&frame===frameShown)return;
    frameShown=frame;
    draw(frame);
    const list=$('squadMetrics');list.replaceChildren();
    text('squadTimestamp',frame?`${frame.time.toFixed(2)} s · ${frame.players.filter(p=>!p.estimated).length} detected people`:
      frames.length?'Outside the analyzed interval. Use the team timeline.':'Analyze a clip to see the pitch positions.');
    if(!frame)return;
    for(const team of ['A','B']) {
      const shape=teamShape(frame.players,team,direction(team)),item=node('li','');
      const count=frame.players.filter(p=>p.team===team&&!p.estimated).length;
      item.append(node('strong',`Team ${team} · ${count} visible`),
        node('p',shape?`Width ${shape.width}% of pitch · Depth ${shape.depth}% · Average position ${shape.center}% toward the attacking end.`:
          'At least four classified players are needed for shape estimates.'));
      if(shape)item.append(node('p',`Far / middle / near channels: ${shape.channels.join(' / ')}.`));
      if(shape?.pressureGap!==null&&shape?.pressureGap!==undefined)
        item.append(node('p',`Median distance to the closest visible opponent: ${shape.pressureGap}% of pitch length.`));
      list.append(item);
    }
    const unknown=frame.players.filter(p=>!p.team&&!p.estimated).length;
    const estimates=frame.players.filter(p=>p.estimated).length;
    if(estimates)list.append(node('li',`${estimates} dashed position estimate(s) while briefly hidden. Shape stats use detections only.`));
    if(unknown)list.append(node('li',`${unknown} player(s) with unclear kits. Use Correct player team to label their numbered tracks.`));
    $('squadTime').value=frame.time;
  }
  function renderMoments() {
    const list=$('squadMoments');list.replaceChildren();
    const moments=teamTimeline(frames,attackDirection());
    if(frames.length&&!moments.length)
      list.append(node('li','There were too few frames with four or more classified players on a team.'));
    for(const moment of moments) {
      const item=node('li','');
      item.append(node('strong',`${moment.time.toFixed(2)} s · Team ${moment.team} · ${moment.title}`),
        node('p',moment.detail),button('Watch moment',()=>{video.pause();seek(moment.time);showFrame(true);repaint();}));
      list.append(item);
    }
  }
  function sync(clearCalibrationChange=true) {
    const points=pitchPoints(),project=calibratePitch(points);
    if(clearCalibrationChange&&job&&!samePitch(scannedPitch,points)) job.abort();
    if(clearCalibrationChange&&frames.length&&!samePitch(scannedPitch,points)) {
      frames=[];frameShown=null;scannedPitch=null;selectedTrack=null;picking=null;
      text('squadHelp','Pitch calibration changed. Analyze again using the new corners.');
    }
    $('squadPitch').disabled=!hasVideo();
    for(const team of ['A','B']) {
      const mark=$('squad'+team);
      mark.disabled=!hasVideo()||!!job;
      mark.setAttribute('aria-pressed',String(picking===team));
      const count=anchors[team]?.length||0;
      mark.disabled ||= count>=3 && picking!==team;
      mark.textContent=picking===team?'Cancel shirt selection':count?`Team ${team} sampled (${count}/3) · add kit`:`Sample Team ${team} shirt`;
    }
    $('squadRun').disabled=!(project&&anchors.A&&anchors.B&&hasVideo())||!!job;
    $('squadStop').hidden=!job;
    $('squadCorrect').disabled=!frames.length||!!job;
    $('squadCorrect').setAttribute('aria-pressed',String(picking==='correct'));
    $('squadCorrect').textContent=picking==='correct'?'Cancel team correction':'Correct player team';
    $('squadResetKits').disabled=!(anchors.A||anchors.B)||!!job;
    $('squadCorrection').hidden=selectedTrack===null;
    $('squadCsv').disabled=!frames.length;
    const timeline=$('squadTime');
    timeline.disabled=!frames.length;
    if(frames.length) {timeline.min=frames[0].time;timeline.max=frames.at(-1).time;}
    showFrame(true);renderMoments();
  }

  function cancelPick() {picking=null;selectedTrack=null;sync();}
  for(const team of ['A','B']) $('squad'+team).onclick=()=>{
    if(!hasVideo()||job)return;
    const wasActive=picking===team;
    selectedTrack=null;
    armPick();
    picking=wasActive?null:team;
    if(picking) {
      video.pause();
      text('squadHelp',`Tap the middle of a clear Team ${team} shirt in the video.`);
      $('videoStatus').textContent=`Tap a Team ${team} shirt.`;
      $('footage').scrollIntoView({block:'start'});
    }
    sync();repaint();
  };
  function select(x,y) {
    if(!picking)return false;
    if(picking==='correct') {
      const frame=at(video.currentTime);
      const hits=frame?.players.filter(p=>!p.estimated&&p.id&&
        x>=p.box[0]&&x<=p.box[0]+p.box[2]&&y>=p.box[1]&&y<=p.box[1]+p.box[3])
        .sort((a,b)=>boxDistance(a,x,y)-boxDistance(b,x,y))||[];
      if(hits.length===1 || hits.length>1&&boxDistance(hits[1],x,y)-boxDistance(hits[0],x,y)>.02)
        selectTrack(hits[0]);
      else $('videoStatus').textContent='Tap a clear player box or select a numbered dot on the team pitch.';
      return true;
    }
    if(frames.length&&!confirm('Replace the current team analysis with a new shirt sample?')) {
      cancelPick();repaint();return true;
    }
    (anchors[picking] ||= []).push({x,y,time:video.currentTime});
    picking=null;frames=[];scannedPitch=null;
    text('squadHelp',anchors.A&&anchors.B?'Both shirts are marked. Set the clip interval, then analyze both teams.':
      'Shirt marked. Sample a player from the other team.');
    $('videoStatus').textContent='Team shirt selection marked.';
    sync();repaint();return true;
  }
  $('squadPitch').onclick=()=>$('startPitch').click();
  $('squadStop').onclick=()=>job?.abort();
  $('squadRun').onclick=async()=>{
    const points=pitchPoints(),project=calibratePitch(points);
    if(!project||!anchors.A||!anchors.B||job)return;
    const generation=fixtureGeneration, controller=new AbortController();
    const range=selectedRange(),start=range?.start??video.currentTime,end=range?.end??video.duration;
    const source=sourceURL();
    video.pause();job=controller;scannedPitch=points.map(p=>[...p]);frameShown=null;frames=[];
    $('squadProgress').hidden=false;$('squadProgress').removeAttribute('value');
    text('squadHelp','Loading the player detector…');sync();
    try {
      const result=await scanTeams({url:source,anchors,project,start,end,wide:$('squadWide').checked,signal:job.signal,
        progress:value=>{
          $('squadProgress').value=Math.max(0,Math.min(1,value));
          text('squadHelp',`Analyzing both teams · ${Math.round(value*100)}%`);
        }});
      if(generation!==fixtureGeneration||controller.signal.aborted)return;
      frames=result;
      const nonEmpty=frames.filter(frame=>frame.players.some(player=>player.team&&!player.estimated)).length;
      text('squadHelp',nonEmpty?`${nonEmpty}/${frames.length} sampled frames contained classified players. Correct kits from the video or pitch map.`:
        'No kits could be classified confidently. Add clearer shirt samples or assign a team to a numbered track.');
      if(frames.length)seek(frames[0].time);
      repaint();
    } catch(error) {
      if(generation===fixtureGeneration)text('squadHelp',controller.signal.aborted?'Team scan cancelled.':error.message);
    } finally {
      job=null;$('squadProgress').hidden=true;sync();
    }
  };

  $('squadTime').oninput=()=>{
    video.pause();seek($('squadTime').valueAsNumber);showFrame(true);repaint();
  };
  $('squadOverlay').onchange=repaint;
  $('squadCsv').onclick=()=>{
    const rows=[['time_s','team','visible_players','width_percent','depth_percent','average_progress_percent','largest_length_gap_percent','median_opponent_gap_percent','far_channel','middle_channel','near_channel']];
    for(const frame of frames)for(const team of ['A','B']) {
      const shape=teamShape(frame.players,team,direction(team));
      const count=frame.players.filter(player=>player.team===team&&!player.estimated).length;
      rows.push([frame.time.toFixed(3),team,count,shape?.width??'',shape?.depth??'',shape?.center??'',
        shape?.gap??'',shape?.pressureGap??'',...(shape?.channels||['','',''])]);
    }
    download(new Blob([rows.map(row=>row.join(',')).join('\r\n')],{type:'text/csv'}),'football-team-shape.csv');
  };
  function overlay(ctx,rect) {
    const frame=at(video.currentTime);
    if(frame&&$('squadOverlay').checked) {
      ctx.save();ctx.font='bold 11px system-ui';ctx.lineWidth=1.5;
      for(const p of frame.players) {
        const [x,y,w,h]=p.box;
        ctx.strokeStyle=ctx.fillStyle=color(p);
        ctx.lineWidth=p.id===selectedTrack?3:1.5;
        ctx.setLineDash(p.estimated?[4,3]:[]);
        ctx.strokeRect(rect.x+x*rect.w,rect.y+y*rect.h,w*rect.w,h*rect.h);
        if(p.id)ctx.fillText((p.team||'?')+p.id,rect.x+x*rect.w,Math.max(rect.y+11,rect.y+y*rect.h-3));
      }
      ctx.restore();
    }
    const anchor=Object.values(anchors).flat().find(item=>Math.abs(item.time-video.currentTime)<.075);
    if(anchor&&!frame) {
      ctx.save();ctx.strokeStyle='#f8d074';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(rect.x+anchor.x*rect.w,rect.y+anchor.y*rect.h,12,0,Math.PI*2);ctx.stroke();
      ctx.restore();
    }
    showFrame();
  }
  function restore(data) {
    fixtureGeneration++;job?.abort();picking=null;selectedTrack=null;
    const position=point=>Array.isArray(point)&&point.length===2&&point.every(value=>Number.isFinite(value)&&value>=0&&value<=1);
    anchors={};
    for(const team of ['A','B']) {
      const loaded=data?.anchors?.[team];
      const samples=(Array.isArray(loaded)?loaded:[loaded]).filter(p=>p&&position([p.x,p.y])&&
        Number.isFinite(p.time)&&p.time>=0&&p.time<=video.duration).slice(0,3);
      if(samples.length)anchors[team]=samples;
    }
    scannedPitch=calibratePitch(data?.pitch)?data.pitch:null;
    frames=Array.isArray(data?.frames)&&scannedPitch?data.frames.slice(0,271).filter(frame=>
      frame&&Number.isFinite(frame.time)&&frame.time>=0&&frame.time<=video.duration&&Array.isArray(frame.players))
      .map(frame=>({time:frame.time,players:frame.players.slice(0,70).filter(p=>p&&position(p.field)&&
        ['A','B',null].includes(p.team)&&Array.isArray(p.box)&&p.box.length===4&&
        p.box.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&(!p.team||Number.isInteger(p.id)))})):[];
    sync();
  }
  function reset() {
    fixtureGeneration++;job?.abort();anchors={};picking=null;selectedTrack=null;frames=[];scannedPitch=null;frameShown=null;
    text('squadHelp','Mark the four pitch corners and sample one shirt from each team.');sync();
  }
  function boxDistance(player,x,y) {
    const box=player.box;
    return Math.hypot((box[0]+box[2]/2-x)/Math.max(.01,box[2]),(box[1]+box[3]*.4-y)/Math.max(.01,box[3]));
  }
  function selectTrack(player) {
    selectedTrack=player.id;
    picking=null;
    text('squadSelected',`Track ${player.id} · ${player.team?'Team '+player.team:'Team unknown'}`);
    $('videoStatus').textContent=`Track ${player.id} selected. Choose its team in Teams.`;
    $('squadPanel').scrollIntoView({block:'start'});
    sync();repaint();
  }
  $('squadCorrect').onclick=()=>{
    if(!frames.length||job)return;
    const wasActive=picking==='correct';
    armPick();
    selectedTrack=null;
    picking=wasActive?null:'correct';
    if(picking) {
      video.pause();
      if(!at(video.currentTime))seek(frames[0].time);
      text('squadHelp','Tap a player box in the video or a numbered dot on the team pitch.');
      $('videoStatus').textContent='Tap the player whose team you want to correct.';
    }
    sync();repaint();
  };
  $('squadMap').onclick=event=>{
    if(picking!=='correct')return;
    const map=$('squadMap'),rect=map.getBoundingClientRect();
    const px=(event.clientX-rect.left)*map.width/rect.width,py=(event.clientY-rect.top)*map.height/rect.height;
    const hits=at(video.currentTime)?.players.filter(p=>!p.estimated&&p.id).map(p=>({p,d:
      Math.hypot(24+(map.width-48)*p.field[0]-px,24+(map.height-48)*p.field[1]-py)}))
      .filter(item=>item.d<22).sort((a,b)=>a.d-b.d)||[];
    if(hits.length&&(!hits[1]||hits[1].d-hits[0].d>3))selectTrack(hits[0].p);
  };
  for(const [id,newTeam] of [['assignA','A'],['assignB','B'],['assignUnknown',null]]) $(id).onclick=()=>{
    if(selectedTrack===null)return;
    const changed=correctTeam(frames,selectedTrack,newTeam);
    if(changed)text('squadHelp',`Track ${selectedTrack} updated across the analyzed interval.`);
    selectedTrack=null;sync();repaint();
  };
  $('squadResetKits').onclick=()=>{
    if(!confirm('Clear both teams’ shirt samples and team analysis?'))return;
    anchors={};picking=null;selectedTrack=null;frames=[];scannedPitch=null;
    sync();repaint();
  };
  sync();
  return {sync,cancelPick,select,overlay,restore,reset,isPicking:()=>!!picking,hasWork:()=>!!(frames.length||anchors.A||anchors.B),
    snapshot:()=>({anchors,frames,pitch:scannedPitch})};
}
