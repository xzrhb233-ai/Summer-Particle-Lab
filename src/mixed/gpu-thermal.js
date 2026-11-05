import {PartThermalLoads,isThermalLoad} from '../simulation/thermal-loads.js';
import {particlePort} from '../simulation/thermal-ports.js';

// Reuse the CPU material-coordinate selection contract, without constructing
// or advancing a second particle solver. Only descriptors are evaluated here.
export function mixedThermalDescriptors(project,seed,fem){
  const part=project.parts.find(p=>p.method==='mpm'),count=seed.points.length;
  const state={count,domain:seed.domain,mass:new Float32Array(count).fill(seed.mass),
    lab:{part:new Uint32Array(count).fill(1)}};
  for(const [axis,k] of [['x',0],['y',1],['z',2]])state[axis]=Float32Array.from(seed.points,p=>p[k]);
  const p={loads:project.loads.filter(l=>isThermalLoad(l)&&l.target===part.id)};
  const loads=new PartThermalLoads(p,new Map([[part.id,particlePort(state,part,1)]]));
  const descriptors=[...loads.descriptors().map(d=>({...d,domain:'mpm'})),
    ...fem.thermal.loads.descriptors().map(d=>({...d,domain:'fem'}))];
  return project.loads.filter(isThermalLoad).map(l=>descriptors.find(d=>d.definition.id===l.id));
}
