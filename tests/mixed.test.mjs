import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {mixedImpactProject,validateMixed,editMixedParticles,projectDomains,MIXED} from '../src/mixed/model.js';
import {contactDOFs} from '../src/mixed/contact.js';
import {particleMechanics} from '../src/simulation/mechanical-diagnostics.js';
import {cross} from '../src/fem/mesh.js';
import {FEMHistory} from '../src/fem/dynamic.js';
import {contactCSV} from '../src/simulation/contact-ui.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {mixedAdapter} from '../src/mixed/adapter.js';
await initialize();
const near=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b} (tol ${t})`);
const withSim=(p,fn)=>{const s=new MixedSimulation(p);try{return fn(s);}finally{s.free();}};
const touching=()=>{const p=mixedImpactProject(),b=p.parts.find(p=>p.id==='hot-block');b.geometry.center[1]=.7;p.parts[0].geometry.center[1]=.525;b.initial.velocity=[0,0,0];return p;};
const advance=(s,T)=>{while(s.time<T-1e-10)s.step(Math.min(1/60,T-s.time));return s.snapshot();};
const momentum=s=>{
  const p=particleMechanics(s.mpm.particles,[0,0,0]),linear=p.momentum.slice(),angular=p.angular.slice();
  for(const f of s.fem.states)for(let n=0;n<f.mesh.nodes.length;n++){
    const v=Array.from(f.v.subarray(n*3,n*3+3),x=>x*f.m[n*3]),x=f.mesh.nodes[n].map((x,k)=>x+f.u[3*n+k]),l=cross(x,v);
    for(let k=0;k<3;k++){linear[k]+=v[k];angular[k]+=l[k];}
  }
  return {linear,angular};
};
test('mixed canonical document round-trips both domains, loads, and pair IDs',()=>{
  const p=mixedImpactProject();p.loads.push({id:'cooling',name:'cooling',type:'thermal-power',target:'hot-block',power:-100,region:{type:'whole'},enabled:true});
  assert.deepEqual(validateMixed(JSON.parse(JSON.stringify(p))),p);
  const d=projectDomains(p);assert.deepEqual(d.fem.parts.map(b=>b.method),['fem']);assert.deepEqual(d.particles.parts.map(b=>b.method),['mpm']);
  const q=editMixedParticles(p,d=>{d.coupling.parts[0].temperature=120;d.coupling.domain.cellSize=.125;});
  assert.equal(q.parts[1].initial.temperature,120);assert.deepEqual(q.parts[0],p.parts[0]);assert.deepEqual(q.contactPairs,p.contactPairs);assert.equal(q.loads.find(l=>l.id==='cooling').power,-100);assert.equal(q.solver.adapter,MIXED);
});
test('unsupported rigid domain, unsupported bindings, and reversed pair fail explicitly',()=>{
  for(const mutate of [p=>p.parts[1].method='rigid',p=>p.contactPairs[0].a='beam',p=>p.solver.adapter='taichi-coupled',p=>p.loadBindings.push({kind:'body-force',target:'hot-block'})]){
    const p=mixedImpactProject();mutate(p);assert.throws(()=>validateMixed(p));
  }
});
test('initial volumetric overlap rejected before publishing a runtime',()=>{const p=touching();p.parts[0].geometry.center[1]+=.01;assert.throws(()=>new MixedSimulation(p),/重叠/);});
test('APIC contact transfers equal/opposite linear AND angular momentum at the same point',()=>withSim(mixedImpactProject(),sim=>{
  const s=sim.mpm.particles,f=sim.fem.states[0];f.fixed.fill(0);
  const ids=f.mesh.surface[0].nodes,weights=[.2,.3,.5],point=[0,1,2].map(k=>ids.reduce((sum,n,a)=>sum+weights[a]*f.mesh.nodes[n][k],0));
  const arm=point.map((x,k)=>x-s[['x','y','z'][k]][0]*.025),d=contactDOFs(s,0,f,{ids,weights,arm});
  const before=momentum(sim);d.apply([.17,-.2,.31]);const after=momentum(sim);
  before.linear.forEach((x,k)=>near(x,after.linear[k],1e-12));before.angular.forEach((x,k)=>near(x,after.angular[k],1e-12));
}));
test('fixed support impulse accounts for momentum not carried by free DOFs',()=>withSim(mixedImpactProject(),sim=>{
  const s=sim.mpm.particles,f=sim.fem.states[0];f.fixed.fill(1);
  const ids=f.mesh.surface[0].nodes,weights=[.2,.3,.5],point=[0,1,2].map(k=>ids.reduce((sum,n,a)=>sum+weights[a]*f.mesh.nodes[n][k],0)),arm=point.map((x,k)=>x-s[['x','y','z'][k]][0]*.025);
  const before=momentum(sim),{support}=contactDOFs(s,0,f,{ids,weights,arm}).apply([.1,-.2,.3]),after=momentum(sim);
  for(let k=0;k<3;k++)near(after.linear[k]-before.linear[k]+support[k],0,1e-12);
}));
test('a geometric gap transfers neither momentum nor heat',()=>withSim(mixedImpactProject(),s=>{
  s.contacts.begin(.01);s.contacts.mechanical();s.contacts.exchange(.01);const p=s.contacts.results()[0];assert.deepEqual(p.totalImpulse,[0,0,0]);near(p.heat,0);near(p.maxPenetration,0);
}));
test('thermal contact tolerance fades continuously and vanishes beyond the envelope',()=>{
  const heat=gap=>withSim(touching(),sim=>{const s=sim.mpm.particles;for(let i=0;i<s.count;i++)s.y[i]+=gap/.025;sim.contacts.begin(1);sim.contacts.exchange(1);return sim.contacts.results()[0].heat;});
  const full=heat(0),half=heat(.000625);assert.ok(full<0);near(half/full,.5,1e-8);near(heat(.002),0);
});
test('interface heat is conservative, flows both ways, and obeys many-node capacity bounds',()=>{
  for(const reverse of [false,true]){const p=touching();p.parts[0].initial.temperature=reverse?200:20;p.parts[1].initial.temperature=reverse?20:160;
    withSim(p,s=>{const energy=s.mpm.totalThermal()+s.fem.thermal.energy();s.contacts.begin(100);s.contacts.exchange(100);
      const q=s.contacts.results()[0].heat;assert.ok(reverse?q>0:q<0);near(s.mpm.totalThermal()+s.fem.thermal.energy(),energy,1e-7);
      for(const T of [...s.fem.states[0].thermal.temperature,...s.mpm.particles.temperature.subarray(0,s.mpm.particles.count)])assert.ok(T>=20-1e-8&&T<=(reverse?200:160)+1e-8);
    });
  }
});
test('contact causes FEM response and MPM rebound, then permits separation and heat cutoff',()=>withSim(mixedImpactProject(),s=>{
  let peak=0,Q=0;while(s.time<.4-1e-10){const f=s.step(Math.min(1/60,.4-s.time));peak=Math.max(peak,f.contactPairs[0].normalForce);Q=Math.min(Q,f.contactPairs[0].accumulatedHeat);}
  const f=s.snapshot(),r=f.contactPairs[0];assert.ok(peak>10);assert.ok(f.fem.parts[0].summary.maxDisplacement>.001);assert.ok(f.results.parts[1].values.velocity[1]>0);assert.ok(Q<0);
  near(r.normalForce,0);near(r.heatRate,0);assert.ok(Math.abs(f.thermal.residual)<1e-5);
  assert.ok(f.fem.parts[0].summary.maxDisplacement<.015);assert.ok(f.fem.parts[0].summary.maxStrain<.01);
}));
test('deleting the explicit pair removes both coupling channels',()=>{const p=mixedImpactProject();p.contactPairs=[];withSim(p,s=>{const f=advance(s,.2);near(f.fem.parts[0].summary.maxDisplacement,0);near(f.results.parts[1].values.velocity[1],-.5,1e-7);near(f.thermal.interfaceHeatIntoMPM,0);});});
test('shared heater drives MPM phase handoff while FEM also receives its own boundary',()=>{
  const p=touching();p.parts[1].material.phaseChange={enabled:true,meltingPoint:60,latentHeat:1000};p.parts[1].initial.temperature=20;
  p.loads.push({id:'mpm-hot',type:'thermal-temperature',target:'hot-block',temperature:80,region:{type:'whole'},enabled:true},{id:'fem-power',type:'thermal-power',target:'beam',power:100,region:{type:'whole'},enabled:true});
  withSim(p,s=>{const f=s.step(.001);assert.equal(f.coupling.liquids,f.coupling.count);assert.ok(f.thermalLoads.find(l=>l.id==='mpm-hot').heat>0);near(f.thermalLoads.find(l=>l.id==='fem-power').heat,.1,1e-7);assert.ok(Math.abs(f.thermal.residual)<1e-6);assert.ok(f.particles.every(Number.isFinite));});
});
test('FEM contact heat alone reaches MPM enthalpy and causes phase change',()=>{
  const p=touching();p.parts[0].initial.temperature=200;p.parts[1].initial.temperature=59;
  p.parts[1].material.phaseChange={enabled:true,meltingPoint:60,latentHeat:1000};
  withSim(p,s=>{s.contacts.begin(100000);s.contacts.exchange(100000);const f=s.snapshot();assert.ok(f.coupling.liquids>0);assert.ok(f.contactPairs[0].accumulatedHeat>0);near(f.thermal.externalHeat,0);assert.ok(Math.abs(f.thermal.residual)<1e-6);});
});
test('disabled FEM temperature field cannot introduce thermal strain in a mixed project',()=>{
  const p=mixedImpactProject();p.solver.thermal=false;p.contactPairs[0].thermal=false;p.parts[0].initial.temperature=100;p.parts[0].material.expansion=1e-4;
  withSim(p,s=>{const f=s.step(.001);near(f.fem.parts[0].summary.maxDisplacement,0);near(f.fem.parts[0].summary.thermalWork,0);});
});
test('failed interval restores particles, APIC, FEM, temperatures, reservoirs and clocks',()=>withSim(touching(),s=>{
  const b=s.backup(),before=s.snapshot(),exchange=s.contacts.exchange;
  s.contacts.exchange=function(dt){exchange.call(this,dt);throw Error('injected failure');};
  assert.throws(()=>s.step(.002),/injected/);s.contacts.exchange=exchange;
  assert.deepEqual(s.backup(),b);assert.deepEqual(s.snapshot().particles,before.particles);assert.equal(s.time,0);
  assert.ok(s.step(.002).particles.every(Number.isFinite));
}));
test('mixed adapter preserves a valid session when replacement fails',async()=>{
  const session=new ProjectSession(new SolverRegistry().register(mixedAdapter));try{
    await session.replaceAsync(mixedImpactProject());const bad=touching();bad.parts[0].geometry.center[1]+=.01;await assert.rejects(session.replaceAsync(bad),/重叠/);
    assert.equal(session.project.parts[1].geometry.center[1],.75);assert.ok((await session.step(.001)).mixed);
  }finally{session.free();}
});
test('mixed replay retains particle and thermal data; contact CSV includes correction work',()=>withSim(mixedImpactProject(),s=>{
  const h=new FEMHistory(),f=s.step(.001);h.record(f,true);assert.equal(h.at(0).particles.length,512);assert.ok(h.samples[0].results.parts.some(p=>p.method==='mpm'));assert.ok(h.bytes>=f.particles.byteLength);
  const csv=contactCSV(h.samples).split('\n').map(row=>row.split(',').map(x=>x.replaceAll('"','')));assert.equal(csv[0].length,csv[1].length);assert.ok(csv[0].includes('position_correction_work_J'));
}));
