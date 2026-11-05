// Declarative authoring commands only. No paths, expressions or executable code.
import {normalizeProject} from './project.js';
import {normalizeCurves} from './curves.js';
import {normalizeFEMProgram} from '../fem/program.js';
import {validateSurfaceRegion} from './surface-selections.js';

const selectionFields=['id','name','part','entity','region'];
const loadFields=['id','name','type','target','selection','force','pressure','region','power','temperature','coefficient','enabled','program'];
const curveFields=['id','name','type','points','start','end','amplitude','frequency','phase','offset'];
const bindingFields=['id','name','kind','target','load','curve','component','scale','offset','enabled'];
export const PHYSICS_COMMANDS=Object.freeze(Object.fromEntries([
  ['selection',selectionFields],['load',loadFields],['curve',curveFields],['binding',bindingFields]
].flatMap(([name,fields])=>['create','update','delete'].map(action=>[name+'.'+action,action==='delete'?['id']:fields]))));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
function keys(o,allowed,label){if(!plain(o))throw Error(label+'须为普通对象');for(const k of Object.keys(o))if(!allowed.includes(k))throw Error(label+'不允许字段：'+k);}
function id(v){if(typeof v!=='string'||!/^[-\w]{1,40}$/.test(v))throw Error('物理对象 ID 无效');}
function name(v){if(v!==undefined&&(typeof v!=='string'||!v.trim()||v.length>80))throw Error('名称须为 1–80 字');}
function finite(v,lo,hi,label){if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)throw Error(label+'超出范围');}
function vector(v,label){if(!Array.isArray(v)||v.length!==3)throw Error(label+'须为三维向量');v.forEach(x=>finite(x,-1e12,1e12,label));}
function region(r,part,{thermal=false}={}){
  keys(r,['type','face','surface','lower','upper'],'选择区域');
  if(r.type==='surface'){keys(r,['type','surface'],'命名表面');validateSurfaceRegion(part,r);return;}
  if(r.type==='face'){keys(r,['type','face'],'几何面');if(!['x-','x+','y-','y+','z-','z+'].includes(r.face)||!thermal&&part.method!=='fem')throw Error('几何面仅支持 FEM 六个局部面');return;}
  if(r.type==='whole'){keys(r,['type'],'整个部件');return;}
  if(r.type==='box'&&!thermal){keys(r,['type','lower','upper'],'选择框');vector(r.lower,'下限');vector(r.upper,'上限');if(r.lower.some((v,k)=>v>=r.upper[k]))throw Error('选择框下限须小于上限');return;}
  throw Error('不支持的选择区域');
}
const types=['fem-fixed','fem-force','fem-pressure','fixed-selection','thermal-power','thermal-temperature','thermal-convection'];
function validateLoad(p,l){
  if(!types.includes(l.type))throw Error('AI 只支持 FEM 面约束/力/压力、MPM 选区固定及统一热载荷');
  const part=p.parts.find(b=>b.id===l.target);if(!part)throw Error('载荷目标不存在');
  if(l.type.startsWith('fem-')||l.type==='fixed-selection'){
    const s=p.selectionSets.find(s=>s.id===l.selection);if(!s||s.part!==l.target)throw Error('载荷须引用目标部件的选择集');
    if(l.type==='fixed-selection'){if(part.method!=='mpm'||!['whole','box'].includes(s.region.type))throw Error('区域固定仅支持 MPM 整体/包围盒选择集');}
    else if(part.method!=='fem'||s.entity!=='face'||!['face','surface'].includes(s.region.type))throw Error('FEM 载荷需要 FEM 面选择集');
    if(l.type==='fem-force')vector(l.force,'面总力');
    if(l.type==='fem-pressure')finite(l.pressure,-1e12,1e12,'压力');
  }else{
    if(l.selection!==undefined){const s=p.selectionSets.find(s=>s.id===l.selection);if(!s||s.part!==l.target||s.entity!=='face')throw Error('热载荷须引用目标部件的面选择集');}
    region(l.region??{type:'whole'},part,{thermal:true});
    if(l.enabled!==undefined&&typeof l.enabled!=='boolean')throw Error('热载荷开关须为布尔值');
    if(l.type==='thermal-power')finite(l.power,-1e7,1e7,'热功率');else finite(l.temperature,-273.15,2000,'温度');
    if(l.type==='thermal-convection')finite(l.coefficient,0,1e5,'对流系数');
  }
}
function loadKeys(l){return ['id','name','type','target',...(l.type==='fixed-selection'||l.type==='fem-fixed'?['selection']:l.type==='fem-force'?['selection','force']:l.type==='fem-pressure'?['selection','pressure']:['selection','region','enabled','program',...(l.type==='thermal-power'?['power']:l.type==='thermal-temperature'?['temperature']:['temperature','coefficient'])])];}
function curveKeys(c){return ['id','name','type',...(c.type==='sine'?['start','end','amplitude','frequency','phase','offset']:['points'])];}

export function applyPhysicsCommand(project,command,args){
  if(!own(PHYSICS_COMMANDS,command))throw Error('未知物理命令');
  keys(args,PHYSICS_COMMANDS[command],command);id(args.id);name(args.name);
  const p=structuredClone(project),[kind,action]=command.split('.'),collection={selection:'selectionSets',load:'loads',curve:'curves',binding:'loadBindings'}[kind];
  p[collection]??=[];const list=p[collection],index=list.findIndex(v=>v.id===args.id),old=list[index];
  if(action==='create'&&old)throw Error('对象 ID 已存在：'+args.id);
  if(action!=='create'&&!old)throw Error('对象不存在：'+args.id);
  if(action==='delete'){
    if(kind==='selection'&&(p.loads.some(l=>l.selection===args.id)||p.connections.some(c=>Object.values(c.endpoints??{}).some(e=>e.selection===args.id))))throw Error('选择集仍被载荷或连接使用，请先删除关联对象');
    if(kind==='load'&&p.loadBindings.some(b=>b.load===args.id))throw Error('载荷仍被时间曲线绑定，请先删除绑定');
    if(kind==='curve'&&p.loadBindings.some(b=>b.curve===args.id))throw Error('时间曲线仍被绑定，请先删除绑定');
    if(kind==='load'&&!types.includes(old.type))throw Error('AI 不能删除此类载荷');
    if(kind==='binding'&&!['fem-force','fem-pressure'].includes(old.kind))throw Error('AI 仅支持 FEM 时间曲线绑定');
    list.splice(index,1);
  }else{
    const item={...(old??{}),...structuredClone(args)};item.name??=item.id;
    if(kind==='selection'){
      const part=p.parts.find(b=>b.id===item.part);if(!part)throw Error('选择集部件不存在');region(item.region,part);
      if(['surface','face'].includes(item.region.type)){if(part.method!=='fem')throw Error('面选择集仅支持 FEM');item.entity='face';}
      else if(item.entity!==undefined&&item.entity!=='volume')throw Error('区域选择集 entity 须为 volume');
      if(args.entity!==undefined&&args.entity!==item.entity)throw Error('选择集实体类型与区域不一致');
    }else if(kind==='load'){
      if(old&&item.type!==old.type)throw Error('更新载荷不可改变类型，请删除后创建');
      keys(args,loadKeys(item),'载荷');
      if(args.selection!==undefined&&args.region!==undefined)throw Error('热载荷只指定 selection 或 region，不同时指定');
      if(item.type.startsWith('thermal-')&&args.region!==undefined)delete item.selection;
      if(args.region)region(args.region,p.parts.find(b=>b.id===item.target),{thermal:true});
      if(args.program!==undefined&&args.program!==null){keys(args.program,['type','points'],'热时间表');if(!['linear','smooth','step'].includes(args.program.type))throw Error('热时间表只支持 linear/smooth/step');normalizeCurves([{...args.program,id:item.id}]);}
      if(item.program===null)delete item.program;
      validateLoad(p,item);
    }else if(kind==='curve'){
      if(old&&item.type!==old.type)throw Error('更新曲线不可改变类型，请删除后创建');
      keys(args,curveKeys(item),'时间曲线');Object.assign(item,normalizeCurves([item])[0]);
    }else{
      if(!['fem-force','fem-pressure'].includes(item.kind))throw Error('AI 仅支持 FEM 力/压力时间绑定');
      if(p.solver.adapter==='cpu-fem-static')throw Error('时间曲线绑定需要瞬态 FEM 求解器');
      if(item.kind==='fem-pressure'&&args.component!==undefined)throw Error('压力时间绑定不接受向量分量');
      if(old&&item.kind!==old.kind)throw Error('更新绑定不可改变类型');
    }
    if(action==='create')list.push(item);else list[index]=item;
  }
  const next=normalizeProject(p);
  for(const l of next.loads)if(types.includes(l.type))validateLoad(next,l);
  // Only FEM bindings are exposed. Validate them without reinterpreting other
  // existing solver-owned bindings in a mixed document.
  const femBindings=next.loadBindings.filter(b=>['fem-force','fem-pressure'].includes(b.kind));
  if(femBindings.length){const validated=normalizeFEMProgram({...next,loadBindings:femBindings}).loadBindings;const map=new Map(validated.map(b=>[b.id,b]));next.loadBindings=next.loadBindings.map(b=>map.get(b.id)??b);}
  return next;
}
