import {validateMixed,mixedImpactProject} from './model.js';
import {MIXED_MPM_MODELS} from './material-capabilities.js';
import {domainParameters,geometryParameters,geometryPoints} from '../three/discretization.js';
import {particleThermalProperties} from './thermomechanical.js';
import {isFourGPU,validateFourGPU} from './four-gpu-model.js';
export const MIXED_GPU_FEATURE='residentMpmFemV6';
export function validateMixedGPU(input){
  if(isFourGPU(input))return validateFourGPU(input);
  if(input.solver.couplingMode==='unified-pbd')throw Error('Unified PBD 目前需要四方法 GPU 项目');
  const p=validateMixed({...input,solver:{...input.solver,computeBackend:'gpu'}}),mpm=p.parts.filter(p=>p.method==='mpm'),fem=p.parts.filter(p=>p.method==='fem');
  const fail=()=>{throw Error('GPU MPM–FEM V6 支持规则长方体 MPM（弹性 / J2 / 线性强化 / Johnson–Cook / 热软化 J2 / 热激活蠕变）、Tet4 FEM、热膨胀、耗散生热、面载荷曲线及部件热载荷；仅支持一对 MPM–FEM，暂不支持刚体、PBF、FEM–FEM、相变、断裂或空间区域热源。');};
  if(p.parts.length!==2||mpm.length!==1||fem.length!==1||p.contactPairs.length!==1||p.solver.thermalMode==='fixed-geometry'||p.solver.initialState!=='rest')fail();
  const b=mpm[0];if(!MIXED_MPM_MODELS.includes(b.material.model)||b.material.phaseChange.enabled||b.material.fracture.enabled||b.geometry.shape!=='box'||b.geometry.rotation.some(Boolean)||b.discretization.sampling.enabled||p.loads.some(l=>l.type==='fixed-selection'||l.type==='region-heat'&&l.power)||p.loadBindings.some(b=>!['fem-force','fem-pressure'].includes(b.kind)))fail();
  if(p.couplings.some(c=>c.thermalScale!==1))fail();
  const port=p.solver.mixedGpuPort??8795;if(!Number.isInteger(port)||port<8765||port>8799)throw Error('混合 GPU 端口须为 8765–8799');
  p.parts=[fem[0],mpm[0]];p.solver.computeBackend='gpu';p.solver.mixedGpuPort=port;return p;
}
export function mixedScaleProject(count=10000){
  if(![10000,50000].includes(count))throw Error('规模算例支持 10000 或 50000 粒子');
  const p=mixedImpactProject(),b=p.parts[1],plate=p.parts[0],n=count===10000?[25,16,25]:[50,20,50],size=n.map(x=>x*.025);
  plate.name='FEM 板';p.contactPairs[0].name='热块 ↔ FEM 板';p.name=`MPM–FEM · ${count.toLocaleString('en')} 粒子撞板`;b.name=`热弹性块 · ${count} 粒子`;
  b.geometry.size=size;b.geometry.center=[size[0]/2+.2,.3+size[1]/2,0];b.initial.velocity=[0,-.5,0];b.material.density=1100;
  plate.geometry.size=[size[0]+.4,.15,size[2]+.3];plate.geometry.center=[plate.geometry.size[0]/2,.2,0];plate.discretization.divisions=[6,2,6];plate.material.young=4e6;
  p.discretization.mpm={lower:[-.3,-.3,-1.1],upper:[2.1,1.4,1.1],cellSize:.1,particlesPerAxis:4};
  Object.assign(p.solver,{computeBackend:'gpu',mixedGpuPort:8795,duration:.2,dt:.0002});
  p.contactPairs[0].friction=.2;return validateMixedGPU(p);
}
export function mixedParticleSeed(p){
  const d=p.discretization.mpm,domain=domainParameters({...d,lower:d.lower.map(x=>x/.025),upper:d.upper.map(x=>x/.025),cellSize:d.cellSize/.025});
  const b=p.parts.find(p=>p.method==='mpm'),g=geometryParameters({...b.geometry,center:b.geometry.center.map(x=>x/.025),size:b.geometry.size.map(x=>x/.025)},domain),points=geometryPoints(g,50000),spacing=domain.spacing*.025;
  const {cp,conductivity}=particleThermalProperties(b.material),key=q=>q.map((x,k)=>Math.round((x-points[0][k])/domain.spacing)).join(',');
  const index=new Map(points.map((p,i)=>[key(p),i])),edges=[];
  points.forEach((p,i)=>{for(let k=0;k<3;k++){const q=p.slice();q[k]+=domain.spacing;const j=index.get(key(q));if(j!==undefined)edges.push([i,j,conductivity*spacing]);}});
  const face=b.boundary.fixedFace,axis=face==='none'?-1:'XYZ'.indexOf(face.at(-1)),side=face.startsWith('min')?-1:1;
  const pinned=points.map(q=>axis<0?0:Math.abs(q[axis]*.025-(b.geometry.center[axis]+side*b.geometry.size[axis]/2))<=spacing*.51?1:0);
  return {domain,points,edges,pinned,spacing,cp,conductivity,mass:b.material.density*spacing**3,volume:spacing**3/.001,velocity:b.initial.velocity.map(x=>x/.025),temperature:b.initial.temperature,model:b.material.model};
}

export function mixedGPUThermalProject(count=10000){
  const p=mixedScaleProject(count),block=p.parts[1];
  p.name='MPM–FEM · GPU 加热与冷却';block.name='MPM 加热块';p.parts[0].name='FEM 冷却板';
  block.geometry.center[1]-=.025;block.initial.velocity=[0,0,0];block.initial.temperature=80;
  p.parts[0].initial.temperature=40;p.solver.duration=.5;
  p.loads.push(
    {id:'mpm-power',name:'MPM 总功率 · 2 MW',type:'thermal-power',target:block.id,region:{type:'whole'},power:2000000,enabled:true},
    {id:'plate-thermostat',name:'板底恒温 · 60°C',type:'thermal-temperature',target:p.parts[0].id,region:{type:'face',face:'y-'},temperature:60,enabled:true},
    {id:'plate-convection',name:'FEM 对流冷却 · 0°C',type:'thermal-convection',target:p.parts[0].id,region:{type:'whole'},temperature:0,coefficient:5000,enabled:true});
  return validateMixedGPU(p);
}

export function mixedGPUThermomechanicalProject(){
  const p=mixedScaleProject(10000),plate=p.parts[0],block=p.parts[1];
  p.name='MPM–FEM · 热压板接触加热与卸载';
  plate.name='FEM 弹性压板';plate.geometry={shape:'box',center:[.55,.46,0],size:[1.1,.12,.75],rotation:[0,0,0]};
  plate.discretization.divisions=[10,2,6];Object.assign(plate.material,{young:1e7,density:2700,cp:900,conductivity:205,expansion:1.2e-5,referenceTemperature:140});plate.initial.temperature=140;
  block.name='MPM 热软化试件';block.geometry.center=[.75,.2,0];block.initial.velocity=[0,0,0];block.initial.temperature=20;block.boundary.fixedFace='minY';block.material.model=10;
  block.material.thermalMaterial={...block.material.thermalMaterial,Tref:20,Thot:140,hotRatio:.06,A:.035,H:.04};
  block.material.thermomechanical={expansion:.0002,referenceTemperature:20,hotStiffnessRatio:.35};
  Object.assign(block.material,{density:2700,cp:900,conductivity:205});
  p.discretization.mpm={lower:[-.3,-.2,-.9],upper:[1.7,1.2,.9],cellSize:.1,particlesPerAxis:4};
  Object.assign(p.solver,{duration:2.2,dt:.0001,outputInterval:.02,damping:25,mixedGpuPort:8795});p.environment.gravity=[0,0,0];
  const force=p.loads.find(l=>l.type==='fem-force');force.force=[0,0,0];
  p.curves=[{id:'press-cycle',name:'预压 / 热压 / 冷却保持 / 卸载',type:'smooth',points:[[0,0],[.15,60],[.55,60],[.9,220],[1.65,220],[1.9,0],[2.2,0]]}];
  p.loadBindings=[{id:'plate-cycle',name:'压板 Y 向力',kind:'fem-force',target:plate.id,load:force.id,component:1,curve:'press-cycle',scale:-1,offset:0,enabled:true}];
  p.contactPairs[0].name='冷试件 ↔ 热压板';p.contactPairs[0].contactConductance=10000;p.contactPairs[0].thermalToleranceRatio=0;
  p.loads.push({id:'plate-cycle-temperature',name:'热压板控温 / 冷却',type:'thermal-temperature',target:plate.id,region:{type:'whole'},temperature:140,enabled:true,
    program:{type:'smooth',points:[[0,140],[1.4,140],[1.9,20],[2.2,20]]}});
  return validateMixedGPU(p);
}

// Isothermal initial state without a heater: any thermal rise is generated by
// mechanical dissipation, then redistributed by conduction. SI cp is unchanged.
export function mixedGPUDissipationProject(){
  const p=mixedScaleProject(10000),plate=p.parts[0],block=p.parts[1];
  p.name='MPM–FEM · 滑动撞击与耗散生热';plate.name='FEM 摩擦接触板';block.name='MPM 塑性滑块';
  plate.geometry.size=[1.65,.15,.95];plate.geometry.center=[.825,.2,0];plate.discretization.divisions=[12,2,6];
  Object.assign(plate.material,{young:4e6,density:2700,cp:900,conductivity:205,expansion:0,referenceTemperature:20});plate.initial.temperature=20;
  block.geometry.center=[.55,.5,0];block.initial.temperature=20;block.initial.velocity=[.8,-1,0];block.boundary.fixedFace='none';
  Object.assign(block.material,{model:10,density:1100,cp:1800,conductivity:.13});
  block.material.thermalMaterial={...block.material.thermalMaterial,Tref:20,Thot:180,A:.006,H:.01};
  block.material.thermomechanical={expansion:0,referenceTemperature:20,hotStiffnessRatio:1,plasticHeatFraction:.9};
  Object.assign(p.solver,{duration:.25,dt:.0001,outputInterval:.005,stiffness:4,damping:0});p.environment.gravity=[0,0,0];
  Object.assign(p.contactPairs[0],{name:'滑块 ↔ 接触板',friction:.5,frictionHeatFraction:1,frictionHeatToA:.5,thermalToleranceRatio:0});
  return validateMixedGPU(p);
}

// Same authored impact as v0.50, with the recoverable-mechanics observer enabled.
// Toggling diagnostics must not change any physical parameter or initial state.
export function mixedGPUEnergyProject(){
  const p=mixedGPUDissipationProject();
  p.name='MPM–FEM · GPU 能量诊断';p.solver.diagnostics=true;
  return validateMixedGPU(p);
}
