import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { MATERIALS } from '../src/materials.js';
import { exchangeHeat } from '../src/thermal.js';
const near=(a,b,t=1e-4)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
const energy=s=>s.snapshot().energy;

test('equal volume has density-dependent mass; equal energy obeys Q = m c ΔT',()=>{
  const s=new Simulation();s.add(0,0,2,0,0,20);s.add(30,0,5,0,0,20);
  near(s.mass[1]/s.mass[0],7.87);
  for(let i=0;i<2;i++)s.addHeat(i,9000);
  near(s.temperature[0]-20,9000/4180);near(s.temperature[1]-20,9000/(7.87*450));
});
test('isolated different-capacity samples approach the energy-weighted equilibrium',()=>{
  const s=new Simulation();s.add(0,0,2,0,0,20);s.add(4,0,5,0,0,90);
  const before=energy(s),c0=s.mass[0]*4180,c1=s.mass[1]*450,expected=(20*c0+90*c1)/(c0+c1);
  for(let n=0;n<5000;n++)exchangeHeat(s,[0,1,100],.05);
  near(energy(s),before,1e-5);near(s.temperature[0],expected,.001);near(s.temperature[1],expected,.001);
});
test('many contacts conserve energy without thermal overshoot; iron conducts faster than water',()=>{
  for(const mat of [2,5]){
    const s=new Simulation();s.add(0,0,mat,0,0,90);
    const pairs=[];for(let i=0;i<80;i++){s.add(i,0,mat,0,0,20);pairs.push(0,i+1,1000);}
    const before=energy(s);exchangeHeat(s,pairs,1);
    near(energy(s),before,.001);for(let i=0;i<s.count;i++)assert.ok(s.temperature[i]>=20 && s.temperature[i]<=90);
  }
  const drops=[];
  // Compare intrinsic conductivity below the explicit solver's stability cap.
  for(const mat of [2,5]){const s=new Simulation();s.settings.heatRate=1;s.add(0,0,mat,0,0,90);s.add(4,0,mat,0,0,20);exchangeHeat(s,[0,1,1],1);drops.push(90-s.temperature[0]);}
  assert.ok(drops[1]>20*drops[0]);
});
test('melting ice consumes fusion heat; metal melting removes connections and releases anchors',()=>{
  const s=new Simulation();s.add(0,0,4,0,0,0);const m=s.mass[0];
  s.addHeat(0,m*100000);near(s.temperature[0],0);assert.equal(s.material[0],4);
  s.addHeat(0,m*(234000+4180*5));near(s.temperature[0],5);assert.equal(s.material[0],2);near(s.mass[0],m);
  s.structures.create({x1:30,y1:0,x2:46,y2:0,material:7,fixed:true});
  const i=1;assert.equal(s.pinned[i],1);s.addHeat(i,s.mass[i]*(450*1600+247000));
  assert.equal(s.material[i],10);assert.equal(s.pinned[i],0);assert.ok(s.structures.edges.every(e=>e.a!==i && e.b!==i));
});
test('mass-aware contact and viscosity conserve linear momentum without external forces',()=>{
  const s=new Simulation();s.settings.gravity='none';s.settings.thermal=false;
  s.add(-1,0,2,0,0);s.add(1,0,5,0,0);
  const before=s.x[0]*s.mass[0]+s.x[1]*s.mass[1];s.step(1/120);
  near(s.x[0]*s.mass[0]+s.x[1]*s.mass[1],before,.0001);
  near(s.vx[0]*s.mass[0]+s.vx[1]*s.mass[1],0,.01);
});
test('density scene: iron settles at the bottom while ice stays near the water surface',()=>{
  const s=new Simulation();s.reset('density');s.settings.thermal=false;
  const startMass=s.snapshot().totalMass;
  for(let frame=0;frame<540;frame++)s.step();
  const mean=mat=>{let y=0,n=0;for(let i=0;i<s.count;i++)if(s.material[i]===mat){y+=s.y[i];n++;}return y/n;};
  assert.ok(mean(5)<-130);assert.ok(mean(4)>-80 && mean(4)<-25);assert.ok(mean(4)>mean(2)+20);
  near(s.snapshot().totalMass,startMass);
});
test('all material constants are positive and consistent',()=>{
  for(const m of MATERIALS)assert.ok(m.density>0 && m.cp>0 && m.conductivity>0);
});
test('phase conversion preserves the velocity of a freely moving parcel',()=>{
  const s=new Simulation();s.add(0,0,4,12,-7,0);const mass=s.mass[0];
  s.addHeat(0,mass*(334000+4180*20));assert.equal(s.material[0],2);
  assert.equal(s.vx[0],12);assert.equal(s.vy[0],-7);
  s.addHeat(0,mass*(4180*80+2256000+2010));assert.equal(s.material[0],3);
  assert.equal(s.vx[0],12);assert.equal(s.vy[0],-7);
});
