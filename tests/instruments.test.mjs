import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation3 } from '../src/three/simulation.js';
import { projectPlastic,principalStress,constitutiveStress,vonMises } from '../src/three/constitutive.js';
import { det,identity } from '../src/three/math.js';
const close=(a,b,eps=1e-7)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);

test('cached principal stress agrees with direct constitutive evaluation after plastic return',()=>{
  for(const model of [2,3,4,5,6,7,8,9,10,11])for(const F of [[.8,.15,.1,0,.95,.08,0,0,1.1],[1.1,0,0,0,1.1,0,0,0,1.1],[.96,.01,0,0,.98,.02,0,0,.99]]){
    const p=projectPlastic(F,model),cached=principalStress(p.decomposition,model),direct=constitutiveStress(p.F,model,1,1);
    direct.forEach((x,k)=>close(cached[k],x));assert.ok(Number.isFinite(p.plasticIncrement)&&p.plasticIncrement>=0);
  }
});
test('von Mises measures deviatoric Cauchy stress, not rotation or hydrostatic pressure',()=>{
  close(vonMises([3,0,0,0,3,0,0,0,3]),0);
  close(vonMises([4,0,0,0,0,0,0,0,0],2),2);
  close(vonMises([0,2,0,2,0,0,0,0,0]),2*Math.sqrt(3));
  const s=new Simulation3();s.add(0,0,0);s.mpm.F.set([1,.2,0,0,1,0,0,0,1]);s.mpm.refreshDiagnostics(s);
  assert.ok(s.mpm.stress[0]>0);const normalized=s.mpm.stress[0],tau=s.mpm.tau[0];s.settings.stiffness=2;s.mpm.refreshDiagnostics(s);
  close(s.mpm.stress[0],normalized);close(s.mpm.tau[0],2*tau);
  s.mpm.F.set(identity());s.mpm.refreshDiagnostics(s);close(s.mpm.stress[0],0);
});
test('platen moves at a bounded speed, honors anchors, holds and resets',()=>{
  const s=new Simulation3();s.settings.gravity=false;s.setPress({enabled:true,target:-20,speed:12});s.step();close(s.press.y,63.8);close(s.press.force,0);
  s.setPress({hold:true});const y=s.press.y;s.step();close(s.press.y,y);
  s.add(0,60,0);s.pin(0,true);s.setPress({target:-20,speed:20});for(let i=0;i<20;i++)s.step();assert.ok(s.press.y>=62-1e-8);
  s.setPress({target:NaN,speed:Infinity});assert.ok(Number.isFinite(s.press.target+s.press.speed));
  s.reset('empty');assert.equal(s.press.enabled,false);assert.equal(s.history.length,0);
});
test('compression and release produce stress, permanent strain and finite three-dimensional motion',()=>{
  const s=new Simulation3();s.reset('compression');const initial=s.snapshot();assert.equal(s.count,2156);
  s.setPress({target:-20,speed:16});let force=0,stress=0;
  for(let i=0;i<180;i++){
    s.step();force=Math.max(force,s.press.force);stress=Math.max(stress,...s.mpm.stress.subarray(0,s.count));
    assert.ok(s.mpm.minJ(s)>0);for(let p=0;p<s.count;p++)assert.ok(s.y[p]<=s.press.y-1.8+1e-8);
  }
  assert.ok(force>0&&stress>.01);assert.ok(s.time>2.99);
  const plastic=s.mpm.plastic.slice(0,s.count),top=[-Infinity,-Infinity,-Infinity,-Infinity];
  for(let p=0;p<s.count;p++)top[s.model[p]]=Math.max(top[s.model[p]],s.y[p]);
  assert.ok(plastic.subarray(1078).some(x=>x>.02));assert.ok(plastic.subarray(0,1078).every(x=>x===0));
  s.setPress({target:40,speed:20});let rebounds=false;
  for(let i=0;i<180;i++){s.step();for(let p=0;p<s.count;p++)if(s.model[p]===0&&s.y[p]>top[0]+1)rebounds=true;}
  assert.ok(rebounds,'elastic block should expand after the platen retracts');
  const final=s.snapshot();close(final.mass,initial.mass);close(final.energy,initial.energy,1e-5);
  for(let p=0;p<s.count;p++){assert.ok(s.mpm.plastic[p]>=plastic[p]);assert.ok(Number.isFinite(s.x[p]+s.y[p]+s.z[p]));}
  assert.equal(s.history.length,300);assert.ok(s.press.y>39.9);
});
test('diagnostic snapshot buffers recycle and deletion preserves mechanical history',()=>{
  const s=new Simulation3();s.add(0,0,0);s.add(4,0,0,11,20,2);s.mpm.stress[1]=.25;s.mpm.plastic[1]=.3;s.remove(0);
  const first=s.snapshot();close(first.data[6],.25);close(first.data[7],.3);assert.equal(first.data.length,8);
  const second=s.snapshot(first.data.buffer);assert.equal(second.data.buffer,first.data.buffer);
  s.reset('empty');s.add(0,0,0);assert.equal(s.mpm.plastic[0],0);assert.equal(s.mpm.stress[0],0);
});
test('profile sections partition physical time and remain finite for empty and mixed scenes',()=>{
  for(const scene of ['empty','coupled']){
    const s=new Simulation3();s.reset(scene);s.step();const p=s.profile;
    for(const value of Object.values(p))assert.ok(Number.isFinite(value)&&value>=0);
    close(p.constitutive+p.transfer+p.grid+p.fluid+p.thermal+p.diagnostics+p.other,p.total,1e-5);
  }
});
