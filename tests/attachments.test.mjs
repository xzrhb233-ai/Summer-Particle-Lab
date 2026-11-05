import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {gripExample} from '../src/simulation/grip-example.js';
import {fromLegacy,toLegacy,normalizeSolverProject,editLegacyProject,removePart} from '../src/simulation/project.js';
import {removeReference} from '../src/simulation/references.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {attachmentCSV} from '../src/simulation/attachment-ui.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {cpuCoupledAdapter} from '../src/simulation/cpu-adapter.js';
import {quaternion,rotate,inverse,sub,add,mul,dot,norm,inertia} from '../src/multibody/model.js';
import {arr,qa,cross} from '../src/multibody/contact.js';
import {LENGTH as L} from '../src/multibody/coupling-model.js';
await initialize();
const close=(a,b,t=1e-6)=>assert.ok(norm(sub(a,b))<t,`${a} != ${b}`);
const qclose=(a,b,t=1e-5)=>assert.ok(1-Math.abs(dot(a,b))<t);
const body=(id,type,rotation)=>({id,type,shape:'box',size:[.2,.3,.4],position:[id==='a'?-1:1,2,0],mass:2,rotation,collisionFamily:1});

for(const type of ['revolute','prismatic','planar','fixed'])test(`${type} supports independently rotated body geometry without changing its initial pose`,()=>{
  const rotations=[[23,17,41],[-12,36,8]],m={schema:'summer-mbd/1',gravity:[0,0,0],bodies:[body('a','fixed',rotations[0]),body('b','dynamic',rotations[1])],
    joints:[{id:'j',type,a:'a',b:'b',anchor:[1,2,0],axis:[0,1,0],...(['prismatic','revolute'].includes(type)?{limits:[-.3,.3],motor:{mode:'position',target:.15,stiffness:100,damping:20}}:{})}]};
  const s=new MultibodySimulation(m);
  try{
    s.snapshot().bodies.forEach((b,i)=>qclose(b.rotation,quaternion(rotations[i])));
    for(let i=0;i<120;i++)s.step();
    const f=s.snapshot();assert.ok(f.maxError<.001);
    if(type==='prismatic'){assert.ok(f.joints[0].coordinate>.05);qclose(f.bodies[1].rotation,quaternion(rotations[1]));}
    if(type==='revolute')assert.ok(f.joints[0].coordinate>.08);
    if(type==='fixed'||type==='planar')qclose(f.bodies[1].rotation,quaternion(rotations[1]));
  }finally{s.free();}
});

test('reference zero angle is respected by revolute limits and position motors',()=>{
  const p=gripExample(true);p.connections=p.connections.filter(j=>j.type!=='region');p.parts=p.parts.filter(b=>b.method==='rigid');p.selectionSets=[];p.solver.mpmEnabled=false;
  const j=p.connections[0],b=p.frames.find(f=>f.id===j.endpoints.b.frame);
  // Ry(90) Rz(.3): the reference Z axis stays along world X.
  b.rotation=[90,90-.3*180/Math.PI,90];j.motor.target=.4;j.limits=[.2,.6];
  const s=new MultibodySimulation(toLegacy(p));try{
    assert.ok(Math.abs(s.snapshot().joints[0].coordinate-.3)<1e-6);
    for(let i=0;i<240;i++)s.step();assert.ok(Math.abs(s.snapshot().joints[0].coordinate-.4)<.02);
  }finally{s.free();}
});

test('region definitions survive normalization, JSON, legacy forms and cascading deletion',()=>{
  const p=gripExample(),defs=p.connections.filter(j=>j.type==='region');
  for(const q of [normalizeSolverProject(p),normalizeSolverProject(JSON.parse(JSON.stringify(p))),editLegacyProject(p,m=>{m.bodies[1].mass=4;})]){
    assert.deepEqual(q.connections.filter(j=>j.type==='region'),defs);assert.deepEqual(q.frames,p.frames);assert.deepEqual(q.selectionSets,p.selectionSets);
  }
  assert.equal(removePart(p,'right-clamp').connections.length,1);
  assert.equal(removeReference(p,'selection','right-end').connections.length,2);
  assert.equal(editLegacyProject(p,m=>{m.bodies=m.bodies.filter(b=>b.id!=='right-clamp');m.joints=[];}).connections.length,1);
  assert.deepEqual(validateGpuProject(p).connections.filter(j=>j.type==='region'),defs);
});

for(const twist of [false,true])test(`MPM grip ${twist?'twists':'stretches'} with measured reaction and bounded drift`,()=>{
  const s=new CoupledSimulation(toLegacy(gripExample(twist)));
  try{
    for(let i=0;i<120;i++)s.step();
    const f=s.snapshot(),regions=f.joints.filter(j=>j.type==='region');
    assert.equal(s.particles.count,384);assert.deepEqual(regions.map(r=>r.count),[48,48]);
    assert.ok(f.joints[0].coordinate>(twist?.2:.03));assert.ok(regions.every(r=>r.error<.002));
    assert.ok(norm(twist?regions[1].torque:regions[1].force)>.1);
    assert.ok(Array.from(s.particles.mpm.F.subarray(0,s.particles.count*9)).some((x,i)=>Math.abs(x-(i%9%4===0?1:0))>.01));
    assert.ok(f.particles.every(Number.isFinite));assert.ok(regions.every(r=>Math.abs(r.work)<50));
    const csv=attachmentCSV([f]);assert.equal(csv.trim().split('\n').length,3);assert.ok(csv.includes('body_power_W'));
  }finally{s.free();}
});

function freeAttachment(mode='bind'){
  const p=gripExample();p.parts=p.parts.filter(b=>b.method==='mpm'||b.id==='right-clamp');
  const b=p.parts.find(b=>b.method==='rigid');b.geometry.center=[0,1.6,0];b.geometry.rotation=mode==='slide'?[0,0,0]:[23,17,31];b.initial.velocity=[0,0,0];
  p.frames=p.frames.filter(f=>f.part===b.id);p.frames[0].position=[0,0,0];p.frames[0].rotation=[0,90,0];
  p.selectionSets=[{id:'all',name:'all',part:'specimen',region:{type:'whole'}}];
  p.connections=[{id:'test',name:'test',type:'region',a:b.id,b:'specimen',mode,stiffness:10000,damping:80,endpoints:{a:{frame:p.frames[0].id},b:{selection:'all'}}}];
  p.loads=p.loads.filter(l=>l.target===b.id||l.target==='mpm');p.couplings[0].mechanical=false;
  p.parts.find(b=>b.method==='mpm').initial.velocity=mode==='slide'?[.2,0,0]:[.2,.1,-.04];
  return p;
}
function gridBalance(s,g){
  let P=[0,0,0],H=[0,0,0],K=0;
  for(let n=0;n<g.mass.length;n++)if(g.mass[n]>1e-12){
    const v=Array.from(g.v.subarray(n*3,n*3+3),x=>x*L),p=[g.O[0]+(n%g.N)*g.H,g.O[1]+(Math.floor(n/g.N)%g.N)*g.H,g.O[2]+Math.floor(n/g.N**2)*g.H].map(x=>x*L),momentum=mul(v,g.mass[n]);
    P=add(P,momentum);H=add(H,cross(p,momentum));K+=.5*g.mass[n]*dot(v,v);
  }
  for(const {rb,definition:b} of s.bodies.values())if(b.type!=='fixed'){
    const v=arr(rb.linvel()),q=qa(rb.rotation()),omega=rotate(inverse(q),arr(rb.angvel())),I=inertia(b),h=rotate(q,omega.map((x,k)=>x*I[k]));
    P=add(P,mul(v,b.mass));H=add(H,add(cross(arr(rb.translation()),mul(v,b.mass)),h));K+=.5*b.mass*dot(v,v)+.5*dot(I,omega.map(x=>x*x));
  }
  return {P,H,K};
}
test('grid attachment conserves total linear/angular momentum and dissipates initial slip',()=>{
  const s=new CoupledSimulation(toLegacy(freeAttachment()));let checked=false;
  try{
    s.particles.externalGridContact=(g,h)=>{
      const before=gridBalance(s,g);s.attachments.solve(g,h);const after=gridBalance(s,g);
      // Rapier accumulates body impulses in f32; grid arithmetic is f64.
      close(before.P,after.P,2e-6*Math.max(1,norm(before.P)));close(before.H,after.H,2e-6*Math.max(1,norm(before.H)));
      if(!checked){assert.ok(after.K<=before.K+1e-7);assert.ok(Math.abs(after.K-before.K-s.attachments.items[0].stepWork)<2e-6);}
      checked=true;
    };
    s.step();assert.ok(checked);assert.ok(s.snapshot().bodies[0].velocity[0]>.01);
  }finally{s.free();}
});
test('slide connection transmits no impulse along its free reference Z axis',()=>{
  const s=new CoupledSimulation(toLegacy(freeAttachment('slide')));
  try{s.step();const j=s.snapshot().joints.find(j=>j.type==='region');assert.ok(Math.abs(j.force[0])<1e-7);assert.ok(Math.abs(s.snapshot().bodies[0].velocity[0])<1e-8);}finally{s.free();}
});
test('elastic connection remains finite at high stiffness without iteration-multiplied force',()=>{
  const p=freeAttachment('elastic');p.connections[0].stiffness=1e7;
  const s=new CoupledSimulation(toLegacy(p));try{
    for(let i=0;i<25;i++)s.step();const j=s.snapshot().joints.find(j=>j.type==='region');assert.ok(j.error<.002);assert.ok(Number.isFinite(j.elasticEnergy));assert.ok(Math.abs(j.work)<5);
  }finally{s.free();}
});
test('invalid or conflicting region constraints fail explicitly',()=>{
  for(const edit of [
    p=>p.connections[1].endpoints.a.frame='missing',
    p=>p.connections[1].mode='unknown',
    p=>p.connections[1].stiffness=NaN,
    p=>{const b=p.parts.find(b=>b.method==='mpm');b.material.phaseChange.enabled=true;b.initial.temperature=200;},
    p=>p.selectionSets[0].region={type:'box',lower:[10,10,10],upper:[11,11,11]},
    p=>p.loads.push({id:'pin',type:'fixed-selection',target:'specimen',selection:'left-end'}),
    p=>p.connections[2].endpoints.b.selection='left-end',
  ]){
    const p=gripExample();edit(p);assert.throws(()=>{const s=new CoupledSimulation(toLegacy(p));s.free();});
  }
});
test('region metadata survives live heating and failed replacements preserve the running project',()=>{
  const s=new ProjectSession(new SolverRegistry().register(cpuCoupledAdapter));
  try{
    s.replace(gripExample());s.step();const time=s.time,connections=s.project.connections;
    s.setThermalPower('right-clamp',200);assert.equal(s.time,time);assert.deepEqual(s.project.connections,connections);
    const t=s.snapshot().bodies.find(b=>b.id==='right-clamp').temperature;s.step();
    assert.ok(s.snapshot().bodies.find(b=>b.id==='right-clamp').temperature>t);
    const before=s.project,now=s.time,bad=s.project;bad.connections[1].endpoints.b.selection='missing';
    assert.throws(()=>s.replace(bad));assert.deepEqual(s.project,before);assert.equal(s.time,now);
  }finally{s.free();}
});
test('a fixed selection sharing grid support rejects before replacing a session',()=>{
  const p=gripExample();p.selectionSets.push({id:'middle-pin',name:'middle pin',part:'specimen',region:{type:'box',lower:[-.44,-.1,-.1],upper:[-.39,.1,.1]}});
  p.loads.push({id:'pin',type:'fixed-selection',target:'specimen',selection:'middle-pin'});
  assert.throws(()=>new CoupledSimulation(toLegacy(p)),/固定网格支撑/);
});
