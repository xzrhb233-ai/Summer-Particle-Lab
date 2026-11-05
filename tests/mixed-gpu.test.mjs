import test from 'node:test';
import assert from 'node:assert/strict';
import {mixedScaleProject,validateMixedGPU,mixedParticleSeed,MIXED_GPU_FEATURE} from '../src/mixed/gpu-model.js';
import {mixedThermalContactProject} from '../src/mixed/model.js';
import {MixedTransport} from '../src/mixed/gpu-adapter.js';
import {mixedEnergyCSV} from '../src/mixed/energy.js';
test('scale presets sample exactly 10,000 / 50,000 real material points and conserve reference volume',()=>{
  for(const count of [10000,50000]){const p=mixedScaleProject(count),s=mixedParticleSeed(p),b=p.parts[1];assert.equal(s.points.length,count);assert.ok(Math.abs(s.mass*count-b.geometry.size.reduce((a,x)=>a*x,1)*b.material.density)<1e-8);assert.ok(s.edges.length>count*2);assert.equal(p.solver.computeBackend,'gpu');}
});
test('non-binary grid spacing retains every solid thermal neighbor edge',()=>{
  const p=mixedScaleProject();p.discretization.mpm.cellSize=.137;
  const s=mixedParticleSeed(validateMixedGPU(p)),n=[0,1,2].map(k=>new Set(s.points.map(p=>p[k])).size);
  assert.equal(s.points.length,n[0]*n[1]*n[2]);
  assert.equal(s.edges.length,(n[0]-1)*n[1]*n[2]+n[0]*(n[1]-1)*n[2]+n[0]*n[1]*(n[2]-1));
});
test('GPU result export retains heat and timing while leaving unmeasured mechanical residual empty',()=>{
  const frame={time:.1,mixed:{backend:{arch:'cuda'},clock:{steps:500,minDt:.0002,maxDt:.0002},performance:{solverMs:50,snapshotMs:2,frameBytes:320000,substepHostTransfers:0}},coupling:{count:10000},fem:{parts:[{summary:{maxDisplacement:.02}}]},contactPairs:[{totalImpulse:[1,2,3],accumulatedHeat:-20}],thermal:{residual:1e-7}};
  const [head,row]=mixedEnergyCSV([frame]).split('\n').map(s=>s.split(',')),values=Object.fromEntries(head.map((k,i)=>[k,row[i]]));
  assert.equal(values.heat_into_mpm_J,'-20');assert.equal(values.mechanical_residual_J,'');assert.equal(values.shared_steps,'500');assert.equal(values.substep_host_transfers,'0');
});
test('GPU validates its actual feature set and canonicalizes part order',()=>{
  const p=mixedScaleProject();p.parts.reverse();assert.equal(validateMixedGPU(p).parts[0].method,'fem');
  assert.throws(()=>validateMixedGPU(mixedThermalContactProject()),/GPU/);
  for(const change of [p=>p.parts[1].material.model=3,p=>p.parts[1].discretization.sampling={enabled:true},p=>p.solver.mixedGpuPort=9000,p=>p.parts.push(structuredClone(p.parts[0]))]){const p=structuredClone(mixedScaleProject());change(p);assert.throws(()=>validateMixedGPU(p));}
});
class Socket{constructor(){this.sent=[];}send(x){this.sent.push(JSON.parse(x));}close(){this.closed=true;}}
test('mixed transport rejects legacy endpoints and malformed / nonfinite frames',async()=>{
  let c=new MixedTransport(8790,Socket);c.socket.onmessage({data:JSON.stringify({type:'ready',backend:{arch:'cuda'},feature:'wrong'})});await assert.rejects(c.ready,/兼容/);assert.ok(c.closed);
  c=new MixedTransport(8790,Socket);c.receive(JSON.stringify({type:'ready',backend:{arch:'cuda'},feature:MIXED_GPU_FEATURE}));await c.ready;
  const pending=c.request('advance',{dt:.01});await Promise.resolve();const id=c.socket.sent[0].id;
  const header=new TextEncoder().encode(JSON.stringify({type:'frame',id,count:50001,frame:{time:.01}})),raw=new ArrayBuffer(4+Math.ceil(header.length/4)*4);new DataView(raw).setUint32(0,header.length,true);new Uint8Array(raw,4,header.length).set(header);
  c.socket.onmessage({data:raw});await assert.rejects(pending,/结果/);assert.ok(c.closed);
});
