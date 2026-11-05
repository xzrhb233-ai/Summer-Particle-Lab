import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceExample} from '../src/simulation/reference-example.js';
import {normalizeSolverProject,normalizeProject,toLegacy,editLegacyProject,removePart} from '../src/simulation/project.js';
import {framePose,ReferenceResults,removeReference,convertConnectionToReferences} from '../src/simulation/references.js';
import {validateGpuProject} from '../src/simulation/gpu-contract.js';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {cpuCoupledAdapter} from '../src/simulation/cpu-adapter.js';
import {readRecording} from '../src/simulation/recording.js';
import {quaternion,rotate,add,norm,sub} from '../src/multibody/model.js';
await initialize();
const session=()=>new ProjectSession(new SolverRegistry().register(cpuCoupledAdapter));
const close=(a,b,tol=1e-7)=>assert.ok(norm(sub(a,b))<tol,`${a} != ${b}`);

test('reference frames compose local and world transforms, and follow rigid snapshots',()=>{
  const p=referenceExample(),b=p.parts.find(b=>b.id==='hot-platen');b.geometry.rotation=[20,30,40];
  const f=p.frames.find(f=>f.part===b.id);f.position=[.2,.3,.4];f.rotation=[10,0,0];
  close(framePose(p,f.id).position,add(b.geometry.center,rotate(quaternion(b.geometry.rotation),f.position)));
  const state={bodies:[{id:b.id,position:[1,2,3],rotation:quaternion([0,0,90])}]};
  close(framePose(p,f.id,state).position,[.7,2.2,3.4]);
  p.frames.push({id:'world',name:'World',part:null,position:[1,2,3],rotation:[0,0,0]});
  close(framePose(p,'world',state).position,[1,2,3]);
});

test('authoring metadata survives solver normalization, JSON, GPU, legacy form edits and heaters',()=>{
  const p=referenceExample();
  for(const q of [normalizeSolverProject(p),validateGpuProject(p),normalizeProject(JSON.parse(JSON.stringify(p))),editLegacyProject(p,d=>{d.bodies[0].mass=41;})]){
    assert.deepEqual(q.frames,p.frames);assert.deepEqual(q.selectionSets,p.selectionSets);assert.deepEqual(q.connections[0].endpoints,p.connections[0].endpoints);
    assert.equal(q.loads.filter(l=>l.type==='fixed-selection').length,1);
    assert.ok(!q.parts.find(p=>p.method==='mpm').material.fixedRegions);
  }
  const s=session();try{s.replace(p);s.step();s.setHeater({power:15});assert.deepEqual(s.project.frames,p.frames);assert.deepEqual(s.project.selectionSets,p.selectionSets);assert.equal(s.project.loads.find(l=>l.type==='region-heat').power,15);}finally{s.free();}
});

test('editing a parent changes compiled joint anchors without baking away local definitions',()=>{
  const p=referenceExample(),before=toLegacy(p);
  const q=editLegacyProject(p,d=>{for(const b of d.bodies){b.position[0]+=1;}for(const b of d.coupling.parts)b.center[0]+=1;});
  const after=toLegacy(q);close(after.joints[0].anchor,add(before.joints[0].anchor,[1,0,0]));
  assert.deepEqual(q.frames,p.frames);
});

test('reference endpoint joints use independent anchors and preserve physical prismatic constraints',()=>{
  const p=referenceExample();p.frames[1].position[1]+=.1;
  const model=toLegacy(p);delete model.coupling;
  const s=new MultibodySimulation(model);
  try{assert.ok(Math.abs(s.snapshot().joints[0].coordinate-.1)<1e-6);for(let i=0;i<240;i++)s.step();assert.ok(s.snapshot().maxError<.002);}finally{s.free();}
});

test('local region pins only selected MPM material points and conserves their positions',()=>{
  const s=new CoupledSimulation(toLegacy(referenceExample()));
  try{
    const initial=s.snapshot(),pins=[];for(let i=0;i<s.particles.count;i++)if(s.particles.pinned[i])pins.push(i);
    assert.equal(pins.length,48);
    for(let i=0;i<60;i++)s.step();
    const f=s.snapshot();
    for(const i of pins)close(Array.from(f.particles.slice(i*8,i*8+3)),Array.from(initial.particles.slice(i*8,i*8+3)),1e-6);
    assert.ok(f.particles.every(Number.isFinite));
  }finally{s.free();}
});

test('selection measurement tracks original material points after they leave the selection box',()=>{
  const p=referenceExample(),s=session();
  try{
    const initial=s.replace(p),tracker=new ReferenceResults(p,initial),after=structuredClone(initial);
    for(let i=0;i<after.particles.length;i+=8)after.particles[i]+=4;
    const a=tracker.sample(initial).selections[0],b=tracker.sample(after).selections[0];
    assert.equal(a.count,48);assert.equal(b.count,a.count);close(b.position,add(a.position,[4,0,0]),1e-6);
    assert.equal(b.temperature,a.temperature);
  }finally{s.free();}
});

test('invalid references and unsupported selections reject atomically, including empty fixed regions',()=>{
  const s=session();try{
    s.replace(referenceExample());s.step();const saved=s.project,time=s.time;
    for(const edit of [
      p=>p.frames[0].part='missing',p=>p.frames[0].position=[NaN,0,0],p=>p.frames.push(p.frames[0]),
      p=>p.connections[0].endpoints.a.frame='missing',p=>p.selectionSets[0].region.lower=[1,1,1],
      p=>p.loads.find(l=>l.type==='fixed-selection').selection='missing',
      p=>p.selectionSets[0].region={type:'box',lower:[10,10,10],upper:[11,11,11]},
      p=>{p.parts.find(p=>p.method==='mpm').method='pbf';}
    ]){
      const draft=s.project;edit(draft);assert.throws(()=>s.replace(draft));assert.deepEqual(s.project,saved);assert.equal(s.time,time);
    }
  }finally{s.free();}
});

test('deleting parts, frames and sets removes their dependent objects',()=>{
  const p=referenceExample(),q=removePart(p,'hot-platen');assert.equal(q.frames.length,1);assert.equal(q.connections.length,0);toLegacy(q);
  const r=removeReference(p,'frame',p.frames[0].id);assert.equal(r.connections.length,0);toLegacy(r);
  const u=removeReference(p,'selection',p.selectionSets[0].id);assert.equal(u.loads.filter(l=>l.type==='fixed-selection').length,0);toLegacy(u);
  const v=editLegacyProject(p,d=>{d.bodies=d.bodies.filter(b=>b.id!=='hot-platen');d.joints=[];});assert.equal(v.frames.length,1);toLegacy(v);
});

test('saved observations retain reference definitions without becoming restart checkpoints',()=>{
  const p=referenceExample(),s=session();try{
    const f=s.replace(p);const tape=readRecording({schema:'summer-replay/1',project:p,frames:[{...f,particles:Array.from(f.particles)}]});
    assert.deepEqual(tape.project.frames,p.frames);assert.deepEqual(tape.project.selectionSets,p.selectionSets);assert.equal(new ReferenceResults(tape.project,tape.frames[0]).sample(tape.frames[0]).selections[0].count,48);
  }finally{s.free();}
});

test('existing fixed joints with arbitrary part rotations migrate without changing their motion',()=>{
  const p=referenceExample();p.loads=p.loads.filter(l=>l.type!=='fixed-selection');p.parts=p.parts.filter(p=>p.method==='rigid');
  p.solver.mpmEnabled=false;p.connections[0].type='fixed';p.connections[0].limits=null;delete p.connections[0].endpoints;p.frames=[];p.selectionSets=[];
  p.parts.find(b=>b.id==='guide').geometry.rotation=[20,30,40];p.parts.find(b=>b.id==='hot-platen').geometry.rotation=[-30,15,60];
  const converted=convertConnectionToReferences(p,p.connections[0].id),s=new MultibodySimulation(toLegacy(converted));
  try{const initial=s.snapshot();for(let i=0;i<240;i++)s.step();for(const b of s.snapshot().bodies)close(b.position,initial.bodies.find(x=>x.id===b.id).position,1e-5);}finally{s.free();}
});
