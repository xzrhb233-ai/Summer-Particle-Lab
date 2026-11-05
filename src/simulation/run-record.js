import {actualDevice} from './workspace-context.js';
import {compactRunSummary} from './project-archive.js';

const finite=v=>typeof v==='number'&&Number.isFinite(v);
const first=(...values)=>values.find(finite);
const sum=values=>values.length&&values.every(finite)?values.reduce((a,b)=>a+b,0):undefined;
const maximum=values=>values.length&&values.every(finite)?Math.max(...values):undefined;
const minimum=values=>values.length&&values.every(finite)?Math.min(...values):undefined;

// Capture measurements from the result's own immutable configuration, never
// from the currently edited project. This is a report, not restart state.
export function createRunRecord({project,frame,resultProject,outcome,targetTime}={}){
  if(!project||!frame||frame.preview||resultProject?.schema!=='summer-project/1'||!Array.isArray(resultProject.parts)||!resultProject.parts.length)return null;
  if(!finite(frame.time)||frame.time<0||frame.fem?.solved===false)return null;
  const staticSolved=frame.fem?.analysis==='linear-static'&&frame.fem.solved===true;
  if(frame.time===0&&!staticSolved)return null;
  if(!['completed','paused','error','stopped'].includes(outcome))throw Error('运行记录状态无效');
  const parts=resultProject.parts,rows=new Map((frame.results?.parts??[]).map(p=>[p.id,p.values??{}])),fem=new Map((frame.fem?.parts??[]).map(p=>[p.id,p])),bodies=new Map((frame.bodies??[]).map(p=>[p.id,p]));
  const measured=p=>fem.get(p.id)?.summary??rows.get(p.id)??{};
  const particleParts=parts.filter(p=>['mpm','pbf'].includes(p.method)),femParts=parts.filter(p=>p.method==='fem');
  const pureFEM=femParts.length===parts.length,particleFree=particleParts.length===0;
  const balance=frame.results?.balance??{},dynamics=frame.fem?.dynamics??{},diagnostics=frame.diagnostics??{},clock=frame.mixed?.clock??frame.clock??{};
  const total=(key)=>first(balance[key],!frame.mixed?dynamics[key]:undefined);
  // Global extrema require every relevant part to report that quantity. A
  // particle group's mean translation or rendered sample is not its maximum.
  const temperature=(p,key)=>first(measured(p)[key],p.method==='rigid'?bodies.get(p.id)?.temperature:undefined);
  const deformable=parts.filter(p=>p.method==='mpm'||p.method==='fem');
  const summary={
    partCount:parts.length,
    particleCount:first(frame.coupling?.count,sum(particleParts.map(p=>rows.get(p.id)?.count))),
    nodeCount:sum(femParts.map(p=>first(fem.get(p.id)?.nodes?.length,rows.get(p.id)?.nodeCount))),
    elementCount:sum(femParts.map(p=>first(fem.get(p.id)?.cells?.length,rows.get(p.id)?.elementCount))),
    steps:first(frame.mixed?.clock?.steps,dynamics.steps,frame.steps,diagnostics.physicalSubsteps),
    maxDisplacement:maximum(parts.map(p=>measured(p).maxDisplacement)),
    maxSpeed:maximum(parts.map(p=>measured(p).maxSpeed)),
    maxVonMises:maximum(deformable.map(p=>measured(p).maxVonMises)),
    minTemperature:minimum(parts.map(p=>temperature(p,'minTemperature'))),
    maxTemperature:maximum(parts.map(p=>temperature(p,'maxTemperature'))),
    kineticEnergy:first(total('kinetic'),particleFree&&!frame.fem?frame.kinetic:undefined),
    strainEnergy:first(total('energy'),staticSolved&&pureFEM?sum(femParts.map(p=>measured(p).energy)):undefined),
    externalWork:first(total('externalWork'),staticSolved&&pureFEM?sum(femParts.map(p=>measured(p).externalWork)):undefined),
    energyResidual:balance.energyComplete===false?undefined:first(total('energyResidual'),diagnostics.residual),
    thermalEnergy:frame.thermal?.energy,
    thermalResidual:first(frame.thermal?.residual,balance.thermalResidual,frame.coupling?.thermalResidual),
    frictionHeat:frame.thermal?.generated?.friction,
    plasticHeat:frame.thermal?.generated?.plastic,
    minDt:first(clock.minDt,diagnostics.minSubstep),maxDt:first(clock.maxDt,diagnostics.maxSubstep),
  };
  const contacts=frame.contactPairs??frame.results?.contactPairs;
  if(Array.isArray(contacts)&&contacts.length)summary.maxPenetration=maximum(contacts.map(p=>p.maxPenetration));
  // Initial temperatures, constitutive parameters, last-batch wall time and
  // display buffers cannot stand in for measured extrema or whole-run timing.
  return {project:structuredClone(resultProject),outcome,time:frame.time,...(finite(targetTime)&&targetTime>=0?{targetTime}:{}),backend:actualDevice(frame,resultProject),summary:compactRunSummary(summary)};
}
