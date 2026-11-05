import test from 'node:test';
import assert from 'node:assert/strict';
import {sweepSphereTriangle} from '../src/mixed/swept-contact.js';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {contactSafetyExample} from '../src/simulation/contact-safety-example.js';
await initialize();
const tri=[[0,0,0],[1,0,0],[0,0,1]];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} vs ${b}`);
test('continuous face, edge and vertex impact times match analytic distances',()=>{
  for(const [x,z,height] of [[.2,.2,.1],[.5,-.06,.08],[-.06,-.06,Math.sqrt(.0028)]]){
    const hit=sweepSphereTriangle([x,1,z],[x,-1,z],tri,tri,.1);
    assert.ok(hit&&!hit.uncertain);near(hit.time,(1-height)/2);
  }
});
test('moving FEM face hits a stationary sphere; Galilean translation preserves the event',()=>{
  const p=[.2,0,.2],before=tri.map(v=>[v[0],-1,v[2]]),after=tri.map(v=>[v[0],1,v[2]]);
  const h=sweepSphereTriangle(p,p,before,after,.1);near(h.time,.45);
  const shift=v=>[v[0]+.4,v[1]+.3,v[2]-.2];
  near(sweepSphereTriangle(p,shift(p),before,after.map(shift),.1).time,h.time);
});
test('separated endpoints still detect intermediate edge contact without false hits on near misses',()=>{
  const hit=sweepSphereTriangle([-.5,.05,-.08],[1.5,.05,-.08],tri,tri,.1);
  assert.ok(hit&&!hit.initial);
  assert.equal(sweepSphereTriangle([-.5,.09,-.08],[1.5,.09,-.08],tri,tri,.1),null);
  assert.equal(sweepSphereTriangle([.2,1,.2],[.2,2,.2],tri,tri,.1),null);
});
test('initial contact and exhausted search budget are explicit rather than false clearance',()=>{
  assert.equal(sweepSphereTriangle([.2,.1,.2],[.2,1,.2],tri,tri,.1).initial,true);
  assert.equal(sweepSphereTriangle([.2,1,.2],[.2,-1,.2],tri,tri,.1,{iterations:1}).uncertain,true);
});

test('near-tangential travel along a deforming face can be certified clear',()=>{
  const start=[.33778038714871805,.4124764549404214,-.11250087066491928];
  const end=[.3378011442489093,.4124754846228463,-.11250100774990367];
  const before=[[.45000475340136153,.37499304804104205,-.11666769515817883],[.3000120127033563,.3749709890852448,-.11666802185754756],[.45000809571973877,.3749869591774893,.11666624151271306]];
  const after=[[.45000551079740714,.3749922125746929,-.11666789571044875],[.30001251367518844,.3749699472047073,-.11666823492513585],[.45000920199496514,.37498584268894897,.11666617691804719]];
  assert.equal(sweepSphereTriangle(start,end,before,after,.0375-1.5e-8),null);
});
test('mixed runtime detects a complete sphere crossing with no endpoint overlap',()=>{
  const s=new MixedSimulation(contactSafetyExample());
  try{
    s.contactMotion.capture();const b=[...s.mpm.bodies.values()][0];
    b.rb.setTranslation({x:-.5,y:.2,z:0},true);
    assert.throws(()=>s.contactMotion.checkSwept(),e=>e.kind==='swept-contact'&&e.toi>0&&e.toi<1);
  }finally{s.free();}
});
test('disabled mechanical pairs are excluded from the swept runtime check',()=>{
  const p=contactSafetyExample();p.contactPairs.forEach(d=>d.mechanical=false);
  const s=new MixedSimulation(p);
  try{s.contactMotion.capture();[...s.mpm.bodies.values()][0].rb.setTranslation({x:-.5,y:.2,z:0},true);assert.equal(s.contactMotion.checkSwept(),0);}finally{s.free();}
});
