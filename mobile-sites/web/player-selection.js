export const located = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  (point.visibility ?? 1) >= .30;

const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const midpoint=(a,b)=>a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a||b;

export function colourPatch(ctx,point,radius) {
  if(!point)return null;
  const {width,height}=ctx.canvas;
  const x=Math.max(0,Math.floor((point.x-radius)*width));
  const y=Math.max(0,Math.floor((point.y-radius)*height));
  const w=Math.min(width-x,Math.max(3,Math.round(radius*2*width)));
  const h=Math.min(height-y,Math.max(3,Math.round(radius*2*height)));
  if(w<3||h<3)return null;
  const data=ctx.getImageData(x,y,w,h).data,bins=new Float32Array(64);
  for(let i=0;i<data.length;i+=4) {
    const r=data[i],g=data[i+1],b=data[i+2],light=Math.max(55,r,g,b);
    const bin=(Math.min(3,Math.floor(4*r/(light+1)))<<4) |
      (Math.min(3,Math.floor(4*g/(light+1)))<<2) | Math.min(3,Math.floor(4*b/(light+1)));
    bins[bin]+=4/data.length;
  }
  return bins;
}

function torsoPattern(ctx,shoulder,hip) {
  const {width,height}=ctx.canvas;
  const dx=(hip.x-shoulder.x)*width,dy=(hip.y-shoulder.y)*height;
  const points=[];
  for(const row of [.28,.58,.82])for(const across of [-.20,0,.20]) {
    points.push([
      Math.round(shoulder.x*width+dx*row-dy*across),
      Math.round(shoulder.y*height+dy*row+dx*across),
    ]);
  }
  if(Math.hypot(dx,dy)<13||points.some(([x,y])=>x<1||x>=width-1||y<1||y>=height-1))return null;
  const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
  const x=Math.min(...xs)-1,y=Math.min(...ys)-1,w=Math.max(...xs)-x+2,h=Math.max(...ys)-y+2;
  const pixels=ctx.getImageData(x,y,w,h).data;
  return points.map(([px,py])=>{
    let r=0,g=0,b=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++) {
      const index=((py-y+j)*w+px-x+i)*4;
      r+=pixels[index];g+=pixels[index+1];b+=pixels[index+2];
    }
    const total=Math.max(180,r+g+b);
    return [r/total,g/total,(r+g+b)/(9*765)];
  });
}

export function playerSignature(points,ctx) {
  const p=i=>located(points[i])?points[i]:null;
  const shoulder=midpoint(p(11),p(12)),hip=midpoint(p(23),p(24)),knee=midpoint(p(25),p(26));
  if(!shoulder||!hip)return null;
  const torso=gap(shoulder,hip);
  if(torso<.006)return null;
  const center=midpoint(shoulder,hip),radius=Math.min(.045,torso*.19);
  const bins=colourPatch(ctx,center,radius);
  if(!bins)return null;
  const ankle=midpoint(p(27),p(28));
  const lower=knee?colourPatch(ctx,midpoint(hip,knee),radius):null;
  const socks=knee&&ankle?colourPatch(ctx,midpoint(knee,ankle),radius*.75):null;
  const shape=p(11)&&p(12)?gap(p(11),p(12))/torso:0;
  return {bins,lower,socks,hip,center,torso,shape,pattern:torsoPattern(ctx,shoulder,hip)};
}

export function kitDistance(a,b) {
  let shared=0;
  for(let i=0;i<a.bins.length;i++)shared+=Math.sqrt(a.bins[i]*b.bins[i]);
  return Math.sqrt(Math.max(0,1-shared));
}

function patternDistance(a,b) {
  if(!a||!b)return 0;
  const compare=(mirror)=>a.reduce((sum,[r,g,l],i)=>{
    const [rr,gg,ll]=b[mirror?i+2-2*(i%3):i];
    return sum+Math.min(1,Math.hypot(r-rr,g-gg)*1.8+Math.abs(l-ll)*.9);
  },0)/a.length;
  return Math.min(compare(false),compare(true));
}

export function appearance(a,b) {
  const shirt=kitDistance(a,b);
  const shorts=a.lower&&b.lower?kitDistance({bins:a.lower},{bins:b.lower}):shirt;
  const legs=a.socks&&b.socks?kitDistance({bins:a.socks},{bins:b.socks}):shirt;
  const shape=a.shape&&b.shape?Math.abs(a.shape-b.shape):0;
  return .67*shirt+.23*shorts+.10*legs+.20*patternDistance(a.pattern,b.pattern)+.04*Math.min(1,shape);
}

export class PlayerLock {
  constructor(signature,references=[signature]) {
    this.seed=signature;
    this.references=[...references];
    this.last=signature;
    this.velocity={x:0,y:0};
    this.missing=0;
    this.pending=null;
    this.streak=0;
    this.acrossCut=false;
  }

  markDiscontinuity() {
    this.missing=Math.max(7,this.missing);
    this.velocity={x:0,y:0};
    this.pending=null;
    this.streak=0;
    this.acrossCut=true;
  }

  predicted() {
    const ahead=Math.min(this.missing+1,4),fade=this.missing>6?0:1;
    return {
      x:this.last.center.x+this.velocity.x*ahead*fade,
      y:this.last.center.y+this.velocity.y*ahead*fade,
    };
  }

  rank(people) {
    const hasMotion=!!this.last.center;
    const target=hasMotion?this.predicted():this.last.hip;
    return people.map(person=>{
      const sig=person.sig;
      const colour=Math.min(...this.references.map(reference=>appearance(reference,sig)));
      const spatial=gap(target,sig.center||sig.hip);
      const scale=this.last.torso&&sig.torso?Math.abs(Math.log(sig.torso/this.last.torso)):0;
      const continuity=this.missing>6?.24:this.missing>1?.9:2;
      return {person,colour,spatial,scale,score:colour+Math.min(.35,spatial*continuity)+
        (this.missing>6?0:Math.min(.14,scale*.13))};
    }).sort((a,b)=>a.score-b.score);
  }

  match(people) {
    const [best,second]=this.rank(people);
    const radius=Math.max(.032,Math.min(.15,(this.last.torso||.05)*2.7));
    const close=best&&best.spatial<radius&&best.scale<.63;
    const margin=second?second.score-best.score:Infinity;
    let person=null,state=people.length?'ambiguous':'lost';
    const stable=close&&this.missing<=2&&!this.acrossCut;
    const colourLimit=this.acrossCut?.26:stable?.52:.34;
    const marginLimit=this.acrossCut?.13:stable?.038:.085;
    if(best&&best.colour<colourLimit&&margin>marginLimit) {
      const briefGap=this.missing===1&&best.spatial<Math.min(.024,radius*.45)&&best.scale<.40&&best.colour<.24&&margin>.13;
      if(close&&(!this.missing||briefGap)) {
        person=best.person;
        state=briefGap?'reacquired':'tracked';
        if(!briefGap&&best.spatial<radius*.55&&best.colour>.06&&best.colour<.25&&margin>.11&&person.sig.lower) {
          this.references.push(person.sig);
          if(this.references.length>8)this.references.splice(1,1);
        }
      } else {
        const candidate=best.person.sig;
        const same=this.pending&&appearance(this.pending,candidate)<.28&&gap(this.pending.hip,candidate.hip)<.15;
        this.streak=same?this.streak+1:1;
        this.pending=candidate;
        state='checking';
        const required=this.acrossCut?4:close&&this.missing<=3&&best.colour<.22?2:3;
        if(this.streak>=required){person=best.person;state='reacquired';}
      }
    } else {
      this.pending=null;
      this.streak=0;
    }
    if(person) {
      const next=person.sig;
      if(state==='tracked'&&next.center&&this.last.center) {
        this.velocity={
          x:.4*this.velocity.x+.6*(next.center.x-this.last.center.x),
          y:.4*this.velocity.y+.6*(next.center.y-this.last.center.y),
        };
      } else this.velocity={x:0,y:0};
      this.last=next;
      this.acrossCut=false;
      this.missing=0;
      this.pending=null;
      this.streak=0;
    } else this.missing++;
    return {person,state};
  }
}

export function gapCandidate(people,prior,next,mix) {
  if(!prior||!next)return null;
  const bracketDistance=gap(prior.center,next.center);
  const size=Math.max(.012,Math.min(prior.torso,next.torso));
  if(bracketDistance>size*2.4||appearance(prior,next)>.30)return null;
  const expected={x:prior.center.x+(next.center.x-prior.center.x)*mix,
    y:prior.center.y+(next.center.y-prior.center.y)*mix};
  const search=Math.max(.012,Math.min(.045,size*.80));
  const candidates=people.map(person=>({
    person,distance:gap(expected,person.sig.center),
    colour:Math.max(appearance(prior,person.sig),appearance(next,person.sig)),
    scale:Math.abs(Math.log(person.sig.torso/((prior.torso+next.torso)/2))),
  })).filter(item=>item.distance<search&&item.colour<.34&&item.scale<.55)
    .map(item=>({...item,score:item.colour+item.distance/search*.23}))
    .sort((a,b)=>a.score-b.score);
  const [best,second]=candidates;
  return best&&(!second||second.score-best.score>.07)?best.person:null;
}

export function reentryCrop(index,width,height) {
  const landscape=width>=height;
  const ratio=Math.max(width,height)/Math.min(width,height);
  const columns=Math.max(2,Math.ceil(ratio/.6));
  const along=((index%columns)+.5)/columns;
  const across=Math.floor(index/columns)%2?.70:.30;
  return playerCrop(landscape?{x:along,y:across}:{x:across,y:along},.68,width,height);
}

export function tappedPlayer(people,anchor,width,height,margin=.014) {
  const aspect=width/height;
  const ranked=people.map(person=>{
    const joints=person.points.filter(located);
    const xs=joints.map(p=>p.x),ys=joints.map(p=>p.y);
    const xGap=Math.max(0,Math.min(...xs)-anchor.x,anchor.x-Math.max(...xs))*aspect;
    const yGap=Math.max(0,Math.min(...ys)-anchor.y,anchor.y-Math.max(...ys));
    const outside=Math.hypot(xGap,yGap);
    const distance=p=>Math.hypot((p.x-anchor.x)*aspect,p.y-anchor.y);
    const nearest=Math.min(...joints.map(distance));
    return {person,outside,score:outside+nearest*.64+distance(person.sig.center)*.36};
  }).filter(item=>item.outside<=margin).sort((a,b)=>a.score-b.score);
  if(!ranked.length)return null;
  const [best,second]=ranked;
  return !second||second.score-best.score>Math.min(.025,Math.max(.007,best.person.sig.torso*.17))?best.person:null;
}

export function playerCrop(center,zoom,width,height) {
  const side=Math.max(2,Math.round(Math.min(width,height)*zoom));
  return {
    x:Math.max(0,Math.min(width-side,Math.round(center.x*width-side/2))),
    y:Math.max(0,Math.min(height-side,Math.round(center.y*height-side/2))),
    side,width,height,
  };
}

export const uncropPoint=(point,crop)=>({...point,
  x:(crop.x+point.x*crop.side)/crop.width,y:(crop.y+point.y*crop.side)/crop.height});

export function mergePlayers(people,extra) {
  const result=[...people];
  for(const player of extra) {
    const duplicate=result.findIndex(other=>gap(other.sig.center,player.sig.center)<
      Math.min(other.sig.torso,player.sig.torso)*.30);
    if(duplicate<0)result.push(player);
    else if(player.points.filter(located).length>result[duplicate].points.filter(located).length)
      result[duplicate]=player;
  }
  return result;
}
