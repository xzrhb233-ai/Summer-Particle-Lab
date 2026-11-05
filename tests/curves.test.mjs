import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCurves,curveValue,curveIntegral} from '../src/simulation/curves.js';
import {stagedExample} from '../src/simulation/staged-example.js';
import {toLegacy,fromLegacy,editLegacyProject,removePart,normalizeSolverProject} from '../src/simulation/project.js';
import {initialize,MultibodySimulation} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {exchange} from './gpu-thermal-fixtures.mjs';
import {loadCSV} from '../src/simulation/curve-ui.js';
import {removeReference} from '../src/simulation/references.js';
await initialize();
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('piecewise integrals, endpoint holding and right-continuous steps',()=>{
  for(const type of ['linear','smooth','step']){
    const c=normalizeCurves([{id:'c',type,points:[[0,0],[1,2],[2,0]]}])[0];
    close(curveValue(c,.5),type==='step'?0:1);close(curveValue(c,1),2);
    close(curveIntegral(c,0,2),2);close(curveIntegral(c,.4,1.6)+curveIntegral(c,1.6,3),curveIntegral(c,.4,3));
    close(curveIntegral(c,2,0),-2);
  }
  const c=normalizeCurves([{id:'c',type:'linear',points:[[0,2],[1,4]]}])[0];
  close(curveIntegral(c,-1,2),9);
});
test('sine integrates independently of sample rate and holds boundaries',()=>{
  const c=normalizeCurves([{id:'c',type:'sine',start:1,end:2,offset:2,amplitude:3,frequency:1,phase:90}])[0];
  close(curveValue(c,0),5);close(curveIntegral(c,0,3),12);
  close(Array.from({length:37},(_,i)=>curveIntegral(c,3*i/37,3*(i+1)/37)).reduce((a,b)=>a+b,0),12);
});
test('project roundtrip and ordinary edits retain curves and reference bindings',()=>{
  const p=normalizeSolverProject(stagedExample()),round=fromLegacy(toLegacy(p)),edited=editLegacyProject(p,m=>m.bodies[0].mass=4);
  assert.deepEqual(round.curves,p.curves);assert.deepEqual(edited.loadBindings,p.loadBindings);assert.deepEqual(edited.frames,p.frames);
  const removed=removePart(p,'right-clamp');assert.ok(!removed.loadBindings.some(b=>b.kind==='motor-target'));
  const last=editLegacyProject(p,m=>{m.coupling.parts=[];});
  assert.ok(!last.loadBindings.some(b=>b.kind.endsWith('heat')));
});
test('invalid curve data, conflicting channels and excessive output are rejected',()=>{
  for(const change of [
    p=>p.curves[0].points[1][0]=0,p=>p.curves[0].points[0][0]=1,
    p=>p.curves[0].points[1][1]=NaN,p=>p.loadBindings[0].curve='missing',
    p=>p.loadBindings.push({...p.loadBindings[0],id:'duplicate'}),
    p=>p.loadBindings[0].scale=1e20,p=>p.loadBindings[1].target='left-grip',
  ]){const p=stagedExample();change(p);assert.throws(()=>toLegacy(p));}
});
export function forceFixture(){
  return {schema:'summer-mbd/1',gravity:[0,0,0],dt:1/60,bodies:[{id:'body',type:'dynamic',shape:'sphere',size:[.2,.2,.2],position:[0,1,0],mass:2}],joints:[],
    curves:[{id:'pulse',type:'step',points:[[0,0],[.003,1],[.007,0],[.1,0]]}],
    loadBindings:[{id:'force',kind:'body-force',target:'body',component:0,curve:'pulse',scale:100,offset:0}]};
}
test('sub-step pulses preserve analytical impulse and restore zero load',()=>{
  const s=new MultibodySimulation(forceFixture());try{
    s.step(1/60);const f=s.snapshot();close(f.bodies[0].velocity[0],.2,2e-6);
    close(f.loadResponses[0].commandIntegral,.4);
    for(let k=0;k<6;k++)s.step(1/60);close(s.snapshot().bodies[0].velocity[0],.2,2e-6);
    assert.equal(s.model.bodies[0].force[0],0);
  }finally{s.free();}
});
test('heat waveform energy follows its integral and manual stop disables only that binding',()=>{
  const p=exchange();p.couplings[0].thermal=false;
  p.curves=[{id:'heat',type:'linear',points:[[0,0],[.007,1],[.013,0],[.1,0]]}];
  p.loadBindings=[{id:'heat',kind:'region-heat',target:'mpm',curve:'heat',scale:1e6,offset:0}];
  const s=new CoupledSimulation(toLegacy(p));try{
    const f=s.step(1/60);close(f.coupling.externalHeat,6500,1e-5);close(f.loadResponses[0].commandIntegral,6500,1e-7);
    close(f.coupling.thermalResidual,0,1e-6);
    s.setHeater({power:-1000});assert.equal(s.model.loadBindings[0].enabled,false);
    const g=s.step(1/60);close(g.coupling.externalHeat,6500-1000/60,1e-5);assert.equal(g.loadResponses.length,0);
  }finally{s.free();}
});
test('force and torque channels preserve unbound constant components',()=>{
  const m=forceFixture();m.bodies[0].force=[0,4,0];
  m.loadBindings.push({id:'torque',kind:'body-torque',target:'body',component:2,curve:'pulse',scale:2,offset:0});
  const s=new MultibodySimulation(m);try{
    const f=s.step(1/60);close(f.bodies[0].velocity[0],.2,2e-6);close(f.bodies[0].velocity[1],2/60,2e-6);
    close(f.bodies[0].angularVelocity[2],1,2e-5);
    close(f.loadResponses.find(r=>r.id==='torque').commandIntegral,.008);
    assert.deepEqual(s.model.bodies[0].force,[0,4,0]);
  }finally{s.free();}
});
for(const type of ['revolute','prismatic'])for(const mode of ['position','velocity'])test(`${type} curve ${mode} motor reports actual motion without changing authored target`,()=>{
  const m={schema:'summer-mbd/1',gravity:[0,0,0],dt:1/480,
    bodies:[{id:'a',type:'fixed',shape:'box',size:[.1,.1,.1],position:[0,1,0]},
      {id:'b',type:'dynamic',shape:'sphere',size:[.2,.2,.2],position:[0,1,0],mass:1}],
    joints:[{id:'j',type,a:'a',b:'b',anchor:[0,1,0],axis:[1,0,0],motor:{mode,target:0,stiffness:1000,damping:50}}],
    curves:[{id:'drive',type:'smooth',points:[[0,0],[.1,1],[1,1]]}],
    loadBindings:[{id:'drive',kind:'motor-target',target:'j',curve:'drive',scale:.4,offset:0}]};
  const s=new MultibodySimulation(m);try{
    for(let k=0;k<60;k++)s.step(1/60);
    const r=s.snapshot().loadResponses[0];close(r.response,.4,.005);close(r.requested,.4);
    assert.equal(s.model.joints[0].motor.target,0);assert.equal(r.responseUnit,(type==='revolute'?'rad':'m')+(mode==='velocity'?'/s':''));
  }finally{s.free();}
});
test('high frequency sine caps physical stepping and CSV keeps distinct units',()=>{
  const m=forceFixture();m.curves[0]={id:'pulse',type:'sine',start:0,end:.01,amplitude:1,frequency:100,phase:0,offset:0};
  const s=new MultibodySimulation(m);try{
    const f=s.step(.01);assert.ok(f.steps>=32);close(f.bodies[0].velocity[0],0,2e-6);
    const csv=loadCSV([f]);assert.match(csv,/command_unit/);assert.match(csv,/"N"/);assert.match(csv,/"m\/s"/);
    assert.match(csv,/actual_total_external_heat_J/);
  }finally{s.free();}
  const p=stagedExample(),motor=p.connections.find(j=>j.id==='actuator');
  const removed=removeReference(p,'frame',motor.endpoints.a.frame);assert.ok(!removed.loadBindings.some(b=>b.kind==='motor-target'));assert.doesNotThrow(()=>toLegacy(removed));
});
