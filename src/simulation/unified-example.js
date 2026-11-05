import {emptyProject,addProjectPart} from './part-builder.js';

// Four independently editable parts, one clock and bidirectional interfaces.
// The falling sphere spans the solid/fluid boundary; both loads reach the FEM
// plate. Different initial temperatures make the thermal receivers observable.
export function unifiedExample(){
  let p=emptyProject({name:'统一耦合 · 刚体 / MPM / FEM / PBF'});
  p.environment.gravity=[0,-2,0];
  p.discretization.mpm={lower:[-1.2,-.3,-.9],upper:[1.2,1.5,.9],cellSize:.15,particlesPerAxis:2};
  p=addProjectPart(p,{id:'plate',name:'FEM 弹性底板',method:'fem',
    geometry:{center:[0,.275,0],size:[1.2,.2,.7]},
    material:{young:2e7,density:1200,cp:1500,conductivity:10},
    discretization:{divisions:[8,1,3]},boundary:{fixedFace:'x-'}});
  p=addProjectPart(p,{id:'solid',name:'MPM 热弹性块',method:'mpm',
    geometry:{center:[-.225,.525,0],size:[.3,.3,.3]},
    initial:{temperature:100},material:{model:0,density:1100}});
  p=addProjectPart(p,{id:'water',name:'PBF 冷水',method:'pbf',
    geometry:{center:[.1875,.5625,.0375],size:[.375,.375,.375]},
    initial:{temperature:20},material:{density:1000}});
  p=addProjectPart(p,{id:'sphere',name:'刚体撞击球',method:'rigid',
    geometry:{center:[-.0375,.94,0],size:[.3,.3,.3]},
    material:{mass:1.5,cp:500,conductivity:50},initial:{temperature:80,velocity:[0,-.8,0]}});
  Object.assign(p.solver,{computeBackend:'cpu',dt:.0003,duration:.2,outputInterval:.01,damping:2,initialState:'rest',thermal:true});
  return p;
}

export const unifiedCouplingProject=unifiedExample;

export function particlePairExample(){
  const p=unifiedExample();p.name='MPM–PBF 接触对 · 热块推水';
  const solid=p.parts.find(b=>b.id==='solid');solid.geometry.center[0]=-.15;solid.initial.velocity=[1,0,0];
  p.solver.duration=.08;p.solver.outputInterval=.005;
  return p;
}

// The same authoring tools create the contact lab: a non-spherical impactor,
// frictional water/plate contact, and two independently meshed FEM surfaces.
export function unifiedContactExample(){
  let p=unifiedExample();p.name='统一接触实验 · 四方法 + 双 FEM';
  const rigid=p.parts.find(b=>b.method==='rigid');
  rigid.name='刚体长方体 · 斜向撞板';
  Object.assign(rigid.geometry,{shape:'box',center:[-.49,.47,0],size:[.15,.15,.15],rotation:[0,15,0]});
  rigid.material.mass=.4;rigid.initial.velocity=[.05,-.4,0];
  p.parts.find(b=>b.method==='pbf').initial.velocity=[.25,-.1,0];
  p=addProjectPart(p,{id:'foundation',name:'FEM 热底座 · 独立网格',method:'fem',
    geometry:{center:[0,.075,0],size:[1.2,.2,.7]},material:{young:2e7,density:1200,cp:1500,conductivity:10},
    initial:{temperature:80},discretization:{divisions:[5,1,2]},boundary:{fixedFace:'y-'}});
  for(const d of p.contactPairs){
    if(d.a===rigid.id)d.name=rigid.name+' ↔ '+p.parts.find(b=>b.id===d.b).name;
    if(d.a==='plate'&&d.b==='foundation')Object.assign(d,{name:'双 FEM · 接触与换热',stiffness:2e7,damping:500});
    if(d.a==='water'&&d.b==='plate')Object.assign(d,{name:'PBF 水体 ↔ FEM 板 · 摩擦',friction:.5});
  }
  return p;
}
