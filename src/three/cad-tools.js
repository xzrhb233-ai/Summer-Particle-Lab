import {validateCAD} from './cad-geometry.js';

const vec=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=100);
const keys=(o,allowed)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))throw Error('曲线或网格参数字段无效');};
const number=(v,min,max,label)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw Error(label+'超出范围');};
export function validateCurveSpec(input){
  const kind=input?.kind,allowed={line:['points'],circle:['center','radius','rotation'],arc:['center','radius','rotation','startAngle','endAngle'],bezier:['controlPoints'],bspline:['controlPoints','degree']}[kind];
  if(!allowed)throw Error('不支持的曲线类型');keys(input,['kind','samples',...allowed]);
  const s=structuredClone(input);s.samples??=64;number(s.samples,8,512,'曲线分段数');if(!Number.isInteger(s.samples))throw Error('曲线分段数须为整数');
  if(['circle','arc'].includes(kind)){
    if(!vec(s.center))throw Error('曲线中心须为三个有限坐标');number(s.radius,.001,12,'半径');s.rotation??=[0,0,0];
    if(!Array.isArray(s.rotation)||s.rotation.length!==3||s.rotation.some(x=>!Number.isFinite(x)||Math.abs(x)>360))throw Error('旋转角须在 ±360° 内');
    if(kind==='arc'){number(s.startAngle,-360,360,'起始角');number(s.endAngle,-360,360,'结束角');if(s.endAngle-s.startAngle<1e-5||s.endAngle-s.startAngle>=360)throw Error('圆弧转角须大于0且小于360°，整圆请选择圆');}
  }else{
    const points=kind==='line'?s.points:s.controlPoints,max=kind==='line'?2:kind==='bezier'?9:32;
    if(!Array.isArray(points)||points.length<2||points.length>max||!points.every(vec))throw Error('控制点数量或坐标无效');
    if(points.every(p=>p.every((x,k)=>Math.abs(x-points[0][k])<1e-12)))throw Error('曲线控制点不能全部重合');
    if(kind==='bspline'){number(s.degree,1,Math.min(5,points.length-1),'B 样条次数');if(!Number.isInteger(s.degree))throw Error('B 样条次数须为整数');}
  }
  return Object.fromEntries(['kind',...allowed,'samples'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
}
export function validateCurve(c){
  if(c?.schema!=='summer-cad-curve/1'||c.kernel!=='SMLib')throw Error('SMLib 曲线数据无效');
  const s=validateCurveSpec(c.spec);
  if(!Array.isArray(c.points)||c.points.length!==s.samples+1||!c.points.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))||!Number.isFinite(c.length)||c.length<=0||typeof c.closed!=='boolean')throw Error('SMLib 曲线采样无效');
  if(!c.bounds||!['lower','upper'].every(k=>Array.isArray(c.bounds[k])&&c.bounds[k].length===3&&c.bounds[k].every(Number.isFinite)))throw Error('曲线包围盒无效');
  return c;
}
export function normalizeCADCurves(input){
  if(input===undefined)return undefined;
  if(!Array.isArray(input)||input.length>32)throw Error('每个项目最多32条几何曲线');
  const ids=new Set();return input.map(c=>{
    keys(c,['id','name','data']);if(typeof c.id!=='string'||!/^[-\w]{1,40}$/.test(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80)throw Error('几何曲线名称或 ID 无效');ids.add(c.id);
    return {id:c.id,name:c.name,data:structuredClone(validateCurve(c.data))};
  });
}
export function validateMeshOptions(input){
  keys(input,['kind','targetSize','angleTolerance','chordTolerance']);
  if(!['surface','volume'].includes(input.kind))throw Error('请选择表面三角网格或四面体体网格');
  const s={kind:input.kind,targetSize:input.targetSize??.15,angleTolerance:input.angleTolerance??15,chordTolerance:input.chordTolerance??.002};
  number(s.targetSize,.005,12,'目标网格边长');number(s.angleTolerance,3,45,'角度容差');number(s.chordTolerance,.00001,.1,'弦高容差');return s;
}
export function validateCADMesh(m){
  if(m?.schema!=='summer-cad-mesh/1'||!['surface','volume'].includes(m.kind))throw Error('CAD 网格数据无效');
  validateCAD(m.cad);validateMeshOptions(m.options);if(m.options.kind!==m.kind)throw Error('网格结果类型与网格设置不一致');
  const n=m.nodes,arity=m.kind==='volume'?4:3,limit=m.kind==='volume'?5000:50000;
  if(!Array.isArray(n)||n.length<4||n.length>limit||!n.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))throw Error('网格节点无效或超过容量');
  const valid=(a,k)=>Array.isArray(a)&&a.length===k&&new Set(a).size===k&&a.every(i=>Number.isInteger(i)&&i>=0&&i<n.length);
  if(!Array.isArray(m.elements)||!m.elements.length||m.elements.length>(arity===4?24000:100000)||!m.elements.every(e=>valid(e,arity))||!Array.isArray(m.surface)||m.surface.length>100000||!m.surface.every(e=>valid(e,3)))throw Error('网格连接关系无效');
  return m;
}
export function meshToVTK(mesh){
  validateCADMesh(mesh);const arity=mesh.kind==='volume'?4:3,type=arity===4?10:5;
  return ['# vtk DataFile Version 3.0','Summer CAD '+mesh.kind,'ASCII','DATASET UNSTRUCTURED_GRID',`POINTS ${mesh.nodes.length} double`,...mesh.nodes.map(p=>p.join(' ')),`CELLS ${mesh.elements.length} ${mesh.elements.length*(arity+1)}`,...mesh.elements.map(e=>[arity,...e].join(' ')),`CELL_TYPES ${mesh.elements.length}`,...mesh.elements.map(()=>String(type)),''].join('\n');
}
export function meshToOBJ(mesh){validateCADMesh(mesh);return ['# Summer CAD surface (not volume elements)',...mesh.nodes.map(p=>'v '+p.join(' ')),...mesh.surface.map(e=>'f '+e.map(i=>i+1).join(' ')),''].join('\n');}
