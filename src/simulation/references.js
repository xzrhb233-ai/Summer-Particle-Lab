import {add,sub,rotate,inverse,quaternion,qmul,norm} from '../multibody/model.js';
import {attachmentDefinitions} from '../multibody/attachment-model.js';
import {validateSurfaceRegion} from './surface-selections.js';

const ident = value => typeof value==='string' && /^[-\w]{1,40}$/.test(value);
const vector = (v,limit=1000) => Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=limit);
export const localPoint = (part,world) => rotate(inverse(quaternion(part.geometry.rotation??[0,0,0])),sub(world,part.geometry.center));
export function inSelection(set,local) {
  return set.region.type==='whole'||local.every((x,k)=>x>=set.region.lower[k]-1e-9&&x<=set.region.upper[k]+1e-9);
}

// References belong to the editable document, never to a particular solver.
// Particle sets select material points at initialization, not an Eulerian box
// that continuously admits/removes points as the specimen deforms.
export function validateReferences(p) {
  p.frames??=[];p.selectionSets??=[];
  const parts=new Map(p.parts.map(b=>[b.id,b]));
  for(const [items,label] of [[p.frames,'参考点'],[p.selectionSets,'选择集']]){
    if(!Array.isArray(items)||items.length>256)throw Error(label+'最多 256 个');
    const ids=new Set();
    for(const item of items){
      if(!item||!ident(item.id)||ids.has(item.id))throw Error(label+' ID 无效或重复');
      ids.add(item.id);
      if(typeof item.name!=='string'||item.name.length>80)throw Error(label+'名称无效');
    }
  }
  for(const f of p.frames){
    if(f.part!==null&&!parts.has(f.part))throw Error('参考点所属部件不存在');
    if(!vector(f.position)||!vector(f.rotation,360))throw Error('参考点坐标或方向无效');
  }
  for(const s of p.selectionSets){
    if(s.region?.type==='surface'){
      if(parts.get(s.part)?.method!=='fem'||s.entity!=='face')throw Error('命名表面选择集需要 FEM 部件与 face 实体');
      validateSurfaceRegion(parts.get(s.part),s.region);continue;
    }
    if(s.region?.type==='face'){
      if(parts.get(s.part)?.method!=='fem'||s.entity!=='face'||!['x-','x+','y-','y+','z-','z+'].includes(s.region.face))throw Error('FEM 几何面选择集无效');
      continue;
    }
    if(!parts.has(s.part)||!s.region||!['whole','box'].includes(s.region.type))throw Error('选择集所属部件或区域无效');
    if(s.region.type==='box'&&(!vector(s.region.lower)||!vector(s.region.upper)||s.region.lower.some((x,k)=>x>=s.region.upper[k])))throw Error('选择框下限必须小于上限');
  }
  for(const j of p.connections){
    if(j.type==='region'){
      const f=p.frames.find(f=>f.id===j.endpoints?.a?.frame),s=p.selectionSets.find(s=>s.id===j.endpoints?.b?.selection);
      if(!f||!s||f.part!==j.a||s.part!==j.b||parts.get(j.a)?.method!=='rigid'||parts.get(j.b)?.method!=='mpm')throw Error('区域连接必须连接刚体参考点与 MPM 选择集');
      attachmentDefinitions([{...j,body:j.a,part:j.b,frame:f,selection:s}]);continue;
    }
    if(!j.endpoints)continue;
    for(const side of ['a','b']){
      const f=p.frames.find(f=>f.id===j.endpoints[side]?.frame);
      if(!f||f.part!==j[side])throw Error('连接端点必须引用相应部件的参考点');
    }
  }
  for(const l of p.loads)if(l.type==='fixed-selection'){
    const s=p.selectionSets.find(s=>s.id===l.selection);
    if(!s||s.part!==l.target)throw Error('固定区域必须引用目标部件的选择集');
    if(parts.get(l.target).method!=='mpm')throw Error('区域固定当前仅支持 MPM 固体');
  }
  return p;
}

export function framePose(p,id,snapshot=null) {
  const f=p.frames.find(f=>f.id===id);if(!f)throw Error('参考点不存在');
  const part=p.parts.find(b=>b.id===f.part),body=snapshot?.bodies?.find(b=>b.id===f.part);
  const q=body?.rotation??(part?quaternion(part.geometry.rotation??[0,0,0]):[0,0,0,1]);
  return {...f,position:add(body?.position??part?.geometry.center??[0,0,0],rotate(q,f.position)),orientation:qmul(q,quaternion(f.rotation)),
    initialOnly:!!part&&part.method!=='rigid'};
}

export function compileConnection(p,j) {
  if(!j.endpoints)return j;
  const A=framePose(p,j.endpoints.a.frame),B=framePose(p,j.endpoints.b.frame);
  if(p.parts.some(b=>[j.a,j.b].includes(b.id)&&b.method!=='rigid'))throw Error('参考点关节当前仅支持刚体；柔性区域连接尚未接入');
  if(j.type==='gear')throw Error('齿轮传动请使用原有轴与机架定义');
  const axis=rotate(A.orientation,[0,0,1]);
  if(['revolute','prismatic','planar','fixed'].includes(j.type)){
    if(norm(sub(axis,rotate(B.orientation,[0,0,1])))>1e-5)throw Error('连接两端参考点的 Z 轴须同向');
    if(['fixed','prismatic'].includes(j.type)&&Math.abs(A.orientation.reduce((sum,x,k)=>sum+x*B.orientation[k],0))<1-1e-6)throw Error('固定副与移动副的两端参考坐标系须同向');
  }
  if(!['spring','prismatic','planar'].includes(j.type)&&norm(sub(A.position,B.position))>1e-5)throw Error('此连接的两端参考点必须重合，请先调整局部位置');
  if(j.type==='prismatic'&&norm(sub(sub(B.position,A.position),axis.map(x=>x*sub(B.position,A.position).reduce((v,y,k)=>v+y*axis[k],0))))>1e-5)throw Error('移动副的参考点须位于同一轴线上');
  if(j.type==='planar'&&Math.abs(sub(B.position,A.position).reduce((v,y,k)=>v+y*axis[k],0))>1e-5)throw Error('平面副的参考点须位于同一平面');
  const relative=qmul(inverse(A.orientation),B.orientation),angle=2*Math.atan2(relative[2],relative[3]);
  return {...j,anchor:A.position,anchorB:B.position,axis,separateAnchors:true,...(j.type==='revolute'?{angleOffset:Math.atan2(Math.sin(angle),Math.cos(angle))}:{})};
}

export function removeReference(p,kind,id) {
  const next=structuredClone(p);
  if(kind==='frame'){
    next.frames=next.frames.filter(f=>f.id!==id);
    next.connections=next.connections.filter(j=>!Object.values(j.endpoints??{}).some(e=>e.frame===id));
  }else{
    next.selectionSets=next.selectionSets.filter(s=>s.id!==id);
    next.loads=next.loads.filter(l=>l.selection!==id);
    next.connections=next.connections.filter(j=>j.endpoints?.b?.selection!==id);
  }
  if(next.loadBindings)next.loadBindings=next.loadBindings.filter(b=>b.kind!=='motor-target'||next.connections.some(j=>j.id===b.target));
  return next;
}

export function convertConnectionToReferences(input,id) {
  const p=structuredClone(input),j=p.connections.find(j=>j.id===id);
  if(!j||j.type==='gear')throw Error('请选择非齿轮连接');
  if(j.endpoints)return p;
  const axis=j.axis,world=quaternion([0,Math.atan2(Math.hypot(axis[0],axis[1]),axis[2])*180/Math.PI,Math.atan2(axis[1],axis[0])*180/Math.PI]);
  j.endpoints={};
  for(const side of ['a','b']){
    const part=p.parts.find(b=>b.id===j[side]),[x,y,z,w]=qmul(inverse(quaternion(part.geometry.rotation)),world);
    const rotation=[Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y)),Math.asin(Math.max(-1,Math.min(1,2*(w*y-z*x)))),Math.atan2(2*(w*z+x*y),1-2*(y*y+z*z))].map(x=>x*180/Math.PI);
    let n=1;while(p.frames.some(f=>f.id==='ref-'+n))n++;
    const frame='ref-'+n,anchor=side==='b'&&(j.type==='spring'||j.separateAnchors)?j.anchorB:j.anchor;
    p.frames.push({id:frame,name:(j.name+' / '+side.toUpperCase()).slice(0,80),part:part.id,position:localPoint(part,anchor),rotation});
    j.endpoints[side]={frame};
  }
  return validateReferences(p);
}

export class ReferenceResults {
  constructor(project,initial) {
    this.project=project;this.members=new Map();let offset=0;
    for(const part of project.parts.filter(b=>['mpm','pbf'].includes(b.method))){
      const count=initial.results?.parts.find(b=>b.id===part.id)?.values.count??0;
      for(const s of project.selectionSets.filter(s=>s.part===part.id)){
        const indices=[];
        for(let i=offset;i<offset+count;i++)if(inSelection(s,localPoint(part,Array.from(initial.particles.subarray(i*8,i*8+3)))))indices.push(i);
        this.members.set(s.id,indices);
      }
      offset+=count;
    }
  }
  sample(frame,filter={}) {
    const frames=this.project.frames.filter(f=>filter.frameID===undefined||f.id===filter.frameID).map(f=>framePose(this.project,f.id,frame));
    const selections=this.project.selectionSets.filter(s=>filter.setID===undefined||s.id===filter.setID).map(s=>{
      const indices=this.members.get(s.id),part=this.project.parts.find(p=>p.id===s.part);
      if(!indices)return {id:s.id,name:s.name,part:s.part,count:null,position:frame.bodies?.find(b=>b.id===s.part)?.position??part.geometry.center,temperature:null};
      const position=[0,0,0];let temperature=0;
      for(const i of indices){for(let k=0;k<3;k++)position[k]+=frame.particles[i*8+k];temperature+=frame.particles[i*8+4];}
      return {id:s.id,name:s.name,part:s.part,count:indices.length,position:indices.length?position.map(x=>x/indices.length):null,temperature:indices.length?temperature/indices.length:null};
    });
    return {frames,selections};
  }
}
