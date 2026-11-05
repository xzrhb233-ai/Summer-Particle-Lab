import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.js';
import { enthalpyAt } from '../src/thermal.js';

function groupEnergy(s,start=0,end=s.count){let e=0;for(let i=start;i<end;i++)e+=s.mass[i]*s.enthalpy[i];return e;}
function movingWater(enabled,rate=20){
  const s=new Simulation();s.settings.gravity='none';s.settings.thermal=enabled;s.settings.heatRate=rate;
  for(const [cx,v,t] of [[-18,6,80],[18,-6,20]])for(let row=0;row<5;row++)for(let col=0;col<4;col++)s.add(cx+col*3.9,row*3.4,2,v,0,t);
  return s;
}
test('moving hot/cold fluid exchanges heat only after contact and conserves total enthalpy',()=>{
  for(const enabled of [true,false]){
    const s=movingWater(enabled),hot=groupEnergy(s,0,20),cold=groupEnergy(s,20),total=groupEnergy(s);
    for(let n=0;n<20;n++)s.step();
    assert.ok(Math.abs(groupEnergy(s,0,20)-hot)<.001,'separated fluid must not exchange heat');
    for(let n=20;n<300;n++)s.step();
    const loss=hot-groupEnergy(s,0,20),gain=groupEnergy(s,20)-cold;
    if(enabled){assert.ok(loss>10000,`hot fluid loss: ${loss}`);assert.ok(gain>10000);}
    else {assert.ok(Math.abs(loss)<.001);assert.ok(Math.abs(gain)<.001);}
    assert.ok(Math.abs(loss-gain)<.001);assert.ok(Math.abs(groupEnergy(s)-total)<.001);
  }
});
test('contact heat multiplier changes transfer rate without adding energy',()=>{
  const losses=[];
  for(const rate of [1,20]){
    const s=movingWater(true,rate),hot=groupEnergy(s,0,20),total=groupEnergy(s);
    for(let n=0;n<240;n++)s.step();
    losses.push(hot-groupEnergy(s,0,20));assert.ok(Math.abs(groupEnergy(s)-total)<.001);
  }
  assert.ok(losses[1]>losses[0]*5,JSON.stringify(losses));
});
test('actual binary collision exchanges heat across the two original bodies',()=>{
  const probe=new Simulation();probe.makePlanet(0,0,64,0,0,false);const split=probe.count;
  const s=new Simulation();s.reset('collision');
  // Label by immutable initial index ranges, retaining the preset's materials,
  // masses, self gravity, velocities, bonds and contact physics.
  for(let i=0;i<split;i++){
    s.temperature[i]+=10;s.enthalpy[i]=enthalpyAt(s.material[i],s.temperature[i]);
  }
  const first=groupEnergy(s,0,split),second=groupEnergy(s,split),total=groupEnergy(s);
  for(let n=0;n<10;n++)s.step();
  assert.ok(Math.abs(groupEnergy(s,0,split)-first)<.1,'no heat flow through the initial gap');
  let maxTransfer=0;
  for(let n=10;n<600;n++){
    s.step();maxTransfer=Math.max(maxTransfer,Math.abs(groupEnergy(s,0,split)-first));
  }
  assert.ok(maxTransfer>1000,`cross-body energy transfer: ${maxTransfer} J`);
  assert.ok(Math.abs((groupEnergy(s,0,split)-first)+(groupEnergy(s,split)-second))<.1);
  assert.ok(Math.abs(groupEnergy(s)-total)<.1);
});
