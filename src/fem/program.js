import {normalizeCurves,curveValue,curveIntegral,curveBounds} from '../simulation/curves.js';

// FEM bindings reference the same stable part IDs as other load programs.
// The load ID identifies the face load; force components are world coordinates.
export function normalizeFEMProgram(project){
  project.curves=normalizeCurves(project.curves);
  const ids=new Set(),channels=new Set();
  if(!Array.isArray(project.loadBindings)||project.loadBindings.length>128)throw Error('最多 128 个曲线绑定');
  project.loadBindings=project.loadBindings.map(b=>{
    const load=project.loads.find(l=>l.id===b.load&&l.target===b.target),c=project.curves.find(c=>c.id===b.curve);
    if(!b||typeof b.id!=='string'||!/^[-\w]{1,40}$/.test(b.id)||ids.has(b.id))throw Error('曲线绑定 ID 无效或重复');ids.add(b.id);
    if(!c||!load||!['fem-force','fem-pressure'].includes(b.kind)||load.type!==b.kind)throw Error('FEM 曲线须引用已有面载荷与时间曲线');
    const component=b.kind==='fem-force'?b.component:null,enabled=b.enabled??true,scale=b.scale??1,offset=b.offset??0;
    if(b.kind==='fem-force'&&(!Number.isInteger(component)||component<0||component>2))throw Error('面力曲线需要 X / Y / Z 分量');
    if(typeof enabled!=='boolean'||![scale,offset].every(Number.isFinite)||curveBounds(c).some(v=>Math.abs(offset+scale*v)>1e12))throw Error('FEM 曲线倍率、偏置或峰值无效');
    const channel=[b.load,component].join(':');if(enabled&&channels.has(channel))throw Error('同一载荷分量不能绑定多条启用曲线');if(enabled)channels.add(channel);
    return {id:b.id,name:String(b.name??b.id).slice(0,80),kind:b.kind,target:b.target,load:b.load,curve:b.curve,component,scale,offset,enabled};
  });
  return project;
}
export const femBindingValue=(b,c,t)=>b.offset+b.scale*curveValue(c,t);
export const femBindingIntegral=(b,c,a,z)=>b.offset*(z-a)+b.scale*curveIntegral(c,a,z);
export function programEvents(project){
  const curves=new Set(project.loadBindings.filter(b=>b.enabled).map(b=>b.curve));
  return [...new Set(project.curves.filter(c=>curves.has(c.id)).flatMap(c=>c.points?c.points.map(p=>p[0]):[c.start,c.end]))].sort((a,b)=>a-b);
}
