import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
import {RunControl} from '../src/three/run-control.js';
import {TimeHistory,aggregateParts} from '../src/three/time-history.js';

test('parametric solids occupy the requested shapes and get stable part identities',()=>{
  const s=new Simulation3();s.reset('empty');
  for(const shape of ['box','ellipsoid','cylinder'])assert.ok(s.box([-8,0,-8],[8,16,8],11,false,20,0,.025,35,shape,shape));
  const parts=s.lab.snapshot();assert.equal(parts.length,3);assert.equal(parts[0].count,125);assert.ok(parts[1].count<parts[2].count);assert.ok(parts[2].count<parts[0].count);
  const before=s.count;s.remove(0);assert.equal(s.count,before-1);assert.equal(s.lab.part[0],3);
  assert.equal(s.lab.snapshot().find(p=>p.id===1).count,124);
  const expected=s.lab.reference.slice((s.count)*3,(s.count)*3+3);assert.deepEqual(s.lab.reference.slice(0,3),expected);
});
test('part velocities use the mass center, respect anchors, and report full kinetic energy',()=>{
  const s=new Simulation3();s.reset('empty');s.box([-4,-4,-4],[4,4,4],2,false,20);s.box([20,-4,-4],[28,4,4],2,false,20);
  assert.ok(s.lab.command({id:1,action:'velocity',velocity:[3,0,0],angular:[0,0,.2]}));
  const parts=s.lab.snapshot();assert.ok(Math.abs(parts[0].velocity[0]-3)<1e-12);assert.equal(parts[1].kinetic,0);
  assert.ok(parts[0].kinetic>.5*parts[0].mass*9);assert.ok(s.vy[0]<0);
  s.lab.command({id:1,action:'pin'});s.lab.command({id:1,action:'velocity',velocity:[10,0,0]});assert.equal(s.lab.snapshot()[0].kinetic,0);
  s.lab.command({id:1,action:'release'});assert.equal(s.lab.snapshot()[0].pinned,0);
  assert.equal(aggregateParts(s.lab.snapshot()).count,s.count);
});
test('failed geometry creation is atomic and invalid part edits do not mutate',()=>{
  const s=new Simulation3();s.reset('empty');assert.equal(s.box([0,0,0],[8,8,8],2,false,20,0,.025,35,'bad'),false);
  assert.equal(s.count,0);assert.equal(s.lab.nextId,1);assert.equal(s.lab.command({id:1000,action:'pin'}),false);
  s.box([0,0,0],[8,8,8]);assert.equal(s.lab.command({id:1,action:'velocity',velocity:[NaN,0,0]}),false);
  assert.equal(s.lab.snapshot()[0].kinetic,0);
});
test('timed runs stop exactly, pause preserves target, and single step stays paused',()=>{
  const r=new RunControl();let t=0;assert.ok(r.start(.023,t));t+=r.dt(t);r.advanced(t);r.pause(true,t);assert.equal(r.dt(t),0);r.pause(false,t);t+=r.dt(t);r.advanced(t);
  assert.equal(t,.023);assert.equal(r.snapshot().status,'completed');assert.equal(r.dt(t),0);
  assert.ok(r.single());assert.equal(r.dt(t),1/60);assert.equal(r.dt(t),0);assert.ok(r.paused);
  assert.equal(r.start(Infinity,t),false);
});
test('time history uses actual sample times, resets after rewind and escapes CSV names',()=>{
  const s=new Simulation3();s.reset('empty');s.box([0,0,0],[8,8,8],2,false,20,0,.025,35,'box','=unsafe,"name"');
  const p=s.lab.snapshot()[0],h=new TimeHistory();h.sample(0,p);h.sample(.02,p,.05);h.sample(.06,p,.05);assert.equal(h.rows.length,2);assert.equal(h.rows[1][0],.06);
  assert.ok(h.csv().includes("'="));assert.ok(h.csv().includes('""name""'));
  h.sample(0,p);assert.equal(h.rows.length,1);
  h.sample(.023,p,0);assert.equal(h.rows.length,2);assert.equal(h.rows[1][0],.023);
  for(let i=1;i<2200;i++)h.sample(i,p);assert.equal(h.rows.length,2000);
});
