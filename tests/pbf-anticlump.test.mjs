import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation3} from '../src/three/simulation.js';
function pair(enabled,second=2){
  const s=new Simulation3();s.setSettings({gravity:false,thermal:false,pbfAntiClump:enabled});
  s.add(-1,0,0,2,20);s.add(1,0,0,second,second===1?1250:second===3?130:second===4?-12:20);return s;
}
test('PBF artificial pressure separates underdense close pairs and conserves mass-weighted momentum',()=>{
  for(const second of [1,2]){
    const off=pair(false,second),on=pair(true,second),state=on.snapshot();off.step();on.step();
    assert.equal(off.x[1]-off.x[0],2);assert.ok(on.x[1]-on.x[0]>2.05);
    assert.ok(on.lambda[0]===0);assert.ok(on.lambda[1]===0);
    assert.ok(Math.abs(on.mass[0]*on.vx[0]+on.mass[1]*on.vx[1])<1e-9);
    assert.equal(on.snapshot().mass,state.mass);assert.equal(on.snapshot().energy,state.energy);
  }
});
test('anti-clumping does not repel solid or gas samples and can be disabled',()=>{
  for(const second of [3,4,11]){
    const off=pair(false,second),on=pair(true,second);off.step();on.step();
    assert.deepEqual(on.snapshot().data,off.snapshot().data);
  }
  const s=pair(true);s.setSettings({pbfAntiClump:0});assert.equal(s.settings.pbfAntiClump,true);
  s.setSettings({pbfAntiClump:false});s.step();assert.equal(s.x[1]-s.x[0],2);
});
