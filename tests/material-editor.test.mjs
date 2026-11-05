import test from 'node:test';
import assert from 'node:assert/strict';
import {materialGroups,materialParameterPatch,referenceYoung} from '../src/simulation/material-editor.js';
import {emptyProject,addProjectPart,updateProjectPart} from '../src/simulation/part-builder.js';
import {normalizeSolverProject} from '../src/simulation/project.js';
import {fourGPUExample,validateFourGPU} from '../src/mixed/four-gpu-model.js';
const defaults=()=>Object.fromEntries(Object.entries(materialGroups).map(([key,v])=>[key,{...v.defaults}]));
test('reference E matches the existing particle solver SI conversion',()=>{
 for(const density of [1000,1100,2700])for(const stiffness of [.25,1,40]){
  const spacing=.05,mass=density*spacing**3,volume=spacing**3/.001;
  assert.ok(Math.abs(referenceYoung(density,stiffness)-mass/(64*volume)*16000*stiffness/.025)<1e-8);
 }
});
test('visible law parameters survive CPU project compilation and unrelated edits',()=>{
 for(const model of [4,5,6,7,8,9,10,11]){
  const values=defaults();values.plasticity.A=.06;values.pressure.cohesion=.04;values.thermalMaterial.A=.07;
  const patch=materialParameterPatch(model,values),p=addProjectPart(emptyProject(),{method:'mpm',material:{model,...patch}});
  const q=normalizeSolverProject(updateProjectPart(p,p.parts[0].id,{name:'material'}));
  for(const [key,v] of Object.entries(patch))assert.deepEqual(q.parts[0].material[key],v);
 }
});
test('GPU metal parameter edits survive validation',()=>{
 const p=fourGPUExample(),m=p.parts.find(p=>p.method==='mpm'),values=defaults();values.plasticity.A=.06;
 Object.assign(m.material,{model:6,...materialParameterPatch(6,values)});p.solver.stiffness=2;
 const q=validateFourGPU(p);assert.equal(q.parts.find(p=>p.method==='mpm').material.plasticity.A,.06);assert.equal(q.solver.stiffness,2);
});
test('invalid visible material parameters are refused',()=>{
 const v=defaults();v.plasticity.A=-1;assert.throws(()=>materialParameterPatch(6,v));
 v.thermalMaterial.Q=NaN;assert.throws(()=>materialParameterPatch(11,v));
 v.pressure.dilatancy=1.5;assert.throws(()=>materialParameterPatch(8,v));
 assert.deepEqual(materialParameterPatch(0,v),{});
});
