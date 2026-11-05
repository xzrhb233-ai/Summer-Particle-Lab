import {fourGPUExample} from '../mixed/four-gpu-model.js';
import {validateMixed} from '../mixed/model.js';

export function contactSafetyExample(){
  const p=fourGPUExample();p.name='高速撞板 · 40 m/s 球 / 5 mm 固定薄板';
  p.environment.gravity=[0,0,0];
  Object.assign(p.solver,{computeBackend:'cpu',dt:.0001,duration:.002,outputInterval:.0001});
  const [f,m,w,r]=p.parts;
  Object.assign(f.geometry,{size:[1.2,.005,.7],center:[0,.3725,0]});
  f.name='5 mm FEM 薄板 · 全节点固定';f.discretization.divisions=[5,1,3];f.material.young=1e4;
  m.geometry.size=[.075,.075,.075];w.geometry.size=[.075,.075,.075];
  Object.assign(r.geometry,{center:[-.5,.48,0],size:[.15,.15,.15]});
  r.name='40 m/s 撞击球';r.initial.velocity=[0,-40,0];r.boundary.damping=0;
  // One element through thickness: fixing both faces fixes every plate node.
  // Store this in the project itself, so browser and CLI solve the same model.
  for(const [face,suffix] of [['y-','bottom'],['y+','top']]){
    const id='impact-support-'+suffix;
    p.selectionSets.push({id,name:'薄板固定 '+face,part:f.id,entity:'face',region:{type:'face',face}});
    p.loads.push({id:id+'-load',type:'fem-fixed',target:f.id,selection:id});
  }
  for(const d of p.contactPairs)d.thermal=false;
  p.loads.push(...p.parts.map(b=>({id:'heat-'+b.id,type:'thermal-power',target:b.id,region:{type:'whole'},power:100,enabled:true})));
  return validateMixed(p);
}
