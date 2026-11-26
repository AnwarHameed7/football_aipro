import {exercises,WorkoutCoach} from './workout.js';
import {modelWithin,withPoseFallback} from './pose-engine.js';
import {render3d,skeleton} from './pose.js';
import {changedScene,sceneSample} from './scene.js';
import {photoWorkoutReview,readWorkoutFrame,scanWorkoutVideo,WORKOUT_VIDEO_SECONDS,workoutCueMoments,workoutFrameAt} from './workout-media.js';
import {BODY_MEASUREMENTS_KEY,bodyMeasurementReview,measuredEntry,relativeFatMass} from './body-measurements.js';

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
  const video=$('workoutVideo'),photo=$('workoutPhoto'),canvas=$('workoutOutline'),mode=$('workoutExercise');
  const start=$('startWorkout'),stop=$('stopWorkout'),analyze=$('analyzeWorkoutMedia');
  const screen=$('workoutScreen'),rotation=$('workoutRotation'),modelCanvas=$('workoutModel');
  let job=null,stream=null,coach=null,pendingSpeech=false;
  let kind=null,mediaUrl=null,ready=false,frames=[],preview=null,cameraLost=false;
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
    const locked=!!job||blocked();
    start.disabled=locked;
    $('openWorkoutVideo').disabled=$('openWorkoutPhoto').disabled=locked;
    stop.hidden=!job;
    stop.disabled=!job;
    stop.textContent=kind==='camera'?'End workout':'Cancel analysis';
    analyze.hidden=kind!=='video'&&kind!=='photo';
    analyze.disabled=locked||!ready;
    analyze.textContent=kind==='photo'?'Analyze photo':'Analyze from playhead';
    mode.disabled=!!job;
    video.controls=kind==='video'&&!job;
    $('workoutSource').textContent=kind==='camera'?'Live camera':kind==='video'?'Workout video':kind==='photo'?'Workout photo':'No media selected';
  }

  function positionScreen(width,height) {
    const scale=Math.min(1,640/Math.max(width,height));
    const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
    if(canvas.width!==w||canvas.height!==h) {
      canvas.width=w;canvas.height=h;
      screen.style.aspectRatio=`${w} / ${h}`;
      screen.classList.toggle('portrait',h>w);
    }
  }
  function updateModel() {
    render3d(modelCanvas,preview,Number(rotation.value),{workout:true});
    rotation.disabled=!preview?.world;
    for(const button of $('workoutViews').querySelectorAll('button'))button.disabled=rotation.disabled;
    show('workoutDepthStatus',preview?.world?'Estimated depth from the selected frame.':preview?.points?
      'This model returned 2D landmarks. Use the overlay to review them.':'A pose appears here after analysis.');
  }
  function draw(sample) {
    const ctx=canvas.getContext('2d');
    if(ctx) {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      if(sample?.points)skeleton(ctx,{x:0,y:0,w:canvas.width,h:canvas.height},sample.points);
    }
    if(preview!==sample){preview=sample;updateModel();}
  }
  rotation.oninput=updateModel;
  for(const button of $('workoutViews').querySelectorAll('button'))button.onclick=()=>{
    rotation.value=button.dataset.view;
    updateModel();
  };
  let drag;
  modelCanvas.onpointerdown=event=>{
    if(rotation.disabled)return;
    drag={x:event.clientX,angle:Number(rotation.value)};
    modelCanvas.setPointerCapture(event.pointerId);
  };
  modelCanvas.onpointermove=event=>{
    if(!drag)return;
    const angle=drag.angle+(event.clientX-drag.x)*.8;
    rotation.value=((angle+180)%360+360)%360-180;
    updateModel();
  };
  modelCanvas.onpointerup=modelCanvas.onpointercancel=()=>{drag=null;};

  function metricName(exercise) {
    return {hinge:'Hip angle',pushup:'Elbow angle',plank:'Body line',running:'Trunk tilt from vertical',
      free:'Visible joint'}[exercise]||'Knee angle';
  }

  function clearResult() {
    frames=[];
    draw(null);
    $('workoutSummary').hidden=true;
    show('workoutMetric','');
    show('workoutCue','');
  }
  function showReady() {
    if(kind==='photo') {
      ready=!!photo.naturalWidth;
      if(ready)positionScreen(photo.naturalWidth,photo.naturalHeight);
    } else if(kind==='video') {
      ready=!!video.videoWidth&&Number.isFinite(video.duration)&&video.duration>0;
      if(ready)positionScreen(video.videoWidth,video.videoHeight);
    }
    if(ready)show('workoutStatus',kind==='photo'?'Photo ready. Choose the exercise, then analyze.':
      'Video ready. Choose the exercise and position the playhead where you want the review to start.');
    refresh();
  }
  function choose() {
    show('workoutSetup',exercises[mode.value].view);
    if(ready&&(kind==='video'||kind==='photo')){clearResult();showReady();}
  }
  function releaseCamera() {
    release(stream);stream=null;
    if(video.srcObject){video.pause();video.srcObject=null;}
    if(pendingSpeech&&window.speechSynthesis)window.speechSynthesis.cancel();
    pendingSpeech=false;
  }
  function stopJob() {
    job?.abort();
    releaseCamera();
  }
  function clearMedia() {
    video.pause();
    video.removeAttribute('src');video.load();
    photo.removeAttribute('src');
    if(mediaUrl)URL.revokeObjectURL(mediaUrl);
    mediaUrl=null;
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopJob();});
  window.addEventListener('pagehide',stopJob);

  function selectFile(input,type) {
    const file=input.files[0];input.value='';
    if(!file||job||blocked())return;
    kind=null;ready=false;
    clearMedia();clearResult();
    kind=type;
    $('workoutStage').hidden=false;
    screen.hidden=false;
    photo.hidden=type!=='photo';
    video.hidden=type!=='video';
    video.controls=type==='video';
    mediaUrl=URL.createObjectURL(file);
    show('workoutStatus',type==='photo'?'Opening photo…':'Opening video…');
    if(type==='photo')photo.src=mediaUrl;else video.src=mediaUrl;
    refresh();
  }
  $('openWorkoutVideo').onchange=event=>selectFile(event.target,'video');
  $('openWorkoutPhoto').onchange=event=>selectFile(event.target,'photo');
  video.addEventListener('loadedmetadata',()=>{if(kind==='video')showReady();});
  photo.onload=()=>{if(kind==='photo')showReady();};
  video.addEventListener('error',()=>{
    if(kind==='video'&&mediaUrl){ready=false;clearResult();show('workoutStatus','Could not read this video. Try an H.264 MP4.');refresh();}
  });
  photo.onerror=()=>{
    if(kind==='photo'&&mediaUrl){ready=false;clearResult();show('workoutStatus','Could not read this photo. Try JPEG, PNG, or WebP.');refresh();}
  };
  const replay=()=>{
    if(kind!=='video'||job||!frames.length)return;
    const sample=workoutFrameAt(frames,video.currentTime);
    draw(sample);
    if(sample?.cue)show('workoutCue',sample.cue);
    else show('workoutCue',sample?.points?'':video.duration>frames.at(-1).time+.28?
      'Move the playhead to an unreviewed passage and analyze again.':'No analyzed pose at this timestamp.');
    if(sample?.metric!==undefined)show('workoutMetric',`${metricName(mode.value)} ${sample.metric}° in this view`);
    else show('workoutMetric','');
  };
  video.addEventListener('timeupdate',replay);
  video.addEventListener('seeked',replay);

  function renderSummary() {
    const summary=coach.summary();
    $('workoutSummary').hidden=false;
    const work=coach.mode==='plank'?`${summary.hold} s of aligned hold`:
      Object.hasOwn(exercises[coach.mode],'low')?`${summary.reps} estimated reps`:exercises[coach.mode].title;
    const range=summary.bottomRange;
    const partial=summary.shortReps?` ${summary.shortReps} shorter-range rep${summary.shortReps===1?'':'s'} included.`:'';
    const noCycle=coach.good&&!summary.reps&&Object.hasOwn(exercises[coach.mode],'low')?
      ' A rep needs a visible starting position, bend, and return.': '';
    show('workoutReview',`${work} · ${summary.coverage}% of sampled frames had a usable pose.`+partial+noCycle+
      (range?` ${metricName(coach.mode)} at the bottom of counted reps: ${range[0]}–${range[1]}° in this view.`:''));
    const rows=$('workoutFindings');
    rows.replaceChildren();
    for(const note of summary.notes) {
      const item=document.createElement('li');
      item.textContent=`${note.cue} (${note.count} detection${note.count===1?'':'s'})`;
      rows.append(item);
    }
    const moments=kind==='video'?workoutCueMoments(frames):[];
    const reviewList=$('workoutMomentList');
    reviewList.replaceChildren();
    $('workoutMoments').hidden=!moments.length;
    for(const moment of moments) {
      const item=document.createElement('li'),jump=document.createElement('button');
      jump.type='button';
      jump.textContent=`Watch ${moment.time.toFixed(1)} s`;
      jump.onclick=()=>{video.pause();video.currentTime=moment.time;screen.scrollIntoView({block:'nearest'});};
      item.append(jump,' ',moment.cue);
      reviewList.append(item);
    }
    if(coach.good) {
      const exercise=exercises[coach.mode].title;
      const detail=exercise===work?exercise:`${exercise} · ${work}`;
      history=[{text:`${new Date().toLocaleString()} · ${detail} · ${summary.coverage}% pose coverage`},...history].slice(0,20);
      try {localStorage.setItem(historyKey,JSON.stringify(history));} catch {}
      drawHistory();
    }
  }

  function begin() {
    const controller=new AbortController();
    job=controller;
    coach=new WorkoutCoach(mode.value);
    clearResult();
    $('workoutStage').hidden=false;
    screen.hidden=false;
    refresh();onChange();
    return controller;
  }
  function finish() {
    releaseCamera();
    job=null;
    $('workoutProgress').hidden=true;
    refresh();onChange();
  }
  function retry() {show('workoutStatus','Trying a more compatible pose model…');}

  async function cameraLoop(detector,input,zoom,signal) {
    coach.gap();
    let frame=-1,previous,lastSpoken='',spokenAt=-Infinity,recentCue='',cueAt=-Infinity;
    while(!signal.aborted) {
      if(video.readyState>=2&&video.videoWidth&&video.currentTime!==frame) {
        frame=video.currentTime;
        positionScreen(video.videoWidth,video.videoHeight);
        const now=performance.now()/1000;
        const sample=await readWorkoutFrame(detector,input,video,video.videoWidth,video.videoHeight,now,{zoom,previous});
        if(sample.points)previous=sample.points;
        signal.throwIfAborted();
        const state=coach.read(sample.points,sample.aspect,now);
        draw(state?sample:null);
        if(!state) {
          show('workoutStatus',sample.people>1?'One person at a time. Ask others to step out of view.':'Waiting for a clear pose');
          show('workoutCue',exercises[coach.mode].view);show('workoutMetric','');recentCue='';
        } else {
          show('workoutStatus','Camera coaching active');
          const count=coach.mode==='plank'?`${state.hold} s aligned hold · `:
            Object.hasOwn(exercises[coach.mode],'low')?`${state.reps} estimated reps · `:'';
          show('workoutMetric',`${count}${metricName(coach.mode)} ${state.value.metric}° (camera view)`);
          if(state.cue){recentCue=state.cue;cueAt=now;}
          const instruction=(now-cueAt<3?recentCue:'')||(coach.mode==='plank'?'Check that your position stays steady.':
            coach.mode==='running'?'Keep your pace and camera angle steady for comparison.':
            state.phase==='setup'&&Object.hasOwn(exercises[coach.mode],'low')?
              'Return to the starting position to begin counting.':'Keep the movement controlled.');
          show('workoutCue',instruction);
          if(state.cue&&$('workoutVoice').checked&&window.speechSynthesis&&window.SpeechSynthesisUtterance&&
            now-spokenAt>=5&&(state.cue!==lastSpoken||now-spokenAt>=12)) {
            pendingSpeech=true;lastSpoken=state.cue;spokenAt=now;
            window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(state.cue));
          }
        }
      }
      await new Promise(resolve=>setTimeout(resolve,115));
    }
  }

  start.onclick=async()=>{
    if(job||blocked())return;
    kind=null;ready=false;clearMedia();
    kind='camera';cameraLost=false;
    const controller=begin(),signal=controller.signal;
    video.hidden=false;photo.hidden=true;video.controls=false;
    show('workoutStatus','Requesting camera access…');
    const input=document.createElement('canvas'),zoom=document.createElement('canvas');
    zoom.width=zoom.height=352;
    try {
      stream=await openWorkoutCamera(navigator.mediaDevices,signal);
      signal.throwIfAborted();
      for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{cameraLost=true;stopJob();},{once:true});
      video.srcObject=stream;
      await modelWithin(video.play(),signal,6500);
      show('workoutStatus','Loading the pose model…');
      await withPoseFallback(detector=>cameraLoop(detector,input,zoom,signal),{signal,compatible:true,onRetry:retry});
      show('workoutStatus','Workout ended');
    } catch(error) {
      show('workoutStatus',signal.aborted?(cameraLost?'Camera disconnected.':'Workout ended'):
        error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser.':
        error.name==='NotFoundError'?'No camera was found.':error.message||'Workout camera could not start.');
    } finally {
      input.width=input.height=zoom.width=zoom.height=1;
      screen.hidden=true;
      if(coach.samples)renderSummary();
      finish();
    }
  };

  analyze.onclick=async()=>{
    if(job||blocked()||!ready)return;
    const controller=begin(),signal=controller.signal;
    const input=document.createElement('canvas'),scene=document.createElement('canvas'),zoom=document.createElement('canvas');
    zoom.width=zoom.height=352;
    scene.width=16;scene.height=9;
    const sceneContext=scene.getContext('2d',{willReadFrequently:true});
    const from=kind==='video'?Math.min(video.currentTime,Math.max(0,video.duration-.125)):0;
    const progress=$('workoutProgress');
    show('workoutStatus','Loading the pose model…');
    try {
      if(kind==='video') {
        if(video.readyState<2)await modelWithin(video.play(),signal,5000);
        video.pause();
      }
      await withPoseFallback(async detector=>{
        if(kind==='photo') {
          const sample=await readWorkoutFrame(detector,input,photo,photo.naturalWidth,photo.naturalHeight,0,{zoom,detail:true,wide:true});
          signal.throwIfAborted();
          draw(sample);
          const review=photoWorkoutReview(sample,mode.value);
          show('workoutStatus',sample.people>1?'Use a photo with one person.':sample.points?'Photo analyzed':'No clear pose found in this photo.');
          show('workoutMetric',review?`${metricName(mode.value)} ${review.measurement.metric}° in this view`:'');
          show('workoutCue',review?.cue||(review?'Use a video to review reps, pace, and consistency.':exercises[mode.value].view));
          return;
        }
        coach=new WorkoutCoach(mode.value);
        progress.hidden=false;
        progress.value=0;
        let previousScene,previous;
        frames=await scanWorkoutVideo(video,async time=>{
          const sample=await readWorkoutFrame(detector,input,video,video.videoWidth,video.videoHeight,time,{zoom,previous,detail:true,wide:Math.round((time-from)*6)%12===0});
          if(sample.points)previous=sample.points;
          const current=sceneSample(input,sceneContext);
          sample.cut=changedScene(previousScene,current);
          previousScene=current;
          return sample;
        },{
          start:from,end:video.duration,signal,onFrame:(sample,value)=>{
            if(sample.cut)coach.gap();
            const state=coach.read(sample.points,sample.aspect,sample.time);
            if(state){sample.metric=state.value.metric;sample.cue=state.cue;}
            progress.value=value;
            const percent=Math.floor(value*20)*5;
            show('workoutStatus',`Analyzing video · ${percent}%`);
          },
        });
        renderSummary();
        show('workoutStatus',coach.good?
          `Analyzed ${from.toFixed(1)}–${frames.at(-1).time.toFixed(1)} s. Play or scrub to review.`:
          'No usable pose for this exercise. Try a clearer view with one person.');
        if(video.duration>from+WORKOUT_VIDEO_SECONDS)
          show('workoutCue','To review the next passage, move the playhead and analyze again.');
        video.currentTime=from;
      },{signal,compatible:true,onRetry:retry});
    } catch(error) {
      if(kind==='video'){video.pause();video.currentTime=from;}
      show('workoutStatus',signal.aborted?'Analysis cancelled.':'Could not finish analysis. '+error.message);
    } finally {
      input.width=input.height=scene.width=scene.height=zoom.width=zoom.height=1;
      finish();
      replay();
    }
  };
  stop.onclick=stopJob;
  mode.onchange=choose;
  choose();refresh();drawHistory();updateModel();
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
  const estimator=$('bodyEstimateForm');
  estimator.oninput=()=>show('bodyEstimateResult','');
  estimator.onsubmit=event=>{
    event.preventDefault();
    const data=new FormData(estimator);
    const result=relativeFatMass({height:Number(data.get('height')),waist:Number(data.get('waist')),
      reference:data.get('reference'),adult:data.has('adult')});
    show('bodyEstimateResult',result===null?'Check the measurements and formula settings. No estimate is available for these inputs.':
      `About ${Math.round(result)}% body fat by the Relative Fat Mass formula. Treat this as a rough estimate.`);
  };
  render();
}
