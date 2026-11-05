import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
import {phaseParameters,phaseEnthalpy,decodePhase} from '../src/three/phase-change.js';
import {exchangeHeat} from '../src/thermal.js';
import {identity} from '../src/three/math.js';
const phase={enabled:true,meltingPoint:120,latentHeat:120000};
function create(T=110,model=10,enabled=true){
  const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;
  assert.ok(s.box([-4,0,-4],[4,8,4],11,false,T,model,.025,35,'box','',[0,0,0],{},{},{},{},{...phase,enabled}));return s;
}
test('custom enthalpy includes latent heat and switches only at complete melting/freezing',()=>{
  const p=phaseParameters(phase),start=216000,end=336000;
  assert.equal(phaseEnthalpy(180,p),444000);
  assert.deepEqual(decodePhase((start+end)/2,false,p),{liquid:false,temperature:120});
  assert.deepEqual(decodePhase((start+end)/2,true,p),{liquid:true,temperature:120});
  assert.deepEqual(decodePhase(start,true,p),{liquid:false,temperature:120});
  assert.deepEqual(decodePhase(end,false,p),{liquid:true,temperature:120});
  assert.equal(create(180,10,false).snapshot().liquids,0);
});
test('heat and cool brushes perform reversible solver switching without stale MPM stress',()=>{
  const s=create(),i=0,m=s.mass[i],x=[s.x[i],s.y[i],s.z[i]],model=s.model[i],h=s.enthalpy[i];
  s.pin(i,true);s.mpm.F[i*9]=1.2;s.mpm.C[i*9]=9;s.mpm.plastic[i]=.4;
  let strokes=0;while(!s.melted[i]&&strokes<20){s.brush('heat',x,.01);strokes++;}
  assert.ok(s.melted[i]);assert.equal(s.model[i],model);assert.equal(s.pinned[i],0);assert.equal(s.invMass[i],1/m);
  assert.deepEqual(Array.from(s.mpm.F.slice(0,9)),identity());assert.equal(s.mpm.plastic[i],0);assert.ok(s.mpm.C.slice(0,9).every(v=>v===0));
  assert.ok(Math.abs(m*(s.enthalpy[i]-h)-strokes*500000/30)<1e-8);
  const liquidPosition=[s.x[i],s.y[i],s.z[i]];s.mpm.step(s,.001);assert.deepEqual([s.x[i],s.y[i],s.z[i]],liquidPosition);
  strokes=0;while(s.melted[i]&&strokes<30){s.brush('cool',x,.01);strokes++;}
  assert.equal(s.melted[i],0);assert.equal(s.model[i],model);assert.equal(s.mass[i],m);assert.deepEqual(Array.from(s.mpm.F.slice(0,9)),identity());
});
test('fully molten custom material runs PBF density correction and deposits no MPM grid mass',()=>{
  const s=create(180,11),n=s.count;
  assert.equal(s.snapshot().liquids,n);assert.equal(s.snapshot().solids,0);assert.equal(s.snapshot().models[11],0);
  for(let i=0;i<n;i++){s.x[i]*=.4;s.z[i]*=.4;s.y[i]=4+(s.y[i]-4)*.4;}
  s.mpm.step(s,.001);assert.equal(s.mpm.mass.reduce((a,b)=>a+b),0);
  const width=Math.max(...s.x.slice(0,n))-Math.min(...s.x.slice(0,n)),before=s.snapshot();s.step();
  assert.ok(Math.max(...s.x.slice(0,n))-Math.min(...s.x.slice(0,n))>width);
  assert.equal(s.snapshot().mass,before.mass);assert.equal(s.snapshot().energy,before.energy);
  assert.ok(s.snapshot().data.every(Number.isFinite));assert.equal(s.snapshot().data[3],23);
});
test('contact heat melts custom material while conserving total enthalpy and mass',()=>{
  const s=create(110),p=s.phaseMaterials[1];s.enthalpy[1]=phaseEnthalpy(500,p);s.phaseTransition(1);
  const before=s.snapshot();s.settings.heatRate=1000;
  for(let k=0;k<30;k++)exchangeHeat(s,[0,1,.5],1);
  assert.equal(s.melted[0],1);assert.equal(s.melted[1],1);
  assert.ok(Math.abs(s.snapshot().energy-before.energy)<1e-7);assert.equal(s.snapshot().mass,before.mass);
});
test('phase parameters validate atomically; deletion and reset retain the right phase ownership',()=>{
  for(const value of [null,[],{enabled:1},{meltingPoint:NaN},{latentHeat:0},{latentHeat:Infinity},{unknown:1}]){
    assert.equal(phaseParameters(value),null);const s=new Simulation3();
    assert.equal(s.box([0,0,0],[4,4,4],11,false,20,0,.025,35,'box','',[0,0,0],{},{},{},{},value),false);assert.equal(s.count,0);assert.equal(s.lab.nextId,1);
  }
  const s=create();assert.ok(s.box([20,0,0],[24,4,4],11,false,180,11,.025,35,'box','',[0,0,0],{},{},{},{},phase));
  s.remove(0);assert.equal(s.lab.part[0],2);assert.equal(s.melted[0],1);assert.equal(s.model[0],11);
  s.reset('empty');s.add(0,0,0,11,180,10);assert.equal(s.melted[0],0);assert.equal(s.isSolid(0),true);
});
test('melting preset has cold MPM and hot PBF; hot samples spread without elastic memory',()=>{
  const s=new Simulation3();s.reset('melting');s.settings.thermal=false;const before=s.snapshot();
  assert.equal(before.solids,1078);assert.equal(before.liquids,1078);
  const part=2,width=()=>{const xs=[];for(let i=0;i<s.count;i++)if(s.lab.part[i]===part)xs.push(s.x[i]);return Math.max(...xs)-Math.min(...xs);},initial=width();
  for(let k=0;k<120;k++)s.step();
  const after=s.snapshot();assert.ok(after.data.every(Number.isFinite));assert.equal(after.mass,before.mass);assert.equal(after.energy,before.energy);assert.ok(width()>initial+5);
  for(let i=0;i<s.count;i++)if(s.melted[i]){assert.equal(s.mpm.stress[i],0);assert.equal(s.mpm.plastic[i],0);}
});
