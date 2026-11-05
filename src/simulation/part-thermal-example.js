import {fromLegacy} from './project.js';
import {dynamicCantileverProject} from '../fem/model.js';

export function femThermalExample(){
  const p=dynamicCantileverProject({size:[.08,.02,.02],center:[.04,.04,0],divisions:[8,2,2],young:2e6,density:2700,cp:900,conductivity:200,expansion:2.3e-5,force:[0,0,0],damping:15});
  p.name='FEM · 热传导与受约束膨胀';p.curves=[];p.loadBindings=[];
  Object.assign(p.solver,{thermal:true,initialState:'rest',duration:1,dt:.00002});
  p.loads.push({id:'hot-end',name:'热端 100°C',type:'thermal-temperature',target:'beam',region:{type:'face',face:'x-'},temperature:100,enabled:true},
    {id:'cold-end',name:'冷端 20°C',type:'thermal-temperature',target:'beam',region:{type:'face',face:'x+'},temperature:20,enabled:true});
  return p;
}

export function mpmPartThermalExample(){
  const p=fromLegacy({schema:'summer-mbd/1',name:'MPM · 部件热源与冷却',dt:1/480,gravity:[0,0,0],bodies:[],joints:[],coupling:{enabled:true,thermal:true,mechanical:false,
    domain:{lower:[-.6,0,-.4],upper:[.6,.8,.4],cellSize:.1,particlesPerAxis:2},
    parts:[{id:'heated',name:'受热试样',center:[-.2,.4,0],size:[.2,.2,.2],density:1100,temperature:20,phaseChange:{enabled:true,meltingPoint:60,latentHeat:2000},sampling:{enabled:false}},
      {id:'control',name:'未加热对照',center:[.2,.4,0],size:[.2,.2,.2],density:1100,temperature:20,sampling:{enabled:false}}]}});
  p.loads.push({id:'part-heater',name:'试样加热 100000 W',type:'thermal-power',target:'heated',region:{type:'whole'},power:100000,enabled:true},
    {id:'part-cooling',name:'环境对流 20°C',type:'thermal-convection',target:'heated',region:{type:'whole'},temperature:20,coefficient:100,enabled:true});
  return p;
}
