import {exchange} from './gpu-thermal-fixtures.mjs';
import {stagedExample} from '../src/simulation/staged-example.js';
import {editLegacyProject,toLegacy} from '../src/simulation/project.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';

export function pulseFixture(thermal=false){
  return editLegacyProject(exchange(),m=>{
    m.coupling.thermal=false;m.coupling.heater={center:[0,.5,0],radius:1,power:0};
    // Multiple particle parts select the GPU multifield path. Keep the force-only
    // fixture single-part so it still exercises the CPU contact bridge.
    if(!thermal)m.coupling.parts=m.coupling.parts.slice(0,1);
    Object.assign(m.bodies[0],{type:'dynamic',mass:2,position:[-.7,.7,0]});
    m.curves=[{id:'pulse',type:'step',points:[[0,0],[.003,1],[.007,0],[.1,0]]}];
    m.loadBindings=[{id:'force',kind:'body-force',target:'hot',component:0,curve:'pulse',scale:100,offset:0}];
    if(thermal){
      m.curves.push({id:'heat',type:'linear',points:[[0,0],[.007,1],[.013,0],[.1,0]]});
      m.loadBindings.push({id:'heat',kind:'region-heat',target:'mpm',curve:'heat',scale:1e6,offset:0},
        {id:'body-heat',kind:'body-heat',target:'hot',curve:'pulse',scale:500,offset:0});
    }
  });
}
if(process.argv.includes('--curve-projects'))console.log(JSON.stringify({pulse:pulseFixture(),heat:pulseFixture(true),staged:stagedExample()}));
if(process.argv.includes('--curve-cpu')){
  await initialize();const s=new CoupledSimulation(toLegacy(pulseFixture(true)));
  try{console.log(JSON.stringify(s.step(1/60)));}finally{s.free();}
}
