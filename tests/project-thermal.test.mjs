import test from 'node:test';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {thermalExample} from '../src/simulation/thermal-example.js';
import {toLegacy} from '../src/simulation/project.js';
import {exchange} from './gpu-thermal-fixtures.mjs';
await initialize();

test('phase plateau preserves attachment, full melt releases it permanently through refreezing',()=>{
  const m=toLegacy(thermalExample(true));m.coupling.thermal=false;
  const s=new CoupledSimulation(m),g=s.particles,total=[...g.mass.slice(0,g.count)].reduce((a,b)=>a+b,0);
  try{
    const initial=s.attachments.results(0),positions=[...g.x.slice(0,g.count)];
    s.setHeater({power:total*10000/.1});s.heatStep(.1);s.attachments.releaseMelted();
    assert.ok([...g.temperature.slice(0,g.count)].every(t=>Math.abs(t-60)<1e-6));
    assert.equal(s.attachments.results(0)[0].count,initial[0].count);
    s.setHeater({power:total*2000/.1});s.heatStep(.1);s.attachments.releaseMelted();
    assert.ok(s.attachments.results(0).every(j=>j.count===0&&j.state==='released'&&j.initialCount>0));
    assert.deepEqual([...g.x.slice(0,g.count)],positions);
    assert.ok(s.attachments.items.every(item=>item.members.every(m=>!s.attachments.ignores(item.definition.body,m.i))));
    s.setHeater({power:-1e7});s.heatStep(.1);s.attachments.releaseMelted();
    assert.ok([...g.melted.slice(0,g.count)].every(x=>x===0));
    assert.ok(s.attachments.results(0).every(j=>j.state==='released'));
    assert.ok(Math.abs(s.totalThermal()-s.initialThermal-s.externalHeat)<1e-5);
  }finally{s.free();}
});

test('project density and heat conservation survive conduction and capped cooling',()=>{
  const m=toLegacy(exchange()),s=new CoupledSimulation(m),g=s.particles;
  try{
    const initial=[...g.volume.slice(0,g.count)];
    for(let k=0;k<48;k++)s.heatStep(1/480);
    assert.deepEqual([...g.volume.slice(0,g.count)],initial);
    const b=s.bodyHeat.get('hot');assert.ok(b.temperature<160&&b.temperature>20);
    s.model.coupling.thermal=false;
    s.setThermalPower('hot',-1e7);s.setHeater({center:[0,.5,0],radius:1,power:-1e7});s.heatStep(10);
    assert.ok([...g.temperature.slice(0,g.count)].every(t=>Math.abs(t+273.15)<1e-6));
    assert.ok(Math.abs(b.temperature+273.15)<1e-9);
    assert.ok(Math.abs(s.totalThermal()-s.initialThermal-s.externalHeat)<1e-5);
  }finally{s.free();}
});
