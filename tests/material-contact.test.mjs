import test from 'node:test';
import assert from 'node:assert/strict';
import {blocks,measures,attachedMulti} from './material-contact-fixtures.mjs';
import {toLegacy,fromLegacy,editLegacyProject,removePart} from '../src/simulation/project.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {initialize} from '../src/multibody/engine.js';
await initialize();
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('MPM pairs validate unordered uniqueness and survive project edits',()=>{
  const p=blocks();assert.deepEqual(fromLegacy(toLegacy(p)).contactPairs,p.contactPairs);
  assert.equal(editLegacyProject(p,m=>m.gravity=[0,-1,0]).contactPairs.length,1);
  assert.equal(removePart(p,'b').contactPairs.length,0);
  p.contactPairs.push({...p.contactPairs[0],id:'reverse',a:'b',b:'a'});assert.throws(()=>toLegacy(p),/同一部件/);
});
test('disabled contact preserves different velocities on overlapping grid stencils',()=>{
  const s=new CoupledSimulation(toLegacy(blocks({mechanical:false})));try{
    const initial=measures(s);for(let k=0;k<8;k++)s.step(1/480);
    const final=measures(s);final.velocities.forEach((v,i)=>near(v,initial.velocities[i],1e-5));
    assert.equal(s.snapshot().contactPairs[0].normalForce,0);
  }finally{s.free();}
});
test('positive gap and separating blocks do not receive contact impulses',()=>{
  for(const separating of [false,true]){
    // Sampling uses world-grid cell centers; exceed one spacing so the
    // generated particle domains (not merely the nominal boxes) have a gap.
    const p=blocks({gap:separating?0:.06});
    if(separating)p.parts.forEach(p=>p.initial.velocity=p.initial.velocity.map(x=>-x));
    const s=new CoupledSimulation(toLegacy(p));try{
      const f=s.step(1/480);near(f.contactPairs[0].normalForce,0);
    }finally{s.free();}
  }
});
test('unequal-density blocks exchange opposite impulses without tangential sticking at zero friction',()=>{
  const s=new CoupledSimulation(toLegacy(blocks()));try{
    const initial=measures(s);let peak=0;
    for(let k=0;k<96;k++){
      const f=s.step(1/480);peak=Math.max(peak,f.contactPairs[0].normalForce);
      measures(s).momentum.forEach((v,i)=>near(v,initial.momentum[i],2e-5));
      measures(s).angular.forEach((v,i)=>near(v,initial.angular[i],2e-5));
      near(Math.hypot(...f.contactPairs[0].tangentialForce),0,1e-9);
    }
    assert.ok(peak>1);assert.ok(s.snapshot().particles.every(Number.isFinite));
  }finally{s.free();}
});
test('MPM interface heat is conservative, sign-correct, independently switchable',()=>{
  for(const reverse of [false,true]){
    const p=blocks({gap:0,thermal:true,mechanical:false});
    if(reverse)[p.contactPairs[0].a,p.contactPairs[0].b]=['b','a'];
    const s=new CoupledSimulation(toLegacy(p));try{
      const before=measures(s);
      for(let k=0;k<24;k++)s.heatStep(1/480);
      const after=measures(s),f=s.snapshot(),energy=after.energy[reverse?1:0]-before.energy[reverse?1:0];
      near(f.contactPairs[0].accumulatedHeat,energy,1e-5);assert.ok(Math.abs(energy)>1);
      near(f.coupling.thermalResidual,0,1e-5);
    }finally{s.free();}
  }
  const p=blocks({gap:0,thermal:false,mechanical:false});p.couplings[0].thermal=true;
  const s=new CoupledSimulation(toLegacy(p));try{
    const before=measures(s);for(let k=0;k<24;k++)s.heatStep(1/480);
    measures(s).energy.forEach((v,i)=>near(v,before.energy[i],1e-5));assert.equal(s.snapshot().contactPairs[0].heat,0);
  }finally{s.free();}
});
test('fixed supports apply to their own material grid only',()=>{
  const p=blocks({gap:0,fixed:true,mechanical:false});const s=new CoupledSimulation(toLegacy(p));
  try{const initial=measures(s);s.step(1/480);measures(s).velocities.forEach((v,i)=>near(v,initial.velocities[i],1e-5));}finally{s.free();}
});
test('region attachments remain active next to a separately fixed MPM part',()=>{
  const s=new CoupledSimulation(toLegacy(attachedMulti()));try{
    for(let k=0;k<24;k++)s.step(1/480);
    const f=s.snapshot();assert.ok(f.maxError<.002);
    const region=f.joints.find(j=>j.id==='right-grip');assert.equal(region.state,'active');
    assert.ok(Math.hypot(...region.torque)>.01);assert.equal(f.contactPairs[0].normalForce,0);
  }finally{s.free();}
});
