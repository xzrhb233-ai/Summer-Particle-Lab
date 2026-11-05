import {writeFileSync} from 'node:fs';
import {impactProject} from '../src/fem/model.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {contactCSV} from '../src/simulation/contact-ui.js';

const p=impactProject(),s=new FEMDynamicSimulation(p),frames=[s.snapshot()];
let peakForce=0,maxDepth=0,maxDeflection=0,maxEnergyResidual=0;
for(let i=0;i<120;i++){
  const f=s.step(1/120);frames.push(f);
  peakForce=Math.max(peakForce,f.contactPairs[0].normalForce);maxDepth=Math.max(maxDepth,f.contactPairs[0].maxPenetration);
  maxDeflection=Math.max(maxDeflection,f.fem.parts[0].summary.maxDisplacement);
  maxEnergyResidual=Math.max(maxEnergyResidual,Math.abs(f.fem.dynamics.energyResidual)/f.fem.dynamics.initialEnergy);
}
const f=frames.at(-1),disabled=impactProject();disabled.contactPairs[0].mechanical=false;
const control=new FEMDynamicSimulation(disabled).step(1);
const report={version:'0.42.0',scope:'CPU, small-strain Tet4 + spherical rigid body, unilateral compliant contact',duration:f.time,outputInterval:1/120,
  nodes:f.fem.parts[0].nodes.length,elements:f.fem.parts[0].cells.length,dt:s.dt,
  peakIntervalNormalForce:peakForce,maxPenetration:maxDepth,maxDisplacement:maxDeflection,maxRelativeEnergyResidual:maxEnergyResidual,
  finalSphere:f.bodies[0],balance:f.fem.dynamics,disabledControl:{vy:control.bodies[0].velocity[1],beamEnergy:control.fem.parts[0].summary.energy},
  checks:{rebound:f.bodies[0].velocity[1]>0,beamVibrates:maxDeflection>.0005,separation:f.contactPairs[0].normalForce===0,
    energyBudget:maxEnergyResidual<.001,penetration:maxDepth<p.parts[1].geometry.size[0]*.025,disabledNoInteraction:control.bodies[0].velocity[1]===-.5&&control.fem.parts[0].summary.energy===0}};
writeFileSync('artifacts/fem-contact-validation.json',JSON.stringify(report,null,2));
writeFileSync('artifacts/fem-contact-example.json',JSON.stringify(p,null,2));
writeFileSync('artifacts/fem-contact-history.csv',contactCSV(frames));
console.log(JSON.stringify(report,null,2));
if(!Object.values(report.checks).every(Boolean))process.exitCode=1;
