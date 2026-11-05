import {writeFile} from 'node:fs/promises';
import {initialize} from '../src/multibody/engine.js';
import {mixedThermalContactProject} from '../src/mixed/model.js';
import {MixedSimulation} from '../src/mixed/simulation.js';
import {partTemperature,interfaceHeat,thermalHistoryCSV} from '../src/simulation/thermal-history.js';
await initialize();
const rows=[];let coarse;
for(const dt of [.02,.005,.0025]){
  const p=mixedThermalContactProject();p.solver.dt=dt;
  const s=new MixedSimulation(p),frames=[s.snapshot()],start=performance.now();
  try{
    while(s.time<30-1e-10)frames.push(s.step(Math.min(.1,30-s.time)));
    const f=frames.at(-1);rows.push({requestedDt:dt,actualMinDt:f.mixed.clock.minDt,actualMaxDt:f.mixed.clock.maxDt,wallMs:performance.now()-start,
      plate:partTemperature(f,'beam'),pad:partTemperature(f,'hot-pad'),heat:interfaceHeat(f,'pad-plate'),externalHeat:f.thermal.externalHeat,residual:f.thermal.residual,clockDrift:f.mixed.clock.maxDrift});
    if(!coarse){coarse=frames;await writeFile('artifacts/thermal-v046-example.json',JSON.stringify(p,null,2));}
  }finally{s.free();}
}
const reference=rows.at(-1);for(const r of rows)r.differenceFromFinest={meanDegC:r.plate.mean-reference.plate.mean,maxDegC:r.plate.max-reference.plate.max,heatRelative:(r.heat.heat-reference.heat.heat)/reference.heat.heat};
const checks={visibleWarming:rows[0].plate.mean>26&&rows[0].plate.max>55,conservative:rows.every(r=>Math.abs(r.residual)<1e-6),sharedClock:rows.every(r=>r.clockDrift===0),timeRefinement:rows.every(r=>Math.abs(r.differenceFromFinest.meanDegC)<.002&&Math.abs(r.differenceFromFinest.maxDegC)<.05&&Math.abs(r.differenceFromFinest.heatRelative)<.001)};
await writeFile('artifacts/thermal-v046-validation.json',JSON.stringify({scope:'Fixed geometry, prescribed 160°C pad, 30 s; time refinement only, no spatial convergence claim.',rows,checks},null,2));
await writeFile('artifacts/thermal-v046-history.csv',thermalHistoryCSV(coarse,'beam','pad-plate'));
console.log(JSON.stringify({rows,checks},null,2));if(Object.values(checks).some(x=>!x))process.exitCode=1;
