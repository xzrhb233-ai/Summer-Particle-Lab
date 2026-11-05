import {initialize} from '../multibody/engine.js';
import {MixedSimulation} from './simulation.js';
let simulation;
self.onmessage=async({data:{id,type,project,dt}})=>{
  try{
    let value;
    if(type==='init'){await initialize();simulation=new MixedSimulation(project);value=simulation.snapshot();}
    else if(type==='advance')value=simulation.step(dt);
    else throw Error('未知混合求解命令');
    if(type==='advance')for(const p of value.fem.parts)for(const k of ['nodes','surface','cells','quality'])delete p[k];
    self.postMessage({id,value});
  }catch(e){self.postMessage({id,error:e.message});}
};
