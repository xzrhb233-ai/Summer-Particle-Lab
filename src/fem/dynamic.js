import {validateFEM} from './model.js';
import {boxMesh,dot,cross} from './mesh.js';
import {assemble,multiply,boundaryData,pcg,recover} from './solver.js';
import {femBindingValue,femBindingIntegral,programEvents} from './program.js';
import {FEMContacts} from './contact.js';
import {makeThermalData,FEMThermalSystem,elasticEnergy} from './thermal.js';
import {resolveSurfaceSelection} from '../simulation/surface-selections.js';

export function lumpedMass(mesh,density){
  const m=new Float64Array(mesh.nodes.length*3);
  for(const c of mesh.cells)for(const n of c.ids)for(let k=0;k<3;k++)m[3*n+k]+=density*c.volume/4;
  return m;
}
// Gershgorin upper bound on the largest eigenvalue of M^-1/2 K_ff M^-1/2.
// Hence 2/sqrt(bound) is a conservative central-difference stability limit.
export function stabilityLimit(A,m,fixed){
  let bound=0;
  for(let i=0;i<m.length;i++)if(!fixed[i]){
    let row=0;
    for(let j=A.offsets[i];j<A.offsets[i+1];j++)if(!fixed[A.indices[j]])row+=Math.abs(A.values[j])/Math.sqrt(m[i]*m[A.indices[j]]);
    bound=Math.max(bound,row);
  }
  return bound>0?2/Math.sqrt(bound):Infinity;
}
const kinetic=(m,v)=>v.reduce((s,x,i)=>s+.5*m[i]*x*x,0);
export function faceMean(mesh,values,face='x+'){
  const faces=mesh.surface.filter(f=>f.face===face||f.surfaceKey===face),area=faces.reduce((s,f)=>s+f.area,0),v=[0,0,0];
  if(!(area>0))return [null,null,null];
  for(const f of faces)for(const n of f.nodes)for(let k=0;k<3;k++)v[k]+=f.area/(3*area)*values[3*n+k];
  return v;
}
function makeState(project,part){
  const mesh=boxMesh(part),A=assemble(mesh,part.material),bc=boundaryData(project,part,mesh),m=lumpedMass(mesh,part.material.density);
  const thermal=makeThermalData({...part,material:{...part.material,expansion:project.solver.thermal?part.material.expansion:0}},mesh,m,A),initialForce=Float64Array.from(bc.f,(x,i)=>x+thermal.force[i]);
  const u=project.solver.initialState==='equilibrium'?pcg(A,initialForce,bc.fixed,project.solver).u:new Float64Array(m.length);
  const v=Float64Array.from(m,(_,i)=>bc.fixed[i]?0:part.initial.velocity[i%3]);
  const bindings=project.loadBindings.filter(b=>b.enabled&&b.target===part.id).map(b=>{
    const l=project.loads.find(l=>l.id===b.load),selection=project.selectionSets.find(s=>s.id===l.selection);
    const {triangles,area,key}=resolveSurfaceSelection(part,mesh,selection),weights=new Float64Array(m.length);
    for(const t of triangles)for(const n of t.nodes)for(let k=0;k<3;k++)weights[3*n+k]+=t.area/3*(b.kind==='fem-force'?(k===b.component?1/area:0):-t.normal[k]);
    return {...b,surfaceKey:key,curveDefinition:project.curves.find(c=>c.id===b.curve),weights,base:b.kind==='fem-force'?l.force[b.component]:l.pressure};
  });
  const responseLoad=project.loads.find(l=>l.target===part.id&&['fem-force','fem-pressure'].includes(l.type)),response=responseLoad?resolveSurfaceSelection(part,mesh,project.selectionSets.find(s=>s.id===responseLoad.selection)):null;
  return {part,mesh,A,m,u,v,...bc,bindings,responseSurface:response?{key:response.key,label:response.label}:null,thermal,internal:multiply(A,u),f0:new Float64Array(m.length),f1:new Float64Array(m.length),
    initialEnergy:kinetic(m,v)+dot(u,multiply(A,u))/2-dot(u,thermal.force)+thermal.constant,externalWork:0,dissipated:0,criticalDt:stabilityLimit(A,m,bc.fixed)};
}
function forceAt(s,t,out){
  out.set(s.f);
  for(let i=0;i<out.length;i++)out[i]+=s.thermal.force[i];
  for(const b of s.bindings){
    const delta=femBindingValue(b,b.curveDefinition,t)-b.base;
    for(let i=0;i<out.length;i++)out[i]+=delta*b.weights[i];
  }
  return out;
}
function advance(s,t,h,damping){
  // Exact mass-proportional damping split around velocity Verlet (Strang).
  // This avoids an explicit damping stability penalty; no artificial mass scaling.
  const {u,v,m,fixed,internal,f0,f1}=s,decay=Math.exp(-damping*h/2),loss=-Math.expm1(-damping*h);
  forceAt(s,t,f0);
  // Endpoint force uses the left limit at a step discontinuity. The next
  // interval starts from its right limit; no impulse or half-step smear.
  forceAt(s,t+h-Math.min(h*1e-7,1e-12*Math.max(1,t+h)),f1);
  let work=0,dissipation=0;
  for(let i=0;i<u.length;i++){
    if(fixed[i])continue;
    dissipation+=.5*m[i]*v[i]*v[i]*loss;v[i]*=decay;
    v[i]+=.5*h*(f0[i]-internal[i])/m[i];
    const du=h*v[i];u[i]+=du;work+=(.5*(f0[i]+f1[i])-s.thermal.force[i])*du;
  }
  multiply(s.A,u,internal);
  if(!internal.every(Number.isFinite))throw Error('FEM 动力学数值失稳；内力出现非有限值');
  for(let i=0;i<u.length;i++)if(!fixed[i]){
    v[i]+=.5*h*(f1[i]-internal[i])/m[i];
    dissipation+=.5*m[i]*v[i]*v[i]*loss;v[i]*=decay;
    if(!Number.isFinite(u[i])||!Number.isFinite(v[i])||Math.abs(u[i])>1e6)throw Error('FEM 动力学数值失稳；请检查载荷和材料');
  }
  s.externalWork+=work;s.dissipated+=dissipation;
}
function advanceCoupled(states,contacts,t,h,damping){
  const decay=Math.exp(-damping*h/2),loss=-Math.expm1(-damping*h);
  const damp=()=>{for(const s of states)for(let i=0;i<s.v.length;i++)if(!s.fixed[i]){s.dissipated+=.5*s.m[i]*s.v[i]**2*loss;s.v[i]*=decay;}};
  damp();contacts.forces(h/2);contacts.kick(h/2);
  for(const s of states){
    forceAt(s,t,s.f0);forceAt(s,t+h-Math.min(h*1e-7,1e-12*Math.max(1,t+h)),s.f1);
    s.oldContact??=new Float64Array(s.u.length);s.du??=new Float64Array(s.u.length);s.oldContact.set(s.contactForce);
    for(let i=0;i<s.u.length;i++){
      s.du[i]=0;if(s.fixed[i])continue;
      s.v[i]+=.5*h*(s.f0[i]+s.contactForce[i]-s.internal[i])/s.m[i];
      const du=h*s.v[i];s.du[i]=du;s.u[i]+=du;s.externalWork+=(.5*(s.f0[i]+s.f1[i])-s.thermal.force[i])*du;
    }
    multiply(s.A,s.u,s.internal);
    if(!s.internal.every(Number.isFinite))throw Error('FEM 动力学数值失稳；内力出现非有限值');
  }
  contacts.drift(h);contacts.forces(h/2);contacts.kick(h/2);
  for(const s of states)for(let i=0;i<s.u.length;i++)if(!s.fixed[i]){
    s.v[i]+=.5*h*(s.f1[i]+s.contactForce[i]-s.internal[i])/s.m[i];
    s.contactWork+=.5*(s.oldContact[i]+s.contactForce[i])*s.du[i];
    if(!Number.isFinite(s.u[i])||!Number.isFinite(s.v[i])||Math.abs(s.u[i])>1e6)throw Error('FEM 动力学数值失稳；请检查接触和材料');
  }
  contacts.dissipate(h);damp();
}
export class FEMDynamicSimulation{
  constructor(input){
    this.project=validateFEM(input);
    if(this.project.solver.analysis!=='linear-dynamic')throw Error('需要 FEM 瞬态项目');
    this.states=this.project.parts.filter(p=>p.method==='fem').map(p=>makeState(this.project,p));this.time=0;this.steps=0;
    this.contacts=new FEMContacts(this.project,this.states);this.contacts.forces();
    this.thermal=new FEMThermalSystem(this.project,this.states,this.contacts);
    const elasticDt=Math.min(Infinity,...this.states.map(s=>s.criticalDt));
    this.criticalDt=2/Math.sqrt(4/elasticDt**2+this.contacts.spectralBound());
    const active=new Set(this.project.loadBindings.filter(b=>b.enabled).map(b=>b.curve));
    const forcingDt=Math.min(Infinity,...this.project.curves.filter(c=>active.has(c.id)&&c.type==='sine').map(c=>1/(40*c.frequency)));
    this.dt=Math.min(this.project.solver.dt,this.project.solver.safety*this.criticalDt,forcingDt,this.thermal.enabled?Math.min(...this.states.map(s=>s.thermal.criticalDt)):Infinity);
    if(this.dt<1e-9)throw Error('材料或网格导致稳定步长小于 1e-9 s，请调整模型');
    this.events=programEvents(this.project);this.lastStart=0;this.lastEnd=0;this.lastDt=0;this.eventSplits=0;this.stopSplits=0;this.solveMs=0;
  }
  step(duration=this.project.solver.dt,emit=true){
    if(!Number.isFinite(duration)||duration<=0||duration>1||this.time+duration>60+1e-10)throw Error('单次推进须在 (0, 1] s，累计最多 60 s');
    const end=this.time+duration;
    if(Math.ceil(duration/this.dt)>200000)throw Error('本次推进子步过多，请减小输出间隔或调整网格');
    // A failed interval never publishes or commits a partial numerical state.
    const backup=this.states.map(s=>({u:s.u.slice(),v:s.v.slice(),internal:s.internal.slice(),contactForce:s.contactForce.slice(),externalWork:s.externalWork,dissipated:s.dissipated,contactWork:s.contactWork}));
    const contactBackup=this.contacts.backup();
    const thermalBackup=this.thermal.backup();
    const saved={time:this.time,steps:this.steps,lastStart:this.lastStart,lastEnd:this.lastEnd,lastDt:this.lastDt,eventSplits:this.eventSplits,stopSplits:this.stopSplits,solveMs:this.solveMs};
    const start=performance.now();
    try{
      this.contacts.begin(duration);
      this.thermal.begin();
      while(this.time<end-1e-13){
        const event=this.events.find(t=>t>this.time+1e-12)??Infinity;
        const stop=Math.min(end,event),start=this.time,span=stop-start;
        // Equal steps inside each output/event interval avoid a repeated tiny
        // tail followed by a full step (parametric excitation near the CFL bound).
        const count=Math.max(1,Math.ceil(span/Math.min(this.dt,this.contacts.travelLimit())-1e-10)),h=span/count;
        if(count>200000)throw Error('接触运动限制导致子步过多，请降低初速或缩短输出间隔');
        if(!(h>0))throw Error('FEM 时间推进停滞');
        for(let n=0;n<count;n++){
          const next=n===count-1?stop:start+(n+1)*h;
          this.advanceShared({end:next,dt:next-this.time});
        }
        if(h<this.dt*(1-1e-8)){if(stop===event)this.eventSplits++;else this.stopSplits++;}
      }
      this.time=end;this.solveMs=performance.now()-start;return emit?this.snapshot():undefined;
    }catch(e){Object.assign(this,saved);this.states.forEach((s,i)=>Object.assign(s,{...backup[i],contactForce:backup[i].contactForce.slice()}));this.contacts.restore(contactBackup);this.states.forEach((s,i)=>s.contactForce.set(backup[i].contactForce));this.thermal.restore(thermalBackup);throw e;}
  }
  // Does not subcycle: the shared scheduler has already applied CFL/events.
  advanceShared(tick){
    this.lastStart=this.time;this.lastEnd=tick.end;this.lastDt=tick.dt;
    this.thermal.step(tick.dt);
    if(this.contacts.bodies.length||this.contacts.surfaceContacts.pairs.length)advanceCoupled(this.states,this.contacts,this.time,tick.dt,this.project.solver.damping);
    else for(const s of this.states)advance(s,this.time,tick.dt,this.project.solver.damping);
    this.time=tick.end;this.steps++;
  }
  snapshot(){
    const damping=this.project.solver.damping,loadResponses=[];
    const parts=this.states.map(s=>{
      const {mesh,part,A,m,u,v,fixed}=s,internal=multiply(A,u),force=forceAt(s,this.time,new Float64Array(u.length));
      for(let i=0;i<force.length;i++)force[i]+=s.contactForce[i];
      const fields=recover(mesh,A,u,this.thermal.enabled?s.thermal.temperature:null,part.material),reaction=new Float64Array(u.length),acceleration=new Float64Array(u.length);
      const forceSum=[0,0,0],reactionSum=[0,0,0],balance=[0,0,0],momentBalance=[0,0,0];
      for(let n=0;n<mesh.nodes.length;n++){
        const residual=[0,0,0];
        for(let k=0;k<3;k++){
          const i=3*n+k;
          if(fixed[i])reaction[i]=internal[i]-force[i];else acceleration[i]=(force[i]-internal[i])/m[i]-damping*v[i];
          forceSum[k]+=force[i];reactionSum[k]+=reaction[i];
          residual[k]=force[i]+reaction[i]-m[i]*(acceleration[i]+damping*v[i]);balance[k]+=residual[k];
        }
        const moment=cross(mesh.nodes[n].map((x,k)=>x-part.geometry.center[k]),residual);moment.forEach((x,k)=>momentBalance[k]+=x);
      }
      let maxDisplacement=0,maxSpeed=0;
      for(let i=0;i<u.length;i+=3){maxDisplacement=Math.max(maxDisplacement,Math.hypot(u[i],u[i+1],u[i+2]));maxSpeed=Math.max(maxSpeed,Math.hypot(v[i],v[i+1],v[i+2]));}
      const energy=elasticEnergy(s,internal),K=kinetic(m,v),maxStrain=Math.max(0,...fields.strain.map(e=>Math.max(...e.map(Math.abs)))),warnings=[];
      if(maxStrain>.01||maxDisplacement>Math.min(...part.geometry.size)*.1)warnings.push('变形较大，可能超出小变形线弹性适用范围；变形放大仅影响显示。');
      if(part.material.poisson>.45)warnings.push('接近不可压缩：Tet4 可能发生体积锁死。');
      const loadedFace=s.responseSurface?.key??null,tip=faceMean(mesh,u,loadedFace),tipVelocity=faceMean(mesh,v,loadedFace);
      for(const b of s.bindings){
        loadResponses.push({id:b.id,target:b.target,kind:b.kind,unit:b.kind==='fem-force'?'N':'Pa',requested:femBindingValue(b,b.curveDefinition,this.time),
          applied:this.lastDt?femBindingIntegral(b,b.curveDefinition,this.lastStart,this.lastEnd)/this.lastDt:femBindingValue(b,b.curveDefinition,0),
          intervalStart:this.lastStart,intervalEnd:this.lastEnd,commandIntegral:femBindingIntegral(b,b.curveDefinition,0,this.time),
          response:faceMean(mesh,u,b.surfaceKey)[b.component??1],responseUnit:'m'});
      }
      return {id:part.id,name:part.name,nodes:mesh.nodes,surface:mesh.surface,cells:mesh.cells.map(c=>c.ids),quality:mesh.quality,
        displacement:u.slice(),velocity:v.slice(),temperature:s.thermal.temperature.slice(),acceleration,reaction,...fields,fixedFaces:s.fixedFaces,loadedFaces:s.loadedFaces,fixedSurfaceKeys:s.fixedSurfaceKeys,loadedSurfaceKeys:s.loadedSurfaceKeys,fixedTriangles:s.fixedTriangles,loadedTriangles:s.loadedTriangles,log:[],iterations:0,relativeResidual:null,
        summary:{maxDisplacement,maxSpeed,maxStrain,maxVonMises:Math.max(0,...fields.vonMises),energy,kinetic:K,mechanicalEnergy:energy+K,initialEnergy:s.initialEnergy,
          externalWork:s.externalWork,contactWork:s.contactWork,thermalWork:s.thermal.work,dissipated:s.dissipated,energyResidual:energy+K+s.dissipated-s.initialEnergy-s.externalWork-s.contactWork-s.thermal.work,
          temperature:s.thermal.temperature.reduce((sum,T,n)=>sum+T*s.thermal.capacity[n],0)/s.thermal.capacity.reduce((sum,C)=>sum+C,0),minTemperature:Math.min(...s.thermal.temperature),maxTemperature:Math.max(...s.thermal.temperature),
          tip,tipVelocity,responseSurface:s.responseSurface,force:forceSum,reaction:reactionSum,forceBalance:balance,momentBalance,warnings,solveMs:this.solveMs,
          mass:m.reduce((a,x)=>a+x,0)/3}};
    });
    const keys=['energy','kinetic','mechanicalEnergy','initialEnergy','externalWork','dissipated','energyResidual','thermalWork'];
    const totals=Object.fromEntries(keys.map(k=>[k,parts.reduce((a,p)=>a+p.summary[k],0)]));
    const contact=this.contacts.snapshot();
    totals.rigidKinetic=contact.rigidKinetic;totals.contactEnergy=contact.contactEnergy;totals.contactDissipated=contact.contactDissipated;
    totals.kinetic+=contact.rigidKinetic;totals.initialEnergy+=contact.initialEnergy;totals.externalWork+=contact.externalWork;totals.dissipated+=contact.contactDissipated;
    totals.mechanicalEnergy=totals.energy+totals.kinetic+totals.contactEnergy;
    totals.energyResidual=totals.mechanicalEnergy+totals.dissipated-totals.initialEnergy-totals.externalWork-totals.thermalWork;
    const thermal=this.thermal.snapshot(this.contacts.duration);
    return {time:this.time,bodies:contact.bodies,contactPairs:contact.contactPairs,thermal,thermalLoads:thermal.loads,joints:[],energy:totals.mechanicalEnergy,maxError:0,loadResponses,
      fem:{analysis:'linear-dynamic',solved:true,parts,dynamics:{...totals,dt:this.dt,criticalDt:this.criticalDt,requestedDt:this.project.solver.dt,
        lastDt:this.lastDt,steps:this.steps,eventSplits:this.eventSplits,stopSplits:this.stopSplits,solveMs:this.solveMs}},
      results:{schema:'summer-results/1',time:this.time,analysis:'linear-dynamic',parts:[...parts.map((r,i)=>({id:r.id,method:'fem',values:{
        position:this.states[i].part.geometry.center,nodeCount:r.nodes.length,elementCount:r.cells.length,...r.summary}})),...contact.bodies.map(b=>({id:b.id,method:'rigid',values:b}))],connections:[],balance:{...totals,thermalResidual:thermal.residual,externalHeat:thermal.externalHeat}}};
  }
  free(){}
}

// Keep immutable mesh topology shared, with bounded replay state storage.
// Scalar time histories survive eviction of old, larger visualization frames.
export class FEMHistory{
  constructor(){this.frames=[];this.samples=[];this.bytes=0;this.interval=1/120;this.limit=64*1024*1024;}
  record(frame,force=false){
    if(!force&&this.frames.length&&frame.time-this.frames.at(-1).time<this.interval-1e-9)return;
    if(this.frames.at(-1)?.time===frame.time)return;
    // Solver snapshots own their arrays and are never mutated after publication.
    this.frames.push(frame);
    const size=frame.fem.parts.reduce((s,p)=>s+p.nodes.length*8*13+p.cells.length*8*13,0)+(frame.particles?.byteLength??0);
    this.bytes+=size;
    while(this.bytes>this.limit&&this.frames.length>2){this.frames.shift();this.bytes-=size;}
    if(this.frames.length>1200){this.frames.shift();this.bytes-=size;}
    this.samples.push({time:frame.time,bodies:frame.bodies,contactPairs:frame.contactPairs,thermal:frame.thermal,thermalLoads:frame.thermalLoads,mixed:frame.mixed,results:frame.results,coupling:frame.coupling,fem:{dynamics:frame.fem.dynamics,parts:frame.fem.parts.map(p=>({id:p.id,summary:p.summary}))},loadResponses:frame.loadResponses});
    if(this.samples.length>7201)this.samples.shift();
  }
  at(index){return this.frames[Math.max(0,Math.min(this.frames.length-1,Math.round(index)))];}
}
