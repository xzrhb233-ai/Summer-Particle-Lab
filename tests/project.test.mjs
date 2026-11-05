import test from 'node:test';
import assert from 'node:assert/strict';
import {preset} from '../src/multibody/presets.js';
import {initialize} from '../src/multibody/engine.js';
import {normalizeProject,fromLegacy,toLegacy,removePart} from '../src/simulation/project.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {cpuCoupledAdapter} from '../src/simulation/cpu-adapter.js';
import {partField,projectCSV} from '../src/simulation/results.js';
await initialize();
const session=()=>new ProjectSession(new SolverRegistry().register(cpuCoupledAdapter));

test('legacy models migrate to a single SI project and round-trip all physical parameters',()=>{
  for(const kind of ['coupling','pendulum','crank','suspension','collision','empty']) {
    const old=preset(kind),p=fromLegacy(old),back=toLegacy(JSON.parse(JSON.stringify(p)));
    assert.equal(p.schema,'summer-project/1');assert.equal(p.units.length,'m');
    assert.deepEqual(back.bodies,old.bodies);assert.deepEqual(back.joints,old.joints);
    if(old.coupling){assert.deepEqual(back.coupling.domain,old.coupling.domain);assert.equal(back.coupling.parts[0].thermalMaterial.Thot,40);}
    assert.deepEqual(normalizeProject(p),p);
  }
});
test('MPM IDs remain stable on deletion, recreation, rename and load migration',()=>{
  const p=fromLegacy(preset('coupling')),part=p.parts.find(x=>x.method==='mpm');
  const other=structuredClone(part);other.id='specimen-B';other.geometry.center=[1.2,.2,0];other.geometry.size=[.2,.2,.2];p.parts.push(other);
  const removed=removePart(p,part.id);assert.equal(removed.parts.find(x=>x.method==='mpm').id,'specimen-B');
  const legacy=toLegacy(removed);legacy.coupling.parts.push({...legacy.coupling.parts[0],id:undefined,center:[-1.2,.2,0]});
  const added=fromLegacy(legacy);assert.equal(added.parts.at(-2).id,'specimen-B');assert.notEqual(added.parts.at(-1).id,'specimen-B');
  added.parts.at(-2).name='renamed';assert.equal(normalizeProject(added).parts.at(-2).id,'specimen-B');
});
test('deleting a project body also removes its connections and loads',()=>{
  const p=removePart(fromLegacy(preset('coupling')),'hot-platen');
  assert.ok(!p.parts.some(x=>x.id==='hot-platen'));assert.equal(p.connections.length,0);
  assert.ok(!p.loads.some(x=>x.target==='hot-platen'));toLegacy(p);
});
test('failed edits, unsupported FEM on the coupled adapter and missing references preserve the running session',()=>{
  const s=session();s.replace(preset('coupling'));
  try {
    s.step();const previous=s.snapshot(),doc=s.project;
    for(const modify of [p=>p.parts[0].method='fem',p=>p.loads[0].target='missing',p=>p.parts[0].geometry.size=[-1,1,1],p=>p.solver.adapter='gpu-coupled',p=>p.parts[1].id=p.parts[0].id,p=>p.solver.mpmEnabled=false]) {
      const draft=s.project;modify(draft);assert.throws(()=>s.replace(draft));
      assert.deepEqual(s.project,doc);assert.equal(s.time,previous.time);assert.deepEqual(s.snapshot().particles,previous.particles);
    }
    const overlap=s.project;overlap.parts.find(x=>x.method==='mpm').geometry.center=[0,.55,0];assert.throws(()=>s.replace(overlap),/重叠/);
    assert.deepEqual(s.project,doc);assert.equal(s.time,previous.time);s.step();assert.ok(s.time>previous.time);
  }finally{s.free();}
});
test('one project clock and result envelope cover every rigid and MPM part',()=>{
  const s=session();const f0=s.replace(preset('coupling'));
  try {
    let f;for(let i=0;i<15;i++)f=s.step();
    assert.ok(Math.abs(f.time-15/240)<1e-9);assert.equal(f.results.time,f.time);
    assert.deepEqual(f.results.parts.map(x=>x.id),s.project.parts.map(x=>x.id));
    const id=s.project.parts.find(x=>x.method==='mpm').id;
    assert.equal(partField(f,id,'count'),192);assert.ok(partField(f,id,'temperature')>=20);
    assert.ok(Number.isFinite(partField(f,id,'speed')));assert.equal(partField(f,id,'contactForce'),null);
    const csv=projectCSV([f0,f]);assert.equal(csv.split('\n').length,9);assert.match(csv,/mpm-1,mpm/);assert.match(csv,/hot-platen,rigid/);
  }finally{s.free();}
});
test('live heaters update the canonical document without resetting deformation or time',()=>{
  const s=session();s.replace(preset('coupling'));
  try {
    s.step();const before=s.snapshot();s.setThermalPower('hot-platen',100000);s.setHeater({power:-100});
    assert.equal(s.time,before.time);assert.deepEqual(s.snapshot().particles,before.particles);
    assert.equal(s.project.loads.find(l=>l.type==='body-heat'&&l.target==='hot-platen').power,100000);
    assert.equal(s.project.loads.find(l=>l.type==='region-heat').power,-100);
    s.step();assert.ok(s.snapshot().coupling.externalHeat>0);
    assert.throws(()=>s.setThermalPower('missing',100));assert.equal(s.project.loads.find(l=>l.type==='body-heat'&&l.target==='hot-platen').power,100000);
  }finally{s.free();}
});
test('solver registry rejects unsupported domains instead of silently running the wrong method',()=>{
  const r=new SolverRegistry().register({id:'rigid-only',methods:['rigid'],create:()=>({})});
  const p=fromLegacy(preset('coupling'));p.solver.adapter='rigid-only';assert.throws(()=>r.create(p),/mpm/);
  assert.throws(()=>r.register({id:'rigid-only',methods:[],create:()=>({})}));
});
test('a registered test adapter can use a future method through the shared lifecycle without legacy conversion',()=>{
  // Contract-only test double, not a FEM solver implementation.
  let freed=0;
  const registry=new SolverRegistry().register({id:'contract-test',methods:['fem'],create:project=>{
    let time=0;const snapshot=()=>({time,results:{schema:'summer-results/1',time,parts:[],connections:[],balance:null}});
    return {get time(){return time;},snapshot,step(dt){time+=dt;return snapshot();},free(){freed++;}};
  }});
  const p=fromLegacy(preset('empty'));p.parts[0].method='fem';p.solver.adapter='contract-test';
  const s=new ProjectSession(registry);s.replace(p);assert.equal(s.project.parts[0].method,'fem');
  assert.equal(s.step().time,p.solver.dt);s.replace(p);assert.equal(s.time,0);assert.equal(freed,1);s.free();assert.equal(freed,2);
});
