import test from 'node:test';
import assert from 'node:assert/strict';
import {fourGPUExample,compileFourGPU,validateFourGPU} from '../src/mixed/four-gpu-model.js';
import {mixedScaleProject,validateMixedGPU} from '../src/mixed/gpu-model.js';
import {MIXED_METALS_FEATURE,requireMixedMaterialFeatures} from '../src/mixed/material-capabilities.js';

test('metal IDs and authored plasticity survive four-domain compilation',()=>{
  for(const model of [4,5,6,7]){
    const p=structuredClone(fourGPUExample()),b=p.parts.find(b=>b.method==='mpm');
    b.material.model=model;b.material.plasticity.A=.04;b.material.plasticity.B=.15;
    b.material.thermomechanical={plasticHeatFraction:.5};
    const c=compileFourGPU(p);
    assert.equal(c.seed.model,model);assert.equal(c.project.parts[1].material.plasticity.A,.04);
    assert.equal(c.fullProject.parts[1].material.plasticity.B,.15);
    assert.equal(c.project.parts[1].material.thermomechanical.plasticHeatFraction,.5);
    assert.throws(()=>requireMixedMaterialFeatures(p,['residentFourMethodV2']),/新版/);
    assert.doesNotThrow(()=>requireMixedMaterialFeatures(p,[MIXED_METALS_FEATURE]));
    const two=mixedScaleProject();two.parts[1].material.model=model;
    assert.equal(validateMixedGPU(two).parts[1].material.model,model);
  }
});
test('unsupported granular laws stay rejected and old supported projects need no new flag',()=>{
  const p=fourGPUExample();assert.doesNotThrow(()=>requireMixedMaterialFeatures(p,[]));
  for(const model of [2,3,8,9]){p.parts[1].material.model=model;assert.throws(()=>validateFourGPU(p),/尚未接入/);}
});
