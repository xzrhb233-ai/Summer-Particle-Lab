import {FEMSimulation} from './solver.js';
import {runFEMValidation} from './validation.js';
import {FEMDynamicSimulation} from './dynamic.js';
import {runDynamicValidation} from './dynamic-validation.js';
let sim;
self.onmessage=({data:{id,type,project,dt}})=>{
  try{
    let value;
    if(type==='init'){sim=project.solver.analysis==='linear-dynamic'?new FEMDynamicSimulation(project):new FEMSimulation(project);value=sim.snapshot();}
    else if(type==='solve')value=sim.step();
    else if(type==='validate')value=runFEMValidation();
    else if(type==='validate-dynamic')value=runDynamicValidation();
    else if(type==='advance'){
      value=sim.step(dt);
      // The adapter retains immutable geometry from initialization.
      for(const p of value.fem.parts)for(const k of ['nodes','surface','cells','quality'])delete p[k];
    }
    else throw Error('未知 FEM 命令');
    self.postMessage({id,value});
  }catch(e){self.postMessage({id,error:e.message});}
};
