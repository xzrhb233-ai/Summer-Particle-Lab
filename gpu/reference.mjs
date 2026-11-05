import { Simulation3 } from '../src/three/simulation.js';
const s=new Simulation3();s.settings.thermal=false;
const F=[.98,.1,0,0,.95,0,0,0,1.02];
for(let model=0;model<4;model++){
  const x=model%2===0?-24:24,z=model<2?-24:24;
  s.box([x-4,0,z-4],[x+4,8,z+4],11,false,20,model);
}
for(let i=0;i<s.count;i++)s.mpm.F.set(F,i*9);
for(let i=0;i<12;i++)s.step();
console.log(JSON.stringify({positions:Array.from({length:s.count},(_,i)=>[s.x[i],s.y[i],s.z[i]]),jp:Array.from(s.mpm.Jp.subarray(0,s.count))}));
