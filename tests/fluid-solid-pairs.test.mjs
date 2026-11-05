import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyProject,addProjectPart} from '../src/simulation/part-builder.js';
import {toLegacy,fromLegacy,removePart} from '../src/simulation/project.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {contactCSV} from '../src/simulation/contact-ui.js';
await initialize();
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
function project(){
  let p=emptyProject();p.environment.gravity=[0,0,0];
  p.discretization.mpm={lower:[-1.2,-.3,-.9],upper:[1.2,1.5,.9],cellSize:.15,particlesPerAxis:2};
  for(const [id,method,x,T] of [['solid','mpm',-.075,100],['water','pbf',.075,20],['other','pbf',.6,20]])
    p=addProjectPart(p,{id,method,geometry:{center:[x,.6,0],size:[.15,.15,.15]},initial:{temperature:T}});
  return p;
}
function sim(edit=()=>{}){const p=project();edit(p);return new CoupledSimulation(toLegacy(p));}
function pressure(s){
  const p=s.particles;p.energySafePressure=false;p.buildGrid();p.pairs=[];
  for(let i=0;i<p.count;i++)p.near(i,j=>{if(j>i&&(!p.isSolid(i)||!p.isSolid(j))&&p.particlePairAllowed(i,j))p.pairs.push(i,j);});
  p.density(.001);
}
test('MPM–PBF authoring roundtrips, supports reversal, rejects duplicate and unsupported friction',()=>{
  const p=project();assert.equal(p.contactPairs.length,2);assert.equal(p.contactPairs[0].friction,0);
  assert.deepEqual(fromLegacy(toLegacy(p)).contactPairs,p.contactPairs);
  assert.equal(removePart(p,'solid').contactPairs.length,0);
  const q=structuredClone(p);[q.contactPairs[0].a,q.contactPairs[0].b]=[q.contactPairs[0].b,q.contactPairs[0].a];toLegacy(q);
  q.contactPairs.push({...q.contactPairs[0],id:'duplicate',a:'solid',b:'water'});assert.throws(()=>toLegacy(q),/同一/);
  p.contactPairs[0].friction=.2;assert.throws(()=>toLegacy(p),/自由滑移/);
});
test('pressure pair reports its momentum transfer, reversed orientation flips force; disabling isolates the pair',()=>{
  const run=(enabled,reverse=false)=>{const s=sim(p=>{p.contactPairs[0].mechanical=enabled;if(reverse)[p.contactPairs[0].a,p.contactPairs[0].b]=[p.contactPairs[0].b,p.contactPairs[0].a];});
    try{
      const p=s.particles;for(let i=0;i<p.count;i++)if(p.lab.part[i]<3){p.x[i]*=.4;p.y[i]=24+(p.y[i]-24)*.4;p.z[i]*=.4;}
      const before=['x','y','z'].map(k=>p[k].slice(0,p.count));
      pressure(s);const r=s.pairContacts.results(.001)[0],sum=[0,0,0];
      for(let i=0;i<p.count;i++)if(p.lab.part[i]===1)for(const [k,v] of ['x','y','z'].entries())sum[k]+=p.mass[i]*(p[v][i]-before[k][i])*.025/.001;
      for(let k=0;k<3;k++)close(r.force[k]*.001*(reverse?-1:1),sum[k]);
      r.force.forEach((v,k)=>close(v*.001,r.totalImpulse[k]));
      s.pairContacts.begin();assert.deepEqual(s.pairContacts.results(.001)[0].totalImpulse,r.totalImpulse);
      assert.equal(s.pairContacts.results(.001)[1].normalForce,0);
      return r;
    }finally{s.free();}};
  const on=run(true),off=run(false),reverse=run(true,true);
  assert.ok(on.normalForce>0);assert.equal(off.normalForce,0);on.force.forEach((v,k)=>close(v,-reverse.force[k]));
  assert.equal(on.maxPenetration,null);assert.match(contactCSV([{time:.001,contactPairs:[on]}]),/contact-1/);
});
test('heat and mechanics are independent, signed heat matches both parts and disabling is adiabatic',()=>{
  for(const enabled of [true,false])for(const reverse of [true,false]){
    const s=sim(p=>{p.couplings[0].thermal=false;p.contactPairs[0].mechanical=false;p.contactPairs[0].thermal=enabled;if(reverse)[p.contactPairs[0].a,p.contactPairs[0].b]=[p.contactPairs[0].b,p.contactPairs[0].a];});
    try{
      const p=s.particles,energy=()=>Array.from({length:p.count},(_,i)=>p.lab.part[i]===1?p.mass[i]*p.enthalpy[i]:0).reduce((a,b)=>a+b,0),before=energy(),total=s.totalThermal();
      s.heatStep(.01);const r=s.pairContacts.results(.01)[0];
      close(energy()-before,r.heat*(reverse?-1:1),1e-6);close(s.totalThermal(),total,1e-6);
      assert.equal(s.pairContacts.results(.01)[1].heat,0);
      if(enabled)assert.ok(Math.abs(r.heat)>0);else assert.equal(r.heat,0);
      close(r.heat,r.accumulatedHeat);s.pairContacts.begin();close(s.pairContacts.results(.01)[0].heat,0);close(s.pairContacts.results(.01)[0].accumulatedHeat,r.heat);
    }finally{s.free();}
  }
});
