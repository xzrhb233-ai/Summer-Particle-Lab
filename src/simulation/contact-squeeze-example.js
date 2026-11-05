import {emptyProject,addProjectPart} from './part-builder.js';
import {validateMixed} from '../mixed/model.js';

export function contactSqueezeExample(){
  let p=emptyProject({name:'多体挤压 · 双球夹持 FEM 板'});
  p.environment.gravity=[0,0,0];
  p=addProjectPart(p,{id:'plate',name:'中央 FEM 板 · 底面固定',method:'fem',
    geometry:{center:[0,.5,0],size:[.08,.5,.5]},discretization:{divisions:[1,2,2]},
    material:{young:1e5,density:1000,cp:1000,conductivity:10},boundary:{fixedFace:'y-'}});
  for(const [id,x,v,T] of [['left',-.15,.5,100],['right',.15,-.5,20]]){
    p=addProjectPart(p,{id,name:id==='left'?'左侧热球':'右侧冷球',method:'rigid',
      geometry:{shape:'sphere',center:[x,.55,0],size:[.2,.2,.2]},
      material:{mass:1,cp:500,conductivity:50},initial:{velocity:[v,0,0],temperature:T},boundary:{damping:0}});
  }
  Object.assign(p.solver,{computeBackend:'cpu',dt:.0002,duration:.06,outputInterval:.001,damping:0,initialState:'rest',thermal:true});
  for(const pair of p.contactPairs)pair.friction=0;
  return validateMixed(p);
}
