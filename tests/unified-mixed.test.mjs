import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {mixedImpactProject,validateMixed,projectDomains,editMixedParticles} from '../src/mixed/model.js';
import {validateMixedGPU} from '../src/mixed/gpu-model.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {rigidDOFs} from '../src/mixed/rigid-contact.js';
import {arr,cross} from '../src/multibody/contact.js';
await initialize();

const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
function project(){
  const p=mixedImpactProject();p.parts[0].discretization.divisions=[4,1,2];p.parts[0].material.young=1e5;p.parts[0].geometry.center[1]=.525;p.solver.damping=0;
  const solid=p.parts[1];solid.geometry.center[1]=.7;solid.initial.velocity=[0,-.1,0];
  const water=structuredClone(solid);water.id='water';water.name='PBF water';water.method='pbf';water.geometry.center=[.65,.675,0];water.geometry.size=[.15,.15,.15];water.initial.temperature=60;
  p.parts.push(water,{id:'ball',name:'Rigid sphere',method:'rigid',geometry:{shape:'sphere',center:[.3,.67001,0],size:[.14,.14,.14],rotation:[0,0,0]},material:{mass:1,cp:500,conductivity:20},initial:{velocity:[0,-.1,0],angularVelocity:[0,0,0],temperature:140},boundary:{motion:'dynamic',friction:.2,restitution:0,damping:0}});
  p.couplings[0].methods=['rigid','mpm','pbf'];
  p.contactPairs.push({id:'water-beam',a:'water',b:'beam',mechanical:true,thermal:true,contactConductance:1000},
    {id:'ball-beam',a:'ball',b:'beam',mechanical:true,thermal:true,contactConductance:1000},
    {id:'ball-water',a:'ball',b:'water',mechanical:true,thermal:true,contactConductance:1000});
  p.loads.push({id:'ball-power',type:'thermal-power',target:'ball',power:10,region:{type:'whole'},enabled:true});
  return validateMixed(p);
}
const withSim=fn=>{const s=new MixedSimulation(project());try{fn(s);}finally{s.free();}};

test('four methods remain in one project and each compiled domain retains its own pair/load IDs',()=>{
  const p=project(),d=projectDomains(p);
  assert.deepEqual(new Set(p.parts.map(b=>b.method)),new Set(['fem','mpm','pbf','rigid']));
  assert.deepEqual(d.particles.contactPairs.map(c=>c.id),['ball-water']);
  assert.ok(d.particles.loads.some(l=>l.id==='ball-power'));
  const q=editMixedParticles(p,d=>{d.bodies[0].mass=2;});
  assert.equal(q.parts.find(b=>b.id==='ball').material.mass,2);
  assert.deepEqual(new Set(q.contactPairs.map(c=>c.id)),new Set(p.contactPairs.map(c=>c.id)));
  assert.equal(q.loads.find(l=>l.id==='ball-power').power,10);
  assert.deepEqual(q.parts.find(b=>b.id==='beam'),p.parts[0]);
});
test('all four share one clock, return real rigid and PBF results, and exchange conservative interface heat',()=>withSim(s=>{
  const f=s.step(.003);
  assert.equal(f.bodies.length,1);assert.equal(f.bodies[0].id,'ball');
  assert.deepEqual(new Set(f.results.parts.map(p=>p.method)),new Set(['rigid','mpm','pbf','fem']));
  assert.equal(f.mixed.clock.maxDrift,0);assert.equal(f.mixed.clock.domains.length,2);
  for(const id of ['block-beam','water-beam','ball-beam']){
    const pair=f.contactPairs.find(p=>p.id===id);assert.ok(pair.samples>0,id+' mechanical response');assert.ok(pair.accumulatedHeat<0,id+' transfers heat into FEM');
  }
  assert.ok(f.fem.parts[0].summary.maxDisplacement>0);
  assert.ok(f.particles.every(Number.isFinite));
  assert.ok(Math.abs(f.thermal.residual)<1e-5);
  assert.equal(f.mixed.energy.complete,false);assert.ok(f.mixed.energy.reasons.includes('rigid-constraint-work-not-audited'));
  close(f.thermalLoads.find(l=>l.id==='ball-power').heat,.03,1e-5);
}));
test('sphere and FEM receive opposite impulses at the same point including torque',()=>withSim(s=>{
  const body=s.mpm.bodies.get('ball'),f=s.fem.states[0];f.fixed.fill(0);
  const ids=f.mesh.surface[0].nodes,weights=[.2,.3,.5],point=[0,1,2].map(k=>ids.reduce((sum,n,a)=>sum+weights[a]*f.mesh.nodes[n][k],0));
  const x=arr(body.rb.translation()),hit={ids,weights,point,arm:point.map((v,k)=>v-x[k])},J=[.03,-.02,.01],before=arr(body.rb.linvel()),beforeW=arr(body.rb.angvel());
  const receipt=rigidDOFs(body,f,hit).apply(J),after=arr(body.rb.linvel()),afterW=arr(body.rb.angvel()),I=.4*.07**2;
  for(let k=0;k<3;k++){close(after[k]-before[k],J[k]);close((afterW[k]-beforeW[k])*I,cross(hit.arm,J)[k]);close(receipt.impulseResidual[k],0);}
}));
test('failed coupled interval restores Rapier state, temperatures, pair accumulators, and clocks',()=>withSim(s=>{
  const before=s.snapshot(),body=s.mpm.bodies.get('ball'),old=s.contacts.exchange;
  s.contacts.exchange=function(dt){old.call(this,dt);throw Error('injected');};
  assert.throws(()=>s.step(.003),/injected/);s.contacts.exchange=old;
  assert.equal(s.time,0);assert.equal(s.mpm.bodies.get('ball'),body);
  assert.deepEqual(s.snapshot().bodies,before.bodies);assert.deepEqual(s.snapshot().particles,before.particles);
  assert.deepEqual(s.snapshot().contactPairs,before.contactPairs);close(s.snapshot().thermal.energy,before.thermal.energy);
  assert.ok(s.step(.001).particles.every(Number.isFinite));
}));
test('unsupported FEM rigid shape and unsupported GPU project fail explicitly',()=>{
  const p=project();p.parts.find(b=>b.id==='ball').geometry.shape='torus';p.parts.find(b=>b.id==='ball').geometry.size=[.3,.3,.05];assert.throws(()=>validateMixed(p),/轮胎|torus|球/);
  assert.throws(()=>validateMixedGPU(project()),/GPU/);
});
test('rigid joints and force programs survive mixed projections, editing and rollback',()=>{
  const p=project(),anchor=structuredClone(p.parts.find(b=>b.id==='ball'));
  anchor.id='anchor';anchor.geometry.center=[2,1,0];anchor.boundary.motion='fixed';anchor.initial.velocity=[0,0,0];p.parts.push(anchor);
  p.connections.push({id:'spring',name:'spring',type:'spring',a:'ball',b:'anchor',anchor:[.3,.67,0],anchorB:[2,1,0],restLength:1.73,stiffness:1,damping:1});
  p.curves.push({id:'force-program',name:'force',type:'linear',points:[[0,0],[1,1]]});
  p.loadBindings.push({id:'ball-x-force',kind:'body-force',target:'ball',component:0,curve:'force-program',scale:1,offset:0,enabled:true});
  const q=validateMixed(p),d=projectDomains(q),edited=editMixedParticles(q,m=>{m.bodies.find(b=>b.id==='ball').mass=1.2;});
  assert.ok(d.particles.connections.some(j=>j.id==='spring'));assert.equal(d.particles.curves[0].id,'force-program');
  assert.ok(edited.connections.some(j=>j.id==='spring'));assert.ok(edited.loadBindings.some(b=>b.id==='ball-x-force'));
  const s=new MixedSimulation(q);try{
    const before=s.snapshot(),exchange=s.contacts.exchange;
    s.contacts.exchange=()=>{throw Error('rollback joint');};assert.throws(()=>s.step(.001),/rollback joint/);s.contacts.exchange=exchange;
    assert.deepEqual(s.snapshot().bodies,before.bodies);assert.deepEqual(s.snapshot().joints,before.joints);
    const f=s.step(.001);assert.equal(f.joints[0].id,'spring');assert.ok(f.loadResponses.find(b=>b.id==='ball-x-force').commandIntegral>0);
  }finally{s.free();}
});
