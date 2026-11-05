import {PhysicsClock} from './physics-clock.js';

// SI contract: domains advance exactly one shared mechanical tick. Heat may
// subcycle inside that tick. The caller owns transaction rollback on failure.
export class CouplingStepper{
  constructor(baseDt,domains){this.clock=new PhysicsClock(baseDt);this.domains=domains;}
  next(end,interfaceLimit=Infinity){
    const start=this.domains[0].time(),schedules=this.domains.map(d=>d.schedule());
    for(const d of this.domains)if(Math.abs(d.time()-start)>1e-12)throw Error('耦合域时钟不同步');
    const tick=this.clock.next(start,end,Math.min(interfaceLimit,...this.domains.map(d=>d.stableDt())),{
      maxDt:Math.min(...schedules.map(s=>s.maxDt??Infinity)),nextEvent:Math.min(...schedules.map(s=>s.nextEvent??Infinity))});
    return {...tick,start,index:this.clock.steps};
  }
  advance(tick){
    for(const d of this.domains){
      const before=d.steps();d.advance(tick);
      if(d.steps()!==before+1||Math.abs(d.time()-tick.end)>1e-12)throw Error('耦合域未按共享子步推进：'+d.id);
    }
  }
  snapshot(){const times=this.domains.map(d=>d.time());return {schema:'coupling-clock/1',...this.clock.snapshot(),
    domains:this.domains.map(d=>({id:d.id,time:d.time(),steps:d.steps()})),maxDrift:Math.max(...times)-Math.min(...times)};}
}

const scale=(a,s)=>a.map(x=>x*s),sum=(a,b)=>a.map((x,k)=>x+b[k]);
// Endpoint ports return actual kinetic work and the impulse absorbed by a
// fixed support. Geometry and constitutive laws stay in the domain adapters.
export function exchangeImpulse(a,b,J){
  if(J.length!==3||!J.every(Number.isFinite))throw Error('界面冲量须为有限 SI 向量');
  const A=a.applyImpulse(J),B=b.applyImpulse(scale(J,-1));
  const support=sum(A.support,B.support),residual=sum(sum(A.impulse,B.impulse),support);
  if(![A.work,B.work,...support,...residual].every(Number.isFinite))throw Error('界面冲量回执无效');
  return {workA:A.work,workB:B.work,support,impulseResidual:residual};
}

// Thermal ports: temperature [°C], capacity [J/K], receive [J -> accepted J].
// All edges read the same temperature state before a capacity-limited update.
export function exchangeHeat(edges,dt){
  if(!Number.isFinite(dt)||dt<=0)throw Error('界面热步长无效');
  const budget=new Map(),results=new Map();
  for(const e of edges){for(const p of [e.a,e.b])budget.set(p,(budget.get(p)??0)+e.g);if(!results.has(e.pair))results.set(e.pair,{heatA:0,heatB:0,samples:0});}
  let limit=Infinity;for(const [p,g] of budget){const C=p.capacity();if(!(C>0)||!(g>0))throw Error('界面热容量或热导无效');limit=Math.min(limit,.45*C/g);}
  const count=Math.max(1,Math.ceil(dt/limit));if(count>10000)throw Error('混合接触热子步过多');
  let residual=0;
  for(let n=0;n<count;n++){
    const temperatures=new Map([...budget.keys()].map(p=>[p,p.temperature()])),Q=new Map();
    for(const e of edges){const q=(temperatures.get(e.b)-temperatures.get(e.a))*e.g*dt/count,r=results.get(e.pair);
      Q.set(e.a,(Q.get(e.a)??0)+q);Q.set(e.b,(Q.get(e.b)??0)-q);r.heatA+=q;r.heatB-=q;r.samples++;}
    for(const [p,q] of Q){const actual=p.receive(q);if(!Number.isFinite(actual)||Math.abs(actual-q)>1e-7*Math.max(1,Math.abs(q)))throw Error('混合换热能量更新失败');residual+=actual-q;}
  }
  return {results,substeps:edges.length?count:0,residual};
}

export class ExchangeBook{
  constructor(){this.entries=new Map();this.heatResidual=0;this.heatSubsteps=0;}
  entry(id){if(!this.entries.has(id))this.entries.set(id,{workA:0,workB:0,normalLoss:0,frictionLoss:0,heatA:0,heatB:0,impulses:0,support:[0,0,0],impulseResidual:[0,0,0]});return this.entries.get(id);}
  impulse(id,r,kind,loss){const e=this.entry(id);e.workA+=r.workA;e.workB+=r.workB;e[kind+'Loss']+=loss;e.impulses++;e.support=sum(e.support,r.support);e.impulseResidual=sum(e.impulseResidual,r.impulseResidual);}
  heat(r){this.heatResidual+=r.residual;this.heatSubsteps+=r.substeps;for(const [id,q] of r.results){const e=this.entry(id);e.heatA+=q.heatA;e.heatB+=q.heatB;}}
  snapshot(){return {schema:'coupling-exchanges/1',units:{impulse:'N s',work:'J',heat:'J'},heatResidual:this.heatResidual,heatSubsteps:this.heatSubsteps,
    pairs:[...this.entries].map(([id,e])=>({id,...structuredClone(e),workResidual:e.workA+e.workB+e.normalLoss+e.frictionLoss}))};}
  backup(){return structuredClone({entries:this.entries,heatResidual:this.heatResidual,heatSubsteps:this.heatSubsteps});}
  restore(data){Object.assign(this,structuredClone(data));}
}
