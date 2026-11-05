import {normalizeProject,toLegacy} from './project.js';
import {projectDomains} from '../mixed/model.js';
import {quaternion} from '../multibody/model.js';

// Geometry-only preview. No solver is created and no preview is a result frame.
// Keep the authored material, backend and coupling choices intact, even while
// the assembly is incomplete and cannot yet be compiled by that backend.
export function authoringPreview(input,reason){
  const project=normalizeProject(input);
  const projected=projectDomains(project).particles;
  if(!project.parts.some(b=>['mpm','pbf'].includes(b.method))){
    projected.discretization.mpm=null;projected.solver.mpmEnabled=false;projected.couplings=[];
  }
  const editorModel=toLegacy(projected);
  const bodies=project.parts.map(b=>({id:b.id,name:b.name,method:b.method,
    cad:b.geometry.cad,
    shape:b.geometry.shape==='ellipsoid'?'sphere':b.geometry.shape,
    size:b.geometry.size.slice(),position:b.geometry.center.slice(),rotation:quaternion(b.geometry.rotation??[0,0,0]),
    type:b.boundary?.motion??'dynamic',appearance:b.geometry.appearance??null}));
  const frame={preview:true,reason,time:0,bodies,joints:[]};
  return {project,editorModel,preview:true,time:0,snapshot:()=>frame,
    step(){throw Error('模型尚未就绪：'+reason);},free(){}};
}

export function authoringIssue(registry,project){
  // computeBackend alone must never make a CPU-only adapter look like GPU.
  if(project.solver.computeBackend==='gpu'&&!['cpu-fem-mpm','taichi-coupled'].includes(project.solver.adapter))
    return '当前部件组合未接入所选 GPU 后端。可继续建模，或在“求解”中选择 CPU 并应用。';
  try{registry.normalize(project);return null;}catch(e){return e.message;}
}
