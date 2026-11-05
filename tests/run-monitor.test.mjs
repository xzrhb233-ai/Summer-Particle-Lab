import test from 'node:test';
import assert from 'node:assert/strict';
import {RunMonitor,validateRunTarget,wallTime} from '../src/simulation/run-monitor.js';
test('absolute target continues from current time, rejects exhausted or invalid targets',()=>{
  assert.equal(validateRunTarget(2,.35),2);
  for(const x of [.3,.35,NaN,Infinity,61])assert.throws(()=>validateRunTarget(x,.35));
});
test('live progress, elapsed and ETA account for a slow pending batch',()=>{
  const m=new RunMonitor();assert.equal(m.read(0,2).eta,null);
  m.record(.01,1);m.record(.02,1);
  const r=m.read(.35,2,1);
  assert.equal(r.percent,17.5);assert.equal(r.elapsed,3);assert.equal(r.rate,.01);assert.equal(r.eta,165);
  assert.equal(m.read(2,2).percent,100);assert.equal(m.read(2,2).eta,0);
  m.reset();assert.equal(m.read(0,2).elapsed,0);assert.equal(m.read(0,2).rate,null);
});
test('recent rate does not average the entire pre-contact run',()=>{
  const m=new RunMonitor();m.record(1,.1);
  for(let i=0;i<20;i++)m.record(.001,1);
  assert.ok(Math.abs(m.read(1.02,2).rate-.001)<1e-12);
  assert.equal(wallTime(null),'—');assert.equal(wallTime(120),'2.0 min');
});
