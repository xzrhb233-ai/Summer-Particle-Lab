import {exchange} from './gpu-thermal-fixtures.mjs';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {contactExample} from '../src/simulation/contact-example.js';
import {gripExample} from '../src/simulation/grip-example.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';

export function heatPairs(){
  const p=exchange();p.couplings[0].thermal=false;
  p.contactPairs=[
    {id:'conducting',a:'hot',b:'cold',mechanical:false,thermal:true,friction:0,contactConductance:1000},
    {id:'insulated',a:'hot',b:'warm',mechanical:false,thermal:false,friction:0,contactConductance:100000}];
  return p;
}
export function mechanicalPairs(fluid=false){
  return fromLegacy({schema:'summer-mbd/1',gravity:[0,0,0],dt:1/480,
    bodies:[{id:'wall',name:'自由接触板',type:'dynamic',shape:'box',size:[.1,.8,.4],position:[-.05,.5,0],mass:2}],
    joints:[],coupling:{enabled:true,mechanical:false,thermal:false,
      domain:{lower:[-1,0,-1],upper:[1,1,1],cellSize:.1,particlesPerAxis:2},
      parts:[{id:'on',center:[.05,.45,0],size:[.1,.1,.1],method:fluid?'pbf':'mpm',density:fluid?1000:1100,model:0,velocity:[-.3,0,.2],sampling:{enabled:false}},
        {id:'off',center:[.05,.55,0],size:[.1,.1,.1],model:0,velocity:[-.3,0,.2],sampling:{enabled:false}}]},
    contactPairs:[{id:'active',a:'wall',b:'on',mechanical:true,thermal:false,friction:.5,contactConductance:0},
      {id:'disabled',a:'wall',b:'off',mechanical:false,thermal:false,friction:1,contactConductance:10000}]});
}
export function attachedPair(){
  const p=gripExample(true);
  p.parts.find(p=>p.method==='mpm').discretization.sampling.enabled=false;
  p.contactPairs=[{id:'clamp-contact',a:'right-clamp',b:'specimen',mechanical:true,thermal:false,friction:.4,contactConductance:0}];
  return p;
}
if(process.argv.includes('--pair-projects'))console.log(JSON.stringify({heat:heatPairs(),mechanical:mechanicalPairs(),fluid:mechanicalPairs(true),demo:contactExample(),attached:attachedPair()}));
if(process.argv.includes('--pair-cpu')){
  await initialize();const s=new CoupledSimulation(toLegacy(heatPairs()));
  try{for(let k=0;k<48;k++)s.heatStep(1/480);s.lastDt=.1;console.log(JSON.stringify(s.snapshot()));}finally{s.free();}
}
