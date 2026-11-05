import test from 'node:test';
import assert from 'node:assert/strict';
import {fourGPUExample,unifiedPBDExample,compileFourGPU} from '../src/mixed/four-gpu-model.js';
import {validateMixedGPU,mixedScaleProject} from '../src/mixed/gpu-model.js';
import {couplingMode,validateCouplingOptions,requireCouplingSupport} from '../src/simulation/coupling-mode.js';
import {convertMixedGPUFrame} from '../src/mixed/gpu-adapter.js';

test('old documents stay native; PBD selection and iteration count survive compilation and JSON',()=>{
  assert.equal(couplingMode(fourGPUExample().solver),'native');
  const p=unifiedPBDExample();p.solver.pbdIterations=9;
  const c=compileFourGPU(JSON.parse(JSON.stringify(p)));
  assert.equal(c.fullProject.solver.couplingMode,'unified-pbd');assert.equal(c.fullProject.solver.pbdIterations,9);
  p.solver.couplingMode='native';assert.equal(compileFourGPU(p).fullProject.solver.couplingMode,'native');
});
test('unsupported backends, partial domains, invalid settings, and stale servers cannot silently fall back',()=>{
  for(const n of [0,21,2.5,NaN,'6',true])assert.throws(()=>validateCouplingOptions({couplingMode:'unified-pbd',pbdIterations:n}));
  assert.throws(()=>validateCouplingOptions({couplingMode:'unknown'}));
  const p=unifiedPBDExample();p.solver.computeBackend='cpu';assert.throws(()=>requireCouplingSupport(p),/Taichi GPU/);
  const q=mixedScaleProject();q.solver.couplingMode='unified-pbd';assert.throws(()=>validateMixedGPU(q),/四方法/);
  assert.throws(()=>convertMixedGPUFrame(unifiedPBDExample(),null,{framework:{couplingMode:'native'}}),/后端未启用/);
});
