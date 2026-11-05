import {thermalExample} from '../src/simulation/thermal-example.js';
import {fromLegacy,toLegacy} from '../src/simulation/project.js';
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';

export const exchange=()=>fromLegacy({
  schema:'summer-mbd/1',name:'Heat balance',dt:1/480,gravity:[0,0,0],
  bodies:[{id:'hot',type:'fixed',shape:'box',size:[.2,.2,.2],position:[-.19,.5,0],mass:.1,thermal:{temperature:160,cp:900,conductivity:50}}],
  joints:[],coupling:{enabled:true,thermal:true,mechanical:false,thermalScale:1000,
    domain:{lower:[-1,0,-1],upper:[1,1,1],cellSize:.1,particlesPerAxis:2},
    parts:[{id:'cold',center:[0,.5,0],size:[.2,.2,.2],density:2200,temperature:20,sampling:{enabled:false}},
      {id:'warm',center:[.25,.5,0],size:[.2,.2,.2],density:550,temperature:70,sampling:{enabled:false}}]}});
const projects={exchange:exchange(),hot:thermalExample(),release:thermalExample(true)};
if(process.argv.includes('--projects'))console.log(JSON.stringify(projects));
if(process.argv.includes('--cpu')){
  await initialize();const s=new CoupledSimulation(toLegacy(exchange()));
  try{for(let k=0;k<48;k++)s.heatStep(1/480);
    console.log(JSON.stringify({temperatures:[...s.particles.temperature.slice(0,s.particles.count)],frame:s.snapshot()}));
  }finally{s.free();}
}
