import {writeFileSync} from 'node:fs';
import {femThermalExample,mpmPartThermalExample} from '../src/simulation/part-thermal-example.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
const runs=[];
for(const dt of [.0001,.00005,.00002]){
  const p=femThermalExample();p.solver.dt=dt;const s=new FEMDynamicSimulation(p),f=s.step(1),d=f.fem.dynamics,t=f.thermal;
  runs.push({dt,steps:d.steps,thermalWork:d.thermalWork,energyResidual:d.energyResidual,relativeMechanicalResidual:Math.abs(d.energyResidual)/Math.abs(d.thermalWork),heatResidual:t.residual,externalHeat:t.externalHeat,temperature:f.fem.parts[0].summary.temperature,tip:f.fem.parts[0].summary.tip});
}
const report={description:'Constrained transient thermal expansion, 81 nodes / 192 Tet4; weak coupling',runs,checks:{heatConservation:runs.every(x=>Math.abs(x.heatResidual)<1e-7),timeRefinement:runs[2].relativeMechanicalResidual<runs[0].relativeMechanicalResidual*.1,finalMechanicalResidual:runs[2].relativeMechanicalResidual<.001}};
writeFileSync('artifacts/thermal-v043-validation.json',JSON.stringify(report,null,2));
writeFileSync('artifacts/fem-thermal-example.json',JSON.stringify(femThermalExample(),null,2));
writeFileSync('artifacts/mpm-part-thermal-example.json',JSON.stringify(mpmPartThermalExample(),null,2));
console.log(JSON.stringify(report,null,2));if(!Object.values(report.checks).every(Boolean))process.exitCode=1;
