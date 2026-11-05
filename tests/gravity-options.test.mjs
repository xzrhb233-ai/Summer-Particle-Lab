import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
import {GRAVITY_DEFAULTS,gravityAcceleration,gravityMode,updateGravity,DIRECTIONS} from '../src/three/gravity-options.js';

test('gravity defaults follow the scene and zero strength disables the field',()=>{
  const s={...GRAVITY_DEFAULTS,gravity:true};
  assert.equal(gravityMode(s,'planet'),'self');assert.equal(gravityMode(s,'million'),'none');assert.equal(gravityMode(s,'coupled'),'uniform');
  s.gravityMode='repel';assert.equal(gravityMode(s,'planet'),'repel');s.gravityStrength=0;assert.equal(gravityMode(s,'planet'),'none');
});
test('six directional fields, softened attraction and repulsion have correct accelerations',()=>{
  const s={...GRAVITY_DEFAULTS,gravityStrength:2,gravityCenter:[10,5,-6]};
  for(const [key,dir] of Object.entries(DIRECTIONS)){
    s.gravityDirection=key;const a=gravityAcceleration(s,'uniform',0,0,0);
    for(let k=0;k<3;k++)assert.equal(a[k],dir[k]*48);
  }
  const a=gravityAcceleration(s,'attract',18,5,-6),r=gravityAcceleration(s,'repel',18,5,-6);
  assert.ok(a[0]<0);assert.equal(r[0],-a[0]);assert.equal(a[1],0);assert.equal(a[2],0);
  assert.deepEqual(gravityAcceleration(s,'attract',10,5,-6),[0,0,0]);
  s.gravitySoftening=32;assert.ok(Math.abs(gravityAcceleration(s,'attract',18,5,-6)[0])<Math.abs(a[0]));
});
test('CPU particles respond to changed direction and fixed particles remain anchored',()=>{
  const s=new Simulation3();s.reset('empty');s.add(0,0,0,2,20);s.add(20,0,0,2,20);s.pin(1,true);
  s.setSettings({gravityMode:'uniform',gravityDirection:'front',gravityStrength:2,thermal:false});s.step();
  assert.ok(s.z[0]>0);assert.equal(s.y[0],0);assert.equal(s.z[1],0);
  const count=s.count;s.setSettings({gravityMode:'none'});s.step();assert.equal(s.count,count);assert.equal(s.snapshot().gravityMode,'none');
});
test('settings reject nonfinite centers and unsupported CPU self gravity',()=>{
  const s={...GRAVITY_DEFAULTS};updateGravity(s,{gravityCenter:[NaN,0,0],gravityDirection:'invalid',gravityStrength:Infinity,gravityMode:'self'});
  assert.equal(s.gravityMode,'scene');assert.equal(s.gravityStrength,1);assert.deepEqual(s.gravityCenter,[0,0,0]);
  updateGravity(s,{gravityCenter:[-999,10,999],gravitySoftening:0,gravityStrength:99});
  assert.deepEqual(s.gravityCenter,[-240,10,240]);assert.equal(s.gravityStrength,4);assert.equal(s.gravitySoftening,4);
});
