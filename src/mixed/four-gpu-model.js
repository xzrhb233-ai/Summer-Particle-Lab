import {validateMixed,projectDomains} from './model.js';
import {MIXED_MPM_MODELS} from './material-capabilities.js';
import {mixedParticleSeed} from './gpu-model.js';
import {unifiedExample} from '../simulation/unified-example.js';
import {FEMDynamicSimulation} from '../fem/dynamic.js';
import {PartThermalLoads,isThermalLoad} from '../simulation/thermal-loads.js';
import {particlePort,lumpedPort} from '../simulation/thermal-ports.js';
import {inverse,quaternion,rotate} from '../multibody/model.js';

export const FOUR_GPU_FEATURE='residentFourMethodV2';
export const isFourGPU=p=>p.parts.some(b=>b.method==='pbf'||b.method==='rigid');
export function validateFourGPU(input){
  const p=validateMixed({...input,solver:{...input.solver,computeBackend:'gpu'}});
  const by=m=>p.parts.filter(b=>b.method===m),fail=s=>{throw Error('四方法 GPU：'+s);};
  if(p.parts.length!==4||['mpm','fem','pbf','rigid'].some(m=>by(m).length!==1))fail('首版需要 MPM、PBF、FEM、球形刚体各一个；更多部件请使用 CPU。');
  const [m,f,w,r]=['mpm','fem','pbf','rigid'].map(m=>by(m)[0]);
  if(r.geometry.shape!=='sphere')fail('目前刚体支持球形；尚未接入其他形状和关节。');
  if(r.boundary.restitution)fail('当前采用无恢复的法向接触，恢复系数须为 0。');
  if(p.connections.length||p.solver.initialState!=='rest'||p.solver.thermalMode==='fixed-geometry')fail('仅支持无关节、从初始几何开始的动态联算。');
  for(const b of [m,w])if(b.geometry.shape!=='box'||b.geometry.rotation.some(Boolean)||b.discretization.sampling.enabled||b.material.phaseChange.enabled||b.material.fracture.enabled)fail('粒子部件使用无旋转规则长方体，暂不支持随机采样、相变和断裂。');
  if(!MIXED_MPM_MODELS.includes(m.material.model))fail('MPM 本构支持弹性、Neo-Hookean、J2、线性强化、Johnson–Cook、简化 Johnson–Cook、温度 J2 和热激活蠕变；雪、砂、黏聚岩土与泡沫尚未接入联算。');
  if(p.loads.some(l=>!['fem-fixed','fem-force','fem-pressure','thermal-power','thermal-temperature','thermal-convection'].includes(l.type))||p.loadBindings.some(b=>!['fem-force','fem-pressure'].includes(b.kind)))fail('支持 FEM 面载荷和部件加热/恒温/对流；暂不支持其他运动或区域约束。');
  if(p.loads.some(l=>l.target===r.id&&isThermalLoad(l)&&l.region.type!=='whole'))fail('球体热载荷只支持整个部件。');
  if(p.couplings.some(c=>c.thermalScale!==1))fail('热交换倍率须为 1。');
  if(p.contactPairs.some(c=>c.frictionHeatFraction>0))fail('四方法摩擦转热账本尚未接入；请将摩擦转热比例设为 0。塑性转热可用。');
  if(p.solver.diagnostics)fail('四方法完整机械能账本尚未覆盖，暂时只记录热量收支与接触冲量。');
  for(const pair of p.contactPairs)if(pair.a===r.id&&pair.b===f.id){
    const area=input.contactPairs.find(d=>d.id===pair.id)?.thermalArea??.001;
    if(!Number.isFinite(area)||area<=0||area>100)fail('球–FEM 等效传热面积须在 0–100 m² 内且大于 0。');
    pair.thermalArea=area;
  }
  const port=p.solver.mixedGpuPort??8796;if(!Number.isInteger(port)||port<8765||port>8799)fail('端口须为 8765–8799。');
  p.parts=[f,m,w,r];p.solver.mixedGpuPort=port;p.solver.computeBackend='gpu';return p;
}

export function fourGPUExample(){
  const p=unifiedExample();p.name='四方法 GPU · 热球 / MPM / PBF / FEM';
  Object.assign(p.solver,{computeBackend:'gpu',mixedGpuPort:8796,dt:.0002,duration:2,outputInterval:.01,diagnostics:false});
  // The plate touches both particle groups; the sphere falls onto their seam.
  const r=p.parts.find(b=>b.method==='rigid');r.geometry.center=[-.0375,.94,0];r.initial.velocity=[0,-.8,0];
  return validateFourGPU(p);
}

export function fourGPUFluidImpactExample(){
  const p=fourGPUExample();p.name='MPM–PBF · GPU 双向碰撞';
  const solid=p.parts.find(b=>b.method==='mpm'),water=p.parts.find(b=>b.method==='pbf'),rigid=p.parts.find(b=>b.method==='rigid');
  solid.geometry.center[0]=-.15;solid.initial.velocity=[.4,0,0];water.initial.velocity=[-.2,0,0];
  rigid.boundary.motion='fixed';rigid.initial.velocity=[0,0,0];p.solver.duration=.2;
  return validateFourGPU(p);
}

export function unifiedPBDExample(){
  const p=fourGPUExample();p.name='Unified PBD · 四方法混合耦合';
  p.parts.find(b=>b.method==='mpm').initial.velocity=[.2,0,0];
  p.parts.find(b=>b.method==='pbf').initial.velocity=[-.1,0,0];
  Object.assign(p.solver,{couplingMode:'unified-pbd',pbdIterations:6,dt:.002,duration:.12});
  return validateFourGPU(p);
}

export function compileFourGPU(input){
  const p=validateFourGPU(input),[f,m,w,r]=p.parts;
  const seed=mixedParticleSeed(p),water=mixedParticleSeed({...p,parts:[f,{...w,method:'mpm',material:{...w.material,cp:4180,conductivity:.6}}]});
  const nm=seed.points.length,nw=water.points.length,n=nm+nw;if(n>50000)throw Error('四方法 GPU 当前总粒子数上限为 50000');
  const points=[...seed.points,...water.points],q=inverse(quaternion(f.geometry.rotation));
  for(const point of points){const x=point.map(v=>v*.025),local=rotate(q,x.map((v,k)=>v-f.geometry.center[k]));
    if(local.every((v,k)=>Math.abs(v)<f.geometry.size[k]/2-1e-9))throw Error('初始粒子位于 FEM 体积内部');
    if(Math.hypot(...x.map((v,k)=>v-r.geometry.center[k]))<r.geometry.size[0]/2+seed.spacing/2-1e-7)throw Error('初始粒子与刚体球重叠');}
  const localSphere=rotate(q,r.geometry.center.map((v,k)=>v-f.geometry.center[k]));
  if(Math.hypot(...localSphere.map((v,k)=>Math.max(0,Math.abs(v)-f.geometry.size[k]/2)))<r.geometry.size[0]/2-1e-8)throw Error('初始刚体与 FEM 重叠');
  const fem=new FEMDynamicSimulation(projectDomains(p).fem),s=fem.states[0];
  try{
    const ports=new Map(),domainSeed={count:n,domain:seed.domain,mass:Float32Array.from(points,(_,i)=>i<nm?seed.mass:water.mass),lab:{part:Uint32Array.from(points,(_,i)=>i<nm?1:2)}};
    for(const [a,k] of [['x',0],['y',1],['z',2]])domainSeed[a]=Float32Array.from(points,v=>v[k]);
    ports.set(m.id,particlePort(domainSeed,m,1));ports.set(w.id,particlePort(domainSeed,w,2));ports.set(r.id,lumpedPort({}, {index:0,capacity:r.material.mass*r.material.cp,area:Math.PI*r.geometry.size[0]**2}));
    const descriptors=new PartThermalLoads({...p,loads:p.loads.filter(l=>isThermalLoad(l)&&l.target!==f.id)},ports).descriptors().map(d=>({...d,domain:d.definition.target===r.id?'rigid':'mpm'}));
    descriptors.push(...fem.thermal.loads.descriptors().map(d=>({...d,domain:'fem'})));
    const shadow=structuredClone(p);shadow.parts=[f,m];shadow.loads=p.loads.filter(l=>!isThermalLoad(l));shadow.solver.diagnostics=false;
    shadow.contactPairs=[p.contactPairs.find(c=>c.a===m.id&&c.b===f.id)??{mechanical:false,thermal:false,friction:0,thermalToleranceRatio:0,contactConductance:0}];
    shadow.contactPairs[0]={...shadow.contactPairs[0],thermalToleranceRatio:Math.max(...p.contactPairs.map(c=>c.thermalToleranceRatio??0))};
    return {four:true,fullProject:p,nm,water,rigidQuaternion:quaternion(r.geometry.rotation),thermalLoads:descriptors,project:shadow,seed:{...seed,points,pinned:[...seed.pinned,...water.pinned]},
      fem:{nodes:s.mesh.nodes,cells:s.mesh.cells,surface:s.mesh.surface,A:s.A,m:s.m,fixed:s.fixed,force:s.f,bindings:s.bindings,velocity:s.v,dt:fem.dt,thermalEdges:s.thermal.edges,capacity:s.thermal.capacity,thermalDt:s.thermal.criticalDt},frame:fem.snapshot()};
  }finally{fem.free();}
}
