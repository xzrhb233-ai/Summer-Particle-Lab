import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { solidStress } from '../src/solid-mpm.js';

function empty(){const s=new Simulation();s.reset('empty');Object.assign(s.settings,{gravity:'none',thermal:false,boundary:false});return s;}
const width=s=>Math.max(...s.x.subarray(0,s.count))-Math.min(...s.x.subarray(0,s.count));

test('elastic constitutive law is stress free under rotation and resists shear',()=>{
  const theta=.7,c=Math.cos(theta),sn=Math.sin(theta);
  for(const tau of [solidStress(1,0,0,1,400,400),solidStress(c,-sn,sn,c,400,400)])assert.ok(tau.every(x=>Math.abs(x)<1e-10));
  const shear=solidStress(1,.3,0,1,400,400);assert.ok(shear[1]>0);assert.ok(Math.abs(shear[1]-shear[2])<1e-10);
  assert.ok(solidStress(1.2,0,0,1,400,400)[0]>0);
});
test('MPM ignores liquid particles entirely; pure liquids retain PBF behavior',()=>{
  const s=empty();for(let x=0;x<6;x++)s.add(x*3.5,0,2,3,-2);
  const x=Array.from(s.x.subarray(0,s.count)),vx=Array.from(s.vx.subarray(0,s.count));
  s.mpm.step(s,.001);assert.deepEqual(Array.from(s.x.subarray(0,s.count)),x);assert.deepEqual(Array.from(s.vx.subarray(0,s.count)),vx);
  assert.equal(s.mpm.hasParticles(s),false);assert.equal(s.mpm.stats(s).count,0);
  let calls=0;const density=s.solveDensity.bind(s);s.solveDensity=()=>{calls++;density();};s.step();assert.ok(calls>0);
});
test('created MPM solid has no springs or rigid groups and preserves uniform translation',()=>{
  const s=empty();assert.ok(s.structures.create({x1:-15,y1:-15,x2:15,y2:15,material:11,shape:'panel'}));
  s.buildGrid();s.flushBonds();assert.equal(s.structures.edges.length,0);assert.equal(s.structures.rigidGroups.length,0);
  for(let i=0;i<s.count;i++){s.vx[i]=7;s.vy[i]=-3;}
  s.mpm.step(s,.001);
  for(let i=0;i<s.count;i++){assert.ok(Math.abs(s.vx[i]-7)<1e-6);assert.ok(Math.abs(s.vy[i]+3)<1e-6);}
  assert.ok(s.mpm.stats(s).strain<1e-10);
});
test('stretched solid develops restoring stress and contracts after release',()=>{
  const s=empty();s.structures.create({x1:-18,y1:-18,x2:18,y2:18,material:11,shape:'panel'});
  const reference=width(s);
  for(let i=0;i<s.count;i++){s.x[i]*=1.25;s.mpm.f00[i]=1.25;}
  const stretched=width(s);let min=Infinity,maxSpeed=0;
  for(let t=0;t<120;t++){s.step();min=Math.min(min,width(s));for(let i=0;i<s.count;i++)maxSpeed=Math.max(maxSpeed,Math.abs(s.vx[i]));}
  assert.ok(min<reference*1.1 && min<stretched*.9);assert.ok(maxSpeed>1);
  assert.equal(s.structures.edges.length,0);assert.equal(s.structures.rigidGroups.length,0);
  assert.ok(s.mpm.stats(s).minJ>0);
});
test('MPM dragging deforms an anchored body and releasing permits recoil',()=>{
  const s=empty();s.structures.create({x1:-60,y1:0,x2:25,y2:25,material:11,shape:'panel',fixed:true});
  const pins=[];for(let i=0;i<s.count;i++)if(s.pinned[i])pins.push([i,s.x[i],s.y[i]]);
  const tip=23,initial=s.y[tip];
  s.setPointer({active:true,tool:'drag',x:22,y:12,radius:18});s.setPointer({x:22,y:55});
  for(let t=0;t<120;t++)s.step();const loaded=s.y[tip],strain=s.mpm.stats(s).strain;
  assert.ok(loaded>initial+8,`tip rises: ${loaded-initial}`);assert.ok(strain>.05);
  s.setPointer({active:false});let min=Infinity;
  for(let t=0;t<180;t++){s.step();min=Math.min(min,s.y[tip]);}
  assert.ok(min<loaded-5,`elastic recoil: ${loaded} -> ${min}`);
  for(const [i,x,y] of pins)assert.ok(Math.hypot(s.x[i]-x,s.y[i]-y)<1e-5);
});
test('soft body and PBF water remain bounded, exchange heat, and preserve mass',()=>{
  const s=new Simulation();s.reset('softbody');const initial=s.snapshot();
  for(let i=0;i<s.count;i++)if(s.material[i]===11)s.addHeat(i,s.mass[i]*1800*40);
  const energy=s.snapshot().energy;
  for(let t=0;t<600;t++)s.step();
  const snap=s.snapshot();assert.equal(snap.totalMass,initial.totalMass);assert.ok(Math.abs(snap.energy-energy)<energy*1e-10);
  assert.ok(snap.materialTemps[2]>18);assert.ok(snap.materialTemps[11]<60);
  assert.ok(snap.mpm.minJ>0 && Number.isFinite(snap.mpm.strain));assert.equal(s.structures.edges.length,0);
  for(let i=0;i<s.count;i++){assert.ok(Number.isFinite(s.x[i]+s.y[i]+s.vx[i]+s.vy[i]));assert.ok(Math.abs(s.x[i])<=170 && Math.abs(s.y[i])<=145);}
});
test('delete, reuse and reset preserve deformation indices; creation is atomic at capacity',()=>{
  const s=empty();s.add(0,0,11);s.add(5,0,11);s.mpm.f01[1]=.3;s.removeAt(0);assert.equal(s.mpm.f01[0],.3);
  s.add(10,0,11);assert.equal(s.mpm.f01[1],0);assert.equal(s.mpm.f00[1],1);
  s.count=s.x.length-2;assert.equal(s.structures.create({x1:0,y1:0,x2:20,y2:20,material:11,shape:'panel'}),false);assert.equal(s.count,s.x.length-2);
  s.reset('empty');assert.equal(s.mpm.f01[0],0);assert.equal(s.mpm.f00[0],1);
});
