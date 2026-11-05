import {validateCADMesh} from '../three/cad-tools.js';
import {addProjectPart} from './part-builder.js';
import {projectDevice} from './simple-settings.js';

export function cadFEMOptions(mesh,{id,name='CAD 四面体部件',young=1e5,poisson=.3,density=1000,temperature=20,fixedFace='y-'}={}){
  validateCADMesh(mesh);if(mesh.kind!=='volume')throw Error('FEM 需要四面体体网格，表面三角形不能作为体单元');
  const c=mesh.cad;
  return {...(id?{id}:{}),method:'fem',name,
    geometry:{shape:'cad',cad:structuredClone(c),center:c.lower.map((v,k)=>(v+c.upper[k])/2),size:c.upper.map((v,k)=>v-c.lower[k]),rotation:[0,0,0]},
    discretization:{element:'tet4',mesh:{schema:'summer-tet4/1',coordinates:'cad',nodes:structuredClone(mesh.nodes),elements:structuredClone(mesh.elements),surface:structuredClone(mesh.surface),source:{recipe:structuredClone(c.recipe),lower:c.lower.slice(),upper:c.upper.slice()}}},
    material:{young,poisson,density},initial:{temperature},boundary:{fixedFace}};
}
export function addCADFEM(project,mesh,options){
  if(projectDevice(project)!=='cpu')throw Error('CAD 四面体目前使用 CPU FEM，请先切换 CPU 并应用');
  return addProjectPart(project,cadFEMOptions(mesh,options));
}
