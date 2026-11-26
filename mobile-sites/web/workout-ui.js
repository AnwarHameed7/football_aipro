import {exercises,WorkoutCoach} from './workout.js';
import {modelWithin,PoseEngineError,withPoseFallback} from './pose-engine.js';
import {skeleton} from './pose.js';
import {BODY_MEASUREMENTS_KEY,bodyMeasurementReview,measuredEntry} from './body-measurements.js';

const $=id=>document.getElementById(id);
function show(id,message) {
  const node=$(id);
  if(node.textContent!==message)node.textContent=message;
}
const release=stream=>stream?.getTracks().forEach(track=>track.stop());

export async function openWorkoutCamera(media,signal) {
  signal.throwIfAborted();
  if(!media?.getUserMedia)throw new Error('Camera access needs a supported browser over HTTPS.');
  return modelWithin(media.getUserMedia({audio:false,
    video:{facingMode:{ideal:'user'},width:{ideal:640},height:{ideal:480},frameRate:{ideal:24,max:30}}}),
    signal,45000,release);
}

export function setupWorkout({blocked,onChange}) {
  const video=$('workoutVideo'),canvas=$('workoutOutline'),mode=$('workoutExercise');
  const start=$('startWorkout'),stop=$('stopWorkout');
  let job=null,stream=null,coach=null,pendingSpeech=false;
  const historyKey='football-ai-pro-workout-history-v1';
  let history=[];
  try {
    const stored=JSON.parse(localStorage.getItem(historyKey)||'[]');
    if(Array.isArray(stored))history=stored.filter(item=>item&&typeof item.text==='string'&&item.text.length<=260).slice(0,20);
  } catch {}
  function drawHistory() {
    const list=$('workoutHistoryList');
    list.replaceChildren();
    $('workoutHistory').hidden=!history.length;
    for(const entry of history) {
      const item=document.createElement('li');
      item.textContent=entry.text;
      list.append(item);
    }
  }
  for(const [id,exercise] of Object.entries(exercises))mode.add(new Option(exercise.title,id));
  mode.value='squat';
  function refresh() {
    start.disabled=!!job||blocked();
    stop.disabled=!job;
    mode.disabled=!!job;
  }
  function choose() {show('workoutSetup',exercises[mode.value].view);}
  function stopCamera() {
    job?.abort();
    release(stream);
    stream=null;
    video.pause();
    video.srcObject=null;
    if(pendingSpeech&&window.speechSynthesis)window.speechSynthesis.cancel();
    pendingSpeech=false;
  }
  const pauseIfHidden=()=>{if(document.hidden)stopCamera();};
  document.addEventListener('visibilitychange',pauseIfHidden);
  window.addEventListener('pagehide',stopCamera);

  function draw(points) {
    const context=canvas.getContext('2d');
    if(!context)return;
    context.clearRect(0,0,canvas.width,canvas.height);
    if(points)skeleton(context,{x:0,y:0,w:canvas.width,h:canvas.height},points);
  }
  function renderSummary() {
    const summary=coach?.summary();
    const report=$('workoutSummary'),rows=$('workoutFindings');
    report.hidden=!summary;
    rows.replaceChildren();
    if(!summary)return;
    const work=coach.mode==='plank'?`${summary.hold} s of aligned hold`:
      Object.hasOwn(exercises[coach.mode],'low')?`${summary.reps} estimated reps`:exercises[coach.mode].title;
    const range=summary.bottomRange;
    const joint=coach.mode==='hinge'?'Hip':coach.mode==='pushup'?'Elbow':'Knee';
    show('workoutReview',`${work} · ${summary.coverage}% of sampled frames had a usable pose.`+
      (range?` ${joint} angle at the bottom of counted reps: ${range[0]}–${range[1]}° in this view.`:''));

    for(const note of summary.notes) {
      const item=document.createElement('li');
      item.textContent=`${note.cue} (${note.count} detection${note.count===1?'':'s'})`;
      rows.append(item);
    }
    if(coach.good) {
      const exercise=exercises[coach.mode].title;
      const detail=exercise===work?exercise:`${exercise} · ${work}`;
      history=[{text:`${new Date().toLocaleString()} · ${detail} · ${summary.coverage}% pose coverage`},...history].slice(0,20);
      try {localStorage.setItem(historyKey,JSON.stringify(history));} catch {}
      drawHistory();
    }
  }
  stop.onclick=stopCamera;
  mode.onchange=choose;
  start.onclick=async()=>{
    if(job||blocked())return;
    const controller=new AbortController();
    job=controller;
    const signal=controller.signal;
    let cameraLost=false,lastSpoken='',spokenAt=-Infinity,recentCue='',cueAt=-Infinity;
    coach=new WorkoutCoach(mode.value);
    $('workoutSummary').hidden=true;
    $('workoutScreen').hidden=false;
    show('workoutStatus','Requesting camera access…');
    show('workoutCue','Stand where the camera can see you.');
    show('workoutMetric','');
    refresh();onChange();
    try {
      stream=await openWorkoutCamera(navigator.mediaDevices,signal);
      signal.throwIfAborted();
      for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{
        cameraLost=true;stopCamera();
      },{once:true});
      video.srcObject=stream;
      await modelWithin(video.play(),signal,6500);
      show('workoutStatus','Loading the pose model…');
      const input=document.createElement('canvas'),ctx=input.getContext('2d');
      try {
        await withPoseFallback(async detector=>{
          coach.gap();
          let frame=-1;
          while(!signal.aborted) {
            if(video.readyState>=2&&video.videoWidth&&video.currentTime!==frame) {
              frame=video.currentTime;
              const scale=Math.min(1,480/Math.max(video.videoWidth,video.videoHeight));
              const width=Math.round(video.videoWidth*scale),height=Math.round(video.videoHeight*scale);
              if(input.width!==width||input.height!==height||canvas.width!==width||canvas.height!==height) {
                input.width=canvas.width=width;input.height=canvas.height=height;
                $('workoutScreen').style.aspectRatio=`${width} / ${height}`;
              }
              if(!ctx)throw new Error('The browser could not open a camera frame for analysis.');
              ctx.drawImage(video,0,0,width,height);
              let poses=[];
              try {await detector.read(input,result=>{poses=result.landmarks;});}
              catch {throw new PoseEngineError('The workout pose model stopped reading frames.');}
              signal.throwIfAborted();
              const points=poses.length===1?poses[0]:null;
              const state=coach.read(points,width/height,performance.now()/1000);
              draw(state?points:null);
              if(!state) {
                show('workoutStatus',poses.length>1?'One person at a time. Ask others to step out of view.':'Waiting for a clear pose');
                show('workoutCue',exercises[coach.mode].view);
                show('workoutMetric','');
                recentCue='';
              } else {
                show('workoutStatus','Camera coaching active');
                const count=coach.mode==='plank'?`${state.hold} s aligned hold`:Object.hasOwn(exercises[coach.mode],'low')?`${state.reps} estimated reps · `:'';
                const measure=coach.mode==='hinge'?'Hip angle':coach.mode==='pushup'?'Elbow angle':
                  coach.mode==='plank'?'Body line':coach.mode==='running'?'Trunk tilt from vertical':coach.mode==='free'?'Visible joint':'Knee angle';
                show('workoutMetric',`${count}${coach.mode==='plank'?' · ':''}${measure} ${state.value.metric}° (camera view)`);
                const now=performance.now()/1000;
                if(state.cue){recentCue=state.cue;cueAt=now;}
                const instruction=(now-cueAt<3?recentCue:'')||(coach.mode==='plank'?'Hold as long as you can keep your position steady.':
                  coach.mode==='free'?'Move slowly enough for the camera to follow.':
                  coach.mode==='running'?'Keep your pace and camera angle steady for comparison.':
                  state.phase==='setup'?'Return to the starting position to begin counting.':'Keep the movement controlled.');
                show('workoutCue',instruction);
                if(state.cue&&$('workoutVoice').checked&&window.speechSynthesis&&window.SpeechSynthesisUtterance&&
                    now-spokenAt>=5&&(state.cue!==lastSpoken||now-spokenAt>=12)) {
                  const speech=new SpeechSynthesisUtterance(state.cue);
                  pendingSpeech=true;lastSpoken=state.cue;spokenAt=now;
                  window.speechSynthesis.speak(speech);
                }
              }
            }
            await new Promise(resolve=>setTimeout(resolve,115));
          }
        },{signal,compatible:true,onRetry:()=>show('workoutStatus','Trying a more compatible pose model…')});
      } finally {input.width=input.height=1;}
      show('workoutStatus',cameraLost?'Camera disconnected. Start again to continue.':'Workout ended');
    } catch(error) {
      const message=signal.aborted?(cameraLost?'Camera disconnected.':'Workout ended'):
        error.name==='NotAllowedError'?'Camera permission was denied. Allow access in your browser to start.':
        error.name==='NotFoundError'?'No camera was found.':error.message;
      show('workoutStatus',message||'Workout camera could not start.');
    } finally {
      stopCamera();
      draw(null);
      $('workoutScreen').hidden=true;
      if(coach.samples)renderSummary();
      if(job===controller)job=null;
      refresh();onChange();
    }
  };
  choose();refresh();drawHistory();
  return {get active(){return !!job;},refresh};
}

export function setupBodyMeasurements() {
  let entries=[];
  try {
    const saved=JSON.parse(localStorage.getItem(BODY_MEASUREMENTS_KEY)||'[]');
    if(Array.isArray(saved))entries=saved.slice(0,100).map(measuredEntry).filter(Boolean);
  } catch {}
  const form=$('bodyForm'),list=$('bodyEntries'),fields={weight:'Weight',fat:'Body fat',muscle:'Muscle mass',waist:'Waist'};
  const units={weight:'kg',fat:'%',muscle:'kg',waist:'cm'};
  const today=new Date();
  form.elements.namedItem('date').value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
  function render() {
    entries.sort((a,b)=>b.date.localeCompare(a.date));
    list.replaceChildren();
    const latest=entries[0];
    if(!latest){show('bodyTrend','No measurements logged.');return;}
    const result=bodyMeasurementReview(entries,latest);
    const changes=result.changes.map(({field,date,difference})=>
      `${fields[field]} ${difference>=0?'+':''}${difference.toFixed(1)} ${field==='fat'?'percentage points':units[field]} since ${date}`);
    if(result.fatMass!==null)changes.unshift(`Estimated fat mass ${result.fatMass.toFixed(1)} kg · estimated lean mass ${result.leanMass.toFixed(1)} kg`);
    show('bodyTrend',changes.join(' · ')||'Add a later measurement using the same method to see changes.');
    for(const entry of entries.slice(0,10)) {
      const item=document.createElement('li');
      const values=Object.entries(fields).flatMap(([key,label])=>
        Object.hasOwn(entry,key)?[`${label} ${entry[key]} ${units[key]}`]:[]);
      const text=document.createElement('span');
      text.textContent=[entry.date,entry.method,...values].join(' · ');
      const remove=document.createElement('button');
      remove.type='button';
      remove.textContent='Remove';
      remove.setAttribute('aria-label',`Remove measurement dated ${entry.date}`);
      remove.onclick=()=>{
        if(!confirm(`Remove the measurement dated ${entry.date} from this browser?`))return;
        store(entries.filter(item=>item!==entry),'Measurement removed from this browser.');
      };
      item.append(text,' ',remove);
      list.append(item);
    }
  }
  function store(next,message) {
    try {
      localStorage.setItem(BODY_MEASUREMENTS_KEY,JSON.stringify(next));
      entries=next;
      show('bodyStatus',message);
      render();
    } catch {show('bodyStatus','The browser could not update the measurements.');}
  }
  form.onsubmit=event=>{
    event.preventDefault();
    const entry=measuredEntry(Object.fromEntries(new FormData(form)));
    if(!entry){show('bodyStatus','Enter a date, a measurement method and at least one valid value.');return;}
    const same=item=>item.date===entry.date&&item.method.toLowerCase()===entry.method.toLowerCase();
    const updated=measuredEntry({...entries.find(same),...entry});
    if(!updated){show('bodyStatus','Check how the new values compare with the measurement already saved for this date.');return;}
    const next=[updated,...entries.filter(item=>!same(item))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,100);
    store(next,'Measurement saved in this browser.');
  };
  render();
}
