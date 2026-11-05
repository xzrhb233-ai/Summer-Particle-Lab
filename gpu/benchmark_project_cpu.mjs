// Same native bicycle/wall and physical duration as benchmark_project.py.
import {initialize} from '../src/multibody/engine.js';
import {CoupledSimulation} from '../src/multibody/coupled.js';
import {bicycleWall} from '../src/multibody/bicycle.js';
await initialize();
const model=bicycleWall();
if(process.argv.includes('--large')){
  model.coupling.parts[0].size=[.6,3,1.8];
  model.coupling.parts[0].center=[3.77,1.5,0];
}
const duration=Number(process.argv.find(x=>x.startsWith('--duration='))?.split('=')[1]??3);
let sim=new CoupledSimulation(model);
for(let i=0;i<80;i++)sim.step();
sim.free();sim=new CoupledSimulation(model);
const start=performance.now();
let first=null,peak=0;
while(sim.time<duration-1e-9){
  sim.step(Math.min(model.dt,duration-sim.time));
  if(sim.steps%8===0){
    const wheel=sim.snapshot().bodies.find(b=>b.id==='front-wheel'),force=Math.hypot(...wheel.contactForce);
    peak=Math.max(peak,force);if(first===null&&force>1)first=sim.time;
  }
}
const frame=sim.snapshot(),wheel=frame.bodies.find(b=>b.id==='front-wheel');
console.log(JSON.stringify({backend:'CPU / Node',seconds:(performance.now()-start)/1000,simulated:sim.time,particles:sim.particles.count,travel:wheel.displacement[0],speed:wheel.velocity[0],first_contact:first,peak_sampled_force:peak}));
sim.free();
