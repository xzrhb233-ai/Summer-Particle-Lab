import test from 'node:test';
import assert from 'node:assert/strict';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {femPart,dynamicCantileverProject,setPartLoads,validateFEM} from '../src/fem/model.js';
import {cross} from '../src/fem/mesh.js';

function specimen({gap=0,reverse=false,mechanical=true,thermal=true,velocityA=[0,0,0],velocityB=[0,0,0]}={}){
  const p=dynamicCantileverProject();p.parts=[];p.loads=[];p.selectionSets=[];p.curves=[];p.loadBindings=[];
  p.environment.gravity=[0,0,0];Object.assign(p.solver,{thermal,dt:.0005,damping:0,initialState:'rest',duration:.05});
  for(const [id,center,divisions,velocity,T] of [
    ['a',[-.2-gap/2,.2,0],[2,2,2],velocityA,100],['b',[.2+gap/2,.2,0],[3,2,2],velocityB,20],
  ]){
    const b=femPart(id,{name:id,center,size:[.4,.4,.4],divisions,young:1000,density:1000,cp:500,conductivity:50,poisson:.25});
    b.initial.velocity=velocity;b.initial.temperature=T;p.parts.push(b);setPartLoads(p,b,{fixed:'y-',force:[0,0,0]});
  }
  p.contactPairs=[{id:'surface',a:reverse?'b':'a',b:reverse?'a':'b',mechanical,thermal,stiffness:1e4,damping:30,friction:.3,contactConductance:1000}];
  return p;
}
const momentum=states=>[0,1,2].map(k=>states.reduce((sum,s)=>sum+s.mesh.nodes.reduce((a,_,n)=>a+s.m[3*n+k]*s.v[3*n+k],0),0));
const angular=states=>states.reduce((sum,s)=>s.mesh.nodes.reduce((out,x,n)=>{
  const torque=cross(x.map((v,k)=>v+s.u[3*n+k]),[0,1,2].map(k=>s.m[3*n+k]*s.v[3*n+k]));
  return out.map((v,k)=>v+torque[k]);
},sum),[0,0,0]);
const close=(a,b,tol=1e-8)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);

test('nonmatching FEM surfaces exchange heat conservatively with no fictitious external source',()=>{
  const s=new FEMDynamicSimulation(specimen()),initial=s.snapshot();
  const f=s.step(.02),pair=f.contactPairs[0];
  assert.equal(pair.scheme,'fem-vertex-triangle/1');assert.ok(pair.accumulatedHeat<0);assert.ok(pair.thermalSamples>0);
  assert.ok(f.fem.parts[0].summary.temperature<100);assert.ok(f.fem.parts[1].summary.temperature>20);
  close(f.thermal.energy,initial.thermal.energy,1e-7);close(f.thermal.externalHeat,0);close(f.thermal.residual,0,1e-7);
  close(pair.normalForce,0);close(f.fem.dynamics.contactEnergy,0);assert.equal(f.bodies.length,0);
});

test('FEM surface contact rejects initial penetration and duplicate reversed pairs',()=>{
  assert.throws(()=>new FEMDynamicSimulation(specimen({gap:-.02})),/初始重叠/);
  const coincident=specimen();coincident.parts[1].geometry.center=coincident.parts[0].geometry.center.slice();
  assert.throws(()=>new FEMDynamicSimulation(coincident),/初始重叠/);
  const p=specimen();p.contactPairs.push({...p.contactPairs[0],id:'reverse',a:'b',b:'a'});
  assert.throws(()=>validateFEM(p),/只能定义一次/);
  p.contactPairs=[];assert.doesNotThrow(()=>new FEMDynamicSimulation(p));
});

test('deformed vertex-triangle contact gives equal opposite impulses and dissipative friction',()=>{
  const s=new FEMDynamicSimulation(specimen({velocityA:[.3,.2,0],velocityB:[-.3,0,0],thermal:false}));
  // Isolate the interface operator from the two supports for momentum checking.
  for(const [j,state] of s.states.entries()){
    state.fixed.fill(0);for(let i=0;i<state.u.length;i+=3)state.u[i]=j?-.001:.001;
  }
  const before=momentum(s.states),beforeAngular=angular(s.states);s.contacts.begin(.001);s.contacts.forces(.001);s.contacts.surfaceContacts.dissipate(.001);
  const after=momentum(s.states),afterAngular=angular(s.states),pair=s.contacts.snapshot().contactPairs[0];
  for(let k=0;k<3;k++){close(after[k],before[k],1e-10);close(afterAngular[k],beforeAngular[k],1e-10);close(pair.force[k]+pair.oppositeForce[k],0,1e-12);}
  assert.ok(pair.normalForce>0);assert.ok(pair.frictionLoss>0);assert.ok(pair.normalLoss>=0);assert.ok(pair.maxPenetration>0);
  assert.ok(pair.tangentialForce[1]<0); // A's upward slip slows down.
});

test('FEM surface contact uses deformed positions and never attracts separating bodies',()=>{
  const s=new FEMDynamicSimulation(specimen({gap:.05,thermal:false}));
  s.contacts.begin(.001);s.contacts.forces(.001);close(s.contacts.snapshot().contactPairs[0].normalForce,0);
  for(let i=0;i<s.states[0].u.length;i+=3)s.states[0].u[i]=.051;
  s.contacts.forces(.001);assert.ok(s.contacts.snapshot().contactPairs[0].normalForce>0);
  const separating=new FEMDynamicSimulation(specimen({velocityA:[-.3,0,0],velocityB:[.3,0,0],thermal:false}));
  const f=separating.step(.005);close(f.contactPairs[0].normalForce,0,1e-10);close(f.contactPairs[0].frictionLoss,0,1e-12);
  const corner=specimen({gap:-.002});corner.parts[1].geometry.center[1]=.605;
  const disjoint=new FEMDynamicSimulation(corner),edgeFrame=disjoint.step(.005);
  close(edgeFrame.contactPairs[0].normalForce,0);close(edgeFrame.contactPairs[0].accumulatedHeat,0);
});

test('reversing pair order preserves mechanical response and reverses signed heat',()=>{
  const options={gap:.001,velocityA:[.2,.1,0],velocityB:[-.2,0,0]};
  const a=new FEMDynamicSimulation(specimen(options)),b=new FEMDynamicSimulation(specimen({...options,reverse:true}));
  const fa=a.step(.015),fb=b.step(.015);
  for(let s=0;s<2;s++)for(let i=0;i<a.states[s].u.length;i++)close(a.states[s].u[i],b.states[s].u[i],2e-9);
  for(let s=0;s<2;s++)for(let i=0;i<a.states[s].thermal.temperature.length;i++)close(a.states[s].thermal.temperature[i],b.states[s].thermal.temperature[i],2e-8);
  close(fa.contactPairs[0].accumulatedHeat,-fb.contactPairs[0].accumulatedHeat,1e-7);
  assert.ok(fa.contactPairs[0].normalForce>0);
  for(const s of a.states)for(let i=0;i<s.u.length;i++)if(s.fixed[i]){close(s.u[i],0);close(s.v[i],0);}
});

test('surface penalty stiffness tightens the time step and failed intervals roll back heat and contact histories',()=>{
  const p=specimen({gap:.001,velocityA:[.2,0,0],velocityB:[-.2,0,0]}),s=new FEMDynamicSimulation(p);
  const stiff=structuredClone(p);stiff.contactPairs[0].stiffness=1e8;const higher=new FEMDynamicSimulation(stiff);
  assert.ok(higher.dt<s.dt);
  s.step(.01);const before=s.snapshot(),u=s.states.map(s=>s.u.slice()),v=s.states.map(s=>s.v.slice());
  const advance=s.advanceShared.bind(s);let calls=0;s.advanceShared=t=>{advance(t);if(++calls===3)throw Error('injected surface-contact failure');};
  assert.throws(()=>s.step(.01),/injected/);const after=s.snapshot();
  assert.equal(after.time,before.time);assert.deepEqual(after.contactPairs,before.contactPairs);assert.deepEqual(after.thermal,before.thermal);
  for(let i=0;i<after.fem.parts.length;i++){assert.deepEqual(after.fem.parts[i].acceleration,before.fem.parts[i].acceleration);assert.deepEqual(after.fem.parts[i].reaction,before.fem.parts[i].reaction);}
  s.states.forEach((s,i)=>{assert.deepEqual(s.u,u[i]);assert.deepEqual(s.v,v[i]);});
});

test('FEM surface impulse is cumulative across output intervals and snapshot refresh does not add history',()=>{
  const s=new FEMDynamicSimulation(specimen({gap:.001,velocityA:[.2,.1,0],velocityB:[-.2,0,0]}));
  const first=s.step(.01).contactPairs[0],second=s.step(.01).contactPairs[0];
  for(let k=0;k<3;k++)close(second.totalImpulse[k],first.totalImpulse[k]+.01*second.force[k],1e-10);
  const before=s.contacts.surfaceContacts.backup();
  s.contacts.surfaceContacts.refresh();s.snapshot();s.snapshot();
  assert.deepEqual(s.contacts.surfaceContacts.backup(),before);
});
