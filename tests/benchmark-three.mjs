// Manual benchmark, deliberately excluded from the correctness test glob.
import { Simulation3 } from '../src/three/simulation.js';
const scenes=process.argv.slice(2);
for(const scene of scenes.length?scenes:['models','large','coupled']){
  const s=new Simulation3();s.reset(scene);
  for(let i=0;i<10;i++)s.step();
  const totals={},start=performance.now();
  for(let i=0;i<20;i++){
    s.step();for(const [key,value] of Object.entries(s.profile))totals[key]=(totals[key]||0)+value;
  }
  const elapsed=performance.now()-start;
  console.log(JSON.stringify({scene,particles:s.count,warmup:10,samples:20,meanMs:+(elapsed/20).toFixed(2),stagesMs:Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,+(value/20).toFixed(2)]))}));
}
