import test from 'node:test';
import assert from 'node:assert/strict';
import { svd3,compose,projectPlastic,constitutiveStress,hardening } from '../src/three/constitutive.js';
import { det,identity } from '../src/three/math.js';
import { Simulation3,CAPACITY3 } from '../src/three/simulation.js';
const close=(a,b,eps=1e-8)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
const mm=(a,b)=>Array.from({length:9},(_,i)=>[0,1,2].reduce((sum,k)=>sum+a[Math.floor(i/3)*3+k]*b[k*3+i%3],0));
const transpose=a=>[0,3,6,1,4,7,2,5,8].map(k=>a[k]);

test('3D SVD reconstructs shear, compression and rotations with orthogonal factors',()=>{
  for(const F of [[1,.8,.2,0,.7,.4,.1,0,1.2],[.1,0,0,0,.12,0,0,0,2],[0,-1,0,1,0,0,0,0,1]]){
    const d=svd3(F),reconstructed=compose(d,d.sigma);
    F.forEach((x,k)=>close(x,reconstructed[k]));
    for(const m of [d.u,d.v])mm(m,transpose(m)).forEach((x,k)=>close(x,identity()[k]));
  }
});
test('all twelve laws are objective and stress free under rigid rotation',()=>{
  const c=Math.cos(.7),s=Math.sin(.7),R=[c,0,s,0,1,0,-s,0,c],F=[1.03,.02,0,0,.97,0,0,0,.99];
  for(let model=0;model<12;model++){
    constitutiveStress(R,model,400,400).forEach(x=>close(x,0));
    const t=constitutiveStress(F,model,400,400),rotated=constitutiveStress(mm(R,F),model,400,400),expected=mm(mm(R,t),transpose(R));
    rotated.forEach((x,k)=>close(x,expected[k]));
  }
  assert.ok(Math.abs(constitutiveStress([1.5,0,0,0,1,0,0,0,1],0,400,400)[0]-constitutiveStress([1.5,0,0,0,1,0,0,0,1],1,400,400)[0])>100);
});
test('snow returns to its asymmetric yield surface and retains compaction history',()=>{
  const F=[.8,0,0,0,.9,0,0,0,1.2],p=projectPlastic(F,2);
  const singular=svd3(p.F).sigma;assert.ok(singular.every(x=>x>=.975-1e-8&&x<=1.0075+1e-8));
  close(det(p.F)*p.jp,det(F));assert.ok(p.jp<1);assert.ok(hardening(p.jp)>1);
  const unloaded=projectPlastic(identity(),2,p.jp);close(unloaded.jp,p.jp);
  assert.equal(projectPlastic(F,0).F,F); // Elastic models keep the full reversible deformation.
  const soft=projectPlastic([.96,0,0,0,1,0,0,0,1],2,1,0,.01),strong=projectPlastic([.96,0,0,0,1,0,0,0,1],2,1,0,.06);
  assert.ok(soft.jp<strong.jp);
});
test('Drucker–Prager sand has no tensile stress and friction controls shear yield',()=>{
  const tensile=projectPlastic([1.1,0,0,0,1.1,0,0,0,1.1],3);
  constitutiveStress(tensile.F,3,400,400).forEach(x=>close(x,0));assert.ok(tensile.dilation>0);
  const F=[.8,0,0,0,1.05,0,0,0,1.05],low=projectPlastic(F,3,1,0,.025,15),high=projectPlastic(F,3,1,0,.025,50);
  const devNorm=f=>{const e=svd3(f).sigma.map(Math.log),mean=e.reduce((a,b)=>a+b,0)/3;return Math.hypot(...e.map(x=>x-mean));};
  assert.ok(devNorm(high.F)>devNorm(low.F));close(det(low.F),det(F));close(det(high.F),det(F));
  const compressed=projectPlastic([.95,0,0,0,.95,0,0,0,.95],3);
  assert.ok(constitutiveStress(compressed.F,3,400,400)[0]<0);
});
test('model parameters and plastic history survive deletion; fluid never adopts MPM models',()=>{
  const s=new Simulation3();s.add(0,0,0);s.add(10,0,0,11,20,2,.04,42);s.mpm.Jp[1]=.8;s.mpm.dilation[1]=.3;s.remove(0);
  assert.equal(s.model[0],2);assert.equal(s.yieldStrain[0],.04);assert.equal(s.friction[0],42);assert.equal(s.mpm.Jp[0],.8);assert.equal(s.mpm.dilation[0],.3);
  s.add(20,0,0,2,20,3);assert.equal(s.model[1],0);
  assert.equal(s.box([0,0,0],[8,8,8],11,false,20,99),false);assert.equal(s.count,2);
  s.count=CAPACITY3;assert.equal(s.add(0,0,0),false);
});
test('four-model scene evolves in 3D without inversions or mass/enthalpy loss',()=>{
  const s=new Simulation3();s.reset('models');const initial=s.snapshot();
  assert.deepEqual(initial.models,[847,847,847,847,0,0,0,0,0,0,0,0]);
  for(let frame=0;frame<240;frame++)s.step();
  const result=s.snapshot();assert.ok(result.minJ>0);assert.ok(s.time>3.9);close(result.mass,initial.mass);close(result.energy,initial.energy,1e-5);
  for(let i=0;i<s.count;i++)assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.z[i]+s.mpm.Jp[i]));
  assert.ok(s.mpm.Jp.subarray(1694,2541).some(x=>Math.abs(x-1)>.01));
});
test('large preset exceeds the old capacity and preserves its particles while stepping',()=>{
  const s=new Simulation3();s.reset('large');const initial=s.snapshot();assert.equal(s.count,12584);assert.equal(CAPACITY3,20000);
  for(let frame=0;frame<30;frame++)s.step();
  const result=s.snapshot();assert.equal(result.count,12584);assert.ok(result.minJ>0);close(result.mass,initial.mass);close(result.energy,initial.energy,1e-5);
  for(let i=0;i<s.count;i++)assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.z[i]));
});
