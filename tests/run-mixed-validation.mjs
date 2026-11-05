import {writeFileSync} from 'node:fs';
import {initialize} from '../src/multibody/engine.js';
import {mixedImpactProject} from '../src/mixed/model.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {mixedEnergyCSV} from '../src/mixed/energy.js';
import {contactCSV} from '../src/simulation/contact-ui.js';
await initialize();
const rows=[];
for(const dt of [.0001,.00005,.000025]){
  const p=mixedImpactProject();p.solver.dt=dt;const s=new MixedSimulation(p),frames=[s.snapshot()];
  let maxDisplacement=0,maxStrain=0,maxDepth=0,maxThermalResidual=0,maxFEMResidual=0,maxSystemResidual=0,maxInterfaceResidual=0,maxClockDrift=0;
  const start=performance.now();
  try{
    for(let i=0;i<30;i++){const f=s.step(1/60);frames.push(f);const b=f.fem.parts[0].summary;
      maxSystemResidual=Math.max(maxSystemResidual,Math.abs(f.mixed.energy.unexplainedResidual));maxInterfaceResidual=Math.max(maxInterfaceResidual,Math.abs(f.mixed.energy.interfaceWorkResidual));maxClockDrift=Math.max(maxClockDrift,f.mixed.clock.maxDrift);
      maxDisplacement=Math.max(maxDisplacement,b.maxDisplacement);maxStrain=Math.max(maxStrain,b.maxStrain);maxDepth=Math.max(maxDepth,f.contactPairs[0].maxPenetration);
      maxThermalResidual=Math.max(maxThermalResidual,Math.abs(f.thermal.residual));maxFEMResidual=Math.max(maxFEMResidual,Math.abs(f.fem.dynamics.energyResidual));
    }
    const f=frames.at(-1),r=f.contactPairs[0];rows.push({dt,wallMs:performance.now()-start,maxDisplacement,maxStrain,maxDepth,maxThermalResidual,maxFEMResidual,maxSystemResidual,maxInterfaceResidual,maxClockDrift,energy:f.mixed.energy,clock:f.mixed.clock,exchanges:f.mixed.exchanges,
      finalParticle:f.results.parts[1].values,impulse:r.totalImpulse,normalLoss:r.normalLoss,frictionLoss:r.frictionLoss,correctionWork:r.correctionWork,heatIntoMPM:r.accumulatedHeat,
      finalThermal:f.thermal,finalFEM:f.fem.dynamics,separated:r.normalForce===0&&r.heatRate===0});
    if(rows.length===1){writeFileSync('artifacts/mixed-v045-example.json',JSON.stringify(p,null,2));writeFileSync('artifacts/mixed-v045-history.csv',contactCSV(frames));writeFileSync('artifacts/mixed-v045-energy.csv',mixedEnergyCSV(frames));}
  }finally{s.free();}
}
const reference=rows.at(-1);
for(const r of rows)r.relativeDifference={impulse:Math.abs(r.impulse[1]-reference.impulse[1])/Math.abs(reference.impulse[1]),maxDisplacement:Math.abs(r.maxDisplacement-reference.maxDisplacement)/reference.maxDisplacement,heat:Math.abs(r.heatIntoMPM-reference.heatIntoMPM)/Math.abs(reference.heatIntoMPM)};
const report={version:'0.45.0',scope:'Shared mechanical clock, SI impulse and heat ports, explicit two-sided receipts, operator energy observations, separate mechanical and heat balances. CPU MPM–FEM; unsupported constitutive storage yields no full residual.',rows,
  checks:{sharedClock:rows.every(r=>r.maxClockDrift<1e-12&&r.clock.domains.every(d=>d.steps===r.clock.steps)),interfaceWork:rows.every(r=>r.maxInterfaceResidual<1e-9),energyCoverage:rows.every(r=>r.energy.complete),energyRefinement:rows.at(-1).maxSystemResidual<rows[0].maxSystemResidual,rebound:rows.every(r=>r.finalParticle.velocity[1]>0),separation:rows.every(r=>r.separated),smallStrain:rows.every(r=>r.maxStrain<.01),heatConservation:rows.every(r=>r.maxThermalResidual<1e-5),penetration:rows.every(r=>r.maxDepth<.001),timeRefinement:rows[0].relativeDifference.impulse<.1&&rows[0].relativeDifference.maxDisplacement<.1,thermalRefinement:rows.slice(0,-1).every(r=>r.relativeDifference.heat<.1)}};
writeFileSync('artifacts/mixed-v045-validation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
if(!Object.values(report.checks).every(Boolean))process.exitCode=1;
