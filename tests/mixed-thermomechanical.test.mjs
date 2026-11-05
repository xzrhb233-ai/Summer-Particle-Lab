import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedGPUThermomechanicalProject,validateMixedGPU,mixedParticleSeed} from '../src/mixed/gpu-model.js';
import {validateMixed,editMixedParticles} from '../src/mixed/model.js';
import {normalizeThermalLoads,PartThermalLoads} from '../src/simulation/thermal-loads.js';
test('thermomechanical project preserves shared material parameters, face anchors and force programs',()=>{
  const p=mixedGPUThermomechanicalProject(),q=validateMixedGPU(JSON.parse(JSON.stringify(p))),s=mixedParticleSeed(q);
  assert.equal(s.points.length,10000);assert.equal(s.pinned.filter(Boolean).length,625);assert.equal(q.parts[1].material.model,10);
  assert.equal(q.parts[1].material.thermomechanical.hotStiffnessRatio,.35);assert.equal(q.loadBindings.length,1);
  assert.equal(q.solver.outputInterval,.02);
  assert.equal(s.cp,900);assert.equal(s.conductivity,205);assert.equal(s.edges[0][2],205*s.spacing);
  assert.equal(q.parts[1].initial.temperature,20);assert.equal(q.parts[0].initial.temperature,140);
  assert.ok(q.loads.filter(l=>l.type.startsWith('thermal-')).every(l=>l.target===q.parts[0].id));
  assert.equal(q.contactPairs[0].thermalToleranceRatio,0);
  assert.throws(()=>validateMixedGPU({...q,solver:{...q.solver,outputInterval:0}}),/输出间隔/);
  const edited=editMixedParticles(q,d=>d.coupling.parts[0].name='renamed');assert.deepEqual(edited.parts[1].material.thermomechanical,q.parts[1].material.thermomechanical);
  assert.equal(edited.parts[1].material.cp,900);assert.equal(edited.parts[1].material.conductivity,205);
  const cpu=structuredClone(q);cpu.solver.computeBackend='cpu';assert.throws(()=>validateMixed(cpu),/CUDA/);
  for(const model of [0,1,10,11]){const r=structuredClone(q);r.parts[1].material.model=model;assert.equal(validateMixedGPU(r).parts[1].material.model,model);}
  const invalid=structuredClone(q);invalid.parts[1].material.thermomechanical.expansion=Infinity;assert.throws(()=>validateMixedGPU(invalid));
  invalid.parts[1].material.thermomechanical.expansion=0;invalid.parts[1].material.cp=0;assert.throws(()=>validateMixedGPU(invalid),/比热容/);
});
test('thermal power program integrates through heating/cooling and restores its clock',()=>{
  const p=mixedGPUThermomechanicalProject();p.loads=p.loads.filter(l=>l.id==='plate-cycle-temperature');Object.assign(p.loads[0],{target:p.parts[1].id,type:'thermal-power',power:0,program:{type:'linear',points:[[0,0],[1,200],[2,-200]]}});normalizeThermalLoads(p);
  let energy=0;const e={index:0,weight:1,area:1,receive(q){energy+=q;return q;}};
  const s=new PartThermalLoads(p,new Map([[p.parts[1].id,{select:()=>[e]}]]));s.step(.5);const backup=s.backup();s.step(1.5);assert.equal(energy,100);
  s.restore(backup);assert.equal(s.time,.5);assert.equal(s.items[0].heat,25);
  const bad=structuredClone(p);bad.loads[0].program.points[1][1]=1e8;assert.throws(()=>normalizeThermalLoads(bad));
});
