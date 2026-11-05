import test from 'node:test';
import assert from 'node:assert/strict';
import {bicycleWall} from '../src/multibody/bicycle.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {validateGpuProject,GPU_PROJECT_FEATURE} from '../src/simulation/gpu-contract.js';
import {ProjectTransport,gpuCoupledAdapter} from '../src/simulation/gpu-adapter.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {gripExample} from '../src/simulation/grip-example.js';
import {mpmPartThermalExample} from '../src/simulation/part-thermal-example.js';
const project=()=>{const p=structuredClone(fromLegacy(bicycleWall()));p.solver.adapter='taichi-coupled';p.solver.gpuPort=8769;return p;};

class Socket{
  constructor(url){this.url=url;this.sent=[];this.closed=false;Socket.last=this;}
  send(s){this.sent.push(JSON.parse(s));}
  close(){this.closed=true;this.onclose?.();}
  receive(data){this.onmessage({data});}
}
const ready=client=>client.socket.receive(JSON.stringify({type:'ready',features:[GPU_PROJECT_FEATURE],backend:{arch:'cuda',device:'test'}}));

test('old GPU service rejects shared part heat loads before sending init',async()=>{
  const adapter=gpuCoupledAdapter(Socket),p=mpmPartThermalExample();p.solver.adapter=adapter.id;p.solver.gpuPort=8777;
  const loading=adapter.create(validateGpuProject(p)),socket=Socket.last,rejected=assert.rejects(loading,/部件热载荷/);
  socket.receive(JSON.stringify({type:'ready',features:[GPU_PROJECT_FEATURE],backend:{arch:'cuda'}}));await rejected;
  assert.equal(socket.sent.length,0);assert.equal(socket.closed,true);
});
function packet(id,time=0,count=1){
  const header=new TextEncoder().encode(JSON.stringify({type:'frame',id,count,frame:{time,bodies:[]}})),offset=4+Math.ceil(header.length/4)*4,data=new ArrayBuffer(offset+count*32);
  new DataView(data).setUint32(0,header.length,true);new Uint8Array(data,4,header.length).set(header);new Float32Array(data,offset).set([1,2,3,11,20,0,0,0]);return data;
}

test('GPU project document retains common geometry, materials, anchors and transmission',()=>{
  const p=validateGpuProject(project());assert.deepEqual(toLegacy(p),bicycleWall());
  assert.equal(p.solver.gpuPort,8769);assert.equal(p.parts.find(p=>p.method==='mpm').boundary.fixedFace,'minY');
});
test('GPU thermal scope accepts heat and phase changes but rejects unsafe ports',()=>{
  for(const change of [p=>p.couplings[0].thermal=true,p=>p.parts.find(p=>p.method==='mpm').material.phaseChange.enabled=true,p=>p.loads.find(l=>l.type==='body-heat').power=10]){const p=project();change(p);assert.doesNotThrow(()=>validateGpuProject(p));}
  for(const change of [p=>p.solver.gpuPort=80,p=>p.solver.gpuPort=NaN]){const p=project();change(p);assert.throws(()=>validateGpuProject(p));}
});
test('a pure-particle GPU endpoint cannot masquerade as a coupled project solver',async()=>{
  const c=new ProjectTransport(8769,Socket),failure=assert.rejects(c.ready,/项目服务/);
  c.socket.receive(JSON.stringify({type:'ready',features:['discretization'],backend:{arch:'cuda'}}));await failure;assert.ok(c.closed);
});
test('V5 services must be upgraded before loading GPU region connections',async()=>{
  const c=new ProjectTransport(8771,Socket),failure=assert.rejects(c.ready,/V11/);
  c.socket.receive(JSON.stringify({type:'ready',features:['rigidMpmPbfFramesV5'],backend:{arch:'cuda'}}));await failure;assert.ok(c.closed);
});
test('all GPU region modes preserve common project definitions and reject unsupported material states',()=>{
  for(const mode of ['bind','elastic','slide']){
    const p=gripExample();for(const j of p.connections.filter(j=>j.type==='region'))j.mode=mode;
    const validated=validateGpuProject(p);
    assert.deepEqual(validated.connections.filter(j=>j.type==='region'),p.connections.filter(j=>j.type==='region'));
    assert.deepEqual(validated.frames,p.frames);assert.deepEqual(validated.selectionSets,p.selectionSets);
  }
  for(const change of [
    p=>p.solver.diagnostics=true,
    p=>p.parts.find(b=>b.method==='mpm').material.fracture.enabled=true,
    p=>p.parts.find(b=>b.method==='mpm').method='pbf',
  ]){const p=gripExample();change(p);assert.throws(()=>validateGpuProject(p));}
});
test('project transport matches requests and validates binary particle frames',async()=>{
  const c=new ProjectTransport(8769,Socket);ready(c);
  try{const pending=c.request('step',{dt:1/60});await Promise.resolve();const id=c.socket.sent[0].id;c.socket.receive(packet(id,.1));const f=await pending;assert.equal(f.time,.1);assert.deepEqual([...f.particles.slice(0,3)],[1,2,3]);assert.equal(c.socket.url,'ws://127.0.0.1:8769');}finally{c.close();}
});
test('a rejected edit is recoverable while disconnects fail pending GPU work',async()=>{
  const c=new ProjectTransport(8769,Socket);ready(c);
  const edit=c.request('init',{project:project()}),rejected=assert.rejects(edit,/invalid edit/);await Promise.resolve();c.socket.receive(JSON.stringify({type:'operation',id:c.socket.sent[0].id,ok:false,message:'invalid edit'}));await rejected;assert.equal(c.closed,false);
  const step=c.request('step',{dt:1/60}),disconnected=assert.rejects(step,/断开/);await Promise.resolve();c.socket.close();await disconnected;
});
test('malformed and non-finite GPU frames stop the connection',async()=>{
  for(const corrupt of [p=>new DataView(p).setUint32(0,9999999,true),p=>new Float32Array(p,p.byteLength-32)[0]=NaN]){
    const c=new ProjectTransport(8769,Socket);ready(c);const request=c.request('step',{dt:.01}),failed=assert.rejects(request);await Promise.resolve();const p=packet(c.socket.sent[0].id);corrupt(p);c.socket.receive(p);await failed;assert.ok(c.closed);
  }
});
test('asynchronous project replacement preserves the old session until validation and initialization succeed',async()=>{
  let freed=0,fail=false;const registry=new SolverRegistry().register({id:'taichi-coupled',asynchronous:true,methods:['rigid','mpm'],async create(p){if(fail)throw Error('load failed');return {async:true,time:0,snapshot:()=>({time:0}),step:async dt=>({time:dt}),free:()=>freed++};}}),s=new ProjectSession(registry);
  assert.throws(()=>s.replace(project()),/异步/);await s.replaceAsync(project());const before=s.project;fail=true;await assert.rejects(s.replaceAsync(project()),/load failed/);assert.deepEqual(s.project,before);assert.equal(freed,0);assert.equal((await s.step(.01)).time,.01);fail=false;await s.replaceAsync(project());assert.equal(freed,1);s.free();assert.equal(freed,2);
});

test('GPU transport accepts the filled-pool particle count and rejects overflow',async()=>{
  for(const count of [8376,16384,16385]){const c=new ProjectTransport(8769,Socket);ready(c);const request=c.request('step',{dt:.01});const result=count>16384?assert.rejects(request,/GPU 项目结果/):request;await Promise.resolve();c.socket.receive(packet(c.socket.sent[0].id,.01,count));try{const frame=await result;if(count<=16384)assert.equal(frame.particles.length,count*8);}finally{c.close();}}
});

test('GPU live heat commands wait for a running step and update the document only on acknowledgement',async()=>{
  const adapter=gpuCoupledAdapter(Socket),session=new ProjectSession(new SolverRegistry().register(adapter));
  const p=gripExample();p.solver.adapter=adapter.id;p.solver.gpuPort=8772;
  const loading=session.replaceAsync(p),socket=Socket.last;
  socket.receive(JSON.stringify({type:'ready',features:[GPU_PROJECT_FEATURE],backend:{arch:'cuda'}}));
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  await flush();socket.receive(packet(socket.sent.at(-1).id));await loading;
  try{
    const before=session.project,step=session.step(.01);await flush();
    const stepRequest=socket.sent.at(-1);
    const heat=session.setThermalPower('right-clamp',1234);await flush();
    assert.equal(socket.sent.at(-1),stepRequest);assert.deepEqual(session.project,before);
    socket.receive(packet(stepRequest.id,.01));await step;await flush();
    assert.equal(socket.sent.at(-1).type,'command');
    assert.deepEqual(session.project,before);
    socket.receive(packet(socket.sent.at(-1).id,.01));await heat;
    assert.equal(session.time,.01);assert.equal(session.model.bodies.find(b=>b.id==='right-clamp').thermal.power,1234);
    assert.deepEqual(session.project.connections,before.connections);
    const saved=session.project,failed=session.setHeater({power:100}),rejected=assert.rejects(failed,/rejected/);
    await flush();socket.receive(JSON.stringify({type:'operation',id:socket.sent.at(-1).id,ok:false,message:'rejected'}));await rejected;
    assert.deepEqual(session.project,saved);
    const count=socket.sent.length;await assert.rejects(session.setHeater({radius:-1}));assert.equal(socket.sent.length,count);
  }finally{session.free();}
});
