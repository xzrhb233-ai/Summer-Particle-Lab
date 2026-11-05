import test from 'node:test';
import assert from 'node:assert/strict';
import {impactProject,validateFEM,faceSet} from '../src/fem/model.js';
import {FEMDynamicSimulation,FEMHistory} from '../src/fem/dynamic.js';
import {closestTriangle,applyContactImpulse} from '../src/fem/contact.js';
import {editFEMRigids} from '../src/fem/rigid-editor.js';
import {femDynamicAdapter} from '../src/fem/adapter.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {normalizeProject,removePart} from '../src/simulation/project.js';
import {dot,cross} from '../src/fem/mesh.js';
import {quaternion,rotate} from '../src/multibody/model.js';

const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
const small=()=>{const p=impactProject();p.parts[0].discretization.divisions=[8,2,3];return p;};
const run=(p,time=.25)=>{const s=new FEMDynamicSimulation(p),frames=[s.snapshot()];for(let t=0;t<time-1e-9;t+=.005)frames.push(s.step(.005));return {s,frames};};
const peak=(frames,f)=>Math.max(...frames.map(f));
function fixedPlane(){
  const p=small(),beam=p.parts[0],set=faceSet(beam,'x+','other-support');beam.discretization.divisions=[1,1,1];
  p.selectionSets.push(set);p.loads.push({id:'other-fixed',type:'fem-fixed',target:beam.id,selection:set.id});
  p.contactPairs[0].damping=0;p.contactPairs[0].friction=0;p.solver.damping=0;return p;
}
test('closest triangle resolves face, edge and vertex with nonnegative partition-of-unity weights',()=>{
  for(const [p,expected] of [[[.2,1,.3],[.2,0,.3]],[[.8,1,.8],[.5,0,.5]],[[-1,1,-1],[0,0,0]]]){
    const r=closestTriangle(p,[0,0,0],[1,0,0],[0,0,1]);r.point.forEach((x,k)=>near(x,expected[k]));near(r.weights.reduce((s,x)=>s+x,0),1);assert.ok(r.weights.every(x=>x>=0));
  }
});
test('no contact before impact; disabled or deleted pair permits free travel with no beam energy',()=>{
  const p=small(),s=new FEMDynamicSimulation(p),f=s.step(.04);near(f.bodies[0].position[1],1.09);near(f.contactPairs[0].normalForce,0);near(f.fem.parts[0].summary.energy,0);
  for(const mode of ['disabled','deleted']){const p=small();mode==='disabled'?p.contactPairs[0].mechanical=false:p.contactPairs=[];const f=new FEMDynamicSimulation(p).step(.25);near(f.bodies[0].velocity[1],-.5);near(f.fem.parts[0].summary.energy,0);near(f.fem.dynamics.energyResidual,0);}
});
test('coupled impact rebounds the sphere, excites the beam, separates freely and closes the energy budget',()=>{
  const {frames}=run(small()),f=frames.at(-1),d=f.fem.dynamics;
  assert.ok(peak(frames,f=>f.contactPairs[0].normalForce)>100);
  assert.ok(peak(frames,f=>f.fem.parts[0].summary.maxDisplacement)>.0005);
  assert.ok(f.bodies[0].velocity[1]>.3);near(f.contactPairs[0].normalForce,0);near(f.contactPairs[0].contactEnergy,0);
  assert.ok(d.contactDissipated>0);assert.ok(peak(frames,f=>Math.abs(f.fem.dynamics.energyResidual)/d.initialEnergy)<.001);
  for(const f of frames){const r=f.contactPairs[0];r.force.forEach((v,k)=>near(v+r.oppositeForce[k],0));assert.ok(Math.hypot(...f.fem.parts[0].summary.forceBalance)<1e-7);}
});
test('fixed plane collision matches the independent spring-mass penetration, contact duration and elastic rebound',()=>{
  const p=fixedPlane();p.solver.dt=.000025;const s=new FEMDynamicSimulation(p),speed=.5,m=3,k=1e5;
  const expectedDepth=speed*Math.sqrt(m/k),expectedDuration=Math.PI*Math.sqrt(m/k);let first=null,last=null,depth=0;
  for(let i=0;i<4500;i++){const f=s.step(.000025),r=f.contactPairs[0];if(r.normalForce>0){first??=f.time;last=f.time;}depth=Math.max(depth,r.maxPenetration);}
  near(depth,expectedDepth,expectedDepth*2e-4);near(last-first,expectedDuration,1e-4);near(s.snapshot().bodies[0].velocity[1],speed,1e-5);
  assert.ok(Math.abs(s.snapshot().fem.dynamics.energyResidual)<1e-5);
});
test('halving contact time step reduces conservative energy error against fixed-plane analytical impact',()=>{
  const errors=[.0004,.0002,.0001].map(dt=>{const p=fixedPlane();p.solver.dt=dt;return peak(run(p,.15).frames,f=>Math.abs(f.fem.dynamics.energyResidual));});
  assert.ok(errors[2]<errors[0]*.4,JSON.stringify(errors));
});
test('increasing contact stiffness tightens stable time step, without mass scaling',()=>{
  const p=small();p.solver.dt=.02;const base=new FEMDynamicSimulation(p);p.contactPairs[0].stiffness=1e9;const stiff=new FEMDynamicSimulation(p);
  assert.ok(stiff.dt<base.dt*.1);near(stiff.snapshot().fem.parts[0].summary.mass,base.snapshot().fem.parts[0].summary.mass);
});
test('off-center friction impulse preserves total linear and angular momentum and dissipates kinetic energy',()=>{
  const s=new FEMDynamicSimulation(small()),pair=s.contacts.pairs[0],r=pair.body,fem=pair.state;
  const ids=fem.mesh.surface.find(t=>t.face==='y+'&&t.nodes.every(n=>!fem.fixed[3*n])).nodes,weights=[.2,.3,.5];
  const point=[0,1,2].map(k=>ids.reduce((a,n,j)=>a+weights[j]*fem.mesh.nodes[n][k],0)),arm=point.map((x,k)=>x-r.x[k]);
  const c={ids,weights,point,arm};r.v=[1,0,0];
  function momentum(){const P=r.v.map(v=>r.mass*v),L=cross(r.x,P).map((x,k)=>x+r.inertia*r.omega[k]);for(const n of ids){const p=[0,1,2].map(k=>fem.m[3*n+k]*fem.v[3*n+k]),l=cross(fem.mesh.nodes[n],p);for(let k=0;k<3;k++){P[k]+=p[k];L[k]+=l[k];}}return [...P,...L];}
  const before=momentum(),loss=applyContactImpulse(pair,c,[-.01,0,0]);momentum().forEach((x,k)=>near(x,before[k],1e-12));assert.ok(loss>0);assert.ok(Math.hypot(...r.omega)>0);
});
test('Coulomb friction slows tangential slip, creates spin and does not act after separation',()=>{
  const p=fixedPlane();p.parts[1].initial.velocity=[.3,-.5,0];p.contactPairs[0].friction=.6;
  const f=run(p,.2).frames.at(-1);assert.ok(f.bodies[0].velocity[0]<.3);assert.ok(Math.abs(f.bodies[0].angularVelocity[2])>.1);assert.ok(f.contactPairs[0].frictionLoss>0);near(f.contactPairs[0].normalForce,0);near(Math.hypot(...f.contactPairs[0].tangentialForce),0);
});
test('contact follows rotated geometry and conserves the rotated response',()=>{
  const p=small();p.contactPairs[0].friction=0;const base=run(p,.15).frames.at(-1),q=quaternion([30,20,40]);
  for(const b of p.parts){b.geometry.center=rotate(q,b.geometry.center);b.geometry.rotation=[30,20,40];b.initial.velocity=rotate(q,b.initial.velocity);}
  const f=run(p,.15).frames.at(-1);rotate(q,base.bodies[0].position).forEach((x,k)=>near(x,f.bodies[0].position[k],1e-8));near(f.fem.dynamics.energyResidual,base.fem.dynamics.energyResidual,1e-8);
});
test('invalid contacts and initial overlap fail transactionally without replacing the active session',async()=>{
  const session=new ProjectSession(new SolverRegistry().register(femDynamicAdapter));await session.replaceAsync(normalizeProject(small()));const before=session.snapshot();
  for(const edit of [p=>p.parts[1].geometry.center=[1,.8,0],p=>p.parts[1].geometry.shape='box',p=>p.contactPairs[0].stiffness=-1,p=>p.contactPairs[0].thermal=true,p=>p.contactPairs.push({...p.contactPairs[0],id:'duplicate'}),p=>p.contactPairs[0].a='beam',p=>p.parts[1].initial.velocity=[NaN,0,0]]){
    const p=session.project;edit(p);await assert.rejects(session.replaceAsync(p));assert.deepEqual(session.snapshot(),before);
  }session.free();
});
test('failed coupled interval restores time, sphere, beam, impulses and energy accounting',()=>{
  const s=new FEMDynamicSimulation(small());s.step(.09);const before=s.snapshot();s.states[0].A.values[0]=NaN;
  assert.throws(()=>s.step(.01));s.states[0].A.values[0]=new FEMDynamicSimulation(small()).states[0].A.values[0];assert.deepEqual(s.snapshot(),before);
});
test('common authoring edits preserve FEM IDs and loads, round-trip contact parameters and remove dangling pairs',async()=>{
  const original=normalizeProject(small()),edited=editFEMRigids(original,m=>{m.bodies[0].mass=4;m.bodies[0].position[1]+=.1;});
  assert.deepEqual(edited.loads,original.loads);assert.equal(edited.parts.find(b=>b.id==='impactor').material.mass,4);assert.deepEqual(edited.contactPairs,original.contactPairs);
  validateFEM(normalizeProject(JSON.parse(JSON.stringify(edited))));
  assert.equal(removePart(edited,'impactor').contactPairs.length,0);assert.equal(editFEMRigids(edited,m=>m.bodies=[]).contactPairs.length,0);
  const p=small();p.parts.reverse();const frame=new FEMDynamicSimulation(p).snapshot();assert.deepEqual(frame.results.parts.find(p=>p.method==='fem').values.position,[1,.8,0]);
});
test('contact scalar histories and sphere replay survive numerical frame eviction unchanged',()=>{
  const s=new FEMDynamicSimulation(small()),h=new FEMHistory();h.limit=100;const first=s.step(.09);h.record(first,true);const saved=structuredClone(first.bodies);
  for(let i=0;i<5;i++)h.record(s.step(.01),true);
  assert.equal(h.frames.length,2);assert.equal(h.samples.length,6);assert.deepEqual(first.bodies,saved);assert.deepEqual(h.samples[0].contactPairs,first.contactPairs);
});
