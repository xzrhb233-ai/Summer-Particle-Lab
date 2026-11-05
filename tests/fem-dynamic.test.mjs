import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicCantileverProject,validateFEM,setPartLoads} from '../src/fem/model.js';
import {FEMDynamicSimulation,lumpedMass,FEMHistory} from '../src/fem/dynamic.js';
import {boxMesh} from '../src/fem/mesh.js';
import {runDynamicValidation} from '../src/fem/dynamic-validation.js';
import {ProjectSession,SolverRegistry} from '../src/simulation/session.js';
import {femDynamicAdapter,femStaticAdapter} from '../src/fem/adapter.js';
import {normalizeProject,removePart} from '../src/simulation/project.js';
import {rotate,quaternion} from '../src/multibody/model.js';
import {bindingUnit} from '../src/simulation/curves.js';

const small=()=>dynamicCantileverProject({size:[2,.3,.3],divisions:[8,2,2],damping:0});
const near=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b} (tol ${tol})`);
const freeRelease=()=>{const p=small();p.curves[0].points=[[0,0],[2,0]];return p;};
test('lumped Tet4 mass is positive and integrates density times volume in each translational direction',()=>{
  const p=small().parts[0],mesh=boxMesh(p),m=lumpedMass(mesh,p.material.density);
  assert.ok(m.every(x=>x>0));
  for(let k=0;k<3;k++)near(m.reduce((s,x,i)=>s+(i%3===k?x:0),0),180);
});
test('stable time step responds to mesh, stiffness and density without changing physical mass',()=>{
  const p=small();p.solver.dt=.02;
  const base=new FEMDynamicSimulation(p);
  p.parts[0].material.young*=4;near(new FEMDynamicSimulation(p).dt,base.dt/2,1e-12);
  p.parts[0].material.density*=4;near(new FEMDynamicSimulation(p).dt,base.dt,1e-12);
  p.parts[0].discretization.divisions=[16,4,4];assert.ok(new FEMDynamicSimulation(p).dt<base.dt*.6);
  const f=base.step(.02);near(f.time,.02);assert.ok(f.fem.dynamics.steps>1);near(f.fem.parts[0].summary.mass,180);
});
test('unloaded rest stays exactly stationary, constraints enforce zero displacement and velocity',()=>{
  const p=small();p.solver.initialState='rest';p.loads.find(l=>l.type==='fem-force').force=[0,0,0];p.loadBindings=[];
  const sim=new FEMDynamicSimulation(p),frame=sim.step(.1);
  assert.ok(frame.fem.parts[0].displacement.every(x=>x===0));near(frame.energy,0);
  p.parts[0].initial.velocity=[.1,.2,0];const moving=new FEMDynamicSimulation(p);moving.step(.02);
  const s=moving.states[0];for(let i=0;i<s.fixed.length;i++)if(s.fixed[i]){near(s.u[i],0);near(s.v[i],0);}
});
test('preloaded equilibrium holds then releases with continuous displacement and no spurious impulse',()=>{
  const sim=new FEMDynamicSimulation(small()),initial=sim.snapshot(),u=initial.fem.parts[0].displacement;
  const held=sim.step(.15),p=held.fem.parts[0];
  near(p.summary.kinetic,0,1e-15);
  for(let i=0;i<u.length;i++)near(p.displacement[i],u[i],1e-10);
  near(held.loadResponses[0].requested,0);near(held.loadResponses[0].applied,-30);
  const released=sim.step(.05);assert.ok(released.fem.parts[0].summary.kinetic>0);
  assert.ok(Math.abs(released.fem.dynamics.energyResidual)/initial.energy<.001);
  assert.ok(Math.hypot(...released.fem.parts[0].summary.forceBalance)<1e-7);
});
test('narrow pulses split at both knots and match separately stopped integration, including work',()=>{
  const p=small();p.solver.initialState='rest';p.curves[0].points=[[0,0],[.003071,1],[.003093,0],[1,0]];
  const all=new FEMDynamicSimulation(p),split=new FEMDynamicSimulation(p);
  const a=all.step(.01);
  for(const t of [.003071,.003093,.01])split.step(t-split.time);
  const b=split.snapshot();
  a.fem.parts[0].displacement.forEach((x,i)=>near(x,b.fem.parts[0].displacement[i],1e-13));
  near(a.fem.dynamics.externalWork,b.fem.dynamics.externalWork,1e-12);
  near(a.loadResponses[0].commandIntegral,-30*(.003093-.003071),1e-12);
  assert.equal(a.fem.dynamics.eventSplits,2);assert.ok(a.energy>0);
});
test('force bindings replace only their chosen component; pressure curves use Pa and rotate with the face',()=>{
  const p=small();p.solver.initialState='rest';p.loads.find(l=>l.type==='fem-force').force=[12,-30,7];
  p.curves[0].type='linear';p.curves[0].points=[[0,0],[1,1]];
  const f=new FEMDynamicSimulation(p).step(.1);
  near(f.fem.parts[0].summary.force[0],12);near(f.fem.parts[0].summary.force[1],-3);near(f.fem.parts[0].summary.force[2],7);
  setPartLoads(p,p.parts[0],{type:'fem-pressure',pressure:100});p.parts[0].geometry.rotation=[0,0,90];
  Object.assign(p.loadBindings[0],{kind:'fem-pressure',component:null,scale:1000});
  const r=new FEMDynamicSimulation(p).step(.1);near(r.fem.parts[0].summary.force[1],-9);
  assert.equal(r.loadResponses[0].unit,'Pa');assert.equal(bindingUnit(p.loadBindings[0]),'Pa');
});
test('sine loads enforce time resolution as well as elastic stability',()=>{
  const p=small();p.parts[0].material.young=1;p.solver.initialState='rest';p.solver.dt=.02;
  p.curves=[{id:'release',name:'sine',type:'sine',start:0,end:1,frequency:100,amplitude:1,offset:0,phase:0}];
  const sim=new FEMDynamicSimulation(p);near(sim.dt,1/4000,1e-14);
});
test('modal frequency, undamped energy, damping decay and second-order time convergence agree with independent references',()=>{
  const r=runDynamicValidation();for(const [key,value] of Object.entries(r.checks))assert.ok(value,key);
  assert.ok(r.runs[0].maxDisplacementError/r.runs[1].maxDisplacementError>3.5);
});
test('dynamic displacement is invariant under rigid rotation of geometry, force and initial velocity',()=>{
  const p=freeRelease(),base=new FEMDynamicSimulation(p).step(.08),q=quaternion([30,20,40]);
  p.parts[0].geometry.rotation=[30,20,40];
  // Three bindings express the rotated released vector; all are zero after release.
  const force=rotate(q,[0,-30,0]);p.loads.find(l=>l.type==='fem-force').force=force;
  p.loadBindings=force.map((v,k)=>({...p.loadBindings[0],id:'release-'+k,component:k,scale:v}));
  const rotated=new FEMDynamicSimulation(p).step(.08);
  for(let i=0;i<base.fem.parts[0].nodes.length;i++)rotate(q,Array.from(base.fem.parts[0].displacement.slice(3*i,3*i+3))).forEach((x,k)=>near(x,rotated.fem.parts[0].displacement[3*i+k],2e-7));
});
test('invalid dynamic programs and settings reject before replacing the project session',async()=>{
  const session=new ProjectSession(new SolverRegistry().register(femDynamicAdapter).register(femStaticAdapter));
  await session.replaceAsync(normalizeProject(small()));await session.step(.02);const original=session.snapshot(),doc=session.project;
  for(const edit of [
    p=>p.solver.dt=0,p=>p.solver.safety=1,p=>p.solver.damping=-1,p=>p.solver.initialState='unknown',
    p=>p.loadBindings[0].load='missing',p=>p.loadBindings.push({...p.loadBindings[0],id:'duplicate-channel'}),
    p=>p.loadBindings[0].scale=NaN,p=>p.loadBindings[0].component=4,p=>p.solver.duration=NaN,
    p=>p.parts[0].initial.velocity=[0,Infinity,0],p=>p.couplings.push({type:'contact'})
  ]){const invalid=structuredClone(doc);edit(invalid);await assert.rejects(session.replaceAsync(invalid));assert.deepEqual(session.snapshot(),original);}
  near(session.time,.02);assert.deepEqual(session.project,doc);
  const roundtrip=JSON.parse(JSON.stringify(doc));await session.replaceAsync(roundtrip);near(session.time,0);
  const empty=removePart(doc,'beam');assert.equal(empty.loadBindings.length,0);await session.replaceAsync(empty);near((await session.step(.01)).time,.01);session.free();
});
test('numerical interval failure rolls back motion, energy and time',()=>{
  const sim=new FEMDynamicSimulation(freeRelease()),frame=sim.step(.01);
  sim.states[0].A.values[0]=NaN;
  assert.throws(()=>sim.step(.01),/失稳/);
  near(sim.time,frame.time);assert.deepEqual(sim.states[0].u,frame.fem.parts[0].displacement);near(sim.states[0].externalWork,frame.fem.parts[0].summary.externalWork);
});
test('replay states remain immutable and memory eviction retains scalar history',()=>{
  const sim=new FEMDynamicSimulation(freeRelease()),history=new FEMHistory();history.limit=1000;
  const first=sim.snapshot(),saved=first.fem.parts[0].displacement.slice();
  history.record(first,true);for(let i=0;i<5;i++)history.record(sim.step(.02),true);
  assert.deepEqual(first.fem.parts[0].displacement,saved);assert.equal(history.frames.length,2);assert.equal(history.samples.length,6);
  assert.equal(history.at(0).time,.08);
});
test('repeated non-grid output stops do not pump high-frequency energy near the stability limit',()=>{
  const p=dynamicCantileverProject({divisions:[24,4,6],damping:0});p.solver.dt=.02;
  const sim=new FEMDynamicSimulation(p);let worst=0;
  for(let i=0;i<100;i++){const d=sim.step(.02).fem.dynamics;worst=Math.max(worst,Math.abs(d.energyResidual)/d.initialEnergy);}
  assert.ok(worst<.001,`Energy drift ${worst}`);near(sim.time,2,1e-12);
});
