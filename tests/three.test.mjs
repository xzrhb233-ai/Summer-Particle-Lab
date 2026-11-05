import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation3,CAPACITY3 } from '../src/three/simulation.js';
import { identity,stress3 } from '../src/three/math.js';
import { enthalpyAt } from '../src/thermal.js';
function empty(){const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;return s;}

test('3D elastic stress is rotation invariant and restores XZ/YZ shear',()=>{
  const c=Math.cos(.8),s=Math.sin(.8),r=[1,0,0,0,c,-s,0,s,c];
  assert.ok(stress3(r,400,400).every(x=>Math.abs(x)<1e-8));
  const f=identity();f[2]=.2;const t=stress3(f,400,400);assert.ok(t[2]>0);assert.ok(Math.abs(t[2]-t[6])<1e-8);
  f[5]=.3;assert.ok(stress3(f,400,400)[5]>0);
});
test('3D MPM preserves uniform XYZ motion and excludes water from grid transfers',()=>{
  const s=empty();s.box([-8,-8,-8],[8,8,8],11);const count=s.count;
  for(let i=0;i<count;i++){s.vx[i]=3;s.vy[i]=-2;s.vz[i]=7;}
  s.add(35,0,0,2);const water=s.count-1;s.vz[water]=13;
  s.mpm.step(s,.001);
  for(let i=0;i<count;i++){assert.ok(Math.abs(s.vx[i]-3)<1e-8);assert.ok(Math.abs(s.vy[i]+2)<1e-8);assert.ok(Math.abs(s.vz[i]-7)<1e-8);}
  assert.equal(s.z[water],0);assert.equal(s.vz[water],13);
});
test('3D PBF resolves compression along Z as well as X and Y',()=>{
  const s=empty();for(let z=-3;z<=3;z+=2)for(let y=-1;y<=1;y+=2)for(let x=-1;x<=1;x+=2)s.add(x,y,z,2);
  s.step();assert.ok(Math.max(...s.z.subarray(0,s.count))>3);assert.ok(Math.max(...s.x.subarray(0,s.count))>1);
  assert.ok(Math.abs(s.x.subarray(0,s.count).reduce((a,b)=>a+b,0))<1e-7);
});
test('thermal contact checks actual 3D distance and conserves enthalpy',()=>{
  const s=empty();s.settings.thermal=true;s.add(0,0,0,2,80);s.add(0,0,20,2,20);
  const h=s.snapshot().energy;s.step();assert.equal(s.temperature[0],80);assert.equal(s.temperature[1],20);
  s.z[1]=5;for(let t=0;t<30;t++)s.step();
  assert.ok(s.temperature[0]<80 && s.temperature[1]>20);assert.ok(Math.abs(s.snapshot().energy-h)<1e-6);
});
test('3D block really occupies volume, bends in Z under drag, and keeps its anchor',()=>{
  const s=empty();s.box([-24,0,-8],[12,12,8],11,true);assert.ok(new Set(s.z.subarray(0,s.count)).size>2);
  s.beginDrag([12,6,0],9);s.drag.point=[12,6,18];
  for(let i=0;i<60;i++)s.step();let tip=0,n=0;
  for(let i=0;i<s.count;i++){if(s.x[i]>2){tip+=s.z[i];n++;}if(s.pinned[i])assert.ok(Math.abs(s.z[i]-s.az[i])<1e-9);}
  assert.ok(tip/n>2);assert.ok(s.mpm.minJ(s)>0);
  s.drag=null;let recoil=false;
  for(let t=0;t<120;t++){s.step();let z=0,k=0;for(let i=0;i<s.count;i++)if(s.x[i]>2){z+=s.z[i];k++;}if(z/k<tip/n-1)recoil=true;}
  assert.ok(recoil);
});
test('mixed 3D preset stays finite and conserves particle mass and thermal energy',()=>{
  const s=new Simulation3();s.reset();const initial=s.snapshot();for(let i=0;i<180;i++)s.step();const after=s.snapshot();
  assert.equal(after.count,initial.count);assert.equal(after.mass,initial.mass);assert.ok(Math.abs(after.energy-initial.energy)<1e-5);
  assert.ok(after.minJ>0);assert.ok(s.time>2.99);
  for(let i=0;i<s.count;i++){assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.z[i]));assert.ok(Math.abs(s.z[i])<=63 && Math.abs(s.x[i])<=63 && s.y[i]>=-47 && s.y[i]<=71);}
});
test('ice/water phase transitions reset 3D deformation and deletion remaps it',()=>{
  const s=empty();s.add(0,0,0,2);s.enthalpy[0]=enthalpyAt(4,-10);s.phaseTransition(0);assert.equal(s.material[0],4);
  s.mpm.F[2]=.2;s.enthalpy[0]=enthalpyAt(2,20);s.phaseTransition(0);assert.equal(s.material[0],2);assert.equal(s.mpm.F[2],0);
  s.add(5,0,0,11);s.mpm.F[9+2]=.3;s.remove(0);assert.equal(s.mpm.F[2],.3);
  s.count=CAPACITY3-1;assert.equal(s.box([0,0,0],[8,8,8],11),false);assert.equal(s.count,CAPACITY3-1);
});
