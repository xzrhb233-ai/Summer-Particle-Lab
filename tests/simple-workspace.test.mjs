import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSimpleSettings,recommendedStep} from '../src/simulation/simple-settings.js';
import {buildWorkspaceContext,summaryTokens,configurationId,ResultOrigins} from '../src/simulation/workspace-context.js';
import {fourGPUExample,unifiedPBDExample} from '../src/mixed/four-gpu-model.js';
import {emptyProject} from '../src/simulation/part-builder.js';
import {cantileverProject} from '../src/fem/model.js';
const settings=p=>({device:'gpu',timeStepMode:'custom',dt:p.solver.dt,duration:2,port:8797});

test('unified settings preserve all physics and change only requested solver settings',()=>{
  const p=fourGPUExample(),before=structuredClone(p),q=prepareSimpleSettings(p,{...settings(p),dt:.001});
  assert.deepEqual(p,before);assert.deepEqual(q.parts,p.parts);assert.deepEqual(q.contactPairs,p.contactPairs);
  assert.equal(q.solver.dt,.001);assert.equal(q.solver.mixedGpuPort,8797);
});
test('automatic time step is an explicit recommended cap, not an invented measured step',()=>{
  const p=fourGPUExample(),q=prepareSimpleSettings(p,{...settings(p),timeStepMode:'auto',dt:NaN});
  assert.equal(q.solver.dt,recommendedStep(p));assert.equal(q.solver.timeStepMode,'auto');
  const c=buildWorkspaceContext({project:q});assert.equal(c.solver.actualDt,null);assert.equal(c.solver.confirmedDevice,'unconfirmed');
});
test('CPU/GPU switching keeps the model and refuses unsupported GPU geometry',()=>{
  const p=fourGPUExample(),q=prepareSimpleSettings(p,{...settings(p),device:'cpu'});
  assert.equal(q.solver.computeBackend,'cpu');assert.deepEqual(q.parts,p.parts);
  p.parts.find(b=>b.method==='rigid').geometry.shape='box';
  assert.throws(()=>prepareSimpleSettings(p,settings(p)),/球形/);
});
test('switching PBD to CPU never silently changes coupling',()=>{
  const p=unifiedPBDExample();assert.throws(()=>prepareSimpleSettings(p,{...settings(p),device:'cpu'}),/Unified PBD/);
  assert.equal(p.solver.couplingMode,'unified-pbd');
});
test('standalone FEM cannot be mislabeled as GPU',()=>{
  const p=cantileverProject();assert.throws(()=>prepareSimpleSettings(p,settings(p)),/独立 FEM/);
  const summary=summaryTokens(buildWorkspaceContext({project:p}),'solver').map(t=>t.text).join('');
  assert.match(summary,/不进行时间推进/);assert.doesNotMatch(summary,/步长上限/);
});
test('invalid settings are rejected before a session is replaced',()=>{
  const p=fourGPUExample();for(const change of [{duration:0},{duration:61},{dt:0},{dt:NaN},{port:9000},{device:'auto'},{timeStepMode:'wrong'}])assert.throws(()=>prepareSimpleSettings(p,{...settings(p),...change}));
});
test('pending GPU and step input never overwrite applied CPU summary',()=>{
  const p=emptyProject(),c=buildWorkspaceContext({project:p,frame:{time:0},draft:{device:'gpu',dt:.01},pending:['时间步','计算设备']});
  assert.equal(c.solver.confirmedDevice,'cpu');assert.equal(c.solver.requestedDt,p.solver.dt);
  const txt=summaryTokens(c,'solver').map(t=>t.text).join('');assert.match(txt,/CPU/);assert.match(txt,/待应用/);assert.doesNotMatch(txt,/实际后端 GPU/);
});
test('recorded result provenance remains different after a model edit',()=>{
  const old=fourGPUExample(),p=structuredClone(old);p.parts[0].geometry.center[1]+=.1;
  const c=buildWorkspaceContext({project:p,resultProject:old,frame:{time:.1,mixed:{backend:{arch:'cuda'},framework:{couplingMode:'native'}}},recorded:true});
  assert.equal(c.result.configurationId,configurationId(old));assert.equal(c.result.matchesCurrentConfiguration,false);
  assert.match(summaryTokens(c,'results').map(t=>t.text).join(''),/修改前/);assert.equal(c.result.backend,'gpu');
});
test('hybrid GPU is distinct and zero measurements are not treated as missing',()=>{
  const p=fourGPUExample(),c=buildWorkspaceContext({project:p,frame:{time:0,backend:{arch:'cuda'},particles:new Float32Array(16),thermal:{residual:0}}});
  assert.equal(c.solver.confirmedDevice,'gpu+cpu');assert.equal(c.model.particleCount,2);assert.equal(c.result.thermalResidual,0);
});
test('context is an isolated read-only snapshot and does not claim AI execution',()=>{
  const p=fourGPUExample(),c=buildWorkspaceContext({project:p});c.project.parts[0].name='mutated';
  assert.notEqual(p.parts[0].name,'mutated');assert.equal(c.capabilities.executeAICommands,false);
});

test('provenance is stamped before edits and retained by cloned replay frames',()=>{
  const origins=new ResultOrigins(),p=emptyProject(),frame={time:.1},saved=structuredClone(frame);
  origins.capture(frame,p);origins.alias(saved,frame);
  const next=structuredClone(p);next.solver.dt=.001;
  origins.capture(frame,next);
  assert.equal(origins.get(saved).solver.dt,p.solver.dt);
  assert.equal(origins.get(saved),origins.get(frame));
  const newFrame={time:.2};origins.capture(newFrame,next);
  assert.equal(origins.get(newFrame).solver.dt,.001);
});

test('full particle count takes precedence over sampled render buffers',()=>{
  const c=buildWorkspaceContext({project:emptyProject(),target:2,frame:{time:1,coupling:{count:50000},particles:new Float32Array(80)}});
  assert.equal(c.model.particleCount,50000);assert.equal(c.result.progress,.5);
});
