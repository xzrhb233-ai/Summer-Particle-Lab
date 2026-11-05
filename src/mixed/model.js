import {MIXED_PLASTIC_MODELS} from './material-capabilities.js';
import {normalizeProject,normalizeSolverProject,editLegacyProject,fromLegacy,emptyCoupling} from '../simulation/project.js';
import {validateFEM,dynamicCantileverProject} from '../fem/model.js';
import {validateFixedThermal} from './fixed-thermal.js';
import {preserveThermomechanical} from './thermomechanical.js';

export const MIXED='cpu-fem-mpm';
const particle=p=>['mpm','pbf'].includes(p.method);
// Projections are compiled from one document. No runtime owns another copy of
// an interface part, load, or editable contact pair.
export function projectDomains(p){
  const subset=fem=>{
    const q=structuredClone(p);q.parts=q.parts.filter(b=>(b.method==='fem')===fem);
    const ids=new Set(q.parts.map(b=>b.id));
    q.loads=q.loads.filter(l=>ids.has(l.target)||(!fem&&l.type==='region-heat'));
    q.selectionSets=q.selectionSets.filter(s=>ids.has(s.part));q.frames=q.frames.filter(f=>f.part===null||ids.has(f.part));
    q.connections=q.connections.filter(j=>ids.has(j.a)&&ids.has(j.b)&&(!j.carrier||ids.has(j.carrier)));
    const joints=new Set(q.connections.map(j=>j.id));
    q.loadBindings=q.loadBindings.filter(b=>ids.has(b.target)||(!fem&&(b.kind==='region-heat'||b.kind==='motor-target'&&joints.has(b.target))));
    q.curves=q.curves.filter(c=>q.loadBindings.some(b=>b.curve===c.id));
    q.contactPairs=q.contactPairs.filter(d=>ids.has(d.a)&&ids.has(d.b));
    if(fem){q.solver.adapter='cpu-fem-dynamic';q.couplings=[];}
    else {
      q.solver.adapter='cpu-coupled';q.solver.dt=Math.max(1/7680,Math.min(1/480,q.solver.dt));
      // The shared rigid/particle domain can have zero particles. Its empty
      // grid is runtime infrastructure, not a hidden authored material part.
      q.discretization.mpm??=emptyCoupling().domain;q.solver.mpmEnabled=true;
    }
    return q;
  };
  return {fem:subset(true),particles:subset(false)};
}
export function validateMixed(input){
  const p=normalizeProject(input);
  if(p.solver.adapter!==MIXED||p.solver.analysis!=='linear-dynamic')throw Error('混合求解需要 CPU MPM–FEM 瞬态适配器');
  if(p.parts.some(b=>!['fem','rigid','mpm','pbf'].includes(b.method)))throw Error('混合求解支持 FEM、刚体、MPM 和 PBF');
  const femIds=new Set(p.parts.filter(b=>b.method==='fem').map(b=>b.id));
  if(p.connections.some(j=>femIds.has(j.a)||femIds.has(j.b)))throw Error('FEM 连接约束尚未实现；请使用显式接触对');
  if(!p.parts.some(b=>particle(b)||b.method==='rigid')||!p.parts.some(b=>b.method==='fem'))throw Error('混合项目至少需要一个粒子或刚体部件和一个 FEM 部件');
  if(p.parts.some(b=>b.method!=='mpm'&&b.material.thermomechanical?.plasticHeatFraction))throw Error('塑性生热仅支持 MPM 金属塑性、温度相关 J2 或蠕变');
  const domains=projectDomains(p),f=validateFEM(domains.fem),m=normalizeSolverProject(domains.particles);
  preserveThermomechanical(p,m);
  for(const b of m.parts)if(b.material.thermomechanical?.plasticHeatFraction){
    if(p.solver.computeBackend!=='gpu')throw Error('塑性生热需要 Taichi CUDA 混合求解器');
    if(!MIXED_PLASTIC_MODELS.includes(b.material.model))throw Error('塑性生热仅支持 J2、线性强化、Johnson–Cook、温度相关 J2 或蠕变');
    if(!p.solver.thermal)throw Error('塑性生热需要启用温度场');
  }
  if(p.solver.computeBackend!=='gpu'&&m.parts.some(b=>b.method==='mpm'&&((b.material.cp!==undefined&&b.material.cp!==1800)||(b.material.conductivity!==undefined&&b.material.conductivity!==.13))))throw Error('自定义 MPM 比热容和导热率需要 Taichi CUDA 混合求解器');
  if(p.solver.computeBackend!=='gpu'&&m.parts.some(b=>b.method==='mpm'&&b.material.thermomechanical&&(b.material.thermomechanical.expansion||b.material.thermomechanical.hotStiffnessRatio!==1)))throw Error('MPM 热膨胀与刚度软化需要选择 Taichi CUDA 混合求解器');
  p.parts=p.parts.map(b=>(b.method==='fem'?f:m).parts.find(x=>x.id===b.id));
  p.solver={...f.solver,adapter:MIXED,mpmEnabled:true,stiffness:m.solver.stiffness};p.discretization.mpm=m.discretization.mpm;p.couplings=m.couplings;
  const ids=new Set(),keys=new Set();
  p.contactPairs=p.contactPairs.map(d=>{
    if(!d||!/^[-\w]{1,40}$/.test(d.id)||ids.has(d.id))throw Error('混合接触对 ID 无效或重复');ids.add(d.id);
    const local=[...m.contactPairs,...f.contactPairs].find(x=>x.id===d.id);
    if(local)return local;
    const a=p.parts.find(b=>b.id===d.a),b=p.parts.find(b=>b.id===d.b);
    if(!a||!(particle(a)||a.method==='rigid')||b?.method!=='fem')throw Error('跨 FEM 接触对 A 为 MPM / PBF / 刚体，B 为 FEM');
    if(a.method==='rigid'&&!['sphere','box','cylinder','disc'].includes(a.geometry.shape))throw Error('刚体–FEM 接触支持球、长方体、圆柱和圆盘；轮胎尚不支持');
    const key=d.a+'|'+d.b;if(keys.has(key))throw Error('同一部件对只能定义一次');keys.add(key);
    const r={id:d.id,name:String(d.name??d.id).slice(0,80),a:d.a,b:d.b,mechanical:d.mechanical??true,thermal:d.thermal??true,friction:d.friction??.2,contactConductance:d.contactConductance??1000,thermalToleranceRatio:d.thermalToleranceRatio??.05,frictionHeatFraction:d.frictionHeatFraction??0,frictionHeatToA:d.frictionHeatToA??.5};
    if(typeof r.mechanical!=='boolean'||typeof r.thermal!=='boolean'||!Number.isFinite(r.friction)||r.friction<0||r.friction>2||!Number.isFinite(r.contactConductance)||r.contactConductance<0||r.contactConductance>100000)throw Error('混合接触参数无效');
    if(r.thermal&&!p.solver.thermal)throw Error('界面换热需要启用温度场');
    if(!Number.isFinite(r.thermalToleranceRatio)||r.thermalToleranceRatio<0||r.thermalToleranceRatio>.25)throw Error('热接触检测容差须为粒子半径的 0–25%');
    if(!Number.isFinite(r.frictionHeatFraction)||r.frictionHeatFraction<0||r.frictionHeatFraction>1||!Number.isFinite(r.frictionHeatToA)||r.frictionHeatToA<0||r.frictionHeatToA>1)throw Error('摩擦功转热比例及分给 A 的比例须为 0–1');
    if(r.frictionHeatFraction){
      if(p.solver.computeBackend!=='gpu')throw Error('摩擦生热需要 Taichi CUDA 混合求解器');
      if(!p.solver.thermal)throw Error('摩擦生热需要启用温度场');
      if(!r.mechanical)throw Error('摩擦生热需要启用该对力学接触');
    }
    return r;
  });
  validateFixedThermal(p);return p;
}
export function editMixedParticles(project,edit){
  const p=structuredClone(project),old=projectDomains(p).particles,next=editLegacyProject(old,edit);
  preserveThermomechanical(p,next);
  p.parts=[...p.parts.filter(b=>b.method==='fem'),...next.parts];
  p.loads=[...p.loads.filter(l=>p.parts.some(b=>b.method==='fem'&&b.id===l.target)),...next.loads];
  p.selectionSets=[...p.selectionSets.filter(s=>p.parts.some(b=>b.method==='fem'&&b.id===s.part)),...next.selectionSets];
  const allIDs=new Set(p.parts.map(b=>b.id));
  p.contactPairs=[...p.contactPairs.filter(d=>p.parts.some(b=>b.id===d.b&&b.method==='fem')&&allIDs.has(d.a)),...next.contactPairs];
  p.connections=next.connections;p.frames=[...p.frames.filter(f=>p.parts.some(b=>b.id===f.part&&b.method==='fem')),...next.frames];
  p.curves=[...new Map([...p.curves,...next.curves].map(c=>[c.id,c])).values()];
  p.loadBindings=[...p.loadBindings.filter(l=>p.parts.some(b=>b.method==='fem'&&b.id===l.target)),...next.loadBindings];
  p.discretization.mpm=next.discretization.mpm;p.couplings=next.couplings;p.solver.stiffness=next.solver.stiffness;
  p.environment=next.environment;return validateMixed(p);
}
export function mixedImpactProject(){
  const p=dynamicCantileverProject({size:[1.2,.15,.4],center:[.6,.5,0],divisions:[8,2,3],young:4e6,density:1000,force:[0,0,0],damping:1});
  p.name='MPM–FEM · 热块撞击弹性梁';p.curves=[];p.loadBindings=[];
  Object.assign(p.solver,{adapter:MIXED,thermal:true,initialState:'rest',duration:.5,dt:.0001,mpmEnabled:true,stiffness:1});
  const m=fromLegacy({schema:'summer-mbd/1',name:p.name,dt:1/480,gravity:[0,0,0],bodies:[],joints:[],coupling:{enabled:true,thermal:true,mechanical:true,
    domain:{lower:[-.3,0,-.5],upper:[1.5,1.3,.5],cellSize:.1,particlesPerAxis:2},
    parts:[{id:'hot-block',name:'热 MPM 块',center:[1,.75,0],size:[.2,.2,.2],density:1000,temperature:160,velocity:[0,-.5,0],model:0,sampling:{enabled:false},phaseChange:{enabled:false}}]}});
  p.parts.push(...m.parts);p.loads.push(...m.loads);p.couplings=m.couplings;p.discretization=m.discretization;
  p.contactPairs=[{id:'block-beam',name:'热块 ↔ 弹性梁',a:'hot-block',b:'beam',mechanical:true,thermal:true,friction:.2,contactConductance:1000}];
  return validateMixed(p);
}

export function mixedThermalContactProject(){
  // SI polymer-like plate and the existing rubber-like MPM material (cp=1800,
  // k=0.13). The thermostat's actual energy input is part of the heat ledger.
  const p=dynamicCantileverProject({size:[.15,.001,.1],center:[.075,.0245,.05],divisions:[10,1,6],young:2e9,density:1200,cp:1500,conductivity:.2,expansion:0,force:[0,0,0]});
  p.name='MPM–FEM · 热块持续接触薄板';p.parts[0].name='薄板 · 150 × 100 × 1 mm';p.curves=[];p.loadBindings=[];
  Object.assign(p.solver,{adapter:MIXED,thermal:true,thermalMode:'fixed-geometry',initialState:'rest',duration:30,dt:.02,mpmEnabled:true,stiffness:1});
  const m=fromLegacy({schema:'summer-mbd/1',name:p.name,dt:1/480,gravity:[0,0,0],bodies:[],joints:[],coupling:{enabled:true,thermal:true,mechanical:false,thermalScale:1,
    domain:{lower:[-.1,-.1,-.1],upper:[.3,.2,.2],cellSize:.1,particlesPerAxis:4},
    parts:[{id:'hot-pad',name:'恒温 MPM 热块 · 160°C',center:[.1,.05,.05],size:[.1,.05,.05],density:1100,temperature:160,velocity:[0,0,0],model:0,sampling:{enabled:false},phaseChange:{enabled:false}}]}});
  p.parts.push(...m.parts);p.loads.push(...m.loads);p.couplings=m.couplings;p.discretization=m.discretization;
  p.selectionSets.push({id:'pad-fixture',name:'热块全域固定',part:'hot-pad',region:{type:'whole'}});
  p.loads.push({id:'fix-pad',type:'fixed-selection',target:'hot-pad',selection:'pad-fixture'},
    {id:'pad-thermostat',name:'热块恒温热源',type:'thermal-temperature',target:'hot-pad',region:{type:'whole'},temperature:160,enabled:true});
  p.contactPairs=[{id:'pad-plate',name:'热块 → 薄板',a:'hot-pad',b:'beam',mechanical:false,thermal:true,friction:0,contactConductance:1000}];
  return validateMixed(p);
}
