import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {materialContactExample} from '../src/simulation/material-contact-example.js';
import {toLegacy} from '../src/simulation/project.js';
await initialize();
const rows=[];let first=null;
for(const batch of [1/60,1/120]){
  const s=new CoupledSimulation(toLegacy(materialContactExample()));
  try{
    while(s.time<3-1e-10)s.step(Math.min(batch,3-s.time));
    const frame=s.snapshot(),positions=Array.from(frame.particles).filter((_,i)=>i%8<3);
    first??=positions;
    const row={batch,clock:frame.clock,heat:frame.contactPairs[0].accumulatedHeat,
      maxPositionDifferenceFromFirst:Math.max(...positions.map((x,i)=>Math.abs(x-first[i])))};
    rows.push(row);console.log(JSON.stringify(row));
  }finally{s.free();}
}
fs.writeFileSync('artifacts/v039-clock-cpu-after.json',JSON.stringify(rows,null,2));
assert.equal(rows[1].maxPositionDifferenceFromFirst,0);
assert.ok(Math.abs(rows[0].heat-rows[1].heat)<1e-8);
assert.equal(rows[0].clock.steps,rows[1].clock.steps);
assert.equal(rows[0].clock.requestCuts+rows[1].clock.requestCuts,0);
