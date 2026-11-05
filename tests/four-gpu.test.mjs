import test from 'node:test';
import assert from 'node:assert/strict';
import {fourGPUExample,validateFourGPU,compileFourGPU} from '../src/mixed/four-gpu-model.js';
import {validateMixedGPU,mixedScaleProject} from '../src/mixed/gpu-model.js';
import {convertMixedGPUFrame} from '../src/mixed/gpu-adapter.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {projectDomains} from '../src/mixed/model.js';

test('four GPU canonical document preserves all four IDs and old two-domain projects',()=>{
  const p=fourGPUExample();p.parts.reverse();const q=validateMixedGPU(p);
  assert.deepEqual(q.parts.map(b=>b.method),['fem','mpm','pbf','rigid']);assert.equal(q.contactPairs.length,6);assert.equal(q.solver.computeBackend,'gpu');assert.equal(q.solver.mixedGpuPort,8796);
  assert.equal(validateMixedGPU(mixedScaleProject()).parts.length,2);
});
test('four GPU rejects unsupported geometry, joints, fracture and unimplemented heat conversion',()=>{
  for(const edit of [p=>p.parts[3].geometry.shape='box',p=>p.parts[1].material.model=3,p=>p.parts[1].discretization.sampling.enabled=true,p=>p.parts[1].material.phaseChange.enabled=true,p=>p.parts[1].material.fracture.enabled=true,p=>p.parts.splice(2,1),p=>p.contactPairs[0].frictionHeatFraction=.5]){
    const p=structuredClone(fourGPUExample());edit(p);assert.throws(()=>validateFourGPU(p));
  }
});
test('compilation seeds separate mass, capacity and thermal selections without hidden bodies',()=>{
  const p=fourGPUExample();p.loads.push(...p.parts.map(b=>({id:'heat-'+b.id,type:'thermal-power',target:b.id,region:{type:'whole'},power:100,enabled:true})));
  const c=compileFourGPU(p);assert.equal(c.nm,64);assert.equal(c.water.points.length,125);assert.equal(c.seed.points.length,189);assert.equal(c.water.cp,4180);
  assert.equal(c.fullProject.parts.length,4);assert.equal(c.thermalLoads.length,4);
  assert.ok(c.thermalLoads.find(d=>d.definition.target==='water').entries.every(e=>e.index>=64));
  assert.equal(c.thermalLoads.find(d=>d.definition.target==='sphere').domain,'rigid');
  assert.ok(Math.abs(c.water.mass*125-.375**3*1000)<1e-9);
  p.parts[3].geometry.center=p.parts[1].geometry.center.slice();assert.throws(()=>compileFourGPU(p),/重叠/);
});
test('display recovery preserves all four GPU states and does not manufacture energy closure',()=>{
  const p=fourGPUExample(),local=new FEMDynamicSimulation(projectDomains(p).fem),s=local.states[0];
  try{
    const b={id:'sphere',position:[0,1,0],rotation:[0,0,0,1],velocity:[1,0,0],angularVelocity:[0,0,0],temperature:80,kinetic:.75};
    const g={four:true,time:.1,state:{u:Array.from(s.u),v:Array.from(s.v),temperature:Array.from(s.thermal.temperature)},part:{count:189,temperature:40},particles:new Float32Array(189*8),particleParts:[{id:'solid',method:'mpm',values:{count:64}},{id:'water',method:'pbf',values:{count:125}}],bodies:[b],clock:{steps:500,baseDt:.0002,maxDt:.0002},performance:{solverMs:10},thermal:{residual:1e-9},contactPairs:[],backend:{arch:'cuda'}};
    g.framework={schema:'mpm-unified-framework/1',domains:[{id:'solid',method:'mpm'}]};
    const frame=convertMixedGPUFrame(p,local,g);assert.deepEqual(frame.mixed.framework,g.framework);assert.deepEqual(frame.results.parts.map(b=>b.method),['fem','mpm','pbf','rigid']);assert.equal(frame.bodies[0].temperature,80);assert.equal(frame.fem.dynamics.rigidKinetic,.75);assert.equal(frame.results.balance.energyResidual,null);assert.equal(frame.mixed.scheme,'resident-four-method/1');
    assert.throws(()=>convertMixedGPUFrame(p,local,{...g,four:false}),/缺少/);
  }finally{local.free();}
});
