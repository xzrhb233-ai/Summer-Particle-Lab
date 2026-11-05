import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {contactSqueezeExample} from '../src/simulation/contact-squeeze-example.js';
await initialize();

function measure(s){
  let kinetic=0;const momentum=[0,0,0];
  for(const b of s.mpm.bodies.values()){
    const v=b.rb.linvel();kinetic+=.5*b.definition.mass*(v.x*v.x+v.y*v.y+v.z*v.z);
    [v.x,v.y,v.z].forEach((v,k)=>momentum[k]+=v*b.definition.mass);
  }
  for(const f of s.fem.states)for(let i=0;i<f.v.length;i++){kinetic+=.5*f.m[i]*f.v[i]**2;momentum[i%3]+=f.m[i]*f.v[i];}
  return {kinetic,momentum};
}
test('simultaneous opposing sphere contacts conserve impulse without increasing kinetic energy',()=>{
  const s=new MixedSimulation(contactSqueezeExample());
  try{
    s.fem.states[0].fixed.fill(0);
    for(const [id,b] of s.mpm.bodies)b.rb.setTranslation({x:id==='left'?-.139:.139,y:.55,z:0},true);
    const before=measure(s);s.contacts.begin(.001);s.contacts.mechanical();const after=measure(s);
    assert.ok(after.kinetic<=before.kinetic+1e-7);
    before.momentum.forEach((x,k)=>assert.ok(Math.abs(x-after.momentum[k])<2e-6));
    const pairs=s.contacts.results();assert.equal(pairs.length,2);assert.ok(pairs.every(p=>p.normalForce>0));
    assert.ok(s.contacts.exchanges.snapshot().pairs.every(p=>Math.abs(p.workResidual)<1e-6));
  }finally{s.free();}
});
test('two-sided squeeze integrates without crossing the plate and conserves exchanged heat',()=>{
  const s=new MixedSimulation(contactSqueezeExample());
  try{
    let peak=0;for(let i=0;i<6;i++){const f=s.step(.01);peak=Math.max(peak,...f.contactPairs.map(p=>p.normalForce));assert.ok(Math.abs(f.thermal.residual)<1e-6);assert.equal(f.mixed.clock.maxDrift,0);}
    const f=s.snapshot(),left=f.bodies.find(b=>b.id==='left'),right=f.bodies.find(b=>b.id==='right');
    assert.ok(peak>0);assert.ok(left.position[0]<-.09&&right.position[0]>.09);
    assert.ok(f.fem.parts[0].summary.maxDisplacement<.01);
    assert.ok(f.contactPairs.find(p=>p.a==='left'&&p.b==='plate').accumulatedHeat<0);
  }finally{s.free();}
});
