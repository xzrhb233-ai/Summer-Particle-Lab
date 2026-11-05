import fs from 'node:fs';
import {dynamicCantileverProject} from '../src/fem/model.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {runDynamicValidation} from '../src/fem/dynamic-validation.js';

const report=runDynamicValidation(),sim=new FEMDynamicSimulation(dynamicCantileverProject());
const initial=sim.snapshot(),start=performance.now();let peakResidual=0,peakY=0,peakZ=0,frame;
for(let i=1;i<=120;i++){
  frame=sim.step(2*i/120-sim.time);
  const p=frame.fem.parts[0],d=frame.fem.dynamics;
  peakResidual=Math.max(peakResidual,Math.abs(d.energyResidual)/d.initialEnergy);
  peakY=Math.max(peakY,Math.abs(p.summary.tip[1]));peakZ=Math.max(peakZ,Math.abs(p.summary.tip[2]));
}
const example={project:sim.project,nodes:frame.fem.parts[0].nodes.length,elements:frame.fem.parts[0].cells.length,
  initialTip:initial.fem.parts[0].summary.tip,finalTime:sim.time,final:frame.fem.dynamics,peakRelativeEnergyResidual:peakResidual,peakY,peakZ,wallMs:performance.now()-start};
fs.writeFileSync('artifacts/fem-dynamic-validation.json',JSON.stringify(report,null,2));
fs.writeFileSync('artifacts/fem-dynamic-example.json',JSON.stringify(example,null,2));
console.log(JSON.stringify({checks:report.checks,example},null,2));
if(!Object.values(report.checks).every(Boolean)||peakResidual>.001)process.exitCode=1;
