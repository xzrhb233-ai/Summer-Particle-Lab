import test from 'node:test';
import assert from 'node:assert/strict';
import {heatPairs,mechanicalPairs} from './gpu-pair-fixtures.mjs';
import {fromLegacy,toLegacy,editLegacyProject,removePart,normalizeSolverProject} from '../src/simulation/project.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {gripExample} from '../src/simulation/grip-example.js';
import {contactCSV} from '../src/simulation/contact-ui.js';
await initialize();
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('contact pairs roundtrip, survive other edits, and cascade with part deletion',()=>{
  const p=normalizeSolverProject(heatPairs());
  assert.deepEqual(fromLegacy(toLegacy(p)).contactPairs,p.contactPairs);
  assert.deepEqual(editLegacyProject(p,m=>m.gravity=[0,-1,0]).contactPairs,p.contactPairs);
  assert.equal(removePart(p,'cold').contactPairs.length,1);
  assert.equal(editLegacyProject(p,m=>m.coupling.parts=[]).contactPairs.length,0);
  for(const change of [p=>p.contactPairs.push({...p.contactPairs[0],id:'duplicate'}),p=>p.contactPairs[0].a='cold',p=>p.contactPairs[0].friction=-1,p=>p.contactPairs[0].b='missing',p=>p.contactPairs[0].thermal='yes']){
    const q=structuredClone(p);change(q);assert.throws(()=>toLegacy(q));
  }
});
test('conducting and adiabatic interfaces coexist with global conduction off',()=>{
  const s=new CoupledSimulation(toLegacy(heatPairs()));try{
    const before=s.bodyHeat.get('hot').energy;
    for(let k=0;k<48;k++)s.heatStep(1/480);s.lastDt=.1;
    const f=s.snapshot(),a=f.contactPairs.find(p=>p.id==='conducting'),b=f.contactPairs.find(p=>p.id==='insulated');
    assert.ok(a.heat<0);near(a.accumulatedHeat,s.bodyHeat.get('hot').energy-before,1e-7);
    assert.equal(b.heat,0);assert.equal(b.thermalSamples,0);
    for(let i=64;i<128;i++)near(s.particles.temperature[i],70,1e-5);
    near(f.coupling.thermalResidual,0,1e-6);assert.ok(s.particles.temperature[0]>20);
  }finally{s.free();}
});
test('shared grid nodes apply contact corrections only to the enabled part, with opposite rigid impulse',()=>{
  const s=new CoupledSimulation(toLegacy(mechanicalPairs()));try{
    const p=s.particles,mass=[...p.mass.slice(0,p.count)].reduce((a,b)=>a+b,0),initial=[-.3*mass,0,.2*mass];
    const f=s.step(1/480),body=f.bodies[0],sum=body.velocity.map(v=>v*2);
    for(let i=0;i<p.count;i++)for(const [a,k] of ['vx','vy','vz'].entries())sum[a]+=p.mass[i]*p[k][i]*.025;
    sum.forEach((v,k)=>near(v,initial[k],1e-6));
    for(let i=8;i<16;i++){near(p.vx[i]*.025,-.3);near(p.vz[i]*.025,.2);}
    const a=f.contactPairs[0],b=f.contactPairs[1];assert.ok(a.normalForce>0);assert.ok(Math.hypot(...a.tangentialForce)>0);
    assert.equal(b.normalForce,0);assert.equal(b.samples,0);assert.equal(b.maxPenetration,0);
    body.velocity.forEach((v,k)=>near(v*2,a.force[k]/480,1e-6));
  }finally{s.free();}
});
test('zero friction preserves tangential particle motion in a normal impact',()=>{
  const p=mechanicalPairs();p.contactPairs[0].friction=0;p.parts[0].boundary.motion='fixed';
  const s=new CoupledSimulation(toLegacy(p));try{
    const f=s.step(1/480);near(Math.hypot(...f.contactPairs[0].tangentialForce),0);
    for(let i=0;i<8;i++)near(s.particles.vz[i]*.025,.2);
  }finally{s.free();}
});
test('contact corrections remain compatible with APIC region attachments and CSV units',()=>{
  const p=gripExample(true);p.contactPairs=[{id:'clamp-contact',a:'right-clamp',b:'specimen',mechanical:true,thermal:false,friction:.4,contactConductance:0}];
  const s=new CoupledSimulation(toLegacy(p));try{
    for(let i=0;i<12;i++)s.step(1/480);
    const f=s.snapshot();assert.ok(f.particles.every(Number.isFinite));assert.ok(f.maxError<.002);
    const text=contactCSV([f]);assert.match(text,/fx_on_A_N/);assert.match(text,/cumulative_heat_into_A_J/);assert.match(text,/"clamp-contact"/);
    assert.equal(f.contactPairs[0].heat,0);
  }finally{s.free();}
});
