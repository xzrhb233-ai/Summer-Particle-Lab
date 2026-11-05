import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPlastic,constitutiveStress,vonMises} from '../src/three/constitutive.js';
import {flowStress,plasticityParameters,PLASTICITY_DEFAULTS as defaults} from '../src/three/metal-plasticity.js';
import {det,identity} from '../src/three/math.js';
import {Simulation3} from '../src/three/simulation.js';
const F=[1.3,.1,0,0,.8,0,0,0,1/1.04];
const q=f=>vonMises(constitutiveStress(f,4,.4,.4),det(f));
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const project=(model,ep=0,dt=.01,T=20,p=defaults)=>projectPlastic(F,model,1,0,.025,35,ep,dt,T,p);

test('J2 radial return: yield consistency, isochoric plastic flow and elastic unloading',()=>{
  for(const model of [4,5]){
    const p=project(model);assert.ok(p.plasticIncrement>0);close(det(p.F),det(F));
    close(q(p.F),flowStress(model,p.plasticIncrement,0,20));
    const unloading=projectPlastic(identity(),model,1,0,.025,35,p.plasticIncrement);
    close(unloading.plasticIncrement,0);close(q(unloading.F),0);
    const hydro=projectPlastic([.9,0,0,0,.9,0,0,0,.9],model);
    close(hydro.plasticIncrement,0);close(det(hydro.F),.9**3);
  }
  assert.ok(project(5).plasticIncrement<project(4).plasticIncrement);
  assert.ok(project(5,.5).plasticIncrement<project(5,0).plasticIncrement);
});

test('Johnson–Cook solves plastic strain rate implicitly and responds to current temperature',()=>{
  for(const model of [6,7])for(const T of [-20,20,650,1000,1200])for(const dt of [.0001,.01,.1]){
    const p=project(model,.12,dt,T);
    close(det(p.F),det(F));assert.ok(p.plasticIncrement>=0);
    close(q(p.F),flowStress(model,.12+p.plasticIncrement,p.plasticIncrement/dt,T),2e-7);
  }
  assert.ok(q(project(6,0,.0001).F)>q(project(6,0,.1).F));
  assert.ok(q(project(6,0,.01,650).F)<q(project(6,0,.01,20).F));
  close(q(project(6,0,.01,1000).F),0);
  close(q(project(7,0,.01,650).F),q(project(7,0,.01,20).F));
  close(flowStress(6,0,0,20),defaults.A); // reference-rate floor avoids log(0).
});

test('new models reduce to ideal J2 and linear hardening in their limiting cases',()=>{
  const noEffects={...defaults,B:0,C:0};
  close(q(project(6,0,.01,20,noEffects).F),q(project(4).F));
  close(q(project(7,0,.01,650,{...defaults,n:1,C:0}).F),q(project(5).F));
});

test('material validation is atomic and each part retains independent parameters after deletion',()=>{
  for(const p of [{A:NaN},{B:-1},{n:0},{rate0:0},{Tm:20},{C:Infinity},{A:true},{typo:1},null,[]])assert.equal(plasticityParameters(p),null);
  const s=new Simulation3();
  const box=(model,p)=>s.box([-4,0,-4],[4,8,4],11,false,20,model,.025,35,'box','',[0,0,0],p);
  assert.equal(box(6,{Tm:10}),false);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  assert.ok(box(4,{A:.01}));const n=s.count;
  assert.ok(box(5,{A:.1,B:.2}));s.mpm.plastic[n]=.3;
  s.remove(0);assert.equal(s.model[0],5);assert.equal(s.plasticity[s.lab.part[0]].A,.1);
  assert.equal(s.plasticity[s.lab.part[1]].A,.01);
  s.add(30,0,0,2,20,6);assert.equal(s.model[s.count-1],0);
  s.reset('empty');assert.deepEqual(s.plasticity[1],defaults);
});

test('metal preset compresses all four laws with finite states and conserved mass/enthalpy',()=>{
  const s=new Simulation3();s.reset('metals');s.setSettings({thermal:false});
  const before=s.snapshot();assert.deepEqual(before.models,[0,0,0,0,539,539,539,539,0,0,0,0]);
  assert.deepEqual(before.parts.map(p=>p.count),[539,539,539,539]);
  s.setPress({target:-20,speed:16});
  for(let i=0;i<150;i++)s.step();
  const after=s.snapshot();assert.ok(after.minJ>0);assert.ok(after.maxPlastic>0);
  close(after.mass,before.mass);close(after.energy,before.energy,1e-5);
  for(let i=0;i<s.count;i++)assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.z[i]+s.mpm.plastic[i]));
});
