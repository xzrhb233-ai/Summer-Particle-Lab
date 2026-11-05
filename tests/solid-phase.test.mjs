import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { enthalpyAt } from '../src/thermal.js';

const width=s=>Math.max(...s.x.subarray(0,s.count))-Math.min(...s.x.subarray(0,s.count));
function block(s,mat,y=-535){for(let row=0;row<6;row++)for(let col=0;col<8;col++)s.add((col-4)*3.9,y+row*3.4,mat);}
function heatTo(s,mat,temp){for(let i=0;i<s.count;i++)s.addHeat(i,s.mass[i]*(enthalpyAt(mat,temp)-s.enthalpy[i]));}

test('rock holds its shape, melts into a spreading liquid, and freezes into the new shape',()=>{
  const s=new Simulation();s.settings.gravity='uniform';s.settings.thermal=false;block(s,0);
  const initialWidth=width(s),mass=s.snapshot().totalMass;
  for(let n=0;n<240;n++)s.step();
  assert.ok(Math.abs(width(s)-initialWidth)<.1,'cold rock must not flatten on the floor');
  assert.equal(s.snapshot().phases.solid,s.count);
  heatTo(s,1,1250);assert.ok(s.material.subarray(0,s.count).every(m=>m===1));
  assert.equal(s.structures.edges.length,0,'melting releases all solid bonds');
  for(let n=0;n<240;n++)s.step();assert.ok(width(s)>initialWidth*2,'molten rock must spread');
  heatTo(s,0,100);s.step();const frozenWidth=width(s);
  assert.ok(s.structures.edges.length>0);assert.ok(s.material.subarray(0,s.count).every(m=>m===0));
  for(let n=0;n<240;n++)s.step();assert.ok(Math.abs(width(s)-frozenWidth)<.1,'refrozen pool must stop flowing');
  assert.equal(s.snapshot().totalMass,mass);
});
test('water freezes into a free solid, then melts without being anchored',()=>{
  const s=new Simulation();s.settings.gravity='none';s.settings.thermal=false;block(s,2,0);
  heatTo(s,4,-15);s.step();assert.ok(s.structures.rigidGroups.length>0);
  const diagonal=Math.hypot(s.x[0]-s.x[47],s.y[0]-s.y[47]);
  // Apply an asymmetric load: a distance-only soft net can shear under this.
  for(let n=0;n<120;n++){s.vx[47]+=3;s.step();}
  assert.ok(Math.abs(Math.hypot(s.x[0]-s.x[47],s.y[0]-s.y[47])-diagonal)<.05);
  assert.ok(s.pinned.subarray(0,s.count).every(p=>p===0));
  heatTo(s,2,20);s.step();assert.equal(s.structures.edges.length,0);assert.equal(s.structures.rigidGroups.length,0);
  assert.ok(s.material.subarray(0,s.count).every(m=>m===2));
});
test('settling newly created solid grains form a body, but cut bonds do not heal',()=>{
  const s=new Simulation();s.settings.gravity='none';s.settings.thermal=false;
  s.add(-4,0,0,4,0);s.add(4,0,0,-4,0);
  for(let n=0;n<45;n++)s.step();assert.equal(s.structures.edges.length,1);
  s.structures.brush('cut',0,0,5);for(let n=0;n<30;n++)s.step();
  assert.equal(s.structures.edges.length,0);
});
test('the basin foundation holds the solid container while liquids move inside it',()=>{
  const s=new Simulation();s.reset('basin');const walls=[];
  for(let i=0;i<s.count;i++)if(s.material[i]===0)walls.push([i,s.x[i],s.y[i]]);
  for(let n=0;n<180;n++)s.step();
  for(const [i,x,y] of walls)if(s.material[i]===0)assert.ok(Math.hypot(s.x[i]-x,s.y[i]-y)<.1);
  assert.ok(s.snapshot().phases.liquid>1000);
});
test('high-power cooling solidifies water without cooling below absolute zero',()=>{
  const s=new Simulation();s.add(0,0,2);s.settings.brushPower=5000000;
  s.setPointer({active:true,tool:'cool',x:0,y:0,radius:24});
  for(let n=0;n<30;n++)s.interact(1/30);
  assert.equal(s.material[0],4);assert.ok(s.temperature[0]>=-273.151 && s.temperature[0]<-273.14);
});
