import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PhysicsClock} from '../src/simulation/physics-clock.js';
import {initialize} from '../src/multibody/engine.js';
import {runContactRow,contactValidationPlan,summarizeContact} from '../src/simulation/contact-validation.js';
import {MechanicalDiagnostics} from '../src/simulation/mechanical-diagnostics.js';
await initialize();
test('CFL subdivisions use the same absolute time grid across output partitions',()=>{
  const run=pattern=>{
    const c=new PhysicsClock(1/480),ticks=[];let t=0,k=0;
    while(t<.1-1e-10){const end=Math.min(.1,t+pattern[k++%pattern.length]/480);
      while(t<end-1e-10){const r=c.next(t,end,t<.05?.0017:.0008);ticks.push(r.end);t=r.end;}}
    assert.equal(c.requestCuts,0);return ticks;
  };
  assert.deepEqual(run([8]),run([1,7,3,5]));
});
test('off-grid stops and load discontinuities are honored and explicitly counted',()=>{
  const c=new PhysicsClock(1/480),event=.0007;
  const a=c.next(0,.01,1/480,{nextEvent:event});assert.equal(a.end,event);assert.equal(c.eventCuts,1);
  const b=c.next(a.end,.001,1/480);assert.equal(b.end,.001);assert.equal(c.requestCuts,1);
  const other=new PhysicsClock(1/480);other.next(0,.0001,1/480,{nextEvent:.0007});
  assert.equal(other.eventCuts,0);assert.equal(other.requestCuts,1);
  assert.throws(()=>c.next(.001,.002,1e-9));
});
test('MPM collisions preserve states, heat and impulse across regular and irregular requests',async()=>{
  const specs=contactValidationPlan().slice(0,3),rows=[];
  for(const s of specs)rows.push(await runContactRow(s));
  const checks=summarizeContact(rows).filter(c=>c.kind==='batch'&&c.status!=='missing');
  assert.equal(checks.length,2);
  for(const c of checks)assert.equal(c.status,'pass',JSON.stringify(c));
  for(const r of rows){assert.equal(r.clock.requestCuts,0);assert.ok(r.maxEnergyGain<.03);assert.ok(r.maxThermalResidual<1e-4);}
});

test('contact dissipation cannot conceal an earlier positive correction',()=>{
  const d=new MechanicalDiagnostics({});
  d.recordContact({normalWork:2,frictionWork:-1});
  d.recordContact({normalWork:-3,frictionWork:0});
  assert.equal(d.ledger.contactNormalWork+d.ledger.contactFrictionWork,-2);
  assert.equal(d.ledger.positiveContactWork,2);
});
