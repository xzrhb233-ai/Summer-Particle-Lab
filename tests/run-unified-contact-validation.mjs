import fs from 'node:fs';
import {initialize} from '../src/multibody/engine.js';
import {unifiedContactExample} from '../src/simulation/unified-example.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
await initialize();const simulation=new MixedSimulation(unifiedContactExample()),start=performance.now();
try{
  const frame=simulation.step(.2),summary={version:'0.57.0',time:frame.time,solveMs:performance.now()-start,
    particles:frame.coupling.count,nodes:frame.fem.parts.reduce((sum,p)=>sum+p.nodes.length,0),
    maxDisplacement:Math.max(...frame.fem.parts.map(p=>p.summary.maxDisplacement)),clockDrift:frame.mixed.clock.maxDrift,
    thermal:frame.thermal,physicalLoss:frame.mixed.energy.physical,
    contacts:frame.contactPairs.map(p=>({id:p.id,a:p.a,b:p.b,normalForce:p.normalForce,tangentialForce:p.tangentialForce,samples:p.samples,heat:p.accumulatedHeat,thermalSamples:p.thermalSamples}))};
  if(!frame.particles.every(Number.isFinite)||Math.abs(frame.thermal.residual)>1e-5||summary.clockDrift!==0)throw Error('Unified contact validation failed');
  for(const [a,b] of [['water','plate'],['sphere','plate'],['plate','foundation']])if(!summary.contacts.find(p=>p.a===a&&p.b===b)?.samples)throw Error('Missing contact response: '+a+' / '+b);
  const output=JSON.stringify(summary,null,2);fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/v057-contact-validation.json',output+'\n');console.log(output);
}finally{simulation.free();}
