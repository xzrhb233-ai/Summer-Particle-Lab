import {quaternion,rotate} from '../multibody/model.js';
import {normalizeFEMProgram} from './program.js';
import {validateRigidContacts} from './contact.js';
import {normalizeThermalLoads,isThermalLoad} from '../simulation/thermal-loads.js';
import {validateExplicitMesh} from './explicit-mesh.js';
import {validateReferences} from '../simulation/references.js';
import {validateSurfaceRegion} from '../simulation/surface-selections.js';

export const FEM_LIMITS={nodes:5000,elements:24000,parts:8};
export const FACES=['x-','x+','y-','y+','z-','z+'];
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
export function validateFEM(project){
  const p=normalizeThermalLoads(structuredClone(project));
  validateReferences(p);
  if(p.solver.computeBackend==='gpu'&&(p.selectionSets.some(s=>s.region.type==='surface')||p.loads.some(l=>l.region?.type==='surface')))throw Error('命名表面选择当前仅支持 CPU FEM，尚未接入 GPU');
  const dynamic=p.solver.adapter==='cpu-fem-dynamic'&&p.solver.analysis==='linear-dynamic';
  if(!dynamic&&(p.solver.adapter!=='cpu-fem-static'||p.solver.analysis!=='linear-static'))throw Error('FEM 支持 CPU 线弹性静力或瞬态动力学分析');
  if(p.parts.filter(b=>b.method==='fem').length>FEM_LIMITS.parts||p.parts.some(b=>b.method!=='fem'&&(!dynamic||b.method!=='rigid')))throw Error('静力仅接受 FEM；瞬态支持 FEM 与球形刚体接触，尚不支持 MPM');
  if(p.connections.length||p.couplings.length||(!dynamic&&(p.contactPairs?.length||p.loadBindings?.length||p.curves?.length)))throw Error('FEM 暂不支持连接或多场耦合；接触和时间曲线需要瞬态动力学分析');
  if(dynamic)validateRigidContacts(p);
  if(dynamic){
    const s=p.solver;s.damping??=0;s.safety??=.8;s.initialState??='rest';s.duration??=2;
    s.thermal??=false;if(typeof s.thermal!=='boolean')throw Error('FEM 温度场开关无效');
    if(!Number.isFinite(s.dt)||s.dt<1e-7||s.dt>.02||!Number.isFinite(s.safety)||s.safety<=0||s.safety>.9)throw Error('动力学步长须为 1e-7–0.02 s，稳定安全系数须在 (0, 0.9]');
    if(!Number.isFinite(s.damping)||s.damping<0||s.damping>1000||!['rest','equilibrium'].includes(s.initialState))throw Error('阻尼须为 0–1000 s⁻¹，初始状态须为静止或预载平衡');
    if(!Number.isFinite(s.duration)||s.duration<=0||s.duration>60)throw Error('动力学追加时长须在 (0, 60] s');
    if(s.outputInterval!==undefined&&(!Number.isFinite(s.outputInterval)||s.outputInterval<1e-4||s.outputInterval>1))throw Error('结果输出间隔须在 0.0001–1 s');
  }
  if(!vector(p.environment?.gravity))throw Error('重力必须是有限三维向量');
  if(!Number.isFinite(p.solver.tolerance)||p.solver.tolerance<1e-12||p.solver.tolerance>1e-3)throw Error('相对残差容差须在 1e-12 至 1e-3');
  if(!Number.isInteger(p.solver.maxIterations)||p.solver.maxIterations<10||p.solver.maxIterations>10000)throw Error('最大迭代次数须为 10–10000');
  let nodes=0,elements=0;
  for(const b of p.parts.filter(b=>b.method==='fem')){
    const {geometry:g,material:m,discretization:d}=b;
    if(typeof b.name!=='string'||b.name.length>80)throw Error('FEM 部件名称最多 80 字');
    if(!['box','cad'].includes(g.shape)||!vector(g.size)||g.size.some(x=>x<1e-4||x>100)||!vector(g.center)||g.center.some(x=>Math.abs(x)>1000)||!vector(g.rotation))throw Error('FEM 支持长方体或带 Tet4 网格的 CAD；尺寸 0.0001–100 m，位置 ±1000 m');
    if(m.model!=='linear-elastic'||!Number.isFinite(m.young)||m.young<=0||m.young>1e13||!Number.isFinite(m.poisson)||m.poisson<=-.9||m.poisson>=.49||!Number.isFinite(m.density)||m.density<=0)throw Error('线弹性材料需要 E > 0、−0.9 < ν < 0.49、密度 > 0');
    m.cp??=500;m.conductivity??=50;m.expansion??=0;m.referenceTemperature??=20;
    if(!Number.isFinite(m.cp)||m.cp<1||m.cp>100000||!Number.isFinite(m.conductivity)||m.conductivity<0||m.conductivity>10000||!Number.isFinite(m.expansion)||Math.abs(m.expansion)>.001||!Number.isFinite(m.referenceTemperature)||m.referenceTemperature< -273.15||m.referenceTemperature>2000)throw Error('FEM 比热容、导热率、热膨胀系数或参考温度无效');
    if(b.initial.temperature< -273.15||b.initial.temperature>2000)throw Error('FEM 初温须在 −273.15 至 2000°C');
    if(d?.element!=='tet4')throw Error('FEM 需要 Tet4 四面体网格');
    if(g.shape==='cad'){
      validateExplicitMesh(d.mesh,g.cad);
      if(p.solver.computeBackend==='gpu')throw Error('CAD 四面体 FEM 目前仅支持 CPU，尚未接入 GPU 内核');
      nodes+=d.mesh.nodes.length;elements+=d.mesh.elements.length;
    }else{
      if(d.mesh)throw Error('显式四面体网格必须对应 CAD 几何');
      if(!vector(d.divisions)||d.divisions.some(x=>!Number.isInteger(x)||x<1||x>100))throw Error('Tet4 每方向划分数须为 1–100 的整数');
      const cell=g.size.map((v,k)=>v/d.divisions[k]);if(Math.max(...cell)/Math.min(...cell)>50)throw Error('网格长宽比超过 50，请调整划分数');
      nodes+=d.divisions.reduce((v,n)=>v*(n+1),1);elements+=6*d.divisions.reduce((v,n)=>v*n,1);
    }
    if(!vector(b.initial.velocity)||(!dynamic&&b.initial.velocity.some(x=>x!==0))||b.initial.velocity.some(x=>Math.abs(x)>1000)||!Number.isFinite(b.initial.temperature))throw Error('初速度须为有限向量（静力须为零），初温须为有限值');
  }
  if(nodes>FEM_LIMITS.nodes||elements>FEM_LIMITS.elements)throw Error(`当前 FEM 上限 ${FEM_LIMITS.nodes} 节点 / ${FEM_LIMITS.elements} 单元，请降低网格划分数`);
  const ids=new Set();
  for(const l of p.loads){
    if(typeof l.id!=='string'||!/^[-\w]{1,40}$/.test(l.id)||ids.has(l.id))throw Error('FEM 载荷 ID 无效或重复');ids.add(l.id);
    if(isThermalLoad(l)){if(!dynamic||!p.solver.thermal)throw Error('统一热载荷需要启用 FEM 瞬态温度场');continue;}
    if(!['fem-fixed','fem-force','fem-pressure'].includes(l.type))throw Error('FEM 静力仅支持固定面、面总力、压力和重力');
    if(!p.parts.some(b=>b.id===l.target&&b.method==='fem'))throw Error('FEM 面载荷目标必须是 FEM 部件');
    const s=p.selectionSets.find(s=>s.id===l.selection);
    if(!s||s.part!==l.target||s.entity!=='face'||!['face','surface'].includes(s.region.type)||s.region.type==='face'&&!FACES.includes(s.region.face))throw Error('FEM 约束和载荷须引用该部件的几何面或命名表面选择集');
    if(s.region.type==='surface')validateSurfaceRegion(p.parts.find(b=>b.id===l.target),s.region);
    if(l.type==='fem-force'&&!vector(l.force))throw Error('面总力必须是有限三维向量');
    if(l.type==='fem-pressure'&&!Number.isFinite(l.pressure))throw Error('压力须为有限数值');
  }
  // Fully fixing a complete box face removes all six rigid modes. More general
  // component-wise supports require a rank check and are a later capability.
  for(const b of p.parts.filter(b=>b.method==='fem'))if(!p.loads.some(l=>l.target===b.id&&l.type==='fem-fixed'))throw Error(b.name+' 缺少固定面，存在刚体自由度');
  return dynamic?normalizeFEMProgram(p):p;
}

export function femPart(id='beam',options={}){
  return {id,name:options.name??'悬臂梁',method:'fem',
    geometry:{shape:'box',center:options.center??[1,.8,0],size:options.size??[2,.3,.3],rotation:options.rotation??[0,0,0]},
    material:{model:'linear-elastic',young:options.young??2e7,poisson:options.poisson??.3,density:options.density??1000,cp:options.cp??500,conductivity:options.conductivity??50,expansion:options.expansion??0,referenceTemperature:options.referenceTemperature??20},
    initial:{temperature:20,velocity:[0,0,0]},boundary:{},
    discretization:{element:'tet4',divisions:options.divisions??[24,4,4]}};
}
export function faceSet(part,face,role){
  return {id:`${part.id}-${role}`,name:`${part.name} / ${face}`,part:part.id,entity:'face',region:{type:'face',face}};
}
export function setPartLoads(p,part,{fixed='x-',loaded='x+',type='fem-force',force=[0,-100,0],pressure=1000}={}){
  const support=faceSet(part,fixed,'support'),load=faceSet(part,loaded,'load');
  p.selectionSets=p.selectionSets.filter(s=>s.part!==part.id);p.selectionSets.push(support,load);
  p.loads=p.loads.filter(l=>l.target!==part.id||isThermalLoad(l));
  p.loads.push({id:part.id+'-fixed',type:'fem-fixed',target:part.id,selection:support.id},
    {id:part.id+'-traction',type,target:part.id,selection:load.id,...(type==='fem-pressure'?{pressure}:{force})});
  return p;
}
export function cantileverProject(options={}){
  const part=femPart('beam',options);
  return setPartLoads({schema:'summer-project/1',name:'FEM · 悬臂梁静力弯曲',
    units:{length:'m',mass:'kg',time:'s',temperature:'degC'},parts:[part],loads:[],connections:[],couplings:[],contactPairs:[],frames:[],selectionSets:[],curves:[],loadBindings:[],
    environment:{gravity:[0,0,0]},discretization:{mpm:null},
    solver:{adapter:'cpu-fem-static',analysis:'linear-static',tolerance:1e-8,maxIterations:4000,dt:1/240,iterations:12,mpmEnabled:false}},part,{force:options.force??[0,-100,0]});
}
export function dynamicCantileverProject(options={}){
  const p=cantileverProject({size:[2,.3,.5],divisions:[24,4,6],force:[0,-30,0],...options});
  p.name='FEM · 悬臂梁弯曲后释放';
  Object.assign(p.solver,{adapter:'cpu-fem-dynamic',analysis:'linear-dynamic',dt:.0001,safety:.8,damping:options.damping??.5,initialState:'equilibrium',duration:2});
  p.curves=[{id:'release',name:'预载保持 0.15 s 后卸载',type:'step',points:[[0,1],[.15,0],[2,0]]}];
  p.loadBindings=[{id:'beam-release',name:'端面 Y 力卸载',kind:'fem-force',target:'beam',load:'beam-traction',component:1,curve:'release',scale:p.loads.find(l=>l.type==='fem-force').force[1],offset:0,enabled:true}];
  return p;
}
export const transformPoint=(part,p)=>rotate(quaternion(part.geometry.rotation),p).map((x,k)=>x+part.geometry.center[k]);

export function impactProject(){
  const p=dynamicCantileverProject({divisions:[16,3,5],force:[0,0,0],damping:.2});
  p.name='刚体–FEM · 小球撞击弹性梁';p.curves=[];p.loadBindings=[];
  Object.assign(p.solver,{initialState:'rest',duration:1,dt:.0001});
  p.parts.push({id:'impactor',name:'撞击球',method:'rigid',geometry:{shape:'sphere',size:[.24,.24,.24],center:[1.75,1.11,0],rotation:[0,0,0],appearance:null},material:{mass:3,cp:500,conductivity:0},initial:{velocity:[0,-.5,0],angularVelocity:[0,0,0],temperature:20},boundary:{motion:'dynamic',friction:0,restitution:0,damping:0,collisionFamily:0}});
  p.contactPairs=[{id:'ball-beam',name:'撞击球 ↔ 弹性梁',a:'impactor',b:'beam',mechanical:true,thermal:false,stiffness:1e5,damping:20,friction:.2,contactConductance:0}];
  return p;
}
