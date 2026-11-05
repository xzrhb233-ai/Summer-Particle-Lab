import {fromLegacy} from './project.js';
export function materialContactExample(){
  return fromLegacy({schema:'summer-mbd/1',name:'冷热块 · 碰撞 / 滑动 / 传热',gravity:[0,-1,0],dt:1/480,iterations:12,
    bodies:[],joints:[],
    coupling:{enabled:true,mechanical:true,thermal:true,thermalScale:1000,stiffness:8,
      domain:{lower:[-1.2,0,-.6],upper:[1.8,1.6,.6],cellSize:.1,particlesPerAxis:2},
      parts:[
        {id:'hot-block',name:'热弹性块 · 160°C',method:'mpm',center:[-.35,.75,0],size:[.3,.25,.4],model:0,density:1100,temperature:160,velocity:[.5,-.3,0],sampling:{enabled:false},phaseChange:{enabled:false}},
        {id:'cold-block',name:'冷块 · 20°C',method:'mpm',center:[0,.175,0],size:[1.2,.15,.5],model:0,density:2200,temperature:20,velocity:[0,0,0],fixedFace:'minY',sampling:{enabled:false}}
      ]},
    contactPairs:[{id:'hot-cold',name:'热块 ↔ 冷块',a:'hot-block',b:'cold-block',mechanical:true,thermal:true,friction:.15,contactConductance:20000}]});
}
