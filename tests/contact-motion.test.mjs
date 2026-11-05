import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {mixedImpactProject} from '../src/mixed/model.js';
import {unifiedContactExample} from '../src/simulation/unified-example.js';
import {ContactMotion,ContactMotionError} from '../src/mixed/contact-motion.js';
await initialize();
const run=(p,fn)=>{const s=new MixedSimulation(p);try{return fn(s);}finally{s.free();}};

test('thin FEM cells and rigid angular velocity both tighten contact travel',()=>run(unifiedContactExample(),s=>{
  const body=[...s.mpm.bodies.values()][0],guard=s.contactMotion;
  const baseline=guard.limit();body.rb.setAngvel({x:0,y:0,z:200},true);
  assert.ok(guard.limit()<baseline/10);
  const f=s.fem.states[0];f.part.geometry.size[1]=.001;
  const thin=new ContactMotion(s.contacts);
  assert.ok(thin.limit()<guard.limit()/10);
}));

test('actual swept travel is rejected even when final velocities are zero',()=>run(mixedImpactProject(),s=>{
  const guard=s.contactMotion,p=s.mpm.particles;
  guard.capture();p.y[0]-=10; p.vy[0]=0;
  assert.throws(()=>guard.check(),ContactMotionError);
}));

test('FEM movement and rigid rotation are checked independently of particle motion',()=>run(unifiedContactExample(),s=>{
  const guard=s.contactMotion,body=[...s.mpm.bodies.values()][0];guard.capture();
  body.rb.setRotation({x:0,y:0,z:Math.sin(.3),w:Math.cos(.3)},true);
  assert.throws(()=>guard.check(),ContactMotionError);
  guard.capture();s.fem.states[0].u[1]+=.1;
  assert.throws(()=>guard.check(),ContactMotionError);
}));

test('disabled mechanical pairs do not constrain heat-only travel',()=>{
  const p=mixedImpactProject();p.contactPairs.forEach(p=>p.mechanical=false);
  run(p,s=>{assert.equal(s.contactMotion.limit(),Infinity);s.contactMotion.capture();s.mpm.particles.y[0]-=10;assert.equal(s.contactMotion.check(),0);});
});

test('oversized trial rolls back heat, impulse and clocks before successful refinement',()=>run(mixedImpactProject(),s=>{
  const original=s.contactMotion.check.bind(s.contactMotion);let calls=0;
  s.contactMotion.check=()=>{if(++calls===3)throw new ContactMotionError(2);return original();};
  const f=s.step(.001);
  assert.equal(f.mixed.contactSafety.retries,1);assert.equal(f.time,.001);
  assert.equal(f.mixed.clock.maxDrift,0);assert.ok(Math.abs(f.thermal.residual)<1e-6);
  run(mixedImpactProject(),reference=>{
    const g=reference.stepAttempt(.001,s.dt/2);
    assert.deepEqual(f.particles,g.particles);assert.deepEqual(f.contactPairs,g.contactPairs);
    assert.deepEqual(f.thermal,g.thermal);assert.equal(f.mixed.clock.steps,g.mixed.clock.steps);
  });
}));

test('exhausted refinements restore all state and report failure, never publish a partial step',()=>run(mixedImpactProject(),s=>{
  const before=s.snapshot();s.contactMotion.check=()=>{throw new ContactMotionError(2);};
  assert.throws(()=>s.step(.001),/8 次细分/);const after=s.snapshot();
  assert.equal(after.time,before.time);assert.deepEqual(after.particles,before.particles);
  assert.deepEqual(after.thermal,before.thermal);assert.deepEqual(after.contactPairs,before.contactPairs);
  assert.deepEqual(after.mixed.clock,before.mixed.clock);assert.deepEqual(after.mixed.contactSafety,before.mixed.contactSafety);
}));
