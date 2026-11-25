export const skills = Object.freeze({
  running:{label:'Running form',category:'Running form'},
  acceleration:{label:'Acceleration',mark:'start',category:'Acceleration',outcome:'Controlled starts'},
  braking:{label:'Deceleration',mark:'braking step',category:'Deceleration',outcome:'Controlled stops'},
  kick:{label:'Shot or free kick',mark:'contact',foot:true,category:'Shot',outcome:'Attempts on target'},
  pass:{label:'Passing technique',mark:'contact',foot:true,category:'Pass',outcome:'Completed passes'},
  cross:{label:'Crossing technique',mark:'contact',foot:true,category:'Pass',outcome:'Crosses reaching the target zone'},
  touch:{label:'Receiving and first touch',mark:'first touch',category:'First touch',outcome:'Controlled first touches'},
  dribble:{label:'Dribble and change of direction',mark:'cut',category:'Change of direction',outcome:'Controlled dribbles'},
  defending:{label:'Defending and pressing',mark:'close-down',category:'Pressing',outcome:'Controlled close-downs'},
  landing:{label:'Jump and landing',mark:'landing',category:'Other',outcome:'Controlled landings'},
  offball:{label:'Off-ball movement and scanning',mark:'decision',category:'Transition',manual:true,outcome:'Effective movements'},
});

const catalog = {
  trunk:['Tall-hips run-through','2 sets × 3 runs of 15 m','45 s between runs',
    'Run at an easy, steady pace. Think tall hips and relaxed shoulders. Film from the side.',
    'Repeat at the same pace until the position is easier to reproduce, then increase the pace slightly.',
    'Compare trunk angle in the middle of two steady runs at the same speed.'],
  knee:['Controlled build-up runs','2 sets × 3 runs of 15 m','60 s between runs',
    'Build smoothly from a walk into an easy run. Keep the same pace on each pass and film both sides.',
    'Add 5 m once both sides look consistent across repeat clips.',
    'Check whether the left–right difference repeats in three full strides from each side.'],
  elbow:['Relaxed arm-drive runs','2 sets × 3 runs of 15 m','45 s between runs',
    'Keep your hands loose. Let each elbow travel backward without intentionally crossing your torso.',
    'Repeat at a slightly quicker pace after you can keep your shoulders relaxed on every run.',
    'Compare left and right arm travel at the same pace.'],
  acceleration:['Controlled 10 m starts','2 sets × 4 starts','60–90 s between starts',
    'Start from a comfortable split stance. Accelerate smoothly through the first three steps.',
    'Alternate the lead foot, then add a ball once the starts are repeatable.',
    'Film the first three steps from the side and count controlled starts.'],
  braking:['Approach and stop in a gate','2 sets × 4 stops','45–60 s between stops',
    'Jog toward a two-cone gate and stop with short steps. Alternate which foot leads the stop.',
    'Increase approach speed only after you can consistently stop inside the gate.',
    'Count stops inside the same gate without extra recovery steps.'],
  kick:['Same-spot target strikes','2 sets × 5 kicks','45 s between kicks',
    'Strike from the same spot at a large target with a short approach. Film support-foot placement and follow-through.',
    'Shrink the target after 8 of 10 controlled strikes reach the original target.',
    'Log attempts on target and compare the support-foot position across clips.'],
  pass:['Two-cone passing gate','2 sets × 6 passes per foot','45 s between sets',
    'Pass through a wide gate at short range. Reset at the same spot and finish facing the target.',
    'Narrow the gate or add a moving receiver after two consistent sets.',
    'Record completed passes separately for each foot.'],
  cross:['Cross into a target zone','2 sets × 5 crosses','45–60 s between crosses',
    'Mark a generous target zone. Start with a stationary ball and repeat the same approach.',
    'Add a moving ball after the delivery reaches the zone consistently.',
    'Record how many deliveries reach the marked zone.'],
  touch:['Receive through an exit gate','2 sets × 6 receptions per side','45 s between sets',
    'Use a wall or partner. Receive across your body and guide the first touch through a nearby cone gate.',
    'Vary the return angle after the first touch regularly sets up the next action.',
    'Count touches that stay within one playing step and enter the gate.'],
  dribble:['Two-way cone cut','2 sets × 5 cuts each way','45 s between sets',
    'Approach a cone slowly with a ball. Shorten the setup step and take a controlled first touch out of the turn.',
    'Increase speed or add a passive defender after both directions are repeatable.',
    'Count clean exits and film the last step before the cut.'],
  defending:['Close down and hold','2 sets × 5 close-downs','45 s between sets',
    'Approach a cone or passive partner. Slow down before reaching them and finish balanced in a staggered stance.',
    'Let the partner choose either side once you can stop under control.',
    'Count attempts where you finish balanced without crossing your feet.'],
  landing:['Low jump and stick','2 sets × 5 low jumps','45–60 s between sets',
    'Use a small two-foot jump on a clear, level surface. Land comfortably and hold the finish for two seconds.',
    'Add a small forward jump after the finish is steady across all reps.',
    'Film from the front and side and count steady two-second finishes.'],
  offball:['Scan and move into a passing lane','2 sets × 6 moves','45 s between sets',
    'With a partner or cones, check over your shoulder, then move into a clear receiving lane before the pass.',
    'Add a passive defender or two possible receiving lanes.',
    'Log moves where your scan comes before the pass and you offer a visible passing lane.'],
};

export function outcomeRate(attempts, successes) {
  if(!Number.isSafeInteger(attempts)||!Number.isSafeInteger(successes)||attempts<1||attempts>500||
      successes<0||successes>attempts) return null;
  return Math.round(100*successes/attempts);
}

export function planFor(mode,findings) {
  const priorities=Array.isArray(findings)?findings:[];
  const byKey=new Map();
  for(const finding of priorities) {
    const key=finding.focus;
    if(!Object.hasOwn(catalog,key)||byKey.has(key)) continue;
    const [name,work,rest,setup,progress,check]=catalog[key];
    byKey.set(key,{key,name,work,rest,setup,progress,check,reason:finding.observation,start:finding.start});
  }
  return {skill:skills[mode]?.label||'Football technique',sessions:2,items:[...byKey.values()].slice(0,3)};
}
