import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedImpactProject,projectDomains} from '../src/mixed/model.js';
import {mixedGPUThermalProject,validateMixedGPU,mixedParticleSeed} from '../src/mixed/gpu-model.js';
import {mixedThermalDescriptors} from '../src/mixed/gpu-thermal.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';

const thermal=(id,target,type,region={type:'whole'},more={})=>({id,target,type:'thermal-'+type,region,enabled:true,...(type==='power'?{power:1000}:{temperature:100,...(type==='convection'?{coefficient:100}:{})}),...more});
function compile(loads){
  const input=mixedImpactProject();input.loads.push(...loads);const p=validateMixedGPU(input),fem=new FEMDynamicSimulation(projectDomains(p).fem);
  try{return mixedThermalDescriptors(p,mixedParticleSeed(p),fem);}finally{fem.free();}
}
test('GPU thermal selections preserve material faces, nominal areas and total-power weights',()=>{
  for(const face of ['x-','x+','y-','y+','z-','z+']){
    const [mpm,fem]=compile([thermal('mpm','hot-block','convection',{type:'face',face}),thermal('fem','beam','power',{type:'face',face})]);
    assert.equal(mpm.entries.length,16);assert.equal(mpm.domain,'mpm');assert.equal(fem.domain,'fem');
    assert.ok(Math.abs(mpm.entries.reduce((s,e)=>s+e.area,0)-.04)<1e-12);
    const a='xyz'.indexOf(face[0]),area=[1.2,.15,.4].filter((_,k)=>k!==a).reduce((s,x)=>s*x,1);
    assert.ok(Math.abs(fem.entries.reduce((s,e)=>s+e.weight,0)-area)<1e-12);
  }
});
test('conflicting thermostats fail before GPU publication, disabled boundaries remain inert',()=>{
  assert.throws(()=>compile([thermal('all','hot-block','temperature'),thermal('face','hot-block','temperature',{type:'face',face:'y+'},{temperature:50})]),/不同温度/);
  assert.throws(()=>compile([thermal('all','beam','temperature'),thermal('face','beam','temperature',{type:'face',face:'y+'},{temperature:50})]),/不同温度/);
  assert.equal(compile([thermal('off','hot-block','temperature',{type:'whole'},{enabled:false})])[0].definition.enabled,false);
});
test('three boundary types remain in the unified GPU project document',()=>{
  const p=mixedGPUThermalProject();assert.equal(p.solver.computeBackend,'gpu');
  assert.deepEqual(p.loads.filter(l=>l.type.startsWith('thermal-')).map(l=>l.type),['thermal-power','thermal-temperature','thermal-convection']);
  const disabled=structuredClone(p);disabled.solver.thermal=false;assert.throws(()=>validateMixedGPU(disabled),/温度场/);
  const latent=structuredClone(p);latent.parts[1].material.phaseChange.enabled=true;assert.throws(()=>validateMixedGPU(latent),/相变/);
});
