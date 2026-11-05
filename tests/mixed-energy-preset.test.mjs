import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedGPUEnergyProject,mixedGPUDissipationProject,validateMixedGPU,MIXED_GPU_FEATURE} from '../src/mixed/gpu-model.js';

test('energy demo adds only diagnostics to the existing 10k physical experiment',()=>{
  const energy=mixedGPUEnergyProject(),original=mixedGPUDissipationProject();
  assert.equal(energy.solver.diagnostics,true);
  assert.equal(original.solver.diagnostics,undefined);
  assert.equal(energy.solver.mixedGpuPort,8795);
  assert.equal(MIXED_GPU_FEATURE,'residentMpmFemV6');
  energy.name=original.name;delete energy.solver.diagnostics;
  assert.deepEqual(energy,original);
});

test('saved GPU projects retain an explicit diagnostics toggle and reject non-booleans',()=>{
  const project=mixedGPUEnergyProject();project.solver.diagnostics=false;
  assert.equal(validateMixedGPU(JSON.parse(JSON.stringify(project))).solver.diagnostics,false);
  project.solver.diagnostics='false';
  assert.throws(()=>validateMixedGPU(project),/布尔值/);
});
