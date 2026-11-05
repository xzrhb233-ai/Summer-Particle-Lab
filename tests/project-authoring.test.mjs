import test from 'node:test';
import assert from 'node:assert/strict';
import {fourGPUExample,unifiedPBDExample} from '../src/mixed/four-gpu-model.js';
import {removePart} from '../src/simulation/project.js';
import {prepareProjectMethods,emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {authoringPreview,authoringIssue} from '../src/simulation/authoring-preview.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {mixedAdapter} from '../src/mixed/adapter.js';
import {buildWorkspaceContext} from '../src/simulation/workspace-context.js';
const registry=new SolverRegistry().register(mixedAdapter);

test('each GPU component can be deleted into an editable preview, preserving material and device',()=>{
 for(const original of [fourGPUExample(),unifiedPBDExample()])for(const part of original.parts){
  const p=prepareProjectMethods(removePart(original,part.id)),issue=authoringIssue(registry,p);
  assert.ok(issue);
  const r=authoringPreview(p,issue),frame=r.snapshot();
  assert.equal(frame.bodies.length,3);assert.ok(!frame.bodies.some(b=>b.id===part.id));
  assert.equal(r.project.solver.computeBackend,'gpu');
  assert.equal(r.project.solver.couplingMode,original.solver.couplingMode);
  for(const b of r.project.parts)assert.deepEqual(b.material,original.parts.find(x=>x.id===b.id).material);
  assert.ok(r.project.contactPairs.every(c=>c.a!==part.id&&c.b!==part.id));
  assert.ok(r.project.loads.every(l=>l.target!==part.id));
  assert.ok(r.project.selectionSets.every(s=>s.part!==part.id));
  assert.throws(()=>r.step(.001),/模型尚未就绪/);
  const c=buildWorkspaceContext({project:p,frame});
  assert.equal(c.result,null);assert.equal(c.solver.status,'editing');assert.equal(c.solver.confirmedDevice,'unconfirmed');
 }
});
test('GPU parts can be deleted sequentially down to zero without a GPU server',()=>{
 let p=unifiedPBDExample();
 for(const part of [...p.parts]){
  p=prepareProjectMethods(removePart(p,part.id));
  const r=authoringPreview(p,authoringIssue(registry,p));assert.equal(r.snapshot().bodies.length,p.parts.length);
 }
 assert.equal(p.parts.length,0);assert.equal(p.contactPairs.length,0);assert.equal(p.loads.length,0);
});
test('staging releases old runtime, preserves heat settings and can resume a valid four-domain document',()=>{
 const original=fourGPUExample();const m=original.parts.find(b=>b.method==='mpm');m.material.model=6;m.material.thermomechanical={plasticHeatFraction:.5};
 const session=new ProjectSession(registry);let freed=0;session.runtime={free(){freed++;}};
 const target=original.parts.find(b=>b.method==='pbf');
 const edited=prepareProjectMethods(removePart(original,target.id));
 session.stage(edited,authoringIssue(registry,edited));
 assert.equal(freed,1);assert.equal(session.time,0);assert.ok(session.runtime.preview);
 assert.deepEqual(session.project,edited);assert.throws(()=>session.step(),/模型尚未就绪/);
 const restored=addProjectPart(session.project,target);
 assert.equal(authoringIssue(registry,restored),null);
 assert.equal(restored.parts.find(b=>b.method==='mpm').material.thermomechanical.plasticHeatFraction,.5);
});
test('blank project has no example parts, loads or connections',()=>{
 const p=emptyProject();for(const key of ['parts','loads','connections','contactPairs','frames','selectionSets','loadBindings'])assert.deepEqual(p[key],[]);
 assert.equal(p.solver.adapter,'cpu-coupled');
});
