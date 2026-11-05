import test from 'node:test';
import assert from 'node:assert/strict';
import {stepStatus} from '../src/simulation/step-status.js';

test('reports backend policy cap without calling the user request an actual step',()=>{
  const r=stepStatus({requested:.002,clock:{requestedDt:.002,baseDt:.0002,stepLimits:{requested:.002,fem:.001,thermal:null,mpm:.001,fourMethodPolicy:.0002}}});
  assert.match(r.status,/2.000e-3 s/);assert.match(r.status,/2.000e-4 s/);
  assert.match(r.status,/四方法 GPU 当前策略上限/);assert.doesNotMatch(r.status,/当前受限于：FEM/);
});
test('smaller request, unapplied edit and backend mismatch are distinct',()=>{
  const clock={requestedDt:.0001,baseDt:.0001,stepLimits:{requested:.0001,fourMethodPolicy:.0002}};
  assert.doesNotMatch(stepStatus({requested:.0001,clock}).status,/当前受限/);
  assert.match(stepStatus({requested:.0001,draft:.002,clock}).status,/尚未应用/);
  assert.match(stepStatus({requested:.002,clock}).status,/与项目不一致/);
});
test('legacy backend and CPU limits do not invent a cause, English uses English labels',()=>{
  assert.match(stepStatus({requested:.002,clock:{baseDt:.0002}}).status,/旧服务未提供具体原因/);
  assert.match(stepStatus({requested:.002,dynamics:{dt:.0001,requestedDt:.002}}).status,/1.000e-4/);
  assert.match(stepStatus({requested:.002,clock:{baseDt:.0002,stepLimits:{fourMethodPolicy:.0002}},en:true}).status,/four-method GPU policy limit/);
});

test('uncapped four-method backend identifies the remaining model limit',()=>{
  const r=stepStatus({requested:.002,clock:{requestedDt:.002,baseDt:.0004612,stepLimits:{requested:.002,fem:.0004612,thermal:306,mpm:.003125}}});
  assert.match(r.status,/当前受限于：FEM 积分上限/);
  assert.doesNotMatch(r.status,/四方法 GPU 当前策略上限/);
  assert.match(r.status,/4.612e-4 s/);
});
