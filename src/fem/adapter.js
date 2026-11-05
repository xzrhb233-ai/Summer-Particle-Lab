import {validateFEM} from './model.js';
import {FEMSimulation} from './solver.js';
import {FEMDynamicSimulation} from './dynamic.js';
import {femEditorModel} from './rigid-editor.js';

export function femWorker(){
  const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}),pending=new Map();let serial=0,closed=false;
  worker.onmessage=({data})=>{const entry=pending.get(data.id);if(!entry)return;pending.delete(data.id);data.error?entry.reject(Error(data.error)):entry.resolve(data.value);};
  const stop=message=>{closed=true;worker.terminate();for(const p of pending.values())p.reject(Error(message));pending.clear();};
  worker.onerror=e=>stop(e.message||'FEM 后台求解失败');
  return {request(type,project,dt){if(closed)return Promise.reject(Error('FEM 求解已取消，请重置后重试'));return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,type,project,dt});});},
    free:()=>stop('FEM 求解已取消')};
}
export const femStaticAdapter={
  id:'cpu-fem-static',methods:['fem'],fields:['displacement','stress','strain','reaction'],asynchronous:true,normalize:validateFEM,
  async create(project){
    const local=typeof Worker==='undefined'?new FEMSimulation(project):null,worker=local?null:femWorker();
    let frame;try{frame=local?local.snapshot():await worker.request('init',project);}catch(e){worker?.free();throw e;}
    return {async:true,time:0,project,
      // Read-only compatibility data for the existing viewport/HUD forms.
      // FEM edits use the canonical document; toLegacy still rejects FEM.
      editorModel:{name:project.name,bodies:[],joints:[],gravity:project.environment.gravity,dt:1/240,iterations:12},
      snapshot:()=>frame,
      async step(){const next=local?local.step():await worker.request('solve');frame=next;return frame;},
      cancel:()=>worker?.free(),free:()=>{worker?.free();local?.free();}};
  }
};
export const femDynamicAdapter={
  id:'cpu-fem-dynamic',methods:['fem','rigid'],fields:['displacement','velocity','acceleration','stress','strain','reaction','contact','temperature','heat'],asynchronous:true,normalize:validateFEM,
  async create(project){
    const local=typeof Worker==='undefined'?new FEMDynamicSimulation(project):null,worker=local?null:femWorker();
    let frame;try{frame=local?local.snapshot():await worker.request('init',project);}catch(e){worker?.free();throw e;}
    const geometry=new Map(frame.fem.parts.map(p=>[p.id,{nodes:p.nodes,surface:p.surface,cells:p.cells,quality:p.quality}]));
    const runtime={async:true,time:0,project,
      editorModel:femEditorModel(project),
      snapshot:()=>frame,
      async step(dt){
        const next=local?local.step(dt):await worker.request('advance',undefined,dt);
        next.fem.parts=next.fem.parts.map(p=>({...p,...geometry.get(p.id)}));
        frame=next;runtime.time=frame.time;return frame;
      },
      cancel:()=>worker?.free(),free:()=>{worker?.free();local?.free();}};
    return runtime;
  }
};
