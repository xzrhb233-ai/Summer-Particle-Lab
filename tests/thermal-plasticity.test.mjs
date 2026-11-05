import test from 'node:test';
import assert from 'node:assert/strict';
import {thermalReturn,thermalStrength,creepLogRate,thermalParameters,THERMAL_DEFAULTS as P} from '../src/three/thermal-plasticity.js';
import {projectPlastic,constitutiveStress,vonMises} from '../src/three/constitutive.js';
import {det,identity} from '../src/three/math.js';
import {Simulation3} from '../src/three/simulation.js';
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const F=[1,.2,0,0,1,0,0,0,1];
const ret=(model,T,ep=0,p=P,dt=.01,f=F)=>projectPlastic(f,model,1,0,.025,35,ep,dt,T,undefined,undefined,p);
const vm=r=>vonMises(constitutiveStress(r.F,10,.4,.4),det(r.F));

test('thermal J2 hot return lies on yield surface; cooling restores strength without erasing history',()=>{
  const cold=ret(10,20),hot=ret(10,180);
  assert.ok(hot.plasticIncrement>cold.plasticIncrement);assert.ok(vm(hot)<vm(cold));
  close(vm(hot),thermalStrength(hot.plasticIncrement,180));close(det(hot.F),det(F));
  const cooled=ret(10,20,hot.plasticIncrement,P,.01,hot.F);close(cooled.plasticIncrement,0);close(vm(cooled),vm(hot));
  assert.ok(thermalStrength(hot.plasticIncrement,20)>thermalStrength(hot.plasticIncrement,180));
  const noSoft={...P,hotRatio:1};close(ret(10,20,0,noSoft).plasticIncrement,ret(10,1000,0,noSoft).plasticIncrement);
  for(const T of [-273.15,20,180,1e6]){const r=ret(10,T);assert.ok(r.plasticIncrement>=0);close(det(r.F),1);}
});

test('implicit Norton creep responds to temperature, stress and elapsed time, preserving volume',()=>{
  const cold=ret(11,20),hot=ret(11,180),long=ret(11,180,0,P,.1);
  assert.ok(hot.plasticIncrement>cold.plasticIncrement*5);assert.ok(long.plasticIncrement>hot.plasticIncrement);
  close(hot.plasticIncrement,.01*Math.exp(creepLogRate(vm(hot),180)),1e-8);close(det(hot.F),1);
  assert.ok(ret(11,-100).plasticIncrement<cold.plasticIncrement);close(ret(11,180,0,{...P,rate:0}).plasticIncrement,0);
  close(ret(11,180,0,P,0).plasticIncrement,0);close(ret(11,180,0,P,.01,identity()).plasticIncrement,0);
  // For n=1 the backward-Euler stress relaxation has a closed-form solution.
  const p={...P,n:1,Q:0,rate:.1},sigma=[Math.exp(.1),Math.exp(-.1),1],q=Math.sqrt(6)*.4*Math.sqrt(.02),dt=.02;
  const r=thermalReturn(sigma,11,0,dt,20,p),expected=dt*p.rate*q/p.stress/(1+dt*p.rate*1.2/p.stress);
  close(r.increment,expected,1e-9);
  for(const T of [-273.15,1e6])assert.ok(ret(11,T).F.every(Number.isFinite));
});

test('actual heat/cool brushes drive constitutive response and retain inelastic history',()=>{
  for(const model of [10,11]){
    const s=new Simulation3();s.add(0,0,0,11,20,model);s.settings.gravity=false;
    s.mpm.F.set([1,.05,0,0,1,0,0,0,1]);s.mpm.step(s,1/240);const cold=s.mpm.plastic[0];
    s.brush('heat',[s.x[0],s.y[0],s.z[0]],10,.65);assert.ok(s.temperature[0]>180);
    s.mpm.F.set([1,.05,0,0,1,0,0,0,1]);s.mpm.C.fill(0);s.vx[0]=s.vy[0]=s.vz[0]=0;s.mpm.step(s,1/240);
    const heated=s.mpm.plastic[0];assert.ok(heated-cold>cold*2);
    s.brush('cool',[s.x[0],s.y[0],s.z[0]],10,.65);close(s.temperature[0],20,1e-7);close(s.mpm.plastic[0],heated);
    s.mpm.F.set([1,.05,0,0,1,0,0,0,1]);s.mpm.C.fill(0);s.vx[0]=s.vy[0]=s.vz[0]=0;s.mpm.step(s,1/240);
    assert.ok(s.mpm.plastic[0]-heated<heated-cold);
    assert.equal(s.material[0],11);assert.equal(s.model[0],model);
  }
});

test('contact heat changes local thermal strength and creep rate while conserving enthalpy',()=>{
  const s=new Simulation3();s.add(-2,0,0,11,180,10);s.add(2,0,0,11,20,11);s.pin(0,true);s.pin(1,true);s.settings.heatRate=100;
  const before=s.snapshot(),y=thermalStrength(0,s.temperature[0]),rate=creepLogRate(.04,s.temperature[1]);
  for(let k=0;k<20;k++)s.step();
  assert.ok(s.temperature[0]<180&&s.temperature[1]>20);assert.ok(thermalStrength(0,s.temperature[0])>y);assert.ok(creepLogRate(.04,s.temperature[1])>rate);
  close(s.snapshot().energy,before.energy,1e-6);
});

test('thermal model parameters are validated atomically and preserved by part/deletion/reset',()=>{
  for(const p of [null,[],{Q:-1},{rate:NaN},{n:0},{Thot:20},{Tref:Infinity},{hotRatio:0},{typo:1}])assert.equal(thermalParameters(p),null);
  const s=new Simulation3(),box=p=>s.box([-4,0,-4],[4,8,4],11,false,20,11,.025,35,'box','',[0,0,0],{},{},{},p);
  assert.equal(box({Thot:0}),false);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  assert.ok(box({Q:10000}));assert.ok(box({Q:50000}));s.mpm.plastic[s.count-1]=.3;s.remove(0);
  assert.equal(s.thermalMaterials[s.lab.part[0]].Q,50000);close(s.mpm.plastic[0],.3);
  s.reset('empty');assert.deepEqual(s.thermalMaterials[1],P);
});

test('cold/hot comparison scene remains finite and conserves mass and enthalpy during compression',()=>{
  const s=new Simulation3();s.reset('thermomech');const before=s.snapshot();assert.deepEqual(before.models,[0,0,0,0,0,0,0,0,0,0,1078,1078]);
  s.setPress({target:-20,speed:16});for(let k=0;k<120;k++)s.step();const after=s.snapshot();
  assert.ok(after.maxPlastic>0);assert.ok(after.minJ>0);close(after.mass,before.mass);close(after.energy,before.energy,1e-4);assert.ok(after.data.every(Number.isFinite));
});
