import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {projectDomains,validateMixed} from '../src/mixed/model.js';
import {unifiedContactExample} from '../src/simulation/unified-example.js';
await initialize();
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('contact lab preserves both FEM meshes and routes each explicit interface once',()=>{
  const p=validateMixed(unifiedContactExample()),d=projectDomains(p);
  assert.equal(p.parts.length,5);assert.equal(p.contactPairs.length,10);
  assert.deepEqual(d.fem.contactPairs.map(p=>p.id),[p.contactPairs.find(d=>d.a==='plate'&&d.b==='foundation').id]);
  const s=new MixedSimulation(p);try{
    assert.ok(!s.contacts.pairs.some(p=>p.definition.a==='plate'&&p.definition.b==='foundation'));
    assert.equal(s.snapshot().contactPairs.length,10);
  }finally{s.free();}
});
test('four methods plus FEM–FEM return conservative heat, single-counted contact energy and shared clock',()=>{
  const s=new MixedSimulation(unifiedContactExample());try{
    const f=s.step(.003),pair=f.contactPairs.find(p=>p.a==='plate'&&p.b==='foundation');
    assert.ok(pair.normalForce>0);assert.ok(pair.accumulatedHeat>0);assert.ok(pair.thermalSamples>0);
    assert.ok(Math.abs(f.thermal.residual)<1e-5);assert.equal(f.mixed.clock.maxDrift,0);
    const loss=f.mixed.energy.physical,storage=f.mixed.energy.storage;
    near(loss.femContact,pair.normalLoss+pair.frictionLoss);
    near(loss.femDamping,f.fem.parts.reduce((sum,p)=>sum+p.summary.dissipated,0));
    near(storage.femContact,pair.contactEnergy);
    near(f.mixed.interfaceWorkIntoFEM,f.mixed.exchanges.pairs.reduce((sum,p)=>sum+p.workB,0)+f.mixed.correctionWork);
    assert.ok(f.particles.every(Number.isFinite));
  }finally{s.free();}
});
test('failed mixed interval rolls back FEM–FEM statistics, thermal exchanges, storage and clocks',()=>{
  const s=new MixedSimulation(unifiedContactExample());try{
    s.step(.001);const before=s.snapshot(),exchange=s.contacts.exchange;
    s.contacts.exchange=function(dt){exchange.call(this,dt);throw Error('injected failure');};
    assert.throws(()=>s.step(.001),/injected failure/);s.contacts.exchange=exchange;
    const after=s.snapshot();assert.equal(after.time,before.time);
    assert.deepEqual(after.contactPairs,before.contactPairs);assert.deepEqual(after.thermal,before.thermal);
    assert.deepEqual(after.mixed.clock,before.mixed.clock);
    assert.deepEqual(after.mixed.energy.physical,before.mixed.energy.physical);
    assert.deepEqual(after.fem.parts.map(p=>p.temperature),before.fem.parts.map(p=>p.temperature));
  }finally{s.free();}
});
