import {MATERIALS} from '../materials.js';
import {enthalpyAt} from '../thermal.js';
import {phaseEnthalpy} from '../three/phase-change.js';
import {rotate,inverse,quaternion} from '../multibody/model.js';
import {PartThermalLoads} from './thermal-loads.js';

export function boxArea(size,face){
  if(!face)return 2*(size[0]*size[1]+size[1]*size[2]+size[2]*size[0]);
  return size.filter((_,k)=>k!=='xyz'.indexOf(face[0])).reduce((s,x)=>s*x,1);
}
export function lumpedPort(state,{index=0,capacity,area}){
  const entry={index,weight:1,area,capacity:()=>capacity,temperature:()=>state.temperature,energy:()=>state.energy,energyAt:T=>capacity*T,
    receive(Q){const next=Math.max(-273.15*capacity,state.energy+Q),actual=next-state.energy;state.energy=next;state.temperature=next/capacity;return actual;}};
  return {select:()=>[entry]};
}
export function particleTargetEnthalpy(s,i,T){
  if(Math.abs(T-s.temperature[i])<1e-10)return s.enthalpy[i]; // retain a latent-heat plateau
  if(s.material[i]===11)return phaseEnthalpy(T,s.phaseMaterials[s.lab.part[i]]);
  if([2,3,4].includes(s.material[i]))return enthalpyAt(T<=0?4:T<=100?2:3,T);
  return enthalpyAt(s.material[i],T);
}
export function particlePort(s,part,partIndex){
  const entries=[],local=[],q=inverse(quaternion(part.geometry.rotation??[0,0,0])),spacing=s.domain.spacing*.025;
  for(let i=0;i<s.count;i++)if(s.lab.part[i]===partIndex){
    const point=rotate(q,[s.x[i]*.025,s.y[i]*.025,s.z[i]*.025].map((x,k)=>x-part.geometry.center[k]));
    local.push(point);
    entries.push({index:i,weight:s.mass[i],area:0,capacity:()=>s.mass[i]*MATERIALS[s.material[i]].cp,temperature:()=>s.temperature[i],energy:()=>s.mass[i]*s.enthalpy[i],energyAt:T=>s.mass[i]*particleTargetEnthalpy(s,i,T),
      receive(Q){const min=s.mass[i]*particleTargetEnthalpy(s,i,-273.15),old=s.mass[i]*s.enthalpy[i],after=Math.max(min,old+Q);s.enthalpy[i]=after/s.mass[i];s.phaseTransition(i);return after-old;}});
  }
  return {select(region){
    const face=region.type==='face'?region.face:null,axis=face?'xyz'.indexOf(face[0]):-1,sign=face?.[1]==='-'?-1:1;
    const rows=entries.filter((e,n)=>axis<0||sign*local[n][axis]>=part.geometry.size[axis]/2-spacing*.65-1e-9);
    // Nominal reference surface area; convection on a whole particle body is
    // a lumped boundary approximation distributed by initial particle mass.
    const area=part.geometry.shape==='sphere'?Math.PI*part.geometry.size[0]**2:boxArea(part.geometry.size,face),mass=rows.reduce((s,e)=>s+e.weight,0);
    return rows.map(e=>({...e,area:area*e.weight/mass}));
  }};
}
export function attachParticleThermalLoads(project,engine){
  const ports=new Map();let index=0;
  for(const part of project.parts)if(['mpm','pbf'].includes(part.method))ports.set(part.id,particlePort(engine.particles,part,++index));
  for(const [k,[id,t]] of [...engine.bodyHeat??[]].entries()){
    const p=project.parts.find(p=>p.id===id),area=p.geometry.shape==='sphere'?Math.PI*p.geometry.size[0]**2:boxArea(p.geometry.size);
    ports.set(id,lumpedPort(t,{index:-k-1,capacity:t.capacity,area}));
  }
  const loads=new PartThermalLoads(project,ports);engine.partThermalLoads=loads;
  return loads;
}
