import {validateMixed,projectDomains,MIXED} from './model.js';
import {toLegacy} from '../simulation/project.js';
import {initialize} from '../multibody/engine.js';
import {MixedSimulation} from './simulation.js';
import {createMixedGPU} from './gpu-adapter.js';
import {validateMixedGPU} from './gpu-model.js';

export const mixedAdapter={id:MIXED,methods:['fem','mpm','pbf','rigid'],fields:['displacement','velocity','temperature','contact'],asynchronous:true,normalize:p=>p.solver.computeBackend==='gpu'?validateMixedGPU(p):validateMixed(p),
  async create(project){
    if(project.solver.computeBackend==='gpu')return createMixedGPU(project);
    let local,worker,serial=0,closed=false;const pending=new Map();
    const stop=()=>{closed=true;worker?.terminate();local?.free();for(const p of pending.values())p.reject(Error('混合求解已取消'));pending.clear();};
    const request=(type,dt)=>new Promise((resolve,reject)=>{if(closed){reject(Error('混合求解已取消'));return;}const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,type,dt,project:type==='init'?project:undefined});});
    if(typeof Worker==='undefined'){await initialize();local=new MixedSimulation(project);}
    else {worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const p=pending.get(data.id);if(p){pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.value);}};worker.onerror=stop;}
    let frame;try{frame=local?local.snapshot():await request('init');}catch(e){stop();throw e;}
    const geometry=new Map(frame.fem.parts.map(p=>[p.id,{nodes:p.nodes,surface:p.surface,cells:p.cells,quality:p.quality}]));
    const runtime={async:true,time:0,project,editorModel:toLegacy(projectDomains(project).particles),snapshot:()=>frame,
      async step(dt){const next=local?local.step(dt):await request('advance',dt);next.fem.parts=next.fem.parts.map(p=>({...p,...geometry.get(p.id)}));frame=next;runtime.time=frame.time;return frame;},cancel:stop,free:stop};return runtime;
  }};
