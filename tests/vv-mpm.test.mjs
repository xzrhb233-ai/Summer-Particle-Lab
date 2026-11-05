import test from 'node:test';
import assert from 'node:assert/strict';
import {runMPMTranslationCheck} from '../src/simulation/vv-mpm.js';

test('real CPU MPM preserves analytic free translation through a full grid cell at three initial phases',async()=>{
  const reported=[],report=await runMPMTranslationCheck({onRow:r=>reported.push(r)});
  assert.equal(report.backend,'cpu');assert.equal(report.status,'passed');assert.equal(report.rows.length,3);assert.deepEqual(reported,report.rows);
  assert.deepEqual(report.rows.map(r=>r.phaseFraction),[0,.25,.5]);
  assert.equal(new Set(report.rows.map(r=>r.particleCount)).size,1);assert.equal(new Set(report.rows.map(r=>r.mass)).size,1);
  for(const r of report.rows){
    assert.ok(r.travelCells>1);assert.ok(r.physicalSubsteps>1);assert.ok(r.minSubstep>0&&r.maxSubstep<=report.configuration.requestedDt+1e-12);
    assert.equal(r.particleHealth.inspectedParticles,r.particleCount);assert.equal(r.particleHealth.nonfiniteParticles,0);assert.equal(r.particleHealth.invalidJCount,0);
    assert.equal(r.regularization.solidAntiClump,true);assert.equal(r.regularization.initialRandomSampling,false);
    assert.ok(Object.values(r.transferWork).every(Number.isFinite));assert.ok(r.positionError<1e-8);assert.ok(r.maxFDeviation<1e-8);assert.ok(r.maxNormalizedStress<1e-8);
  }
  assert.ok(report.limitations.some(x=>x.includes('nonuniform stress')));assert.ok(report.limitations.some(x=>x.includes('No GPU')));
});
test('MPM translation check respects abort and substep budgets without claiming a completed check',async()=>{
  const controller=new AbortController();controller.abort();
  const aborted=await runMPMTranslationCheck({signal:controller.signal});
  assert.equal(aborted.status,'inconclusive');assert.equal(aborted.stopReason,'aborted');assert.equal(aborted.rows.length,0);
  const bounded=await runMPMTranslationCheck({maxSteps:1});
  assert.equal(bounded.status,'inconclusive');assert.equal(bounded.stopReason,'step-budget-exhausted');assert.equal(bounded.physicalSubsteps,1);assert.ok(bounded.rows[0].travelCells<1);
});
