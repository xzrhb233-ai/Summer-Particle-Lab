import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation3 } from '../src/three/simulation.js';
import { regularizeSolids,solidSpacing } from '../src/three/solid-sampling.js';
import { specimen,distribution } from './benchmark-solid-beading.mjs';

test('solid sampling separates crowded points without a velocity kick or history loss',()=>{
  const s=new Simulation3();s.add(-.5,0,0);s.add(.5,0,0);
  s.mass[1]=3;s.invMass[1]=1/3;s.vx.fill(7,0,2);s.mpm.plastic[0]=.4;s.mpm.C[0]=.2;
  const before=s.snapshot(),center=s.mass[0]*s.x[0]+s.mass[1]*s.x[1],F=s.mpm.F.slice(0,18),C=s.mpm.C.slice(0,18);
  for(let k=0;k<60;k++)regularizeSolids(s,1/120);
  assert.ok(s.x[1]-s.x[0]>2.79);assert.ok(Math.abs(s.mass[0]*s.x[0]+s.mass[1]*s.x[1]-center)<1e-10);
  assert.deepEqual([...s.vx.slice(0,2)],[7,7]);assert.deepEqual(s.mpm.F.slice(0,18),F);assert.deepEqual(s.mpm.C.slice(0,18),C);
  assert.equal(s.mpm.plastic[0],.4);assert.equal(s.snapshot().mass,before.mass);assert.equal(s.snapshot().energy,before.energy);
});
test('sampling respects parts, fluids, pins, boundaries and the disable switch',()=>{
  for(const kind of ['parts','fluid','disabled']){
    const s=new Simulation3();s.add(0,0,0);s.add(1,0,0,kind==='fluid'?2:11);
    if(kind==='parts')s.lab.part[1]=1;
    if(kind==='disabled')s.setSettings({solidAntiClump:false});
    regularizeSolids(s,1/60);assert.equal(s.x[0],0);assert.equal(s.x[1],1);
  }
  const s=new Simulation3();s.add(0,-46,0);s.add(0,-45,0);s.pin(0,true);s.press.enabled=true;s.press.y=-40;
  for(let k=0;k<60;k++)regularizeSolids(s,1/120);
  assert.equal(s.y[0],-46);assert.ok(s.y[1]>-43.3&&s.y[1]<=s.press.y-1.8);assert.equal(s.vy[1],0);
});
test('spacing follows volume loss including snow, soil and foam plastic compaction',()=>{
  const s=new Simulation3();s.add(0,0,0);
  const initial=solidSpacing(s,0);s.mpm.F.set([.5,0,0,0,.5,0,0,0,.5]);
  assert.ok(Math.abs(solidSpacing(s,0)-initial*.5)<1e-12);
  for(const model of [2,8,9]){s.model[0]=model;s.mpm.Jp[0]=.125;assert.ok(Math.abs(solidSpacing(s,0)-initial*.25)<1e-12);}
});
test('coincident particles separate deterministically within a time-based displacement budget',()=>{
  const make=()=>{const s=new Simulation3();s.add(0,0,0);s.add(0,0,0);return s;};
  const a=make(),b=make();regularizeSolids(a,1/240);regularizeSolids(b,1/240);
  assert.deepEqual(a.x.slice(0,2),b.x.slice(0,2));
  const d=Math.hypot(a.x[0],a.y[0],a.z[0]);assert.ok(d>0&&d<=8/240+1e-12);
  assert.ok(Math.abs(a.x[0]+a.x[1])+Math.abs(a.y[0]+a.y[1])+Math.abs(a.z[0]+a.z[1])<1e-12);
});
test('equal elapsed time gives consistent sampling relaxation across substep sizes',()=>{
  const distances=[];
  for(const dt of [1/120,1/240,1/1200]){
    const s=new Simulation3();s.add(-1,0,0);s.add(1,0,0);
    for(let t=0;t<Math.round(.1/dt);t++)regularizeSolids(s,dt);
    distances.push(s.x[1]-s.x[0]);
  }
  assert.ok(Math.max(...distances)-Math.min(...distances)<.01);
});
test('six-second thermal J2 drop and compression suppress severe clustering while preserving plastic flow',()=>{
  for(const loading of ['drop','press']){
    const before=specimen(10,loading,false),after=specimen(10,loading,true),mass=after.snapshot().mass,energy=after.snapshot().energy;
    for(let t=0;t<360;t++){before.step();after.step();}
    const a=distribution(before),b=distribution(after);
    assert.ok(a.close>100,`${loading}: baseline must actually reproduce clustering`);
    assert.equal(b.close,0,`${loading}: no point pairs closer than half the initial spacing`);
    assert.ok(b.min>2.6);assert.ok(b.minJ>0);assert.ok(Math.max(...after.mpm.plastic.slice(0,after.count))>.02);
    assert.equal(after.snapshot().mass,mass);assert.equal(after.snapshot().energy,energy);
    assert.ok(b.bounds[0][1]-b.bounds[0][0]>35,'plastic spreading remains active');
  }
});
