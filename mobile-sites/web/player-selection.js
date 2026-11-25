export const located = point => point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
  (point.visibility ?? 1) >= .30;

const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const midpoint=(a,b)=>a&&b?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a||b;

function colourPatch(ctx,point,radius) {
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
  return {bins,lower,socks,hip,center,torso,shape};
}

export function kitDistance(a,b) {
  let shared=0;
  for(let i=0;i<a.bins.length;i++)shared+=Math.sqrt(a.bins[i]*b.bins[i]);
  return Math.sqrt(Math.max(0,1-shared));
}

function appearance(a,b) {
  const lower=a.lower&&b.lower, socks=a.socks&&b.socks;
  const shirt=kitDistance(a,b);
  const shorts=lower?kitDistance({bins:a.lower},{bins:b.lower}):shirt;
  const legs=socks?kitDistance({bins:a.socks},{bins:b.socks}):shirt;
  const shape=a.shape&&b.shape?Math.abs(a.shape-b.shape):0;
  return .70*shirt+.23*shorts+.07*legs+.04*Math.min(1,shape);
}

export class PlayerLock {
  constructor(signature,references=[signature]) {
    this.seed=signature;
    this.references=[...references];
    this.last=signature;
    this.missing=0;
    this.pending=null;
    this.streak=0;
  }

  rank(people) {
    return people.map(person=>{
      const colour=Math.min(...this.references.map(reference=>appearance(reference,person.sig)));
      const spatial=gap(this.last.hip,person.sig.hip);
      return {person,colour,spatial,score:colour+Math.min(this.missing?.14:.30,spatial*(this.missing?.35:1.2))};
    }).sort((a,b)=>a.score-b.score);
  }

  match(people) {
    const [best,second]=this.rank(people);
    let person=null,state='lost';
    if(best&&best.colour<(this.missing?.36:.50)&&
      (!second||second.score-best.score>(this.missing?.10:.05))) {
      if(!this.missing&&best.spatial<Math.max(.035,Math.min(.16,(this.last.torso||.06)*3))) {
        person=best.person;
        state='tracked';
        if(best.spatial<.07&&best.colour>.06&&best.colour<.24&&person.sig.lower) {
          this.references.push(person.sig);
          if(this.references.length>5)this.references.splice(1,1);
        }
      } else {
        const same=this.pending&&appearance(this.pending,best.person.sig)<.27&&gap(this.pending.hip,best.person.sig.hip)<.15;
        this.streak=same?this.streak+1:1;
        this.pending=best.person.sig;
        state='checking';
        if(this.streak>=3){person=best.person;state='reacquired';}
      }
    } else {
      this.pending=null;
      this.streak=0;
    }
    if(person) {
      this.last=person.sig;
      this.missing=0;
      this.pending=null;
      this.streak=0;
    } else this.missing++;
    return {person,state};
  }
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
