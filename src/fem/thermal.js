import {dot,meshLength} from './mesh.js';
import {PartThermalLoads} from '../simulation/thermal-loads.js';
import {lumpedPort} from '../simulation/thermal-ports.js';
import {resolveSurfaceSelection} from '../simulation/surface-selections.js';

export function thermalForce(mesh,A,material,T){
  const force=new Float64Array(mesh.nodes.length*3),alpha=material.expansion??0,ref=material.referenceTemperature??20;
  let constant=0;
  if(alpha)for(const c of mesh.cells){
    const theta=alpha*(c.ids.reduce((s,n)=>s+T[n],0)/4-ref),stress=(3*A.lambda+2*A.mu)*theta;
    for(let a=0;a<4;a++)for(let k=0;k<3;k++)force[3*c.ids[a]+k]+=c.volume*stress*c.grads[a][k];
    constant+=1.5*c.volume*stress*theta;
  }
  return {force,constant};
}
export function makeThermalData(part,mesh,m,A){
  const temperature=new Float64Array(mesh.nodes.length).fill(part.initial.temperature),capacity=Float64Array.from(temperature,(_,n)=>m[3*n]*(part.material.cp??500));
  const map=new Map(),area=new Float64Array(temperature.length);
  for(const t of mesh.surface)for(const n of t.nodes)area[n]+=t.area/3;
  for(const c of mesh.cells)for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    const a=Math.min(c.ids[i],c.ids[j]),b=Math.max(c.ids[i],c.ids[j]),key=a+','+b;
    const g=-(part.material.conductivity??50)*c.volume*dot(c.grads[i],c.grads[j]);map.set(key,(map.get(key)??0)+g);
  }
  const edges=[],budget=new Float64Array(temperature.length);
  // An unstructured Tet4 conductivity matrix can have positive off-diagonals.
  // Keep the assembled FE operator rather than clipping its signed fluxes.
  // Absolute row sums provide a conservative explicit stability bound; unlike
  // an acute mesh, this does not promise a discrete maximum principle.
  for(const [key,g] of map){if(g< -1e-8&&!mesh.explicit)throw Error('当前热网格不满足单调导热条件，请使用规则 Tet4 长方体网格');if(Math.abs(g)<=1e-12)continue;const [i,j]=key.split(',').map(Number);edges.push({i,j,g});budget[i]+=Math.abs(g);budget[j]+=Math.abs(g);}
  const criticalDt=capacity.reduce((limit,c,n)=>Math.min(limit,budget[n]>.0?.45*c/budget[n]:Infinity),Infinity);
  const initial=thermalForce(mesh,A,part.material,temperature);
  return {temperature,capacity,area,edges,criticalDt,force:initial.force,constant:initial.constant,work:0};
}
export function elasticEnergy(s,Ku){return .5*dot(s.u,Ku)-dot(s.u,s.thermal.force)+s.thermal.constant;}
export function updateThermalForce(s){
  if(!s.part.material.expansion)return;
  const next=thermalForce(s.mesh,s.A,s.part.material,s.thermal.temperature);
  s.thermal.work+=s.thermal.constant===next.constant&&s.thermal.force.every((x,i)=>x===next.force[i])?0:
    -dot(s.u,next.force)+dot(s.u,s.thermal.force)+next.constant-s.thermal.constant;
  s.thermal.force=next.force;s.thermal.constant=next.constant;
}
export class FEMThermalSystem{
  constructor(project,states,contacts){
    this.states=states;this.contacts=contacts;this.enabled=project.solver.thermal===true;this.externalHeat=0;this.exchangedHeat=0;
    const ports=new Map();
    for(const s of states){
      const entries=s.mesh.nodes.map((_,n)=>({index:n,weight:s.m[3*n],area:s.thermal.area[n],capacity:()=>s.thermal.capacity[n],temperature:()=>s.thermal.temperature[n],energy:()=>s.thermal.capacity[n]*s.thermal.temperature[n],energyAt:T=>s.thermal.capacity[n]*T,
        receive(Q){const c=s.thermal.capacity[n],old=c*s.thermal.temperature[n],next=Math.max(-273.15*c,old+Q);s.thermal.temperature[n]=next/c;return next-old;}}));
      s.thermal.entries=entries;
      ports.set(s.part.id,{select(region){
        if(region.type==='whole')return entries;
        const weights=new Map();for(const t of resolveSurfaceSelection(s.part,s.mesh,region).triangles)for(const n of t.nodes)weights.set(n,(weights.get(n)??0)+t.area/3);
        return [...weights].map(([n,area])=>({...entries[n],area,weight:area}));
      }});
    }
    for(const r of contacts.bodies)ports.set(r.part.id,lumpedPort(r,{index:0,capacity:r.capacity,area:4*Math.PI*r.radius*r.radius}));
    this.loads=new PartThermalLoads(project,ports);this.initialEnergy=this.energy();
    this.entries=states.flatMap(s=>s.thermal.entries);this.bulkEdges=[];let offset=0;
    for(const s of states){s.thermal.offset=offset;for(const e of s.thermal.edges)this.bulkEdges.push({...e,i:e.i+offset,j:e.j+offset});offset+=s.thermal.entries.length;}
    for(const r of contacts.bodies){r.thermalIndex=this.entries.length;this.entries.push(lumpedPort(r,{capacity:r.capacity,area:0}).select()[0]);}
    this.budget=new Float64Array(this.entries.length);this.heat=new Float64Array(this.entries.length);
    if(this.enabled){this.externalHeat+=this.loads.step(0);for(const s of states)updateThermalForce(s);}
  }
  energy(){return this.states.reduce((sum,s)=>sum+s.thermal.temperature.reduce((e,T,n)=>e+T*s.thermal.capacity[n],0),0)+this.contacts.bodies.reduce((e,r)=>e+r.energy,0);}
  begin(){this.loads.begin();}
  step(dt){
    if(!this.enabled)return;
    const entries=this.entries,edges=this.bulkEdges.slice();
    for(const p of this.contacts.pairs){
      if(!p.definition.thermal||!p.definition.contactConductance)continue;
      const c=this.contacts.thermalContact(p);if(!c)continue;
      const k=p.state.part.material.conductivity,kr=p.body.part.material.conductivity;if(!(k>0&&kr>0))continue;
      const cell=meshLength(p.state);
      const g=p.definition.thermalArea/(1/p.definition.contactConductance+p.body.radius/kr+.5*cell/k);
      for(let a=0;a<3;a++)if(c.weights[a]>0)edges.push({i:p.body.thermalIndex,j:p.state.thermal.offset+c.ids[a],g:g*c.weights[a],pair:p});
    }
    edges.push(...(this.contacts.surfaceContacts?.thermalEdges()??[]));
    const budget=this.budget;budget.fill(0);for(const e of edges){budget[e.i]+=Math.abs(e.g);budget[e.j]+=Math.abs(e.g);}
    const limit=entries.reduce((d,e,i)=>Math.min(d,budget[i]>.0?.45*e.capacity()/budget[i]:Infinity),Infinity),count=Math.max(1,Math.ceil(dt/limit));
    if(count>10000)throw Error('热扩散子步过多，请降低导热率或细化时间步');
    const h=dt/count,Q=this.heat;
    for(let n=0;n<count;n++){
      Q.fill(0);
      for(const e of edges){const q=(entries[e.j].temperature()-entries[e.i].temperature())*e.g*h;Q[e.i]+=q;Q[e.j]-=q;this.exchangedHeat+=Math.abs(q);if(e.pair){const signed=q*(e.pairSign??1);e.pair.heat+=signed;e.pair.accumulatedHeat+=signed;e.pair.thermalSamples++;}}
      entries.forEach((e,i)=>{const actual=e.receive(Q[i]);if(Math.abs(actual-Q[i])>1e-7*Math.max(1,Math.abs(Q[i])))throw Error('热量更新触及温度下界，请减小步长');});
      this.externalHeat+=this.loads.step(h);
    }
    for(const s of this.states){if(!s.thermal.temperature.every(T=>Number.isFinite(T)&&T>=-273.150001&&T<1e6))throw Error('FEM 温度超出数值范围');updateThermalForce(s);}
  }
  backup(){return {externalHeat:this.externalHeat,exchangedHeat:this.exchangedHeat,loads:this.loads.backup(),states:this.states.map(s=>({temperature:s.thermal.temperature.slice(),force:s.thermal.force.slice(),constant:s.thermal.constant,work:s.thermal.work}))};}
  restore(b){this.externalHeat=b.externalHeat;this.exchangedHeat=b.exchangedHeat;this.loads.restore(b.loads);this.states.forEach((s,i)=>{s.thermal.temperature.set(b.states[i].temperature);s.thermal.force=b.states[i].force;s.thermal.constant=b.states[i].constant;s.thermal.work=b.states[i].work;});}
  snapshot(dt){const energy=this.energy();return {enabled:this.enabled,energy,initialEnergy:this.initialEnergy,externalHeat:this.externalHeat,exchangedHeat:this.exchangedHeat,residual:energy-this.initialEnergy-this.externalHeat,loads:this.loads.results(dt)};}
}
