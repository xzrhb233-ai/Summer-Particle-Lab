import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPlastic,constitutiveStress,vonMises,MODELS} from '../src/three/constitutive.js';
import {pressureParameters,PRESSURE_DEFAULTS as P,foamStrength} from '../src/three/pressure-plasticity.js';
import {det,identity} from '../src/three/math.js';
import {Simulation3} from '../src/three/simulation.js';
const close=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
const diag=(x,y=x,z=x)=>[x,0,0,0,y,0,0,0,z];
const ret=(F,model=8,p=P,jp=1,ep=0)=>projectPlastic(F,model,jp,0,.025,35,ep,.01,20,undefined,p);
function stress(p){const J=det(p.F)*p.jp,t=constitutiveStress(p.F,8,.4,.4);return {q:vonMises(t,J),mean:(t[0]+t[4]+t[8])/(3*J)};}

test('cohesive DP satisfies shear/tension limits, preserves total J and dilates independently',()=>{
  for(const F of [diag(1.1),diag(.8),diag(1.3,.8,1),[1,.4,0,0,1,0,0,0,1]]){
    const p=ret(F),s=stress(p);assert.ok(s.q/Math.sqrt(3)+P.slope*s.mean<=P.cohesion+1e-7);assert.ok(s.mean<=P.tension+1e-7);
    close(det(p.F)*p.jp,det(F));assert.ok(p.plasticIncrement>=0);
  }
  const tension=ret(diag(1.1));close(stress(tension).mean,P.tension);assert.ok(tension.jp>1);
  const compressed=ret(diag(.8));close(compressed.plasticIncrement,0);close(compressed.jp,1);
  const F=[1,.5,0,0,1,0,0,0,1];
  close(ret(F,8,{...P,dilatancy:0}).jp,1);
  assert.ok(ret(F,8,{...P,dilatancy:.5}).jp>1);
  assert.ok(stress(ret(F,8,{...P,cohesion:.1})).q>stress(ret(F)).q);
  const residual=ret(identity(),8,P,tension.jp,tension.plasticIncrement);close(residual.jp,tension.jp);close(residual.plasticIncrement,0);
});

test('DF foam yields in hydrostatic compression, hardens, and retains permanent compaction',()=>{
  for(const F of [diag(.85),diag(1.1),[1,.45,0,0,.95,0,0,0,1.1]])for(const jp of [.6,1,1.2]){
    const p=ret(F,9,P,jp,.05),s=stress(p),hat=Math.sqrt((s.q**2+P.alpha**2*s.mean**2)/(1+P.alpha**2/9));
    close(det(p.F)*p.jp,det(F)*jp);
    close(hat,foamStrength(.05+p.plasticIncrement,P),2e-7);
    assert.ok(.05+p.plasticIncrement<P.epsD);
  }
  const p=ret(diag(.85),9);assert.ok(p.jp<1);assert.ok(p.plasticIncrement>0);
  close(stress(p).q,0);
  const unloaded=ret(identity(),9,P,p.jp,p.plasticIncrement);close(unloaded.jp,p.jp);close(unloaded.plasticIncrement,0);close(stress(unloaded).mean,0);
  assert.ok(foamStrength(.65)>foamStrength(.1));assert.ok(Math.abs(stress(ret(diag(.85),9,P,1,.3)).mean)>Math.abs(stress(p).mean));
});

test('foam flow is associated and equivalent strain is conjugate to plastic work',()=>{
  const F=diag(.85,.97,1.02),p=ret(F,9),s=stress(p),hat=Math.sqrt((s.q**2+P.alpha**2*s.mean**2)/(1+P.alpha**2/9));
  const d=[0,4,8].map(k=>Math.log(F[k]/p.F[k])),tr=d.reduce((a,b)=>a+b,0),dev=d.map(x=>x-tr/3);
  const conjugate=Math.sqrt((1+P.alpha**2/9)*(2/3*dev.reduce((a,x)=>a+x*x,0)+tr*tr/P.alpha**2));
  close(conjugate,p.plasticIncrement);
  const tau=constitutiveStress(p.F,9,.4,.4),J=det(p.F)*p.jp,work=[0,4,8].reduce((a,k,i)=>a+tau[k]/J*d[i],0);
  close(work,hat*p.plasticIncrement);
});

test('pressure parameters reject invalid combinations and are independent per part',()=>{
  for(const bad of [null,[],{alpha:0},{epsD:0},{densify:0},{dilatancy:.8},{tension:.2},{cohesion:NaN},{beta:Infinity},{typo:1}])assert.equal(pressureParameters(bad),null);
  const s=new Simulation3();const box=p=>s.box([-4,0,-4],[4,8,4],11,false,20,9,.025,35,'box','',[0,0,0],{},{},p);
  assert.equal(box({epsD:0}),false);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  assert.ok(box({alpha:.5}));assert.ok(box({alpha:2}));s.mpm.Jp[s.count-1]=.7;s.remove(0);
  assert.equal(s.pressureMaterials[s.lab.part[0]].alpha,2);close(s.mpm.Jp[0],.7);
  s.reset('empty');assert.deepEqual(s.pressureMaterials[1],P);assert.equal(MODELS.length,12);
});

test('soil and foam compression scene stays finite and preserves mass and heat',()=>{
  const s=new Simulation3();s.reset('porous');const before=s.snapshot();
  assert.deepEqual(before.models,[0,0,0,0,0,0,0,0,1078,1078,0,0]);
  s.setPress({target:-20,speed:16});for(let k=0;k<150;k++)s.step();
  const after=s.snapshot();assert.ok(after.maxPlastic>0);assert.ok(after.minJ>0);close(after.mass,before.mass);close(after.energy,before.energy,1e-5);
  for(let i=0;i<s.count;i++)assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.z[i]+s.mpm.Jp[i])&&s.mpm.Jp[i]>0);
  assert.ok(s.mpm.Jp.slice(1078,s.count).some(j=>j<.99));
});
