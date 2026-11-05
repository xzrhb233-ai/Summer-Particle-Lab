import fs from 'node:fs';
import assert from 'node:assert/strict';
import {materialContactExample} from '../src/simulation/material-contact-example.js';
import {toLegacy} from '../src/simulation/project.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {initialize} from '../src/multibody/engine.js';
await initialize();
const s=new CoupledSimulation(toLegacy(materialContactExample()));
try{
  let peak=0,depth=0;const trace=[];
  for(let k=0;k<180;k++){
    const f=s.step(1/60),pair=f.contactPairs[0];
    assert.ok(f.particles.every(Number.isFinite));
    peak=Math.max(peak,pair.normalForce);depth=Math.max(depth,pair.maxPenetration);
    if((k+1)%30===0){
      const p=s.particles,groups=[[],[]];for(let i=0;i<p.count;i++)groups[p.lab.part[i]-1].push(i);
      let minCenterDistance=Infinity;
      for(const a of groups[0])for(const b of groups[1])minCenterDistance=Math.min(minCenterDistance,Math.hypot(p.x[a]-p.x[b],p.y[a]-p.y[b],p.z[a]-p.z[b])*.025);
      trace.push({time:f.time,pair,coupling:f.coupling,minCenterDistance});
      console.log(JSON.stringify({time:f.time,normalForce:pair.normalForce,heat:pair.accumulatedHeat,minCenterDistance,overlap:pair.maxPenetration}));
    }
  }
  const f=s.snapshot();
  const report={peakNormalForce:peak,maxPenetration:depth,trace};
  fs.writeFileSync('artifacts/cpu-material-demo-validation.json',JSON.stringify(report,null,2));
  assert.ok(peak>1);assert.ok(f.contactPairs[0].accumulatedHeat< -1);assert.ok(Math.abs(f.coupling.thermalResidual)<1e-4);
  assert.ok(depth<.01);
  assert.ok(trace.some(t=>t.pair.accumulatedHeat< -1&&t.pair.normalForce===0&&t.pair.heat===0));
  console.log(JSON.stringify({peakNormalForce:peak,maxPenetration:depth,final:f.contactPairs[0],coupling:f.coupling}));
}finally{s.free();}
