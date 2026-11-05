import {PROJECT_SCHEMA, normalizeProject, emptyCoupling} from './project.js';
import {couplingParameters} from '../multibody/coupling-model.js';
import {femPart} from '../fem/model.js';
import {domainParameters, geometryParameters, geometryPoints, rotationXYZ} from '../three/discretization.js';
import {validateCAD} from '../three/cad-geometry.js';
import {validateExplicitMesh} from '../fem/explicit-mesh.js';
import {validateParametricPart} from './cad-parametric.js';

// Authoring operations work on the canonical document, never a solver's lossy
// projection. In particular, adding a FEM part must not replace existing solids.
export const PART_METHODS = Object.freeze([
  {id:'mpm',label:'MPM 固体',shapes:['box','ellipsoid','cylinder']},
  {id:'fem',label:'FEM 弹性体',shapes:['box']},
  {id:'rigid',label:'刚体',shapes:['sphere','box','cylinder','disc','torus']},
  {id:'pbf',label:'PBF 流体',shapes:['box','ellipsoid','cylinder']},
].map(v=>Object.freeze({...v,shapes:Object.freeze(v.shapes)})));
const copy=v=>structuredClone(v),particle=b=>['mpm','pbf'].includes(b.method);
const vector=(v,label)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(label+'需要三个有限数值');};
const number=(v,lo,hi,label)=>{if(!Number.isFinite(v)||v<lo||v>hi)throw Error(label+'超出范围');};
const merge=(a,b)=>{
  const r=copy(a);
  for(const [k,v] of Object.entries(b??{}))if(v!==undefined)r[k]=v&&typeof v==='object'&&!Array.isArray(v)&&r[k]&&typeof r[k]==='object'&&!Array.isArray(r[k])?merge(r[k],v):copy(v);
  return r;
};
function nextID(prefix,items){let i=1;while(items.some(v=>v.id===prefix+'-'+i))i++;return prefix+'-'+i;}

export function emptyProject({name='统一多物理场项目'}={}){
  return normalizeProject({schema:PROJECT_SCHEMA,name,
    units:{length:'m',mass:'kg',time:'s',temperature:'degC'},parts:[],loads:[],connections:[],couplings:[],contactPairs:[],frames:[],selectionSets:[],curves:[],loadBindings:[],
    environment:{gravity:[0,-9.81,0]},discretization:{mpm:null},
    solver:{adapter:'cpu-coupled',dt:1/480,iterations:12,mpmEnabled:false,stiffness:1}});
}

export function createPart(method,options={}){
  const kind=PART_METHODS.find(v=>v.id===method);if(!kind)throw Error('未知部件方法');
  let base;
  if(method==='fem'){
    base=femPart('fem-1',{name:kind.label,center:[0,.5,0],size:[1,.12,.4],divisions:[8,2,4],young:4e6});
    base.boundary.fixedFace='x-';
  }else if(method==='rigid')base={id:'rigid-1',name:kind.label,method,
    geometry:{shape:'sphere',center:[0,1,0],size:[.3,.3,.3],rotation:[0,0,0],appearance:null},
    material:{mass:1,cp:500,conductivity:50},initial:{temperature:20,velocity:[0,0,0],angularVelocity:[0,0,0]},
    boundary:{motion:'dynamic',friction:.3,restitution:0,damping:0,collisionFamily:0}};
  else {
    const sample=couplingParameters({enabled:true,parts:[{method,center:[0,1,0],size:[.4,.4,.4],model:0,phaseChange:{enabled:false},sampling:{enabled:false}}]}).parts[0];
    const {center,size,shape,rotation,temperature,velocity,fixedFace,sampling,name,...material}=sample;
    delete material.method;
    base={id:method+'-1',name:kind.label,method,geometry:{shape,center,size,rotation},material,
      initial:{temperature,velocity},boundary:{fixedFace},discretization:{sampling}};
  }
  const b=merge(base,options);b.method=method;
  if(typeof b.id!=='string'||!/^[-\w]{1,40}$/.test(b.id))throw Error('部件 ID 无效');
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw Error('部件名称需要 1–80 字');
  if(b.geometry.shape==='cad'&&['mpm','pbf','fem'].includes(method))validateCAD(b.geometry.cad);
  else if(!kind.shapes.includes(b.geometry.shape))throw Error(kind.label+'不支持该形状');
  if(b.geometry.shape!=='cad')delete b.geometry.cad;
  if(b.modeling!=null)b.modeling=validateParametricPart(b);else delete b.modeling;
  vector(b.geometry.center,'中心');vector(b.geometry.size,'尺寸');vector(b.geometry.rotation,'旋转');vector(b.initial.velocity,'初速度');
  if(b.geometry.size.some(v=>v<=0||v>100))throw Error('尺寸须大于 0 且不超过 100 m');
  if(b.geometry.rotation.some(v=>Math.abs(v)>360))throw Error('旋转角须在 ±360° 内');
  number(b.initial.temperature,-273.15,2000,'初始温度');
  if(method==='fem'){
    const m=b.material,d=b.discretization;
    if(m.model!=='linear-elastic')throw Error('当前 FEM 使用线弹性本构');
    number(m.young,1e-10,1e13,'杨氏模量');number(m.poisson,-.899999,.489999,'泊松比');number(m.density,1e-10,1e10,'密度');
    number(m.cp,1,100000,'比热容');number(m.conductivity,0,10000,'导热率');
    if(b.geometry.shape==='cad'){
      if(d.element!=='tet4')throw Error('CAD FEM 需要 Tet4 四面体网格');validateExplicitMesh(d.mesh,b.geometry.cad);
    }else{
      delete d.mesh;
      vector(d.divisions,'网格划分');if(d.element!=='tet4'||d.divisions.some(v=>!Number.isInteger(v)||v<1||v>100))throw Error('Tet4 每轴划分须为 1–100 的整数');
    }
    if(!['x-','x+','y-','y+','z-','z+'].includes(b.boundary.fixedFace))throw Error('当前 FEM 需选择一个固定面');
  }else if(method==='rigid'){
    const s=b.geometry.size,shape=b.geometry.shape;
    if(s.some(v=>v<.02))throw Error('刚体各方向尺寸须至少 0.02 m');
    if(shape==='sphere'&&(s[0]!==s[1]||s[1]!==s[2])||shape==='cylinder'&&s[0]!==s[2]||['disc','torus'].includes(shape)&&s[0]!==s[1])throw Error('球、圆柱或圆盘的直径须相等');
    if(shape==='torus'&&s[2]>=s[0]/2)throw Error('轮胎管径须小于外径的一半');
    number(b.material.mass,.001,1e6,'刚体质量');number(b.material.cp,1,100000,'比热容');number(b.material.conductivity,0,10000,'导热率');
    vector(b.initial.angularVelocity,'角速度');
    if(!['fixed','dynamic'].includes(b.boundary.motion))throw Error('刚体运动类型无效');
    if(b.boundary.motion==='fixed'&&[...b.initial.velocity,...b.initial.angularVelocity].some(Boolean))throw Error('固定刚体的初速度须为零');
  }
  return b;
}

function bounds(part){
  const g=part.geometry,R=rotationXYZ(g.rotation??[0,0,0]),half=g.size.map(x=>x/2);
  // A rotated box enclosing the shape is conservative for spheres, cylinders
  // and ellipsoids too; placement never relies on their narrower curved parts.
  const extent=[0,1,2].map(a=>half.reduce((sum,h,k)=>sum+Math.abs(R[3*a+k])*h,0));
  return {lower:g.center.map((x,k)=>x-extent[k]),upper:g.center.map((x,k)=>x+extent[k])};
}

export function proposeNewPart(project,method){
  const b=createPart(method,{id:nextID(method,project?.parts??[])}),domain=project?.discretization?.mpm??emptyCoupling().domain;
  const padding=Math.max(.02,domain.cellSize*.25),half=b.geometry.size.map(x=>x/2),origin=b.geometry.center.slice();
  const axes=half.map((h,k)=>{
    const lo=domain.lower[k]+h+padding,hi=domain.upper[k]-h-padding;if(lo>hi)return [];
    const step=Math.max(domain.cellSize,2*h+2*padding),values=[Math.max(lo,Math.min(hi,origin[k]))];
    // Limit the search independently of world size. Always consider both edges.
    const n=Math.min(30,Math.max(1,Math.floor((hi-lo)/step)));
    for(let i=0;i<=n;i++)values.push(lo+(hi-lo)*i/n);
    return [...new Set(values)].sort((a,c)=>Math.abs(a-origin[k])-Math.abs(c-origin[k]));
  });
  const occupied=(project?.parts??[]).map(bounds);
  for(const x of axes[0])for(const y of axes[1])for(const z of axes[2]){
    const center=[x,y,z],free=occupied.every(a=>center.some((v,k)=>v+half[k]+padding<=a.lower[k]+1e-10||v-half[k]-padding>=a.upper[k]-1e-10));
    if(free){b.geometry.center=center;return b;}
  }
  // Do not resize a material, move existing parts, or expand an authored grid.
  // The form displays this message and lets the user choose a placement.
  b.placementWarning='当前计算域内未找到足够的空位。请调整新部件的位置或尺寸，或在专业建模工具中扩大计算域。';
  return b;
}

function support(p,b){
  const id='support-'+b.id.slice(0,32),loadID='fix-'+b.id.slice(0,36);
  const oldLoad=p.loads.find(l=>l.type==='fem-fixed'&&l.target===b.id),oldSet=p.selectionSets.find(s=>s.id===oldLoad?.selection);
  if(oldSet?.part===b.id&&oldSet.region.type==='face'&&!p.loads.some(l=>l!==oldLoad&&l.selection===oldSet.id)){
    oldSet.region.face=b.boundary.fixedFace;return;
  }
  // A change to the builder's support does not delete user face loads or sets.
  const existing=p.selectionSets.find(s=>s.id===id);
  if(existing&&existing.part!==b.id)throw Error('固定面选择集 ID 已被使用');
  const load=p.loads.find(l=>l.id===loadID);
  if(load&&(load.target!==b.id||load.type!=='fem-fixed'))throw Error('固定面载荷 ID 已被使用');
  const s={id,name:b.name+' · 固定面',part:b.id,entity:'face',region:{type:'face',face:b.boundary.fixedFace}};
  if(existing)Object.assign(existing,s);else p.selectionSets.push(s);
  if(oldLoad)oldLoad.selection=id;
  else if(!load)p.loads.push({id:loadID,type:'fem-fixed',target:b.id,selection:id});
}

// Explicit MPM–PBF pairs control pressure neighborhoods and interface heat.
// Rigid-rigid collision is handled by the rigid solver itself.
export function addDefaultContactPairs(project,partID){
  const p=copy(project),part=p.parts.find(b=>b.id===partID);if(!part)throw Error('部件不存在');
  for(const other of p.parts){
    if(other.id===part.id||p.contactPairs.some(d=>[d.a,d.b].includes(part.id)&&[d.a,d.b].includes(other.id)))continue;
    let a,b;
    if(part.method==='fem'&&other.method==='fem'){a=other;b=part;}
    else if(part.method==='fem'&&(particle(other)||other.method==='rigid')){a=other;b=part;}
    else if(other.method==='fem'&&(particle(part)||part.method==='rigid')){a=part;b=other;}
    else if(part.method==='rigid'&&particle(other)){a=part;b=other;}
    else if(other.method==='rigid'&&particle(part)){a=other;b=part;}
    else if(part.method==='mpm'&&other.method==='mpm'){a=part;b=other;}
    else if(particle(part)&&particle(other)&&part.method!==other.method){a=part.method==='mpm'?part:other;b=part.method==='pbf'?part:other;}
    if(!a)continue;
    if(b.method==='fem'&&a.method==='rigid'&&!['sphere','box','cylinder','disc'].includes(a.geometry.shape))throw Error('刚体–FEM 接触支持球、长方体、圆柱和圆盘；轮胎尚不支持');
    p.contactPairs.push({id:nextID('contact',p.contactPairs),name:a.name+' ↔ '+b.name,a:a.id,b:b.id,mechanical:true,thermal:true,
      friction:a.method==='mpm'&&b.method==='pbf'?0:.2,contactConductance:1000,...(['rigid','fem'].includes(a.method)&&b.method==='fem'?{stiffness:1e5,damping:20,...(a.method==='rigid'?{thermalArea:.001}:{})}:{})});
  }
  return p;
}

export function prepareProjectMethods(project){
  const p=copy(project),hasFEM=p.parts.some(b=>b.method==='fem'),hasParticles=p.parts.some(particle),oldAdapter=p.solver.adapter;
  p.discretization??={};
  if(hasParticles){
    const c=emptyCoupling();p.discretization.mpm??=c.domain;
    if(!p.couplings.length)p.couplings.push({id:'particle-contact',type:'contact',methods:['rigid','mpm'],mechanical:true,thermal:true,friction:.3,contactConductance:1000,thermalScale:1});
    p.couplings[0].methods=p.parts.some(b=>b.method==='pbf')?['rigid','mpm','pbf']:['rigid','mpm'];
    p.solver.mpmEnabled=true;p.solver.stiffness??=1;
    // Validate the current grid and particle geometry before committing an edit.
    const d=p.discretization.mpm,domain=domainParameters({...d,lower:d.lower.map(v=>v/.025),upper:d.upper.map(v=>v/.025),cellSize:d.cellSize/.025});
    const parts=p.parts.filter(particle).map(b=>({...b.material,...b.geometry,...b.initial,method:b.method,id:b.id,name:b.name,fixedFace:b.boundary?.fixedFace,sampling:b.discretization?.sampling}));
    couplingParameters({enabled:true,domain:d,parts});
    let count=0;
    for(const b of p.parts.filter(particle)){
      const g=geometryParameters({...b.geometry,center:b.geometry.center.map(v=>v/.025),size:b.geometry.size.map(v=>v/.025)},domain);
      const limit=p.solver.computeBackend==='gpu'?50000:16384;
      count+=geometryPoints(g,limit-count).length;
    }
  }else{
    p.solver.mpmEnabled=false;p.couplings=[];
    // A region heater is a global particle-domain load. With no particle
    // receiver left it cannot be projected into FEM or rigid-only analysis.
    p.loads=p.loads.filter(l=>l.type!=='region-heat');
    p.loadBindings=p.loadBindings.filter(b=>b.kind!=='region-heat');
  }
  if(hasFEM){
    p.solver.adapter=hasParticles||p.parts.some(b=>b.method==='rigid')?'cpu-fem-mpm':'cpu-fem-dynamic';
    p.solver.analysis='linear-dynamic';p.solver.thermal=true;
    p.solver.tolerance??=1e-8;p.solver.maxIterations??=4000;p.solver.safety??=.8;p.solver.damping??=.5;p.solver.duration??=.5;
    if(!oldAdapter.startsWith('cpu-fem-')){p.solver.dt=.0001;p.solver.initialState='rest';}
    else if(oldAdapter==='cpu-fem-static')p.solver.initialState='rest';
    else p.solver.initialState??='rest';
  }else{
    p.solver.adapter=oldAdapter==='taichi-coupled'?'taichi-coupled':'cpu-coupled';
    p.solver.dt=Math.max(1/7680,Math.min(1/60,p.solver.dt??1/480));
  }
  return normalizeProject(p);
}

export function addProjectPart(project,options){
  let p=normalizeProject(project);const method=options?.method;
  const b=createPart(method,{...options,id:options.id??nextID(method,p.parts)});
  if(p.parts.some(v=>v.id===b.id))throw Error('部件 ID 已存在');
  p.parts.push(b);if(b.method==='fem')support(p,b);
  p=addDefaultContactPairs(p,b.id);return prepareProjectMethods(p);
}

export function updateProjectPart(project,id,patch){
  const p=normalizeProject(project),index=p.parts.findIndex(b=>b.id===id);if(index<0)throw Error('部件不存在');
  const old=p.parts[index];
  if(patch?.method!==undefined&&patch.method!==old.method)throw Error('修改离散方法会使连接和载荷失效，请新建部件');
  if(patch?.id!==undefined&&patch.id!==id)throw Error('部件 ID 不可在编辑时修改');
  const draft=merge(old,patch);
  if(!Object.hasOwn(patch??{},'modeling')&&(patch?.geometry?.cad!==undefined||patch?.geometry?.shape!==undefined)){
    try{validateParametricPart(draft);}catch(error){
      if(error.issues?.every(i=>['parametric.stale','parametric.geometry'].includes(i.code)))delete draft.modeling;
      else throw error;
    }
  }
  const b=createPart(old.method,draft);p.parts[index]=b;
  if(b.method==='fem'&&patch?.boundary?.fixedFace!==undefined)support(p,b);
  return prepareProjectMethods(p);
}
