import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedImpactProject,validateMixed,editMixedParticles} from '../src/mixed/model.js';
import {validateMixedGPU} from '../src/mixed/gpu-model.js';
import {thermomechanicalParameters} from '../src/mixed/thermomechanical.js';
import {contactCSV} from '../src/simulation/contact-ui.js';

function dissipative(){
  const p=mixedImpactProject();p.solver.computeBackend='gpu';
  p.parts[1].material.model=10;p.parts[1].material.thermomechanical={plasticHeatFraction:.9};
  Object.assign(p.contactPairs[0],{frictionHeatFraction:.8,frictionHeatToA:.3});
  return p;
}

test('old mixed projects retain disabled dissipation and explicit opt-in survives geometry edits and JSON',()=>{
  const old=validateMixed(mixedImpactProject());
  assert.equal(thermomechanicalParameters().plasticHeatFraction,0);
  assert.equal(old.contactPairs[0].frictionHeatFraction,0);assert.equal(old.contactPairs[0].frictionHeatToA,.5);
  const p=validateMixedGPU(dissipative()),edited=editMixedParticles(p,d=>{
    d.coupling.parts[0].name='edited specimen';d.coupling.parts[0].center[0]+=.01;
  });
  const q=validateMixedGPU(JSON.parse(JSON.stringify(edited)));
  assert.equal(q.parts[1].name,'edited specimen');assert.equal(q.parts[1].material.thermomechanical.plasticHeatFraction,.9);
  assert.equal(q.contactPairs[0].frictionHeatFraction,.8);assert.equal(q.contactPairs[0].frictionHeatToA,.3);
  for(const model of [10,11]){q.parts[1].material.model=model;assert.equal(validateMixedGPU(q).parts[1].material.thermomechanical.plasticHeatFraction,.9);}
});

test('heat conversion fractions reject out-of-range and nonfinite values before solving',()=>{
  for(const value of [-.01,1.01,NaN,Infinity,'0.5']){
    const p=dissipative();p.parts[1].material.thermomechanical.plasticHeatFraction=value;
    assert.throws(()=>validateMixedGPU(p),/塑性功转热比例/);
    for(const key of ['frictionHeatFraction','frictionHeatToA']){
      const q=dissipative();q.contactPairs[0][key]=value;assert.throws(()=>validateMixedGPU(q),/摩擦功转热比例/);
    }
  }
  for(const fraction of [0,1]){
    const p=dissipative();p.parts[1].material.thermomechanical.plasticHeatFraction=fraction;
    Object.assign(p.contactPairs[0],{frictionHeatFraction:fraction,frictionHeatToA:fraction});assert.doesNotThrow(()=>validateMixedGPU(p));
  }
});

test('unsupported heat generation rejects CPU, elastic plastic heating and disabled thermal or mechanical fields',()=>{
  let p=dissipative();p.solver.computeBackend='cpu';assert.throws(()=>validateMixed(p),/塑性生热.*CUDA/);
  p=dissipative();p.parts[1].material.thermomechanical.plasticHeatFraction=0;p.solver.computeBackend='cpu';assert.throws(()=>validateMixed(p),/摩擦生热.*CUDA/);
  for(const model of [0,1]){p=dissipative();p.parts[1].material.model=model;assert.throws(()=>validateMixedGPU(p),/塑性生热仅支持/);}
  p=dissipative();p.parts[1].method='pbf';assert.throws(()=>validateMixedGPU(p),/塑性生热仅支持 MPM/);
  p=dissipative();p.contactPairs[0].thermal=false;p.solver.thermal=false;assert.throws(()=>validateMixedGPU(p),/塑性生热需要启用温度场/);
  p.parts[1].material.thermomechanical.plasticHeatFraction=0;assert.throws(()=>validateMixedGPU(p),/摩擦生热需要启用温度场/);
  p=dissipative();p.contactPairs[0].mechanical=false;assert.throws(()=>validateMixedGPU(p),/摩擦生热需要启用该对力学接触/);
});

test('friction heat remains enabled on an insulating interface without a thermal boundary load',()=>{
  const p=dissipative();p.parts[1].material.thermomechanical.plasticHeatFraction=0;
  Object.assign(p.contactPairs[0],{thermal:false,contactConductance:0});
  const q=validateMixedGPU(p);assert.equal(q.contactPairs[0].thermal,false);
  assert.equal(q.contactPairs[0].frictionHeatFraction,.8);assert.ok(q.solver.thermal);
  assert.ok(q.loads.every(l=>!l.type.startsWith('thermal-')));
});

test('contact CSV separates transferred heat, friction loss and generated heat split; missing measurements stay blank',()=>{
  const pair={id:'pair',a:'mpm',b:'fem',mechanical:true,thermal:true,force:[0,0,0],torque:[0,0,0],tangentialForce:[0,0,0],heatRate:-2,heat:-1,accumulatedHeat:-7,frictionLoss:10,frictionHeat:8,frictionHeatIntoA:2,frictionHeatIntoB:6};
  const rows=contactCSV([{time:1,contactPairs:[pair]},{time:2,contactPairs:[{...pair,frictionHeat:undefined,frictionHeatIntoA:undefined,frictionHeatIntoB:undefined}]}]).split('\n').map(row=>row.split(',').map(x=>x.replaceAll('"','')));
  const [head,first,last]=rows;assert.equal(first.length,head.length);assert.equal(last.length,head.length);
  const cell=(row,key)=>row[head.indexOf(key)];
  assert.equal(cell(first,'cumulative_heat_into_A_J'),'-7');assert.equal(cell(first,'friction_loss_J'),'10');
  assert.equal(cell(first,'friction_generated_heat_J'),'8');assert.equal(cell(first,'friction_heat_into_A_J'),'2');assert.equal(cell(first,'friction_heat_into_B_J'),'6');
  for(const key of ['friction_generated_heat_J','friction_heat_into_A_J','friction_heat_into_B_J'])assert.equal(cell(last,key),'');
});
