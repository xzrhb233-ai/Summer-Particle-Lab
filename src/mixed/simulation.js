import {CouplingStepper} from '../simulation/coupling-interface.js';
import {MixedEnergy} from './energy.js';
import {validateMixed,projectDomains} from './model.js';
import {CoupledSimulation} from '../multibody/coupled.js';
import {FEMDynamicSimulation} from '../fem/dynamic.js';
import {toLegacy} from '../simulation/project.js';
import {attachParticleThermalLoads} from '../simulation/thermal-ports.js';
import {particleMechanics} from '../simulation/mechanical-diagnostics.js';
import {ContactMotion,ContactMotionError} from './contact-motion.js';
import {MixedContacts} from './contact.js';
import {updateThermalForce} from '../fem/thermal.js';
import {advanceParticleThermal,advanceFEMThermal} from './fixed-thermal.js';

const L=.025;
const vector=v=>[v.x,v.y,v.z];
const restoreMap=(map,data)=>{for(const [id,value] of data)Object.assign(map.get(id),structuredClone(value));};
const rigidSpeed=m=>Math.max(1,...[...m.bodies.values()].map(b=>Math.hypot(...vector(b.rb.linvel()))+Math.hypot(...vector(b.rb.angvel()))*Math.hypot(...b.definition.size)));
const fields=(o,keys)=>Object.fromEntries(keys.map(k=>[k,structuredClone(o[k])]));
const times=['time','steps','lastStart','lastEnd','lastDt','eventSplits','stopSplits','solveMs'];
// Scratch grids and neighbor lists are rebuilt, whereas all material history,
// APIC state, thermal reservoirs and physical clocks are transaction state.
const arrays=(o,count,capacity)=>Object.fromEntries(Object.entries(o).filter(([,v])=>ArrayBuffer.isView(v)&&v.length>=capacity&&v.length%capacity===0).map(([k,v])=>[k,v.slice(0,count*v.length/capacity)]));
const restoreArrays=(o,data)=>{for(const [k,v] of Object.entries(data))o[k].set(v);};
export class MixedSimulation{
  constructor(input){
    this.project=validateMixed(input);const domains=projectDomains(this.project);
    this.fem=new FEMDynamicSimulation(domains.fem);this.time=0;this.steps=0;this.lastDt=0;
    try{
      this.mpm=new CoupledSimulation(toLegacy(domains.particles));
      if(this.mpm.particles.count>16384)throw Error('浏览器 CPU MPM–FEM 最多 16384 粒子；更大规模请使用 Taichi GPU');
      attachParticleThermalLoads(domains.particles,this.mpm);
      this.mpm.externalHeat+=this.mpm.partThermalLoads.step(0);
      this.contacts=new MixedContacts(this.project,this.mpm,this.fem);
      this.contactMotion=new ContactMotion(this.contacts);this.contactSafety={scheme:'swept-sphere-fem/1',retries:0,ccdRetries:0,sweptTests:0,maxTravelRatio:0};
      this.initialThermal=this.mpm.initialThermal+this.fem.thermal.initialEnergy;
      this.fixedThermal=this.project.solver.thermalMode==='fixed-geometry';
      this.dt=this.fixedThermal?this.project.solver.dt:Math.min(this.project.solver.dt,this.fem.dt);this.solveMs=0;
      const m=this.mpm,f=this.fem,s=m.particles;
      if(this.fixedThermal&&!s.pinned.subarray(0,s.count).every(Boolean))throw Error('固定传热模式存在未固定的材料点');
      this.scheduler=new CouplingStepper(this.dt,this.fixedThermal?[
        {id:'mpm',time:()=>m.time,steps:()=>m.steps,stableDt:()=>this.dt,schedule:()=>m.loadProgram.schedule(),advance:t=>advanceParticleThermal(m,t)},
        {id:'fem',time:()=>f.time,steps:()=>f.steps,stableDt:()=>Math.min(...f.states.map(s=>s.thermal.criticalDt)),schedule:()=>({}),advance:t=>advanceFEMThermal(f,t)}
      ]:[
        {id:'mpm',time:()=>m.time,steps:()=>m.steps,stableDt:()=>Math.min(1/480,s.domain.spacing*L*.2/rigidSpeed(m),s.material.subarray(0,s.count).some((_,i)=>s.isSolid(i))?s.mpm.stableStep(s):Infinity),schedule:()=>m.loadProgram.schedule(),advance:t=>m.advanceShared(t)},
        {id:'fem',time:()=>f.time,steps:()=>f.steps,stableDt:()=>Math.min(f.dt,f.contacts.travelLimit()),schedule:()=>({nextEvent:f.events.find(t=>t>f.time+1e-10)??Infinity}),advance:t=>f.advanceShared(t)}
      ]);
      this.energy=new MixedEnergy(this);
    }catch(e){this.mpm?.free();this.fem.free();throw e;}
  }
  backup(){const m=this.mpm,s=m.particles;return {
    self:fields(this,['time','steps','lastDt','solveMs','contactSafety']),mpm:fields(m,['time','steps','lastDt','externalHeat','exchanged','maxPenetration','effectiveHeater']),
    particles:arrays(s,s.count,s.x.length),apic:arrays(s.mpm,s.count,s.x.length),particleTime:s.time,
    rigid:m.bodies.size?m.backupRigid():null,bodyHeat:structuredClone(m.bodyHeat),bodyContact:structuredClone(m.contact),pairStats:structuredClone(m.pairContacts.stats),
    attachments:m.attachments.items.map(item=>fields(item,['members','work','totalPositiveWork','impulse','torqueImpulse','stepWork','bodyWork','positiveWork'])),attachmentExcluded:structuredClone(m.attachments.excluded),
    sharedClock:{...this.scheduler.clock},energy:this.energy.observer.backup(),exchanges:this.contacts.exchanges.backup(),
    clock:{...m.clock},program:fields(m.loadProgram,['last','integrals','bodyLoads','motorTargets']),loads:m.partThermalLoads.backup(),
    fem:fields(this.fem,times),states:this.fem.states.map(s=>fields(s,['u','v','internal','contactForce','externalWork','dissipated','contactWork'])),thermal:this.fem.thermal.backup(),contact:this.contacts.backup(),duration:this.contacts.duration,femContacts:this.fem.contacts.backup()
  };}
  restore(b){Object.assign(this.scheduler.clock,b.sharedClock);this.energy.observer.restore(b.energy);this.contacts.exchanges.restore(b.exchanges);Object.assign(this,b.self);Object.assign(this.mpm,b.mpm);const s=this.mpm.particles;
    if(b.rigid)this.mpm.restoreRigid(b.rigid);restoreMap(this.mpm.bodyHeat,b.bodyHeat);restoreMap(this.mpm.contact,b.bodyContact);this.mpm.pairContacts.stats=structuredClone(b.pairStats);
    this.mpm.attachments.items.forEach((item,i)=>Object.assign(item,structuredClone(b.attachments[i])));this.mpm.attachments.excluded=structuredClone(b.attachmentExcluded);
    restoreArrays(s,b.particles);restoreArrays(s.mpm,b.apic);s.time=b.particleTime;Object.assign(this.mpm.clock,b.clock);Object.assign(this.mpm.loadProgram,b.program);this.mpm.partThermalLoads.restore(b.loads);
    Object.assign(this.fem,b.fem);this.fem.states.forEach((s,i)=>Object.assign(s,{...b.states[i],contactForce:b.states[i].contactForce.slice()}));this.fem.thermal.restore(b.thermal);this.contacts.restore(b.contact);this.contacts.duration=b.duration;this.fem.contacts.restore(b.femContacts);this.fem.states.forEach((s,i)=>s.contactForce.set(b.states[i].contactForce));
  }
  step(duration){
    const start=performance.now();let cap=Infinity,ccdRetries=0;
    for(let retry=0;retry<=8;retry++){
      try{const frame=this.stepAttempt(duration,cap);this.contactSafety.retries=retry;this.contactSafety.ccdRetries=ccdRetries;this.solveMs=performance.now()-start;frame.mixed.contactSafety=this.fixedThermal?null:{...this.contactSafety};frame.mixed.solveMs=this.solveMs;return frame;}
      catch(e){if(!(e instanceof ContactMotionError))throw e;if(e.kind==='swept-contact')ccdRetries++;if(retry===8)throw Error('接触位移检查经过 8 次细分仍未通过，已回滚；请减小载荷或检查初始间隙');cap=Math.min(cap,e.stepDt??this.dt)/2;}
    }
  }
  stepAttempt(duration,cap){
    if(!Number.isFinite(duration)||duration<=0||duration>1||this.time+duration>60+1e-10)throw Error('混合推进时长须在 (0, 1] s，累计最多 60 s');
    const b=this.backup(),end=this.time+duration,start=performance.now(),s=this.mpm.particles;
    let attemptedDt=this.dt;
    const initialVelocities=new Map([...this.mpm.bodies].map(([id,b])=>[id,vector(b.rb.linvel())]));
    const loadStart=new Map([...this.mpm.partThermalLoads.items,...this.fem.thermal.loads.items].map(l=>[l.definition.id,l.heat]));
    try{
      this.mpm.pairContacts.begin();this.mpm.attachments.begin();this.mpm.maxPenetration=0;for(const c of this.mpm.contact.values())Object.assign(c,{impulse:[0,0,0],torque:[0,0,0],heat:0});
      this.contactSafety={scheme:'swept-sphere-fem/1',retries:0,ccdRetries:0,sweptTests:0,maxTravelRatio:0};
      this.contacts.begin(duration);this.fem.contacts.begin(duration);this.fem.thermal.begin();this.mpm.partThermalLoads.begin();
      s.profile={constitutive:0,transfer:0,grid:0,fluid:0,thermal:0,diagnostics:0};let count=0;
      while(this.time<end-1e-10){
        if(++count>200000)throw Error('混合子步过多，已回滚');
        const tick=this.scheduler.next(end,this.fixedThermal?cap:Math.min(cap,this.contacts.travelLimit(),this.contactMotion.limit())),h=tick.dt;
        attemptedDt=h;
        if(!this.fixedThermal)this.contactMotion.capture();
        this.scheduler.advance(tick);
        if(!this.fixedThermal){this.contactSafety.sweptTests+=this.contactMotion.checkSwept();this.contactSafety.maxTravelRatio=Math.max(this.contactSafety.maxTravelRatio,this.contactMotion.check());this.contacts.mechanical();this.contactSafety.maxTravelRatio=Math.max(this.contactSafety.maxTravelRatio,this.contactMotion.check());}const beforeHeat=this.energy.observer.mark();this.contacts.exchange(h);
        // Keep prescribed temperatures exact at the shared endpoint, charging
        // only actual reservoir energy. Interface heat is internal, not a source.
        this.mpm.externalHeat+=this.mpm.partThermalLoads.step(0);
        this.fem.thermal.externalHeat+=this.fem.thermal.loads.step(0);
        if(this.fem.thermal.enabled)for(const f of this.fem.states)updateThermalForce(f);
        this.energy.observer.record('phase',beforeHeat);
        this.time=tick.end;this.steps++;this.lastDt=h;
        for(let i=0;i<s.count;i++)if(![s.x[i],s.y[i],s.z[i],s.vx[i],s.vy[i],s.vz[i],s.enthalpy[i]].every(Number.isFinite))throw Error('混合粒子状态出现非有限值');
      }
      this.time=end;this.mpm.lastDt=duration;
      for(const [id,body] of this.mpm.bodies){const velocity=vector(body.rb.linvel());this.mpm.acceleration.set(id,velocity.map((v,k)=>(v-initialVelocities.get(id)[k])/duration));this.mpm.previousVelocity.set(id,velocity);}
      for(const l of [...this.mpm.partThermalLoads.items,...this.fem.thermal.loads.items])l.intervalHeat=l.heat-loadStart.get(l.definition.id);
      this.solveMs=performance.now()-start;return this.snapshot();
    }catch(e){if(e instanceof ContactMotionError)e.stepDt=attemptedDt;this.restore(b);throw e;}
  }
  snapshot(){
    const s=this.mpm.particles;s.mpm.refreshDiagnostics(s);
    const m=this.mpm.snapshot(),f=this.fem.snapshot(),interfaces=this.contacts.results(),duration=this.contacts.duration;
    const pairs=[...interfaces,...m.contactPairs,...f.contactPairs].sort((a,b)=>this.project.contactPairs.findIndex(p=>p.id===a.id)-this.project.contactPairs.findIndex(p=>p.id===b.id));
    const heatIntoMPM=interfaces.filter(p=>!this.mpm.bodies.has(p.a)).reduce((sum,p)=>sum+p.accumulatedHeat,0),heatIntoRigid=interfaces.filter(p=>this.mpm.bodies.has(p.a)).reduce((sum,p)=>sum+p.accumulatedHeat,0),energy=this.mpm.totalThermal()+this.fem.thermal.energy(),external=this.mpm.externalHeat+this.fem.thermal.externalHeat;
    for(const body of m.bodies)for(const pair of interfaces)if(pair.a===body.id){body.contactForce=body.contactForce.map((x,k)=>x+pair.force[k]);body.contactTorque=body.contactTorque.map((x,k)=>x+pair.torque[k]);body.contactHeatRate+=pair.heatRate;}
    const parts=this.project.parts.filter(p=>['mpm','pbf'].includes(p.method)).map((p,index)=>{
      let mass=0,T=0,minTemperature=Infinity,maxTemperature=-Infinity,count=0,solids=0;const position=[0,0,0],velocity=[0,0,0];
      for(let i=0;i<s.count;i++)if(s.lab.part[i]===index+1){count++;solids+=s.isSolid(i)?1:0;mass+=s.mass[i];T+=s.mass[i]*s.temperature[i];minTemperature=Math.min(minTemperature,s.temperature[i]);maxTemperature=Math.max(maxTemperature,s.temperature[i]);for(let k=0;k<3;k++){position[k]+=s[['x','y','z'][k]][i]*L*s.mass[i];velocity[k]+=s[['vx','vy','vz'][k]][i]*L*s.mass[i];}}
      return {id:p.id,method:p.method,values:{count,mass,temperature:T/mass,minTemperature,maxTemperature,solids,liquids:count-solids,position:position.map(x=>x/mass),velocity:velocity.map(x=>x/mass)}};
    });
    parts.push(...m.bodies.map(b=>({id:b.id,method:'rigid',values:{position:b.position,displacement:b.displacement,velocity:b.velocity,temperature:b.temperature,contactForce:b.contactForce,kinetic:b.kinetic}})));
    // FEM–FEM work is internal. Only cross-domain impulses and their position
    // correction are external interface work on the FEM subsystem.
    const exchanges=this.contacts.exchanges.snapshot();
    const interfaceWork=exchanges.pairs.reduce((sum,p)=>sum+p.workB,0)+interfaces.reduce((sum,p)=>sum+p.correctionWork,0);
    f.fem.dynamics.energyResidual-=interfaceWork;f.fem.dynamics.interfaceWork=interfaceWork;f.fem.dynamics.energyScope='fem-subsystem';f.fem.dynamics.dt=this.dt;
    const thermal={enabled:this.project.solver.thermal,energy,initialEnergy:this.initialThermal,externalHeat:external,residual:energy-this.initialThermal-external,exchangedHeat:pairs.reduce((sum,p)=>sum+Math.abs(p.accumulatedHeat),0),interfaceHeatIntoMPM:heatIntoMPM,interfaceHeatIntoRigid:heatIntoRigid};
    m.coupling.thermalResidual-=heatIntoMPM+heatIntoRigid;
    const thermalLoads=[...this.mpm.partThermalLoads.results(duration),...this.fem.thermal.loads.results(duration)];
    const clock=this.scheduler.snapshot();
    const mechanics=particleMechanics(s,this.project.environment.gravity);
    const ledger=this.energy.snapshot(f.fem.dynamics,mechanics,interfaces,thermal,exchanges,m);
    const mixed={scheme:'explicit-mpm-fem/2',contactSafety:this.fixedThermal?null:{...this.contactSafety},thermalMode:this.fixedThermal?'fixed-geometry':'coupled',clock,exchanges,energy:ledger,steps:this.steps,lastDt:this.lastDt,solveMs:this.solveMs,particleMechanics:mechanics,interfaceWorkIntoFEM:interfaceWork,correctionWork:interfaces.reduce((sum,p)=>sum+p.correctionWork,0)};
    return {...f,bodies:m.bodies,joints:m.joints,particles:m.particles,particleRadius:m.particleRadius,particleColorMode:'temperature',coupling:m.coupling,thermal,thermalLoads,contactPairs:pairs,mixed,
      loadResponses:[...f.loadResponses,...m.loadResponses],results:{...f.results,parts:[...f.results.parts,...parts],contactPairs:pairs,balance:{...f.results.balance,mechanicalEnergy:ledger.mechanical,kinetic:mechanics.kinetic+mechanics.affine+f.fem.dynamics.kinetic+m.kinetic,energy:mechanics.elastic===null?null:mechanics.elastic+f.fem.dynamics.energy+m.springEnergy,potential:mechanics.potential+m.potential,initialEnergy:ledger.initial,dissipated:ledger.physical.total,numericalWork:ledger.numerical.total,thermalResidual:thermal.residual,externalHeat:external,energyResidual:ledger.unexplainedResidual,rawEnergyResidual:ledger.rawResidual,energyScope:ledger.scope,energyComplete:ledger.complete}}};
  }
  free(){this.mpm?.free();this.fem.free();}
}
