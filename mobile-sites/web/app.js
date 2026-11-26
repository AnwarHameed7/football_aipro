import {LONG_CLIP_SECONDS,SECTION_SECONDS,ballProgress,matchKey,matchProgress,nextSection,readMatch,readMatchNotes,readSection,
  saveMatchNotes,saveSection,scanSavedBallSections,scanSections,sectionAt,sectionRange,startMatch} from './match-review.js';
import {openPoseReview,savePoseReview} from './saved-pose.js';
import {poseCoverage,reconnectTrack,sampleAt,skillMoments} from './review-flow.js';
import {closeModel,objectModel,withPoseFallback} from './pose-engine.js';
import {analyzeSectionBall} from './ball-review.js';
import {loadPlayerReference,referenceMemory,savePlayerReference,suggestedAnchor} from './player-reference.js';
import {setupBodyMeasurements,setupWorkout} from './workout-ui.js';
import {activeCoachingCue,drawBodyOutline} from './highlight.js';
import {teamWorkspace} from './team-ui.js';
import {analyze,attemptReview,coachReview,drawMovementMap,metrics,render3d,skeleton} from './pose.js';
import {exportClip} from './export.js';
import {outcomeRate,planFor,skills} from './training.js';
import {calibratePitch,drawPitchMap,estimateId,eventKinds,eventTotals,footLocations,goalArea,suggestBallEvents,tacticalPriorities,tacticalZones,unreviewedEstimates} from './match.js';

const $ = id => document.getElementById(id);
const video = $('video'), reference = $('reference'), canvas = $('drawing');
const categories = ['Running form','Acceleration','Deceleration','Change of direction','First touch','Pass','Shot','Defensive action','Pressing','Transition','Set piece','Opponent pattern','Other'];
const tools = {Line: 2, Arrow: 2, Angle: 3};
let soloWorkout;
let source, sourceUrl, refUrl, exportPreviewUrl, report = null, marks = {}, tags = [];
let weekly=[],outcomes=[],currentPlan=null,activeTeam=null,team=null;
let dismissedEstimates=[];
let pitch=[],pendingPitch=null,events=[],matchSamples=[],goalPoints=[],pendingGoal=null,ballSamples=[];
let anchor, selecting=false, pose=null, coaching=null, markedMoment=null, scanJob=null, scanFailure=null, scanMessage='', exportJob=null, recording=null, voiceDraft='';
let playerReference=loadPlayerReference(),referenceSuggestion=null,notesRevision=0,longNotesLoading=false;
let longSession=null,longKey=null,longReady=null,longIndex=null,longAll=false,longReplace=false,longOverride=null,longReading=null;
const longClip=()=>ready&&video.duration>LONG_CLIP_SECONDS;
const hasChanges=()=>tags.length || Object.values(marks).some(items=>items.length) || voiceDraft || report || pitch.length || events.length || team?.hasWork();
const validAudio=value=>typeof value==='string' && value.length<=2_000_000 &&
  /^data:audio\/(webm|mp4|ogg|wav)(;codecs=[a-zA-Z0-9._,-]+)?;base64,[a-zA-Z0-9+/=]+$/.test(value);
let reconnecting=false, previousPose=null, scanGeneration=0;
let first = 0, last = 0, pending = [], pendingFrame = null, editing = -1, offset = 0, ready = false;
for (const name of categories) $('category').add(new Option(name, name));
for (const [id,skill] of Object.entries(skills)) $('coachMode').add(new Option(skill.label,id));
$('coachMode').value='running';
const fps = () => Math.max(1, Math.min(240, Number($('fps').value) || 30));
const frameCount = () => ready ? Math.max(1, Math.round(video.duration * fps())) : 1;
const frame = () => Math.min(frameCount() - 1, Math.round(video.currentTime * fps()));
const seek = time => { if (ready) video.currentTime = Math.max(0, Math.min(video.duration - .001, time)); };
const range = () => $('range').textContent = `${(first / fps()).toFixed(3)}–${(last / fps()).toFixed(3)} s`;
const status = (id, message) => { if ($(id).textContent !== message) $(id).textContent = message; };
const clean = value => typeof value === 'string' ? value : '';

$('source').onchange = event => {
  const file = event.target.files[0];
  event.target.value='';
  if (file) loadSource(file);
};
const allowReplace=()=>!hasChanges() || confirm('Replace the current work in this tab? Save it first to keep the review.');
function loadSource(file, replace=true) {
  if (replace && !allowReplace()) return false;
  scanGeneration++;scanJob?.abort(); exportJob?.abort(); stopVoice(true);
  ready = false;scanFailure=null;scanMessage='';referenceSuggestion=null;notesRevision=0;longNotesLoading=false;
  longSession=longKey=longReady=longIndex=longOverride=longReading=null;longAll=longReplace=false;renderLongReview();
  clearExportPreview();
  team?.reset();
  $('controls').disabled = $('tags').disabled = true;
  for (const id of ['saveLibrary','exportClip','scanPose','choosePlayer']) $(id).disabled=true;
  if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  source = file;
  sourceUrl = URL.createObjectURL(file);
  video.src = sourceUrl;
  video.hidden = false;
  canvas.hidden = false;
  $('empty').hidden = true;
  tags = []; marks = {}; report = null; pending = []; first = 0; last = 0;
  pitch=[];pendingPitch=null;events=[];dismissedEstimates=[];matchSamples=[];goalPoints=[];pendingGoal=null;ballSamples=[];
  $('attackDirection').value='right';$('eventForm').reset();$('markEventTime').hidden=true;renderMatch();
  anchor=null;selecting=false;reconnecting=false;previousPose=null;pose=null;coaching=null;markedMoment=null;renderCoaching();$('candidates').replaceChildren();updateCanvasMode();updateTargetControls();
  $('trackBadge').hidden=true;
  status('selectionHelp','Pause where your torso is visible, then tap Select me.');
  resetEditor(); renderTags(); renderReport(); range(); updatePosePanel();
  status('poseStatus','Pause where your torso is visible, then select yourself.');
  status('videoStatus', 'Opening clip…');
  return true;
}
function waitForSource() {
  return new Promise((resolve,reject)=>{
    if(ready) {resolve();return;}
    const finish=error=>{
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad);
      if(error || !ready) reject(error||new Error('This clip cannot be read.')); else resolve();
    };
    const ok=()=>finish(),bad=()=>finish(new Error('This clip cannot be decoded.'));
    const timer=setTimeout(bad,8000);
    video.addEventListener('loadedmetadata',ok,{once:true});video.addEventListener('error',bad,{once:true});
  });
}
video.onloadedmetadata = () => {
  ready = Number.isFinite(video.duration) && video.duration > 0 && video.videoWidth > 0;
  $('controls').disabled = $('tags').disabled = !ready;
  for (const id of ['saveLibrary','exportClip','scanPose','choosePlayer']) $(id).disabled=!ready;
  status('videoStatus', ready ? source.name : 'Could not read this clip. Try an MP4 file.');
  if(longClip()&&!longReady) {
    longNotesLoading=true;
    longReady=prepareLongReview(source);
  }
  updateTargetControls();
  renderMatch();
  paint();
};
video.onerror = () => {
  scanJob?.abort();
  ready = false;
  $('controls').disabled = $('tags').disabled = true;
  updateTargetControls();
  team?.sync();
  $('trackBadge').hidden=true;
  status('videoStatus','This format could not be decoded by the browser. Try an H.264 MP4.');
};
$('referenceFile').onchange = event => {
  const file = event.target.files[0];
  if (!file) return;
  if (refUrl) URL.revokeObjectURL(refUrl);
  refUrl = URL.createObjectURL(file);
  reference.src = refUrl;
  reference.playbackRate = video.playbackRate;
  $('comparison').hidden = false;
  $('videos').classList.add('paired');
  $('align').disabled = true;
  offset = 0;
  status('referenceName', file.name);
};
reference.onloadedmetadata = () => { $('align').disabled = false; syncReference(true); };
reference.onerror = () => { status('referenceName','Reference could not be played. Try an MP4.'); };
function syncReference(force = false) {
  if (!$('sync').checked || reference.readyState < 1) return;
  const raw = video.currentTime + offset;
  const time = Math.max(0, Math.min(reference.duration - .01, raw));
  if (force || Math.abs(reference.currentTime - time) > .14) reference.currentTime = time;
  if (video.paused || raw < 0 || raw >= reference.duration - .01) reference.pause();
  else if (reference.paused) reference.play().catch(() => {});
}
$('sync').onchange = () => { if ($('sync').checked) syncReference(true); };
$('align').onclick = () => {
  offset = reference.currentTime - video.currentTime;
  $('sync').checked = true;
  status('videoStatus', `Comparison aligned at ${offset.toFixed(3)} s offset.`);
  syncReference(true);
};
$('speed').onchange = () => { video.playbackRate = reference.playbackRate = Number($('speed').value); };
for (const [id, delta] of [['back', -1], ['next', 1]]) {
  $(id).onclick = () => { video.pause(); seek((frame() + delta) / fps()); };
}
$('fps').onchange = () => {
  const prior = Number($('fps').dataset.active || 30);
  if (tags.length || Object.values(marks).some(items => items.length)) {
    $('fps').value = prior;
    status('videoStatus','Set FPS before drawing or adding tags. Import uses the review’s recorded FPS.');
    return;
  }
  $('fps').value = fps(); $('fps').dataset.active = fps();
  first = 0; last = 0; range(); paint();
};
function update(force = false) {
  if (!ready||scanJob||team?.isScanning()) return;
  if (!video.paused && $('loop').checked && (frame() < first || video.currentTime >= (last + 1) / fps())) seek(first / fps());
  status('clock', `${Math.floor(video.currentTime / 60)}:${(video.currentTime % 60).toFixed(3).padStart(6, '0')} · frame ${frame() + 1}`);
  syncReference(force); paint(); updatePosePanel();
  if(longClip()&&!selecting&&longKey&&longSession) {
    const index=sectionAt(video.currentTime,video.duration);
    if(index!==longIndex&&longSession.parts[index]&&!longReading) {
      longReading=loadLongSection(index,false).finally(()=>{longReading=null;});
    }
  }
}
for (const name of ['timeupdate','seeked','play','pause']) video.addEventListener(name, () => update(name !== 'timeupdate'));
if ('requestVideoFrameCallback' in video) {
  const tick = () => { if (!video.paused) update(); video.requestVideoFrameCallback(tick); };
  video.requestVideoFrameCallback(tick);
}
const resize = new ResizeObserver(() => paint()); resize.observe(video);
function box(width, height) {
  const ratio = Math.min(width / video.videoWidth, height / video.videoHeight);
  const w = ratio * video.videoWidth, h = ratio * video.videoHeight;
  return {x:(width-w)/2, y:(height-h)/2, w, h};
}
function renderMarks(context, rect, list) {
  context.strokeStyle = context.fillStyle = '#ffd960';
  context.lineWidth = Math.max(2, rect.w / 400);
  context.font = `bold ${Math.max(15, rect.w / 36)}px system-ui`;
  context.lineJoin = 'round';
  for (const {tool, points} of list) {
    const p = points.map(([x,y]) => [rect.x+x*rect.w,rect.y+y*rect.h]);
    context.beginPath();
    p.forEach(([x,y], index) => index ? context.lineTo(x,y) : context.moveTo(x,y));
    context.stroke();
    for (const [x,y] of p) { context.beginPath(); context.arc(x,y,Math.max(3,context.lineWidth),0,2*Math.PI); context.fill(); }
    if (tool === 'Arrow' && p.length === 2) {
      const [[a,b],[x,y]] = p, direction = Math.atan2(y-b,x-a);
      context.beginPath(); context.moveTo(x-12*Math.cos(direction-.45),y-12*Math.sin(direction-.45));
      context.lineTo(x,y); context.lineTo(x-12*Math.cos(direction+.45),y-12*Math.sin(direction+.45)); context.stroke();
    }
    if (tool === 'Angle' && p.length === 3) {
      const [[a,b],[x,y],[c,d]] = p;
      if ((a === x && b === y) || (c === x && d === y)) continue;
      const angle = Math.atan2(Math.abs((a-x)*(d-y)-(b-y)*(c-x)),(a-x)*(c-x)+(b-y)*(d-y));
      const label = `${(angle * 180 / Math.PI).toFixed(1)}°`;
      const tx = Math.max(rect.x, Math.min(x + 6, rect.x + rect.w - context.measureText(label).width - 4));
      const ty = Math.max(rect.y + 17, y - 7);
      context.save(); context.strokeStyle = '#121a18'; context.lineWidth = 4;
      context.strokeText(label,tx,ty); context.fillText(label,tx,ty); context.restore();
    }
  }
}
function paint() {
  if (!ready || !video.clientWidth) return;
  const width = video.clientWidth, height = video.clientHeight, density = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(width*density), pixelHeight = Math.round(height*density);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth; canvas.height = pixelHeight;
  }
  const context = canvas.getContext('2d');
  context.setTransform(density,0,0,density,0,0); context.clearRect(0,0,width,height);
  const list = [...(marks[frame()] || [])];
  if (pending.length && pendingFrame === frame()) list.push({tool:$('tool').value,points:pending});
  const rect=box(width,height);
  const sample=poseAt(video.currentTime);
  paintSelectedBody(context,rect,sample,$('showOutline').checked,$('showPose').checked);
  updateLiveCoach(sample);
  renderMarks(context,rect,list);
  drawTarget(context,rect,sample);
  updateTrackBadge(sample);
  team?.overlay(context,rect);
  drawPitchPoints(context,rect);
  drawGoal(context,rect);
  if(selecting) {context.strokeStyle='#b1f58b';context.lineWidth=2;context.strokeRect(rect.x+1,rect.y+1,rect.w-2,rect.h-2);}
}
$('tool').onchange = () => {
  pending = []; selecting=false; pendingPitch=null; pendingGoal=null; team?.cancelPick(); updateCanvasMode(); updateTargetControls();
  if ($('tool').value !== 'Pointer') video.pause();
  paint();
};
canvas.onpointerup = event => {
  const tool = $('tool').value;
  if ((!selecting && !pendingPitch && !pendingGoal && !team?.isPicking() && !(tool in tools)) || !ready) return;
  video.pause();
  const outer = canvas.getBoundingClientRect(), rect = box(outer.width, outer.height);
  const x = (event.clientX-outer.left-rect.x)/rect.w, y = (event.clientY-outer.top-rect.y)/rect.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  if(team?.select(x,y))return;
  if(pendingPitch) {markPitchPoint(x,y);return;}
  if(pendingGoal) {markGoalPoint(x,y);return;}
  if(selecting) {
    startPlayerSelection({x,y,time:Math.min(video.currentTime,video.duration-.001)});
    return;
  }
  if (pendingFrame !== frame()) pending = [];
  pendingFrame = frame(); pending.push([x,y]);
  if (pending.length === tools[tool]) {
    (marks[pendingFrame] ||= []).push({tool,points:pending});
    pending = [];
  }
  status('videoStatus', pending.length ? `${tools[tool]-pending.length} point(s) left` : `${tool} added to frame ${frame()+1}.`);
  paint();
};
function startPlayerSelection(selection) {
  if(soloWorkout?.active)return;
  anchor=selection;referenceSuggestion=null;scanFailure=null;scanMessage='';
  const wasReconnect=reconnecting;
  previousPose=!longClip()&&wasReconnect?pose:null;
  if(longClip()) {
    longOverride=anchor;
    longReplace=!wasReconnect;
    longAll=false;
  }
  reconnecting=false;
  pose=null;coaching=null;markedMoment=null;matchSamples=[];ballSamples=[];renderCoaching();renderMatch();
  $('candidates').replaceChildren();
  selecting=false; updateCanvasMode(); updateTargetControls();
  status('selectionHelp',previousPose?'Reconnect point marked. Keeping the earlier track and rescanning from here.':
    'Selection marked. Checking this player and nearby frames.');
  status('poseStatus',`Player selected at ${anchor.time.toFixed(2)} s.`);
  paint();updatePosePanel();$('scanPose').click();
}
$('undo').onclick = () => { if (pending.length) pending.pop(); else marks[frame()]?.pop(); paint(); };
$('image').onclick = () => {
  if (video.readyState < 2) return;
  const image = document.createElement('canvas');
  const w = image.width = video.videoWidth, h = image.height = video.videoHeight;
  const context = image.getContext('2d');
  context.drawImage(video,0,0,w,h);
  paintSelectedBody(context,{x:0,y:0,w,h},poseAt(video.currentTime),$('showOutline').checked,$('showPose').checked);
  renderMarks(context,{x:0,y:0,w,h},marks[frame()] || []);
  image.toBlob(blob => { if (blob) download(blob,`frame-${frame()+1}.png`); });
};
$('in').onclick = () => { first = frame(); last = Math.max(first,last); range(); };
$('out').onclick = () => { last = frame(); first = Math.min(first,last); range(); };
function resetEditor() {
  stopVoice(true); voiceDraft=''; status('voiceStatus',''); editing = -1; $('form').reset(); $('saveTag').textContent = 'Add tag'; $('clearTag').hidden = true;
}
$('clearTag').onclick = resetEditor;
$('form').onsubmit = event => {
  event.preventDefault();
  const category = $('category').value;
  const tag = {start:first,end:last,title:$('title').value.trim() || category,category,
    player:$('player').value.trim(),feedback:$('feedback').value.trim()};
  if (voiceDraft) tag.voice=voiceDraft;
  if (editing < 0) tags.push(tag); else tags[editing] = tag;
  resetEditor(); renderTags();
};
function element(name,text) { const node = document.createElement(name); node.textContent = text; return node; }
function button(text,action) { const node = element('button',text); node.type = 'button'; node.onclick = action; return node; }
function renderTags() {
  const list = $('clips'), filter = $('filter').value.toLowerCase().trim();
  list.replaceChildren();
  for (const item of tags.map((tag,index) => ({tag,index})).sort((a,b) => a.tag.start-b.tag.start)) {
    const {tag,index} = item;
    if (filter && ![tag.title,tag.category,tag.player,tag.feedback].some(value => value.toLowerCase().includes(filter))) continue;
    const li = element('li','');
    li.append(element('strong',tag.title),element('small',`${(tag.start/fps()).toFixed(2)}–${(tag.end/fps()).toFixed(2)} s · ${tag.category}${tag.player ? ' · '+tag.player : ''}`));
    if (tag.feedback) li.append(element('p',tag.feedback));
    if (validAudio(tag.voice)) {
      const audio=element('audio','');audio.controls=true;audio.preload='none';audio.src=tag.voice;li.append(audio);
    }
    const row = element('div',''); row.className = 'row';
    row.append(button('Jump',() => { video.pause(); first=tag.start; last=tag.end; range(); seek(first/fps()); }),
      button('Edit',() => {
        stopVoice(true); voiceDraft=tag.voice||'';status('voiceStatus',voiceDraft?'Voice note attached.':'');
        editing=index; first=tag.start; last=tag.end; range();
        for (const key of ['title','category','player','feedback']) $(key).value=tag[key];
        $('saveTag').textContent='Save tag'; $('clearTag').hidden=false; $('title').focus();
      }), button('Delete',() => {
        tags.splice(index,1); if (editing === index) resetEditor(); else if (editing > index) editing--;
        renderTags();
      }));
    li.append(row); list.append(li);
  }
}
$('filter').oninput = renderTags;
function download(blob,name) {
  const url = URL.createObjectURL(blob), link = element('a','');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function reviewData() {
  return {version:1,source:source.name,fps:fps(),frame_count:frameCount(),tags,drawings:marks,movement_review:report,
    personal:savePoseReview(pose,$('coachMode').value,markedMoment,$('kickSide').value),training:{weekly,outcomes},match:{pitch,events,dismissedEstimates,samples:matchSamples,goalPoints,ballSamples,attack:$('attackDirection').value,team:team?.snapshot()}};
}
$('json').onclick = () => {
  const data = reviewData();
  download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),'football-review.json');
};
const csv = value => '"' + String(value).replace(/^\s*[=+\-@]/, text => "'" + text).replaceAll('"','""') + '"';
$('csv').onclick = () => {
  const rows = [['start_s','end_s','category','player','title','feedback'],...tags.map(t => [t.start/fps(),t.end/fps(),t.category,t.player,t.title,t.feedback])];
  download(new Blob([rows.map(row => row.map(csv).join(',')).join('\r\n')],{type:'text/csv'}),'football-tags.csv');
};
function renderReport() {
  const area = $('spans'); area.replaceChildren();
  const spans = Array.isArray(report?.spans) ? report.spans : [];
  $('analysis').hidden = !spans.length;
  for (const span of spans.slice(0,1000)) {
    if (!Number.isFinite(span?.start_s)) continue;
    area.append(element('h3',`${span.start_s.toFixed(2)} s · ${clean(span.status)}`));
    for (const metric of Object.values(span.measurements || {})) {
      if (!metric || typeof metric !== 'object') continue;
      const ratio = Number.isFinite(metric.median_ratio);
      const median = ratio ? metric.median_ratio : metric.median_deg;
      if (Number.isFinite(median)) area.append(element('p',`${clean(metric.label)}: ${median} ${ratio ? '× torso' : '°'} median`));
    }
    for (const cue of Array.isArray(span.review_cues) ? span.review_cues : []) area.append(element('p',clean(cue)));
  }
}
$('import').onchange = async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (!ready) { status('reviewStatus','Open the matching video before importing a review.'); return; }
  if (file.size > 15_000_000) { status('reviewStatus','Review file is too large.'); return; }
  try {
    applyReview(JSON.parse(await file.text()));
  } catch { status('reviewStatus','Could not import the review. Check that its format and video match.'); }
};
function applyReview(data, confirmReplace=true) {
    if (data.source !== source.name || data.version !== 1 || !(data.fps >= 1 && data.fps <= 240) ||
        !Number.isInteger(data.frame_count) || Math.abs(data.frame_count / data.fps - video.duration) > .25 ||
        !Array.isArray(data.tags)) throw new Error();
    const verified = data.tags.map(tag => {
      if (!Number.isInteger(tag.start) || !Number.isInteger(tag.end) || tag.start < 0 ||
          tag.end < tag.start || tag.end >= data.frame_count || !categories.includes(tag.category))
        throw new Error();
      const safe={start:tag.start,end:tag.end,category:tag.category,title:clean(tag.title),
        player:clean(tag.player),feedback:clean(tag.feedback)};
      if(validAudio(tag.voice)) safe.voice=tag.voice;
      return safe;
    });
    const drawings = {};
    for (const [key,list] of Object.entries(data.drawings || {})) {
      if (!/^\d+$/.test(key) || +key >= data.frame_count || !Array.isArray(list)) throw new Error();
      drawings[key] = list.map(mark => {
        if (!Object.hasOwn(tools,mark.tool) || !Array.isArray(mark.points) || mark.points.length !== tools[mark.tool] ||
            !mark.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 1)))
          throw new Error();
        return {tool:mark.tool,points:mark.points};
      });
    }
    if (confirmReplace && !allowReplace()) return;
    $('fps').value=data.fps; $('fps').dataset.active=data.fps;
    scanGeneration++;scanJob?.abort();
    tags=verified; marks=drawings; report=data.movement_review; pending=[]; first=0; last=0;
    const restored=openPoseReview(data.personal,video.duration);
    pose=restored;previousPose=null;anchor=null;selecting=false;reconnecting=false;coaching=null;
    scanFailure=null;markedMoment=restored?.moment??null;
    $('coachMode').value=Object.hasOwn(skills,restored?.mode)?restored.mode:'running';
    $('kickSide').value=restored?.foot==='left'?'left':'right';
    restoreTraining(data.training);
    restoreMatch(data.match);
    if(pose) {
      pose.ballSamples=ballSamples;
      matchSamples=footLocations(pose.frames);
      addCandidateButtons(pose.cues);
      renderMatch();
      seek(pose.frames.find(item=>item.points).time);
    } else $('candidates').replaceChildren();
    updateCanvasMode();updateTargetControls();updateCoaching();updatePosePanel();
    resetEditor(); renderTags(); range(); paint(); renderReport(); renderTraining();
    status('reviewStatus',restored?.truncated?'Review imported. A long personal scan was saved through the first 2,400 samples.':
      restored?'Review imported with your outline and coaching.':'Review imported.');
}

function updateCanvasMode() {
  canvas.classList.toggle('active',selecting || !!pendingPitch || !!pendingGoal || !!team?.isPicking() || $('tool').value!=='Pointer');
}

function updateTargetControls() {
  const select=$('choosePlayer'),start=$('trackMe'),busy=!!scanJob||!!soloWorkout?.active;
  select.disabled=!ready||busy;
  start.disabled=!ready||!anchor||selecting||busy;
  start.classList.toggle('primary',!!anchor&&!selecting);
  select.classList.toggle('primary',!anchor||selecting);
  select.setAttribute('aria-pressed',String(selecting));
  select.textContent=selecting?'Cancel selection':anchor?'Change selection':'Select me';
  $('jumpReturn').hidden=!pose?.frames.some(item=>item.state==='reacquired');
  $('reconnectMe').hidden=(!pose&&!longSession)||busy;
  $('markMoment').disabled=!pose||!!scanJob;
  $('saveOutcome').disabled=!ready;
  renderPlayerReference();
  renderLongReview();
  soloWorkout?.refresh();
}

function renderPlayerReference(message) {
  const busy=!!scanJob||!!soloWorkout?.active;
  $('savePlayerReference').disabled=busy||!pose?.forwardMemory;
  $('findPlayerReference').disabled=busy||!ready||!playerReference||!!pose||!!longSession;
  $('acceptPlayerReference').hidden=$('discardPlayerReference').hidden=!referenceSuggestion||busy;
  $('forgetPlayerReference').hidden=!playerReference;
  $('forgetPlayerReference').disabled=busy;
  if(message)status('playerReferenceStatus',message);
  else if(referenceSuggestion)status('playerReferenceStatus','Check the amber marker. Use the suggestion only if it marks you.');
  else status('playerReferenceStatus',playerReference?
    'A kit and body reference is saved in this browser. Look for it in a clip with a similar kit.':
    'Track yourself first to save a kit and body reference for future clips in this browser.');
}
$('savePlayerReference').onclick=()=>{
  if(!pose?.forwardMemory||scanJob)return;
  try {playerReference=savePlayerReference(localStorage,pose.forwardMemory);renderPlayerReference('Player reference saved in this browser.');}
  catch(error){renderPlayerReference(error.message);}
};
$('forgetPlayerReference').onclick=()=>{
  if(scanJob)return;
  try {
    playerReference=savePlayerReference(localStorage,null);referenceSuggestion=null;
    renderPlayerReference('Player reference cleared.');paint();
  } catch {renderPlayerReference('This browser could not clear the player reference.');}
};
$('discardPlayerReference').onclick=()=>{referenceSuggestion=null;renderPlayerReference();paint();};
$('acceptPlayerReference').onclick=()=>{
  if(!ready||scanJob||!referenceSuggestion)return;
  reconnecting=false;
  startPlayerSelection(referenceSuggestion);
};
$('findPlayerReference').onclick=async()=>{
  if(!ready||scanJob||soloWorkout?.active||!playerReference||pose||longSession||team?.isScanning())return;
  const job=new AbortController(),clip=source,position=video.currentTime;
  const start=Math.max(0,Math.min(position,video.duration-1.75)),end=Math.min(video.duration,start+2);
  referenceSuggestion=null;selecting=false;updateCanvasMode();
  beginScan(job,'Looking for your saved player reference…');
  let message;
  try {
    await primeDecoder(clip,job.signal);
    const result=await analyze({sourceVideo:video,anchor:{x:.5,y:.5,time:start},start,end,compact:true,
      memory:referenceMemory(playerReference),lookForBall:false,signal:job.signal,
      progress:value=>drawScanProgress('Looking for a possible player',value)});
    if(source!==clip)return;
    referenceSuggestion=suggestedAnchor(result.frames);
    if(!referenceSuggestion)message='No clear match was found here. Move to a clearer moment or tap Select me.';
  } catch {
    if(source===clip)message=job.signal.aborted?'Player search paused.':'Could not compare the saved reference. Use Select me to continue.';
  } finally {
    if(source===clip)seek(referenceSuggestion?.time??position);
    finishScan();
    renderPlayerReference(source===clip?message:undefined);
    paint();
  }
};

function drawTarget(ctx,rect,sample) {
  const preview=referenceSuggestion&&Math.abs(video.currentTime-referenceSuggestion.time)<.10;
  const target=preview?referenceSuggestion:anchor;
  if(!target||selecting||(!preview&&(sample?.points||pose))||Math.abs(video.currentTime-target.time)>.10)return;
  const x=rect.x+target.x*rect.w,y=rect.y+target.y*rect.h;
  ctx.save();
  ctx.strokeStyle='#102418';ctx.lineWidth=7;
  ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle=preview?'#ffd960':'#b1f58b';ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(x,y,15,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle=preview?'#ffd960':'#b1f58b';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

function updateTrackBadge(sample) {
  const badge=$('trackBadge');
  let state,label;
  if(selecting) [state,label]=['selecting','Tap your torso in the video'];
  else if(scanJob) [state,label]=['checking','Analyzing your track'];
  else if(referenceSuggestion&&Math.abs(video.currentTime-referenceSuggestion.time)<.10) [state,label]=['checking','Possible match · confirm above'];
  else if(sample?.state==='checking') [state,label]=['checking','Checking possible re-entry'];
  else if(sample?.state==='ambiguous') [state,label]=['lost','Can’t confirm which player is you'];
  else if(sample && !sample.points) [state,label]=['lost','Your body wasn’t detected in this frame'];
  else if(sample?.points) {
    const returned=pose.frames.some(item=>item.state==='reacquired'&&
      item.time<=sample.time&&sample.time-item.time<.65);
    [state,label]=['tracked',returned?'Found you again':'Tracking you'];
  } else if(anchor && !pose) [state,label]=['selected','Selection marked · tap Track me'];
  else if(pose) [state,label]=['checking','Outside analyzed range'];
  badge.hidden=!label;
  if(label) {
    if(badge.dataset.state!==state) badge.dataset.state=state;
    status('trackBadge',label);
  }
}
$('choosePlayer').onclick=()=>{
  if(!ready||soloWorkout?.active)return;
  reconnecting=false;referenceSuggestion=null;
  video.pause();pending=[];pendingPitch=null;pendingGoal=null;team?.cancelPick();selecting=!selecting;
  if(selecting) {
    $('tool').value='Pointer';
    status('selectionHelp','Tap your torso in the video. Tracking starts as soon as you tap.');
  } else {
    status('selectionHelp',anchor?'Selection kept. Tap Track me to run the analysis.':'Pause on a clear frame, then tap Select me.');
  }
  updateCanvasMode();updateTargetControls();paint();
};
$('reconnectMe').onclick=()=>{
  if((!pose&&!longSession)||scanJob||soloWorkout?.active||!ready)return;
  video.pause();pending=[];pendingPitch=null;pendingGoal=null;team?.cancelPick();
  selecting=true;reconnecting=true;$('tool').value='Pointer';
  status('selectionHelp','Tap your chest where you reappear. Your earlier analysis will be kept.');
  updateCanvasMode();updateTargetControls();paint();
};
$('trackMe').onclick=()=>$('scanPose').click();
$('jumpReturn').onclick=()=>{
  const moments=pose?.frames.filter(item=>item.state==='reacquired')||[];
  const next=moments.find(item=>item.time>video.currentTime+.08)||moments[0];
  if(next) {video.pause();seek(next.time);}
};
function poseAt(time) { return sampleAt(pose?.frames,time); }
function updatePosePanel() {
  const sample=poseAt(video.currentTime);
  render3d($('model3d'),sample,Number($('rotation').value));
  const angles=metrics(sample,video.videoWidth/video.videoHeight);
  status('measurements',angles.length
    ? angles.map(([label,value])=>`${label} ${value}°`).join(' · ')+' · Estimated from one camera'
    : pose?'No confident measurements at this timestamp.':'Measurements appear after analysis.');
}
$('rotation').oninput=updatePosePanel;
$('showPose').onchange=paint;
$('showOutline').onchange=paint;
$('ballCues').onchange=renderLongReview;
let drag;
$('model3d').onpointerdown=event=>{
  drag={x:event.clientX,rotation:Number($('rotation').value)};
  event.currentTarget.setPointerCapture(event.pointerId);
};
$('model3d').onpointermove=event=>{
  if(!drag) return;
  const rotation=drag.rotation+(event.clientX-drag.x)*.7;
  $('rotation').value=((rotation+180)%360+360)%360-180;
  updatePosePanel();
};
$('model3d').onpointerup=$('model3d').onpointercancel=()=>{drag=null;};
const matchTime=time=>`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
function renderLongReview() {
  const holder=$('longReview');
  holder.hidden=!longClip();
  $('stopTrackHere').textContent=holder.hidden?'Stop tracking':'Pause scan';
  if(holder.hidden)return;
  const select=$('reviewMatchSection'),action=$('scanMatch');
  const coverage=matchProgress(longSession,video.duration),balls=ballProgress(longSession);
  const next=longSession?nextSection(longSession,video.duration):null;
  const pendingBall=$('ballCues').checked&&balls.sections<balls.ready;
  const busy=!!scanJob||!!soloWorkout?.active;
  action.disabled=busy||!longKey||(!pendingBall&&next===null)||!coverage.count;
  const ballAction=$('scanMatchBall');
  ballAction.disabled=busy||!longKey||balls.ready===balls.sections;
  $('retryMatchBall').hidden=!balls.retry;
  $('retryMatchBall').disabled=busy||!longKey;
  ballAction.textContent=balls.sections&&balls.ready===balls.sections?'Ball scan complete':
    balls.sections?'Continue ball scan':'Scan ball in reviewed sections';
  status('longBallProgress',balls.sections?
    `${balls.sections}/${balls.ready} pose sections checked for ball movement. Ball visible in ${balls.observed}/${balls.tried} sampled frames with a matched player.`:
    'Full match review saves pose sections first, then checks the ball if ball cues are enabled.');
  action.textContent=next===null&&coverage.count&&!pendingBall?'Match review complete':
    next===null||coverage.count>1?'Continue match review':'Review full match';
  const parts=Object.values(longSession?.parts||{}).sort((a,b)=>a.index-b.index);
  select.replaceChildren(new Option('Choose a section',''));
  for(const part of parts) {
    const range=sectionRange(part.index,video.duration);
    const ball=part.ball?part.ball.candidates?` · ${part.ball.candidates} ball candidate(s)`:' · ball checked':'';
    select.add(new Option(`${matchTime(range.start)}–${matchTime(range.end)} · ${part.matched?'player poses':'identity unconfirmed'}${ball}`,part.index));
  }
  select.value=longIndex===null?'':String(longIndex);
  select.disabled=!!scanJob||!longKey||!parts.length;
  status('longProgress',coverage.count?
    `${matchTime(coverage.seconds)} of ${matchTime(video.duration)} scanned · ${coverage.count} saved sections · ${Math.round(100*coverage.matched/Math.max(1,coverage.total))}% of sampled poses matched. Keep this tab open during a match scan.`:
    `This video is ${matchTime(video.duration)}. Select yourself to scan the current ${SECTION_SECONDS}-second section first.`);
}
function displayLongSection(index,result,jump=true) {
  longIndex=index;
  const bounds=sectionRange(index,video.duration);
  pose=result?.frames?.some(frame=>frame.points)?result:null;
  markedMoment=null;scanFailure=null;report=null;
  matchSamples=footLocations(pose?.frames||[]);ballSamples=pose?.ballSamples||[];
  updateCoaching();renderMatch();renderReport();addCandidateButtons(pose?.cues||[]);
  const firstVisible=pose?.frames.find(frame=>frame.points);
  if(jump)seek(firstVisible?.time??bounds.start);
  status('selectionHelp',pose?'Section ready. Play the video to see feedback, or choose another reviewed section.':
    'This section was scanned. The tracker couldn’t confirm your identity. Use Reconnect me here at a clear moment to rescan it.');
  if(pose)status('poseStatus',`Playing back a saved section · ${pose.frames.filter(frame=>frame.points).length} matched pose samples.`);
  updateTargetControls();update(true);
}
async function prepareLongReview(clip) {
  try {
    const key=await matchKey(clip);
    const [saved,notes]=await Promise.all([readMatch(key),readMatchNotes(key)]);
    if(source!==clip)return;
    longKey=key;
    if(notes&&notesRevision===0){restoreMatchNotes(notes);renderMatch();}
    if(saved)longSession=saved;
    if(saved&&!anchor) {
      anchor=saved.anchor;
      const index=sectionAt(anchor.time,video.duration);
      if(saved.parts[index]) {
        const record=await readSection(key,saved,index);
        if(source===clip&&!scanJob)displayLongSection(index,restoreSection(record));
      }
    }
  } catch {
    if(source===clip){longKey=null;status('videoStatus','Browser storage is unavailable. Single sections can still be reviewed.');}
  } finally {
    if(source===clip){longNotesLoading=false;updateTargetControls();renderMatch();}
  }
}
function restoreSection(record) {
  if(!record)return null;
  const restored=openPoseReview(record.pose,video.duration);
  return restored?{...restored,ballSamples:record.ballSamples,forwardMemory:record.forwardMemory}:null;
}
async function loadLongSection(index,jump) {
  const clip=source,session=longSession;
  if(scanJob||!session)return;
  try {
    const result=await readSection(longKey,session,index);
    const stillSelected=jump?$('reviewMatchSection').value===String(index):sectionAt(video.currentTime,video.duration)===index;
    if(source===clip&&longSession===session&&!scanJob&&!selecting&&stillSelected)
      displayLongSection(index,restoreSection(result),jump);
  } catch {if(source===clip)status('selectionHelp','That section could not be restored from browser storage.');}
}
$('reviewMatchSection').onchange=()=>{
  const value=$('reviewMatchSection').value;
  if(value!=='')loadLongSection(Number(value),true);
};
$('scanMatch').onclick=()=>{
  if(scanJob||soloWorkout?.active||!longSession||!longKey)return;
  longAll=true;$('scanPose').click();
};
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&longClip()&&scanJob)scanJob.abort();
});
async function runLongReview(clip,signal,scan,onRetry) {
  await longReady;
  signal.throwIfAborted();
  const index=sectionAt(anchor.time,video.duration);
  const all=longAll&&!!longKey;
  if(!longSession||longReplace) {
    const newSession={id:crypto.randomUUID(),anchor,parts:{}};
    if(longKey)await startMatch(longKey,newSession,longSession);
    signal.throwIfAborted();
    longSession=newSession;
    longIndex=null;
    longReplace=false;
  }
  const key=longKey,duration=video.duration;
  if(all&&nextSection(longSession,duration)===null)return;
  let visible=null;
  await withPoseFallback(engine=>scanSections({session:longSession,duration,
    index:all?nextSection(longSession,duration):index,all,anchorOverride:all?null:longOverride||anchor,signal,
    load:(session,part)=>key?readSection(key,session,part):null,
    scan:options=>scan({...options,lookForBall:false,compact:true,engine}),
    combine:(saved,fresh,time)=>{
      const combined=reconnectTrack(restoreSection(saved),fresh,time);
      return {...combined,ballSamples:[],backwardMemory:saved.backwardMemory||combined.backwardMemory};
    },
    save:(session,part,result)=>key?saveSection(key,session,part,{
      pose:savePoseReview(result,'running',null,'right'),ballSamples:result.ballSamples,
      forwardMemory:result.forwardMemory,backwardMemory:result.backwardMemory,
    }):null,
    onSection(session,part,result) {
      if(source!==clip)return;
      longSession=session;
      if(!visible)visible={part,result};
      renderLongReview();
    },
  }),{signal,compatible:true,onRetry});
  if(source!==clip||!visible)return;
  longOverride=null;
  displayLongSection(visible.part,visible.result);
  const next=nextSection(longSession,video.duration);
  status('poseStatus',key?(next===null?'Whole match scanned. Open a reviewed section to replay its outline and feedback.':
    'Section saved on this device. Select Review full match to continue.'):'Section analyzed. Browser storage is unavailable.');
}

function beginScan(job,message) {
  scanJob=job;scanFailure=null;scanMessage=message;
  $('scanPose').disabled=true;
  $('stopPose').hidden=$('stopTrackHere').hidden=$('poseProgress').hidden=$('liveProgress').hidden=false;
  $('poseProgress').removeAttribute('value');$('liveProgress').removeAttribute('value');
  updateTargetControls();team?.sync();paint();updateLiveCoach(null);
}

function finishScan() {
  scanJob=null;scanMessage='';longAll=false;$('scanPose').disabled=!ready;
  $('stopPose').hidden=$('stopTrackHere').hidden=$('poseProgress').hidden=$('liveProgress').hidden=true;
  updateTargetControls();team?.sync();paint();updateLiveCoach(poseAt(video.currentTime));
}

async function primeDecoder(clip,signal) {
  if(video.readyState<2) {
    const muted=video.muted;
    video.muted=true;
    let timeout;
    try {
      await Promise.race([video.play(),new Promise((_,reject)=>{
        timeout=setTimeout(()=>reject(new Error('Play the video once, pause, then retry the scan.')),5000);
      })]);
    } finally {
      clearTimeout(timeout);
      if(source===clip){video.pause();video.muted=muted;}
    }
  } else video.pause();
  signal.throwIfAborted();
}

function drawScanProgress(message,value) {
  $('poseProgress').value=$('liveProgress').value=Math.max(0,Math.min(1,value));
  scanMessage=`${message} · ${Math.round(value*100)}%`;
  status('poseStatus',scanMessage);updateLiveCoach(null);
}

async function reviewSavedBall(clip,signal,detail=false) {
  const key=longKey,position=video.currentTime;
  const coverage=ballProgress(longSession);
  if(!key||!longSession||(detail?!coverage.retry:coverage.sections===coverage.ready))return;
  scanMessage='Opening the ball detector…';
  status('poseStatus',scanMessage);updateLiveCoach(null);
  let detector,display,message;
  try {
    detector=await objectModel(detail?'ball-detail':'people',signal);
    await scanSavedBallSections({
      session:longSession,duration:video.duration,signal,detail,
      load:(session,index)=>readSection(key,session,index),
      save:(session,index,record)=>saveSection(key,session,index,record),
      scan:async (record,index,range)=>{
        const restored=restoreSection(record);
        if(!restored)throw new Error('A saved section has no usable player pose.');
        const result=await analyzeSectionBall(video,detector,restored.frames,range.start,range.end,{
          signal,progress:value=>drawScanProgress(`Ball scan at ${matchTime(range.start)}`,value),
        });
        return {...result,candidates:suggestBallEvents(result.samples,[]).length};
      },
      onSection(session,index,record) {
        if(source!==clip)return;
        longSession=session;
        if(index===longIndex)display={index,record};
        renderLongReview();
      },
    });
    message=detail?'Detailed ball retry complete. Open a reviewed section to see any new candidates.':
      'Ball scan complete for the saved sections. Open a reviewed section to see its ball candidates.';
  } catch(error) {
    message=signal.aborted?'Ball scan paused. Completed sections are saved.':
      `Ball scan could not finish. ${error.message} Your pose review is still available.`;
  } finally {
    if(detector)closeModel(detector);
    if(source===clip) {
      if(display)displayLongSection(display.index,restoreSection(display.record),false);
      status('selectionHelp',message);status('poseStatus',message);seek(position);
    }
  }
}

async function startBallReview(detail) {
  if(!ready||scanJob||soloWorkout?.active||!longKey||!longSession||team?.isScanning())return;
  const job=new AbortController(),clip=source;
  beginScan(job,'Opening video frames…');
  try {
    await primeDecoder(clip,job.signal);
    await reviewSavedBall(clip,job.signal,detail);
  } catch(error) {
    if(source===clip)status('selectionHelp',error.message);
  } finally {finishScan();}
}
$('scanMatchBall').onclick=()=>startBallReview(false);
$('retryMatchBall').onclick=()=>startBallReview(true);

$('stopPose').onclick=$('stopTrackHere').onclick=()=>scanJob?.abort();
$('scanPose').onclick=async()=>{
  if(!ready || scanJob) return;
  if(soloWorkout?.active){status('videoStatus','End the solo workout before starting a clip scan.');return;}
  if(team?.isScanning()) {status('videoStatus','Stop the team scan before running personal tracking.');return;}
  if(!anchor) {
    $('choosePlayer').click();
    return;
  }
  const job=new AbortController(),clip=source,generation=scanGeneration;
  beginScan(job,'Opening the video frames…');
  try {
    await primeDecoder(clip,job.signal);
    scanMessage='Loading the pose model. The first scan may take longer.';
    status('poseStatus',scanMessage);updateLiveCoach(null);
    const inRange=last>first&&anchor.time>=first/fps()&&anchor.time<(last+1)/fps();
    const onRetry=()=>{
      $('poseProgress').removeAttribute('value');$('liveProgress').removeAttribute('value');
      scanMessage='Restarting with a more compatible pose model…';
      status('poseStatus',scanMessage);updateLiveCoach(null);
    };
    const run=({index,...options})=>analyze({url:sourceUrl,sourceVideo:video,signal:job.signal,onRetry,progress:value=>{
        drawScanProgress(index===undefined?'Analyzing selected player':`Section starting at ${matchTime(index*SECTION_SECONDS)}`,value);
      },...options});
    if(longClip()&&(longAll||!inRange||(last+1-first)/fps()>SECTION_SECONDS)) {
      const runBall=longAll&&$('ballCues').checked;
      await runLongReview(clip,job.signal,run,onRetry);
      if(runBall&&source===clip&&!job.signal.aborted)await reviewSavedBall(clip,job.signal);
      return;
    }
    if(longClip()) {longReplace=false;longOverride=null;}
    const result=await run({anchor,start:previousPose?anchor.time:inRange?first/fps():0,
      end:inRange?(last+1)/fps():video.duration,compact:longClip(),lookForBall:$('ballCues').checked});
    if(source!==clip || generation!==scanGeneration || job.signal.aborted) return;
    pose=reconnectTrack(previousPose,result,anchor.time);
    previousPose=null;
    matchSamples=footLocations(pose.frames);ballSamples=pose.ballSamples||[];
    updateCoaching();renderMatch();
    addCandidateButtons(pose.cues);
    const matched=result.frames.filter(item=>item.points).length;
    const returns=result.frames.filter(item=>item.state==='reacquired').length;
    status('selectionHelp',returns?`Play for coach feedback. Found you again ${returns} time(s); use Next re-entry to review.`:
      'Track ready. Play the clip to see feedback under the video.');
    status('poseStatus',`${matched} of ${result.frames.length} samples matched. Unconfirmed frames were left as gaps.`+
      (result.refined?` Recovered ${result.refined} extra samples on a second pass.`:'')+
      (result.poseOutline?' Outline estimated from visible joints.':'')+
      (result.ballUnavailable?' Ball tracking was unavailable for this scan.':''));
    const selectedFrame=result.frames.find(frame=>frame.points&&frame.time>=anchor.time-.001);
    renderReport();seek(selectedFrame?.time??anchor.time);paint();updatePosePanel();
  } catch(error) {
    if(source===clip&&generation===scanGeneration) {
      scanFailure=job.signal.aborted?(longClip()?'Match scan paused. Completed sections are still available.':'Tracking stopped. Tap Track me to retry.'):
        `Tracking could not finish. ${error?.message||'Try again with a short clip.'}`;
      if(previousPose) {
        pose=previousPose;
        matchSamples=footLocations(pose.frames);ballSamples=pose.ballSamples||[];
        updateCoaching();renderMatch();addCandidateButtons(pose.cues);
        scanFailure+=' Your earlier analysis is still available.';
      }
      status('poseStatus',scanFailure);status('selectionHelp',scanFailure);
      seek(anchor.time);
    }
  } finally {
    finishScan();
  }
};
function poseReport(result) {
  const spans=[];
  for(let i=0;i<result.frames.length;) {
    const start=i, matched=!!result.frames[i].points, values={};
    while(i<result.frames.length && i-start<16 && (i===start||result.frames[i].time-result.frames[i-1].time<=.2) && !!result.frames[i].points===matched) {
      for(const [label,value] of metrics(result.frames[i],video.videoWidth/video.videoHeight)) (values[label] ||= []).push(value);
      i++;
    }
    const measurements=Object.fromEntries(Object.entries(values).filter(([,samples])=>samples.length>=3)
      .map(([label,samples])=>{
        samples.sort((a,b)=>a-b);
        return [label,{label,samples:samples.length,min_deg:samples[0],
          max_deg:samples.at(-1),median_deg:samples[Math.floor(samples.length/2)]}];
      }));
    const start_s=result.frames[start].time,end_s=Math.min(video.duration,result.frames[i-1].time+.125);
    spans.push({start_s,end_s,status:matched?'visible':'identity uncertain',
      frames:i-start,pose_samples:matched?i-start:0,measurements,
      review_cues:[
        ...result.cues.filter(cue=>cue.time>=start_s && cue.time<end_s).map(cue=>cue.feedback),
        ...(coaching?.findings||[]).filter(item=>item.start>=start_s && item.start<end_s)
          .map(item=>`${item.observation} ${item.cue}`),
      ]});
  }
  return {fps:8,spans,references:{'MediaPipe Pose Landmarker':'https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker'}};
}
function addCandidateButtons(cues) {
  const list=$('candidates');list.replaceChildren();
  if(!cues.length) {list.append(element('li','No movement or ball proximity candidates found in the scanned interval.'));return;}
  for(const cue of cues) {
    const li=element('li','');li.append(element('strong',`${cue.time.toFixed(2)} s · ${cue.title}`),
      element('p',cue.feedback));
    const row=element('div','');row.className='row';
    row.append(button('Review',()=>{video.pause();seek(cue.time);$('footage').scrollIntoView();}),
      button('Add tag',()=>{
        const start=Math.max(0,Math.round((cue.time-.5)*fps())),end=Math.min(frameCount()-1,Math.round((cue.time+.8)*fps()));
        if(!tags.some(tag=>tag.start===start&&tag.end===end&&tag.title===cue.title))
          tags.push({start,end,title:cue.title,category:cue.category,feedback:cue.feedback,player:''});
        renderTags();
      }));
    li.append(row);list.append(li);
  }
}
updatePosePanel();

function clearExportPreview() {
  const exported=$('exportedVideo');
  exported.pause();
  exported.removeAttribute('src');
  if(exportPreviewUrl)URL.revokeObjectURL(exportPreviewUrl);
  exportPreviewUrl=null;
  $('exportPreview').hidden=true;
}
function previewExport(blob) {
  clearExportPreview();
  const exported=$('exportedVideo');
  exported.onloadedmetadata=()=>{
    if(exportPreviewUrl)status('exportCheck',`This browser opened the exported clip · ${exported.duration.toFixed(2)} s. Tap Play to check it.`);
  };
  exported.onerror=()=>{
    if(exportPreviewUrl)status('exportCheck','This browser could not preview the export. The download is still available.');
  };
  status('exportCheck','Checking that this browser can open the export…');
  $('exportPreview').hidden=false;
  exportPreviewUrl=URL.createObjectURL(blob);
  exported.src=exportPreviewUrl;
}
$('cancelExport').onclick=()=>exportJob?.abort();
$('exportClip').onclick=async()=>{
  if(!ready||exportJob)return;
  const start=first/fps(),end=Math.min(video.duration,(last+1)/fps());
  if(end-start<.15 || end-start>60) {
    status('videoStatus','Set in and out to export an interval between 0.15 and 60 seconds.');return;
  }
  video.pause();
  const job=new AbortController(),clip=source,rate=fps(),show=$('showPose').checked,outline=$('showOutline').checked;
  exportJob=job;$('exportClip').disabled=true;$('cancelExport').hidden=$('exportProgress').hidden=false;
  $('exportProgress').value=0;
  const includeOriginal=$('exportAudio').checked;
  const voiceNotes=$('exportVoice').checked?tags.filter(tag=>validAudio(tag.voice)&&tag.start/rate<end&&tag.start/rate+30>start)
    .sort((a,b)=>a.start-b.start).slice(0,8).map(tag=>({start:tag.start/rate,audio:tag.voice})):[];
  const audioRequested=includeOriginal||voiceNotes.length>0;
  let audioContext;
  status('videoStatus',audioRequested?'Exporting annotated video with audio…':'Exporting annotated video…');
  try {
    if($('exportVoice').checked&&!voiceNotes.length&&!includeOriginal)
      throw new Error('Record a tagged voice note inside this interval or turn off voice mixing.');
    if(audioRequested) {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context) throw new Error('This browser cannot include audio. Turn off both audio options to export video only.');
      audioContext=new Context();
      await Promise.race([audioContext.resume().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,1500))]);
    }
    const result=await exportClip({url:sourceUrl,sourceFile:clip,start,end,audioContext,includeOriginal,voiceNotes,signal:job.signal,
      onFallback:()=>status('videoStatus','Using the MP4 compatibility encoder…'),
      progress:value=>{$('exportProgress').value=value;},
      draw(surface,decoder,time){
        const ctx=surface.getContext('2d'),rect={x:0,y:0,w:surface.width,h:surface.height};
        ctx.drawImage(decoder,0,0,rect.w,rect.h);
        paintSelectedBody(ctx,rect,poseAt(time),outline,show);
        renderMarks(ctx,rect,marks[Math.round(time*rate)]||[]);
      }});
    if(!job.signal.aborted && source===clip) {
      download(result.blob,`football-clip.${result.extension}`);
      previewExport(result.blob);
      const audio=[result.audio?'source audio':'',result.narration?`${result.narration} voice note(s)`:''].filter(Boolean);
      status('videoStatus',`Exported annotated ${result.extension.toUpperCase()}${audio.length?' with '+audio.join(' and '):' without audio'}.`+
        (result.skipped?` ${result.skipped} voice note(s) could not be decoded.`:''));
    }
  } catch(error) {
    if(source===clip)status('videoStatus',job.signal.aborted?'Export cancelled.':`Export unavailable. ${error.message}`);
  } finally {
    if(audioContext) await audioContext.close().catch(()=>{});
    exportJob=null;$('exportClip').disabled=!ready;$('cancelExport').hidden=$('exportProgress').hidden=true;
  }
};

function stopVoice(discard=false) {
  if(!recording) return;
  recording.discard ||= discard;
  if(recording.recorder.state!=='inactive') recording.recorder.stop();
}
$('voiceStop').onclick=()=>stopVoice();
$('voiceStart').onclick=async()=>{
  if(recording||!ready) return;
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder) {
    status('voiceStatus','Microphone recording is unavailable on this browser.');return;
  }
  const clip=source;let stream;
  $('voiceStart').disabled=true;
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(source!==clip){for(const track of stream.getTracks())track.stop();$('voiceStart').disabled=false;return;}
    const type=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm']
      .find(value=>MediaRecorder.isTypeSupported(value));
    const recorder=new MediaRecorder(stream,type?{mimeType:type,audioBitsPerSecond:48_000}:undefined);
    const session={recorder,discard:false},chunks=[];
    recording=session;
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    recorder.onstop=()=>{
      clearTimeout(session.timer);
      for(const track of stream.getTracks())track.stop();
      $('voiceStart').disabled=false;$('voiceStop').hidden=true;
      if(recording===session) recording=null;
      if(session.discard||source!==clip) return;
      const blob=new Blob(chunks,{type:recorder.mimeType||type||'audio/webm'});
      if(!blob.size||blob.size>1_400_000){status('voiceStatus','Voice note empty or too large.');return;}
      const reader=new FileReader();
      reader.onload=()=>{
        if(source!==clip||session.discard) return;
        if(validAudio(reader.result)) {voiceDraft=reader.result;status('voiceStatus','Voice note ready. Save the tag to attach it.');}
        else status('voiceStatus','This browser used an unsupported voice format.');
      };
      reader.readAsDataURL(blob);
    };
    recorder.onerror=()=>{session.discard=true;stopVoice(true);status('voiceStatus','Voice recording stopped unexpectedly.');};
    recorder.start();
    session.timer=setTimeout(()=>stopVoice(),30000);
    $('voiceStop').hidden=false;status('voiceStatus','Recording · up to 30 seconds');
  } catch {
    for(const track of stream?.getTracks()||[])track.stop();
    recording=null;$('voiceStart').disabled=false;$('voiceStop').hidden=true;
    status('voiceStatus','Could not access the microphone. Check this site’s microphone permission.');
  }
};

async function api(path,options) {
  const response=await fetch(path,options);
  if(!response.ok) {
    let info;try {info=await response.json();}catch {}
    throw new Error(info?.error||`Request failed (${response.status}).`);
  }
  return response;
}
async function listLibrary() {
  try {
    const data=await (await api('/api/reviews')).json();
    const list=$('libraryItems');list.replaceChildren();
    if(!data.items.length)list.append(element('li','No saved reviews yet.'));
    for(const item of data.items) {
      const li=element('li','');li.append(element('strong',item.name),element('small',
        `${item.source} · ${item.hasClip==='yes'?'Clip included':'Review file only'} · ${item.role||'review'}`));
      const row=element('div','');row.className='row';
      row.append(button('Open',()=>openLibrary(item)),button('Team feedback',()=>openTeam(item)));
      if(item.role==='owner')row.append(button('Delete',async()=>{
        if(!confirm(`Delete “${item.name}” from your review library?`))return;
        try {
          await api(`/api/reviews/${item.id}`,{method:'DELETE'});
          if(activeTeam?.id===item.id)closeTeam();
          await listLibrary();
        } catch(error){status('libraryStatus',error.message);}
      }));
      li.append(row);list.append(li);
    }
    status('libraryStatus',`${data.items.length} saved review(s).`);
  } catch(error) { status('libraryStatus',error.message); }
}
async function openLibrary(item) {
  try {
    const review=await (await api(`/api/reviews/${item.id}/review`)).json();
    if(item.hasClip==='yes') {
      if(!allowReplace())return;
      status('libraryStatus','Opening saved footage…');
      const blob=await (await api(`/api/reviews/${item.id}/clip`)).blob();
      loadSource(new File([blob],review.source,{type:blob.type}),false);
      await waitForSource();
      applyReview(review,false);
    } else if(ready && source.name===review.source) applyReview(review);
    else {status('libraryStatus',`Open “${review.source}” from your device, then open this saved review again.`);return;}
    status('libraryStatus',`Opened “${item.name}”.`);
  } catch(error) { status('libraryStatus',error.message||'The saved review could not be opened.'); }
}
$('refreshLibrary').onclick=listLibrary;
$('saveLibrary').onclick=async()=>{
  const name=$('libraryName').value.trim();
  if(!ready||!name) {status('libraryStatus','Open a clip and enter a review name.');return;}
  const include=$('cloudVideo').checked;
  if(include&&source.size>20*1024*1024){status('libraryStatus','The clip is over 20 MB. Save the review without footage.');return;}
  const data=new FormData(), review=JSON.stringify(reviewData());
  if(new Blob([review]).size>10*1024*1024){status('libraryStatus','This review is too large for cloud storage. Download it instead.');return;}
  data.set('name',name);data.set('review',review);
  if(include)data.set('video',source);
  $('saveLibrary').disabled=true;
  status('libraryStatus','Saving…');
  try {await api('/api/reviews',{method:'POST',body:data});await listLibrary();}
  catch(error){status('libraryStatus',error.message);}
  finally {$('saveLibrary').disabled=!ready;}
};
listLibrary();

function updateCoaching() {
  const mode=$('coachMode').value, skill=skills[mode], running=mode==='running';
  $('kickSideLabel').hidden=!skill.foot;
  $('markMoment').hidden=running;
  $('markMoment').textContent=`Mark ${skill.mark||'moment'}`;
  $('markMoment').disabled=!pose||!!scanJob;
  $('saveOutcome').disabled=!ready;
  $('manualReview').hidden=!skill.manual;
  $('attemptHelp').hidden=running;
  const suggestions=pose&&!running&&!skill.manual?skillMoments(mode,{
    frames:pose.frames,ballSamples:pose.ballSamples,eventSuggestions:suggestBallEvents(pose.ballSamples||[],goalPoints)
  }):[];
  const suggestionList=$('skillMoments');
  suggestionList.replaceChildren();
  for(const suggested of suggestions) {
    const item=element('li','');
    item.append(button(`${suggested.time.toFixed(2)} s · ${suggested.label}`,()=>{
      video.pause();markedMoment=suggested.time;seek(suggested.time);updateCoaching();
    }));
    suggestionList.append(item);
  }
  status('successLabel',skill.outcome||'Repeats at your target form');
  if(!running) status('attemptHelp',markedMoment===null
    ? suggestions.length?'Choose a suggested moment or mark the exact frame yourself.':
      `Track yourself, scrub to the ${skill.mark}, then mark it above the video.`
    : `Marked ${skill.mark} at ${markedMoment.toFixed(2)} s.`);
  const aspect=video.videoWidth/video.videoHeight;
  if(!pose) coaching=null;
  else if(running) coaching=coachReview(pose.frames,aspect);
  else if(markedMoment===null) coaching=null;
  else if(skill.manual) {
    const sample=poseAt(markedMoment), choice=$('decisionResult').value;
    const evidence=choice==='late'?'You marked that your scan or movement came late.':
      choice==='closed'?'You marked that your movement did not open a passing lane.':
        'You marked that you scanned and moved into space in time.';
    coaching={matched:sample?.points?1:0,total:1,usableWindows:1,
      findings:[{focus:mode,start:markedMoment,end:markedMoment+.8,observation:evidence,
        cue:'Replay the moment with the receiver and defenders in view. Compare when you look up with when the passer has the ball.'}]};
  } else coaching=attemptReview(pose.frames,markedMoment,mode,$('kickSide').value,aspect);
  if(pose) {report=poseReport(pose);renderReport();}
  renderCoaching();renderClipCoaching();
}
$('coachMode').onchange=()=>{markedMoment=null;updateCoaching();};
$('kickSide').onchange=updateCoaching;
$('decisionResult').onchange=updateCoaching;
$('markMoment').onclick=()=>{
  if(!pose) return;
  video.pause();markedMoment=video.currentTime;updateCoaching();
  $('coachPanel').scrollIntoView({block:'start'});
};
function renderClipCoaching() {
  const panel=$('clipCoaching'),list=$('clipCoachingList'),gaps=$('clipCoachingGaps');
  panel.hidden=!pose;
  list.replaceChildren();gaps.replaceChildren();
  if(!pose)return;
  const aspect=video.videoWidth/video.videoHeight;
  const coverage=poseCoverage(pose.frames,video.duration);
  const running=coachReview(pose.frames,aspect);
  const eventEstimates=currentEstimates();
  const context={frames:pose.frames,ballSamples:pose.ballSamples||[],eventSuggestions:eventEstimates};
  const reviewed=running.findings.map(finding=>({mode:'running',time:finding.start,finding,
    drill:planFor('running',[finding]).items[0]}));
  for(const mode of ['acceleration','braking','touch','dribble','landing','pass','kick']) {
    const eventKind=mode==='kick'?'shot':mode;
    const estimates=eventEstimates.filter(event=>event.kind===eventKind);
    const matches=events.filter(event=>event.kind===eventKind&&event.outcome!=='Unclear');
    const moments=[...matches.map(event=>({time:event.time,confirmed:true})),...skillMoments(mode,context)];
    let count=0;
    for(const {time,confirmed} of moments) {
      if((mode==='kick'||mode==='pass')&&!confirmed&&
        !estimates.some(event=>event.time>=time&&event.time-time<.6))continue;
      if(mode==='dribble'&&!confirmed&&
        !context.ballSamples.some(sample=>sample.nearYou&&Math.abs(sample.time-time)<.35))continue;
      if(reviewed.some(item=>item.mode===mode&&Math.abs(item.time-time)<1))continue;
      const {findings}=attemptReview(pose.frames,time,mode,$('kickSide').value,aspect);
      const finding=skills[mode].foot?findings.find(item=>item.observation.includes('ankles')):findings[0];
      if(!finding)continue;
      reviewed.push({mode,time,finding,drill:planFor(mode,[finding]).items[0]});
      if(++count===2)break;
    }
  }
  const pct=Math.round(100*coverage.matched/Math.max(1,coverage.total));
  status('clipCoachingStatus',`From ${coverage.start.toFixed(1)} to ${coverage.end.toFixed(1)} s, ${pct}% of sampled frames had a confirmed player pose. ${running.usableWindows} usable movement segments. ${reviewed.length} coaching observations.`);
  const absent=['acceleration','braking','touch','dribble','landing','pass','kick']
    .filter(mode=>!reviewed.some(item=>item.mode===mode)).map(mode=>skills[mode].label.toLowerCase());
  status('clipCoachingLimits',(absent.length?`No reliable automatic technique cue for ${absent.join(', ')}. `:'')+
    'Use a marked moment for crossing, pressing, or off-ball decisions.');
  const gap=coverage.gaps[0];
  if(gap&&gap.end-gap.start>=.20)gaps.append(button(`Review tracking gap at ${gap.start.toFixed(1)} s`,()=>{
    video.pause();seek(gap.start);$('footage').scrollIntoView();
  }));
  for(const {mode,time,finding,drill} of reviewed.sort((a,b)=>a.time-b.time)) {
    const item=element('li','');
    item.append(element('strong',`${skills[mode].label} · ${time.toFixed(2)} s`),
      element('p',finding.observation),element('p',finding.cue));
    if(drill)item.append(element('p',`${drill.name} · ${drill.work} · ${drill.rest}`));
    item.append(button('Watch and review',()=>{
      video.pause();$('coachMode').value=mode;markedMoment=mode==='running'?null:time;
      seek(time);updateCoaching();$('footage').scrollIntoView();
    }));
    list.append(item);
  }
  const results=eventTotals(events).filter(item=>item.known);
  if(results.length)list.append(element('li',
    'Marked outcomes · '+results.map(item=>`${item.label} ${item.success}/${item.known} successful`).join(' · ')));
  for(const priority of tacticalPriorities(events)) {
    const item=element('li','');
    item.append(element('strong',`${priority.label} · ${priority.unresolved} of ${priority.known} marked outcomes to review`),
      element('p',priority.cue),button('Watch decision',()=>{
        video.pause();seek(Math.max(0,priority.time-.5));$('footage').scrollIntoView();
      }));
    list.append(item);
  }
}

function renderCoaching() {
  const list=$('coachFindings');list.replaceChildren();
  if(!pose) { $('clipCoaching').hidden=true;$('clipCoachingList').replaceChildren(); }
  updateLiveCoach(poseAt(video.currentTime));
  drawMovementMap($('movementMap'),pose?.frames||[]);
  renderTraining();
  $('shareCoaching').disabled=!pose;
  if(!coaching) {
    status('coachSummary',pose?'Mark a moment in the video to see feedback.':'Select yourself and tap Track me to get feedback on your movement.');
    return;
  }
  const coverage=`${coaching.matched} of ${coaching.total} samples matched your selection.`;
  if(!coaching.usableWindows) {
    status('coachSummary',coverage+($('coachMode').value==='running'?' No repeated steps with both ankles visible were confirmed. Try a clear side view of several strides.':'Mark an attempt with clear footage before and after the moment.'));
    return;
  }
  status('coachSummary',(skills[$('coachMode').value].manual?'Self-review. ':coverage)+(coaching.findings.length
    ?' Review these coaching observations against the footage.'
    :' No clear pattern met the review thresholds in this scan.'));
  for(const finding of coaching.findings) {
    const item=element('li','');
    item.append(element('small',`${finding.start.toFixed(2)} s`),element('strong',finding.observation),element('p',finding.cue));
    const actions=element('div','');actions.className='row';
    actions.append(button('Watch moment',()=>{video.pause();seek(finding.start);$('footage').scrollIntoView();}),
      button('Save as tag',()=>{
        const title='Personal coaching cue', start=Math.round(finding.start*fps());
        const end=Math.min(frameCount()-1,Math.max(start,Math.ceil(finding.end*fps())-1));
        if(!tags.some(tag=>tag.title===title&&tag.start===start&&tag.feedback.startsWith(finding.observation))) {
          tags.push({title,category:skills[$('coachMode').value].category,player:'You',start,end,
            feedback:`${finding.observation} ${finding.cue}`});renderTags();
        }
      }));
    item.append(actions);list.append(item);
  }
}
$('shareCoaching').onclick=async()=>{
  if(!pose)return;
  const title='Football AI Pro · My coaching';
  const overall=[...$('clipCoachingList').children].map(item=>
    item.querySelector('strong')?
      [...item.querySelectorAll('strong,p')].map(element=>element.textContent).join('\n'):item.textContent);
  const text=[title,source.name,$('clipCoachingStatus').textContent,$('clipCoachingLimits').textContent,...overall,
    ...($('coachMode').value==='running'?[]:coaching?.findings||[]).map(finding=>
      `${finding.start.toFixed(2)} s · ${finding.observation} ${finding.cue}`)].join('\n\n');
  if(navigator.share) {
    try {await navigator.share({title,text});return;}
    catch(error){if(error.name==='AbortError') return;}
  }
  download(new Blob([text],{type:'text/plain'}),'my-coaching.txt');
};

function rememberTraining() {
  try { localStorage.setItem('football-ai-pro-training-v1',JSON.stringify({weekly,outcomes})); }
  catch { /* The review export still includes training data. */ }
}

function restoreTraining(data) {
  if(!data) return;
  const importedPlan=Array.isArray(data.weekly)?data.weekly.filter(item=>item&&
    ['key','name','work','rest','setup','progress','check','reason'].every(key=>typeof item[key]==='string')
    && Number.isFinite(item.start)).slice(0,6):[];
  for(const item of importedPlan)
    if(weekly.length<6&&!weekly.some(existing=>existing.key===item.key)) weekly.push(item);
  const importedResults=Array.isArray(data.outcomes)?data.outcomes.filter(item=>item&&Object.hasOwn(skills,item.mode)&&
    outcomeRate(item.attempts,item.successes)!==null&&typeof item.date==='string'&&
    Number.isFinite(Date.parse(item.date))).slice(0,100):[];
  const results=new Map([...outcomes,...importedResults].map(item=>[`${item.mode}:${item.date}`,item]));
  outcomes=[...results.values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,100);
  rememberTraining();
}

function renderTraining() {
  const list=$('trainingList'), kept=$('weeklyPlan'), results=$('outcomes');
  list.replaceChildren();kept.replaceChildren();results.replaceChildren();
  currentPlan=planFor($('coachMode').value,coaching?.findings||[]);
  $('saveFocus').disabled=!currentPlan.items.length||weekly.length>=6;
  $('sharePlan').disabled=!currentPlan.items.length&&!weekly.length;
  status('trainingSummary',currentPlan.items.length
    ? 'Start with two sessions on separate days. Pick up to three drills and film a repeat before progressing.'
    : 'A drill appears when there’s a usable coaching observation. Your saved weekly drills stay below.');
  for(const drill of currentPlan.items) {
    const item=element('li','');
    item.append(element('strong',drill.name),element('p',`${drill.work} · Rest ${drill.rest}`),
      element('p',drill.setup),element('p',`Progression — ${drill.progress}`),
      element('p',`Check next time — ${drill.check}`));
    list.append(item);
  }
  for(const [index,drill] of weekly.entries()) {
    const item=element('li',''), info=element('div','');
    info.append(element('strong',drill.name),element('small',drill.work));
    const details=element('details','');
    details.append(element('summary','Practice and progression'),element('p',drill.setup),
      element('p',`Rest ${drill.rest}. ${drill.progress}`),element('p',drill.check));
    info.append(details);
    item.append(info,button('Remove',()=>{weekly.splice(index,1);rememberTraining();renderTraining();}));
    kept.append(item);
  }
  for(const result of outcomes.slice(0,10)) {
    const rate=outcomeRate(result.attempts,result.successes);
    const local=new Date(result.date).toLocaleDateString();
    const item=element('li','');
    item.append(element('strong',`${skills[result.mode].label} · ${rate}%`),
      element('small',`${result.successes}/${result.attempts} · ${local} · Self-reported`));
    results.append(item);
  }
}

$('saveFocus').onclick=()=>{
  if(!currentPlan) return;
  for(const drill of currentPlan.items) {
    if(weekly.length>=6) break;
    if(!weekly.some(item=>item.key===drill.key)) weekly.push(drill);
  }
  rememberTraining();renderTraining();
  status('trainingSummary','Weekly drills saved on this device. Save the review to your library to reopen them on another device.');
};
$('outcomeForm').onsubmit=event=>{
  event.preventDefault();
  if(!ready) return;
  const attempts=Number($('attemptCount').value),successes=Number($('successCount').value);
  const rate=outcomeRate(attempts,successes);
  if(rate===null) {status('outcomeStatus','Enter 1–500 attempts and a success count from zero up to total attempts.');return;}
  const mode=$('coachMode').value;
  const before=outcomes.find(result=>result.mode===mode);
  outcomes.unshift({mode,attempts,successes,date:new Date().toISOString()});
  outcomes=outcomes.slice(0,100);
  rememberTraining();renderTraining();$('outcomeForm').reset();
  const change=before?rate-outcomeRate(before.attempts,before.successes):null;
  status('outcomeStatus',`Logged ${rate}%.`+(change===null?'':change===0?' Same as your last result.':
    ` ${Math.abs(change)} percentage points ${change>0?'above':'below'} your last result.`));
};
$('sharePlan').onclick=async()=>{
  const drills=weekly.length?weekly:currentPlan.items;
  if(!drills.length) return;
  const title='Football AI Pro · My training plan';
  const text=[title,'Two sessions on separate days. Pick up to three drills per session.',
    ...drills.map(drill=>[drill.name,drill.reason,drill.work,`Rest ${drill.rest}`,drill.setup,
      `Progression: ${drill.progress}`,`Recheck: ${drill.check}`].join('\n'))].join('\n\n');
  if(navigator.share) {
    try {await navigator.share({title,text});return;} catch(error){if(error.name==='AbortError')return;}
  }
  download(new Blob([text],{type:'text/plain'}),'my-training-plan.txt');
};
try {restoreTraining(JSON.parse(localStorage.getItem('football-ai-pro-training-v1')||'null'));} catch {}
updateCoaching();

const cornerLabel=['far-left','far-right','near-right','near-left'];
function drawPitchPoints(ctx,rect) {
  if(!pendingPitch?.length) return;
  ctx.save();
  ctx.strokeStyle='#f8d074';ctx.fillStyle='#f8d074';ctx.lineWidth=2;
  ctx.beginPath();
  pendingPitch.forEach(([x,y],i)=>i?ctx.lineTo(rect.x+x*rect.w,rect.y+y*rect.h):ctx.moveTo(rect.x+x*rect.w,rect.y+y*rect.h));
  ctx.stroke();
  for(const [x,y] of pendingPitch) {
    ctx.beginPath();ctx.arc(rect.x+x*rect.w,rect.y+y*rect.h,5,0,Math.PI*2);ctx.fill();
  }
  ctx.restore();
}
function markPitchPoint(x,y) {
  pendingPitch.push([x,y]);
  if(pendingPitch.length<4) {
    status('videoStatus',`Tap the ${cornerLabel[pendingPitch.length]} pitch corner next.`);
    paint();return;
  }
  const candidate=pendingPitch;pendingPitch=null;
  if(calibratePitch(candidate)) {
    pitch=candidate;rememberMatchNotes();status('videoStatus','Pitch corners saved. Open Match to see your map.');
  } else status('videoStatus','Could not line up the corners. Tap them in order around the pitch.');
  updateCanvasMode();renderMatch();paint();
}
$('startPitch').onclick=()=>{
  if(!ready) return;
  video.pause();pending=[];pendingGoal=null;selecting=false;team?.cancelPick();$('tool').value='Pointer';
  pendingPitch=pendingPitch?null:[];
  updateCanvasMode();updateTargetControls();
  const guide=pendingPitch?'Tap the far-left pitch corner first.':'Pitch calibration cancelled.';
  status('videoStatus',guide);
  if(pendingPitch)$('footage').scrollIntoView({block:'start'});
  renderMatch();paint();
};

for(const [kind,item] of Object.entries(eventKinds)) $('eventKind').add(new Option(item.label,kind));
$('eventKind').value='pass';
function eventOptions() {
  const {results}=eventKinds[$('eventKind').value];
  $('eventOutcome').replaceChildren(...results.map(label=>new Option(label,label)));
  $('eventOutcome').value=results[0];
}
$('eventKind').onchange=eventOptions;
eventOptions();

$('captureEvent').onclick=()=>{
  if(!ready) return;
  $('markEventTime').hidden=false;
  $('footage').scrollIntoView({block:'start'});
  status('videoStatus','Scrub to the action, then tap Use current time.');
};
$('markEventTime').onclick=()=>{
  video.pause();
  const timestamp=Math.floor(video.currentTime*1000)/1000;
  $('eventTime').value=timestamp.toFixed(3);
  $('markEventTime').hidden=true;
  $('matchPanel').scrollIntoView({block:'start'});
};
$('eventForm').onsubmit=event=>{
  event.preventDefault();
  const stamp=$('eventTime').valueAsNumber;
  if(!ready || !Number.isFinite(stamp)||stamp<0||stamp>video.duration) {
    status('matchStatus','Enter a timestamp inside the open clip.');return;
  }
  const kind=$('eventKind').value,outcome=$('eventOutcome').value;
  if(events.some(item=>item.kind===kind&&Math.abs(item.time-stamp)<.08)) {
    status('matchStatus','You already logged that action at this time.');return;
  }
  events.push({kind,time:stamp,outcome,note:$('eventNote').value.trim()});
  rememberMatchNotes();
  $('eventNote').value='';renderMatch();
  status('matchStatus',longClip()&&longKey?'Saving event on this device…':'Event added. Save the review to keep it.');
};
async function rememberMatchNotes() {
  if(!longClip()||!longReady)return;
  notesRevision++;
  const clip=source,revision=notesRevision;
  await longReady;
  if(source!==clip||revision!==notesRevision||!longKey)return;
  try {
    await saveMatchNotes(longKey,{pitch,goalPoints,dismissedEstimates,events,attack:$('attackDirection').value});
    if(source===clip&&revision===notesRevision&&$('matchStatus').textContent==='Saving event on this device…')
      status('matchStatus','Event saved with this match on this device.');
  } catch {
    if(source===clip)status('matchStatus','Could not save match notes in this browser. Download the review to keep them.');
  }
}

function restoreMatchNotes(data) {
  pitch=calibratePitch(data?.pitch)?data.pitch:[];
  dismissedEstimates=Array.isArray(data?.dismissedEstimates)?data.dismissedEstimates.filter(id=>
    typeof id==='string'&&/^(pass|shot):\d+$/.test(id)).slice(0,250):[];
  goalPoints=goalArea(data?.goalPoints)?data.goalPoints:[];
  $('attackDirection').value=data?.attack==='left'?'left':'right';
  events=Array.isArray(data?.events)?data.events.filter(item=>item&&Object.hasOwn(eventKinds,item.kind)&&
    eventKinds[item.kind].results.includes(item.outcome)&&Number.isFinite(item.time)&&item.time>=0&&
    item.time<=video.duration&&typeof item.note==='string').slice(0,1000):[];
}

function restoreMatch(data) {
  restoreMatchNotes(data);
  ballSamples=Array.isArray(data?.ballSamples)?data.ballSamples.filter(sample=>sample&&
    Number.isFinite(sample.time)&&sample.time>=0&&sample.time<=video.duration&&
    (sample.ball===null||Array.isArray(sample.ball)&&sample.ball.length===2&&
    sample.ball.every(value=>Number.isFinite(value)&&value>=0&&value<=1))&&
    (!sample.receiver||(Number.isFinite(sample.receiver.x)&&Number.isFinite(sample.receiver.y)&&
    ['similar','unknown'].includes(sample.receiver.team)))).slice(0,721):[];
  matchSamples=Array.isArray(data?.samples)?data.samples.filter(point=>Array.isArray(point)&&
    point.length===2&&point.every(value=>Number.isFinite(value)&&value>=0&&value<=1)).slice(0,1441):[];
  team?.restore(data?.team);
  renderMatch();
}
function renderMatch() {
  const mapper=calibratePitch(pitch),mapped=drawPitchMap($('pitchMap'),mapper,matchSamples);
  team?.sync();
  $('startPitch').disabled=$('captureEvent').disabled=$('saveEvent').disabled=$('markGoal').disabled=!ready||longNotesLoading;
  $('attackDirection').disabled=longNotesLoading;
  renderTactics(mapper);
  renderSuggestions();
  $('exportEvents').disabled=!events.length&&!currentEstimates().length;
  $('startPitch').textContent=pendingPitch?'Cancel calibration':mapper?'Recalibrate pitch':'Mark pitch corners';
  status('pitchHelp',mapper?mapped?`${mapped} ankle samples projected onto the calibrated pitch. Use a fixed camera.`:
    'Corners saved. Track yourself to map your visible movement.':
    'For a fixed wide-angle clip, mark four visible corners in order around the pitch.');
  const totals=$('matchTotals'),list=$('matchEvents');
  totals.replaceChildren();list.replaceChildren();
  for(const summary of eventTotals(events)) {
    const percentage=summary.known?Math.round(100*summary.success/summary.known):null;
    const title=summary.kind==='pass'?'Confirmed pass completion':summary.kind==='shot'?'Confirmed shots on target':summary.label;
    const text=percentage===null?`${title} · ${summary.unclear} unclear`:
      `${title} · ${summary.success}/${summary.known} (${percentage}%)${summary.unclear?` · ${summary.unclear} unclear`:''}`;
    totals.append(element('li',text));
  }
  for(const [index,item] of [...events.entries()].sort((a,b)=>a[1].time-b[1].time)) {
    const row=element('li','');
    row.append(element('strong',`${item.time.toFixed(2)} s · ${eventKinds[item.kind].label} · ${item.outcome}`));
    if(item.note) row.append(element('p',item.note));
    const actions=element('div','');actions.className='row';
    actions.append(button('Replay',()=>{video.pause();seek(item.time);$('footage').scrollIntoView({block:'start'});}),
      button('Remove',()=>{events.splice(index,1);rememberMatchNotes();renderMatch();}));
    row.append(actions);list.append(row);
  }
  if(pose&&ready)renderClipCoaching();
}
$('exportEvents').onclick=()=>{
  const rows=[['time_s','action','outcome','source','note'],
    ...events.map(item=>[item.time,eventKinds[item.kind].label,item.outcome,'Confirmed',item.note]),
    ...currentEstimates().map(item=>[item.time,eventKinds[item.kind].label,
      item.kind==='shot'?'Projected goal-area entry':'Estimated completion','Automatic estimate',item.note])];
  download(new Blob([rows.map(row=>row.map(csv).join(',')).join('\r\n')],{type:'text/csv'}),'football-match-events.csv');
};
renderMatch();

function drawGoal(ctx,rect) {
  if(!pendingGoal) return;
  const point=pendingGoal[0];
  if(!point)return;
  ctx.save();ctx.fillStyle='#f8d074';
  ctx.beginPath();ctx.arc(rect.x+point[0]*rect.w,rect.y+point[1]*rect.h,6,0,Math.PI*2);ctx.fill();
  ctx.restore();
}
function markGoalPoint(x,y) {
  pendingGoal.push([x,y]);
  if(pendingGoal.length===1) {
    status('videoStatus','Tap the opposite corner of the visible goal mouth.');
    paint();return;
  }
  if(goalArea(pendingGoal)) {
    goalPoints=pendingGoal;rememberMatchNotes();
    status('videoStatus','Goal area saved. Open Match to see shot candidates.');
  } else status('videoStatus','The goal area is too small. Try marking both corners again.');
  pendingGoal=null;updateCanvasMode();renderMatch();paint();
}
$('markGoal').onclick=()=>{
  if(!ready)return;
  video.pause();pending=[];pendingPitch=null;selecting=false;team?.cancelPick();$('tool').value='Pointer';
  pendingGoal=pendingGoal?null:[];
  updateCanvasMode();updateTargetControls();
  if(pendingGoal) {
    status('videoStatus','Tap one corner of the visible goal mouth.');
    $('footage').scrollIntoView({block:'start'});
  }
  renderMatch();paint();
};
$('attackDirection').onchange=()=>{rememberMatchNotes();renderMatch();};
function renderTactics(mapper) {
  const zones=$('tacticalZones'),cues=$('tacticalCues');
  zones.replaceChildren();cues.replaceChildren();
  const priorities=tacticalPriorities(events);
  if(!priorities.length)cues.append(element('li','Confirm outcomes from your clip to get tactical review prompts.'));
  for(const priority of priorities) {
    const li=element('li','');
    li.append(element('strong',`${priority.label} · ${priority.unresolved} of ${priority.known} confirmed outcomes to review`),
      element('p',priority.cue),button('Watch moment',()=>{
        video.pause();seek(Math.max(0,priority.time-1));$('footage').scrollIntoView();
      }));
    cues.append(li);
  }
  const summary=tacticalZones(matchSamples,mapper,$('attackDirection').value);
  if(!summary) {
    zones.append(element('li','Track yourself and calibrate a fixed-camera clip to see field positioning.'));
    return;
  }
  const pct=key=>Math.round(100*summary.counts[key]/summary.usable);
  zones.append(element('li',`Longitudinal thirds · defensive ${pct('defensive')}% · middle ${pct('middle')}% · attacking ${pct('attacking')}%`),
    element('li',`Channels · left ${pct('left')}% · centre ${pct('centre')}% · right ${pct('right')}%`));
  zones.append(element('li','Compare this distribution with your assigned role. Percentages use visible, calibrated samples only.'));
}
function currentEstimates() {
  return unreviewedEstimates(suggestBallEvents(ballSamples,goalPoints),events,dismissedEstimates);
}
function renderAutomatic() {
  const found=currentEstimates(), list=$('autoMatches');
  list.replaceChildren();
  const passes=found.filter(item=>item.kind==='pass').length, shots=found.length-passes;
  status('autoSummary',found.length?
    `${passes} estimated completed pass(es) · ${shots} projected goal-area entr${shots===1?'y':'ies'}`:
    'No unreviewed estimates meet the automatic evidence threshold.');
  for(const item of found) {
    const row=element('li','');
    row.append(element('strong',`${item.time.toFixed(2)} s · ${item.kind==='shot'?'Projected goal-area entry':'Estimated completed pass'}`),
      element('p',item.note));
    const actions=element('div','');actions.className='row';
    actions.append(button('Replay',()=>{video.pause();seek(Math.max(0,item.time-.4));$('footage').scrollIntoView();}),
      button('Review outcome',()=>{
        $('eventKind').value=item.kind;eventOptions();$('eventOutcome').value=item.outcome;
        $('eventTime').value=item.time.toFixed(3);$('eventNote').value='';
        $('eventForm').scrollIntoView({block:'center'});
      }),button('Dismiss estimate',()=>{
        dismissedEstimates.push(estimateId(item));rememberMatchNotes();renderMatch();
      }));
    row.append(actions);list.append(row);
  }
}
function renderSuggestions() {
  const list=$('suggestedEvents');list.replaceChildren();
  renderAutomatic();
  $('markGoal').textContent=pendingGoal?'Cancel goal marking':goalPoints.length?'Re-mark goal area':'Mark goal area';
  status('goalStatus',goalPoints.length?'Goal area marked. Shot cues refer to this region of the picture.':
    'For shot candidates, mark opposite corners of the goal mouth in a fixed-camera clip.');
  if(!ballSamples.length) {
    status('suggestedHelp',longClip()?'Use Scan ball in reviewed sections to look for touches and passes.':
      'Enable ball proximity before you run tracking to find pass and shot candidates.');
    return;
  }
  const found=suggestBallEvents(ballSamples,goalPoints).filter(item=>!item.automatic&&
    !events.some(record=>record.kind===item.kind&&Math.abs(record.time-item.time)<=.7));
  status('suggestedHelp',found.length?'Check candidate events on replay before adding them to your match stats.':
    'No qualifying ball transfer or goal-area event was found. Small or obstructed balls can be missed.');
  for(const event of found) {
    const li=element('li','');
    li.append(element('strong',`${event.time.toFixed(2)} s · Possible ${eventKinds[event.kind].label.toLowerCase()}`),
      element('p',event.note));
    const actions=element('div','');actions.className='row';
    actions.append(button('Replay',()=>{video.pause();seek(Math.max(0,event.time-.4));$('footage').scrollIntoView();}),
      button('Review outcome',()=>{
        $('eventKind').value=event.kind;eventOptions();
        $('eventOutcome').value=event.outcome;
        $('eventTime').value=event.time.toFixed(3);
        $('eventNote').value='';$('eventForm').scrollIntoView({block:'center'});
        status('matchStatus','Verify the outcome and tap Add event to count it.');
      }));
    li.append(actions);list.append(li);
  }
}

function closeTeam() {
  activeTeam=null;
  $('teamReview').hidden=true;
  $('teamNotes').replaceChildren();
}
$('closeTeam').onclick=closeTeam;
async function openTeam(item) {
  activeTeam=item;
  $('teamReview').hidden=false;
  $('teamAccess').hidden=item.role!=='owner';
  $('teamFeedback').hidden=!['owner','coach'].includes(item.role);
  $('teamAccess').reset();$('teamFeedback').reset();
  $('teamTime').value=(ready&&source.name===item.source?video.currentTime:0).toFixed(3);
  status('teamTitle',`Team feedback · ${item.name}`);
  status('teamStatus','Loading feedback…');
  $('teamReview').scrollIntoView({block:'start'});
  await refreshTeamNotes(item);
}
async function refreshTeamNotes(item) {
  try {
    const data=await (await api(`/api/reviews/${item.id}/feedback`)).json();
    if(activeTeam?.id!==item.id)return;
    const list=$('teamNotes');list.replaceChildren();
    for(const note of data.items) {
      const time=Number(note.time);
      const li=element('li','');
      li.append(element('strong',`${note.author} · ${time.toFixed(2)} s`),element('p',note.note));
      if(ready&&source.name===item.source)li.append(button('Replay',()=>{
        video.pause();seek(time);$('footage').scrollIntoView({block:'start'});
      }));
      list.append(li);
    }
    status('teamStatus',data.items.length?`${data.items.length} feedback note(s).`:'No feedback on this review yet.');
  } catch(error) {if(activeTeam?.id===item.id)status('teamStatus',error.message);}
}
$('teamAccess').onsubmit=async event=>{
  event.preventDefault();
  const item=activeTeam;
  if(item?.role!=='owner')return;
  const email=$('teamEmail').value.trim(),role=$('teamRole').value;
  try {
    await api(`/api/reviews/${item.id}/access`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,role})
    });
    if(activeTeam?.id===item.id)status('teamStatus',role==='revoke'?'Review access removed.':
      'Review role saved. Invite the collaborator to the private Site if they do not already have access.');
  } catch(error) {if(activeTeam?.id===item.id)status('teamStatus',error.message);}
};
$('teamFeedback').onsubmit=async event=>{
  event.preventDefault();
  const item=activeTeam;
  if(!['owner','coach'].includes(item?.role))return;
  const time=$('teamTime').valueAsNumber,note=$('teamNote').value.trim();
  if(!Number.isFinite(time)||time<0||(ready&&source.name===item.source&&time>video.duration)||!note) {
    status('teamStatus','Enter feedback and a timestamp inside the video.');return;
  }
  try {
    await api(`/api/reviews/${item.id}/feedback`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({time,note})
    });
    if(activeTeam?.id===item.id) {
      $('teamNote').value='';
      await refreshTeamNotes(item);
    }
  } catch(error) {if(activeTeam?.id===item.id)status('teamStatus',error.message);}
};

team=teamWorkspace({
  video,sourceURL:()=>sourceUrl,hasVideo:()=>ready,busy:()=>!!scanJob||!!soloWorkout?.active,pitchPoints:()=>pitch,
  selectedRange:()=>last>first?{start:first/fps(),end:(last+1)/fps()}:null,
  attackDirection:()=>$('attackDirection').value,seek,
  armPick:()=>{selecting=false;pendingPitch=null;pendingGoal=null;pending=[];$('tool').value='Pointer';updateTargetControls();},
  repaint:()=>{updateCanvasMode();paint();},download
});

function paintSelectedBody(context,rect,sample,outline,showPose) {
  if(!sample?.points)return;
  const drewOutline=outline&&drawBodyOutline(context,rect,sample);
  if(showPose||(outline&&!drewOutline)) skeleton(context,rect,sample.points);
}

function updateLiveCoach(sample) {
  const time=video.currentTime, findings=coaching?.moments||coaching?.findings||[];
  const active=activeCoachingCue(findings,time,sample);
  const panel=$('liveCoach');
  const flag=String(!!active);
  if(panel.dataset.cue!==flag)panel.dataset.cue=flag;
  const button=$('nextCoachCue');
  button.hidden=!findings.length||!!scanJob;
  let label='Playback feedback',observation,cue='';
  if(scanJob) observation=scanMessage||'Analyzing your movement…';
  else if(scanFailure) {label='Tracking needs attention';observation=scanFailure;}
  else if(!pose) observation='Select yourself and tap Track me. Feedback appears here as you play the analyzed clip.';
  else if(!sample) observation='This time is outside the analyzed part of the clip.';
  else if(sample?.state==='ambiguous') observation='Players are visible here, but I can’t confirm which one is you.';
  else if(!sample.points) observation='I don’t have a usable pose for you at this moment. Feedback resumes when I can confirm your track.';
  else if(active) {
    label=`${active.start.toFixed(1)}–${active.end.toFixed(1)} s`;
    observation=active.observation;cue=active.cue;
  } else if(!coaching && $('coachMode').value!=='running') {
    observation='Mark the contact or movement you want reviewed to get feedback here.';
  } else {
    const measurement=metrics(sample,video.videoWidth/video.videoHeight).slice(0,2);
    observation=measurement.length?measurement.map(([name,value])=>`${name} ${value}°`).join(' · '):
      'Tracking you here. No coaching observation for this moment.';
    if(measurement.length)label='Current pose estimates';
  }
  $('liveCue').hidden=!cue;
  status('coachPlaybackLabel',label);
  status('liveObservation',observation);
  status('liveCue',cue);
}
$('nextCoachCue').onclick=()=>{
  const moments=[...(coaching?.moments||coaching?.findings||[])].sort((a,b)=>a.start-b.start);
  const next=moments.find(item=>item.start>video.currentTime+.09)||moments[0];
  if(!next)return;
  video.pause();
  seek(next.start+.02);
  paint();
};
updateLiveCoach(null);
renderPlayerReference();
soloWorkout=setupWorkout({
  blocked:()=>!!scanJob||!!exportJob||!!recording||!!team?.isScanning(),
  onChange:()=>{if(soloWorkout?.active)video.pause();updateTargetControls();team?.sync();},
});
setupBodyMeasurements();
