import fs from 'node:fs';
import assert from 'node:assert/strict';
import {initialize} from '../src/multibody/engine.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {fourGPUExample,compileFourGPU} from '../src/mixed/four-gpu-model.js';

// Isolate contact against a fully supported 5 mm plate. Low E avoids making
// elastic-wave CFL the dominant limiter; this is not a plate bending benchmark.
const p=fourGPUExample();p.name='接触保护 · 高速球撞薄板';p.environment.gravity=[0,0,0];
const [f,m,w,r]=p.parts;
Object.assign(f.geometry,{size:[1.2,.005,.7],center:[0,.3725,0]});
f.discretization.divisions=[5,1,3];f.material.young=1e4;
m.geometry.size=[.075,.075,.075];w.geometry.size=[.075,.075,.075];
Object.assign(r.geometry,{center:[-.5,.48,0],size:[.15,.15,.15]});
r.initial.velocity=[0,-40,0];r.boundary.damping=0;
for(const d of p.contactPairs)d.thermal=false;
p.loads.push(...p.parts.map(b=>({id:'heat-'+b.id,type:'thermal-power',target:b.id,region:{type:'whole'},power:100,enabled:true})));
fs.writeFileSync('artifacts/contact-safety-project.json',JSON.stringify(p));
const data=compileFourGPU(p);data.fem.fixed.fill(1);
fs.writeFileSync('artifacts/contact-safety-compiled.json',JSON.stringify(data,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));

await initialize();p.solver.computeBackend='cpu';
const s=new MixedSimulation(p);
try{
  s.fem.states[0].fixed.fill(1);const frame=s.step(.002),b=frame.bodies[0];
  assert.ok(b.position[1]>=.45-1e-5);assert.ok(b.velocity[1]>=-1e-3);
  assert.equal(frame.mixed.clock.maxDrift,0);assert.ok(Math.abs(frame.thermal.externalHeat-.8)<1e-7);
  const result={sphereY:b.position[1],sphereVelocityY:b.velocity[1],steps:s.steps,lastDt:s.lastDt,contactSafety:frame.mixed.contactSafety,heatResidual:frame.thermal.residual,externalHeat:frame.thermal.externalHeat};
  fs.writeFileSync('artifacts/contact-safety-cpu.json',JSON.stringify(result,null,2));console.log(result);
}finally{s.free();}
