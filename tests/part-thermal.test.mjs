import test from 'node:test';
import assert from 'node:assert/strict';
import {femThermalExample,mpmPartThermalExample} from '../src/simulation/part-thermal-example.js';
import {normalizeSolverProject,editLegacyProject,removePart,toLegacy} from '../src/simulation/project.js';
import {attachParticleThermalLoads} from '../src/simulation/thermal-ports.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {impactProject} from '../src/fem/model.js';
import {recover} from '../src/fem/solver.js';
import {editFEMRigids} from '../src/fem/rigid-editor.js';
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);
await initialize();
function fem(){const p=femThermalExample();p.parts[0].discretization.divisions=[2,1,1];p.loads=p.loads.filter(l=>!l.type.startsWith('thermal-'));p.parts[0].material.expansion=0;return p;}
function mpm(){const p=mpmPartThermalExample();p.discretization.mpm.cellSize=.1;p.couplings[0].thermal=false;p.loads.find(l=>l.id==='part-heater').power=5000;p.loads=p.loads.filter(l=>l.id!=='part-cooling');return normalizeSolverProject(p);}

test('FEM power obeys mass and heat capacity; actual heat balances exactly',()=>{
  const p=fem();p.loads.push({id:'heat',type:'thermal-power',target:'beam',region:{type:'whole'},power:123,enabled:true});
  const s=new FEMDynamicSimulation(p);s.thermal.step(.2);const f=s.snapshot(),mass=p.parts[0].geometry.size.reduce((a,b)=>a*b,2700);
  for(const T of f.fem.parts[0].temperature)near(T,20+123*.2/(mass*900));near(f.thermal.externalHeat,24.6);near(f.thermal.residual,0);
});
test('FEM closed conduction conserves heat and respects temperature bounds',()=>{
  const s=new FEMDynamicSimulation(fem()),t=s.states[0].thermal;t.temperature[0]=120;const start=s.thermal.energy();
  for(let i=0;i<20;i++)s.thermal.step(.1);
  near(s.thermal.energy(),start);assert.ok(t.temperature.every(T=>T>=20&&T<120));assert.ok(t.temperature[0]<120);
});
test('FEM prescribed end temperatures converge to the analytical linear rod profile',()=>{
  const p=femThermalExample();p.parts[0].discretization.divisions=[4,2,2];p.parts[0].material.expansion=0;
  const s=new FEMDynamicSimulation(p);for(let i=0;i<200;i++)s.thermal.step(1);
  const st=s.states[0];st.mesh.nodes.forEach((x,n)=>near(st.thermal.temperature[n],100-80*x[0]/.08,2e-5));near(s.thermal.snapshot(1).residual,0,1e-6);
});
test('thermal eigenstrain gives zero stress for free affine expansion and compressive stress if clamped',()=>{
  const p=fem();p.parts[0].material.expansion=1e-5;const s=new FEMDynamicSimulation(p).states[0],T=new Float64Array(s.mesh.nodes.length).fill(100),u=new Float64Array(s.u.length);
  s.mesh.nodes.forEach((x,n)=>x.forEach((v,k)=>u[3*n+k]=v*80e-5));
  const free=recover(s.mesh,s.A,u,T,s.part.material);for(const stress of free.stress)for(const v of stress)near(v,0,1e-7);
  const fixed=recover(s.mesh,s.A,new Float64Array(u.length),T,s.part.material),expected=-(3*s.A.lambda+2*s.A.mu)*80e-5;
  for(const stress of fixed.stress)for(let k=0;k<3;k++)near(stress[k],expected,1e-7);
});
test('hot rigid body transfers opposite heat to FEM only while touching',()=>{
  const p=impactProject();p.solver.thermal=true;p.parts[0].discretization.divisions=[2,1,1];
  const b=p.parts[1];b.initial.velocity=[0,0,0];b.initial.temperature=150;b.geometry.center[1]=1.07;b.material.conductivity=50;
  Object.assign(p.contactPairs[0],{mechanical:false,thermal:true,contactConductance:1000,thermalArea:.01});
  const s=new FEMDynamicSimulation(p),r=s.contacts.bodies[0],old=r.energy;s.thermal.step(1);const heat=s.contacts.pairs[0].accumulatedHeat;
  assert.ok(heat<0);near(r.energy-old,heat);near(s.thermal.snapshot(1).residual,0,1e-6);assert.ok(s.states[0].thermal.temperature.some(T=>T>20));
  r.x[1]+=.001;const before=r.energy;s.thermal.step(1);near(r.energy,before);
});
test('FEM thermal work enters the mechanical ledger and failed intervals restore temperatures',()=>{
  const p=femThermalExample();p.parts[0].discretization.divisions=[2,1,1];const s=new FEMDynamicSimulation(p),f=s.step(.005);
  assert.ok(f.fem.dynamics.thermalWork>0);assert.ok(f.fem.parts[0].summary.maxDisplacement>0);near(f.thermal.residual,0,1e-6);
  const before=s.snapshot(),value=s.states[0].A.values[0];s.states[0].A.values[0]=NaN;assert.throws(()=>s.step(.001));s.states[0].A.values[0]=value;assert.deepEqual(s.snapshot(),before);
});
test('MPM receives target-only power as enthalpy with correct cp, then a physical step retains the ledger',()=>{
  const p=mpm(),s=new CoupledSimulation(toLegacy(p));try{
    const loads=attachParticleThermalLoads(p,s),points=s.particles,selected=loads.items[0].entries,total=selected.reduce((m,e)=>m+e.weight,0);s.externalHeat+=loads.step(.2);
    for(const e of selected)near(e.temperature(),20+1000/(total*1800),1e-5);
    for(let i=0;i<points.count;i++)if(points.lab.part[i]===2)near(points.temperature[i],20);
    near(s.snapshot().coupling.thermalResidual,0,1e-5);s.step(1/480);const frame=s.snapshot();assert.ok(frame.thermalLoads[0].heat>1000);near(frame.coupling.thermalResidual,0,1e-5);
  }finally{s.free();}
});
test('MPM prescribed temperatures melt and refreeze through existing enthalpy phase logic',()=>{
  const p=mpm();p.loads=[{id:'temperature',type:'thermal-temperature',target:'heated',region:{type:'whole'},temperature:2000,enabled:true}];
  const s=new CoupledSimulation(toLegacy(p));try{const l=attachParticleThermalLoads(p,s),points=s.particles;l.step(.1);
    assert.ok(l.items[0].entries.every(e=>points.melted[e.index]===1));l.items[0].definition.temperature=-20;l.step(.1);assert.ok(l.items[0].entries.every(e=>points.melted[e.index]===0));
  }finally{s.free();}
});
test('MPM face selection follows particles; conflicting thermostats are rejected',()=>{
  const p=mpm();p.loads.find(l=>l.id==='part-heater').region={type:'face',face:'x+'};const s=new CoupledSimulation(toLegacy(p));try{const l=attachParticleThermalLoads(p,s),ids=l.descriptors()[0].entries.map(e=>e.index);assert.ok(ids.length<s.particles.count/2);
    for(const i of ids)s.particles.x[i]-=10;l.step(.1);assert.deepEqual(l.descriptors()[0].entries.map(e=>e.index),ids);assert.ok(ids.every(i=>s.particles.temperature[i]>20));
    p.loads=[1,2].map((n)=>({id:'t'+n,type:'thermal-temperature',target:'heated',region:{type:'whole'},temperature:20*n,enabled:true}));assert.throws(()=>attachParticleThermalLoads(p,s),/两个/);
  }finally{s.free();}
});
test('thermal boundaries survive legacy editing and round trips and are removed with their target',()=>{
  const p=mpm(),edited=editLegacyProject(p,m=>m.name='edited'),copy=normalizeSolverProject(JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(copy.loads,p.loads);assert.ok(!removePart(copy,'heated').loads.some(l=>l.target==='heated'));
});

test('MPM whole-body convection matches a finite heat-capacity exponential response',()=>{
  const p=mpm();p.loads=[{id:'ambient',type:'thermal-convection',target:'heated',region:{type:'whole'},temperature:100,coefficient:200,enabled:true}];
  const s=new CoupledSimulation(toLegacy(p));try{const l=attachParticleThermalLoads(p,s),mass=l.items[0].entries.reduce((m,e)=>m+e.weight,0);s.externalHeat+=l.step(.5);
    const expected=100-80*Math.exp(-200*.24*.5/(mass*1800));for(const e of l.items[0].entries)near(e.temperature(),expected,1e-7);near(s.snapshot().coupling.thermalResidual,0,1e-6);
  }finally{s.free();}
});
test('MPM shared power fills latent heat before liquid handoff without a velocity impulse',()=>{
  const p=mpm(),s=new CoupledSimulation(toLegacy(p));try{const l=attachParticleThermalLoads(p,s),es=l.items[0].entries,mass=es.reduce((m,e)=>m+e.weight,0);
    l.items[0].definition.power=mass*(1800*40+1000);l.step(1);
    for(const e of es){near(e.temperature(),60);assert.equal(s.particles.melted[e.index],0);}
    l.items[0].definition.power=mass*2000;l.step(1);
    for(const e of es){assert.equal(s.particles.melted[e.index],1);near(s.particles.vx[e.index],0);near(s.particles.vy[e.index],0);near(s.particles.vz[e.index],0);}
  }finally{s.free();}
});
test('deleting a FEM rigid heat receiver removes its boundary definitions',()=>{
  const p=impactProject();p.solver.thermal=true;p.loads.push({id:'hot-ball',type:'thermal-temperature',target:'impactor',region:{type:'whole'},temperature:150,enabled:true});
  const next=editFEMRigids(p,m=>m.bodies=[]);assert.ok(!next.loads.some(l=>l.target==='impactor'));assert.doesNotThrow(()=>new FEMDynamicSimulation(next));
});
