import {writeFile} from 'node:fs/promises';
import {initialize} from '../src/multibody/engine.js';
import {mixedImpactProject} from '../src/mixed/model.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
await initialize();const p=mixedImpactProject();p.solver.dt=.0002;
const onset=process.argv.includes('--onset'),duration=onset?.153:.25;
await writeFile('artifacts/mixed-v047-reference-project.json',JSON.stringify(p,null,2));
const sim=new MixedSimulation(p),rows=[],start=performance.now();
try{while(sim.time<duration-1e-9){const dt=onset?sim.time<.149-1e-9?Math.min(.01,.149-sim.time):.0002:.01;const f=sim.step(Math.min(dt,duration-sim.time)),b=f.fem.parts[0].summary,c=f.contactPairs[0];rows.push({time:f.time,displacement:b.maxDisplacement,impulse:c.totalImpulse,heat:-c.accumulatedHeat,plateTemperature:b.temperature,plateMax:b.maxTemperature,heatResidual:f.thermal.residual});}
await writeFile(`artifacts/mixed-v047-browser-${onset?'onset':'reference'}.json`,JSON.stringify({backend:'independent browser CPU solver',wallSeconds:(performance.now()-start)/1000,rows},null,2));console.log(rows.at(-1));}finally{sim.free();}
