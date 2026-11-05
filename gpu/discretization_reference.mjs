import {Simulation3} from '../src/three/simulation.js';
const s=new Simulation3();s.settings.gravity=false;s.settings.thermal=false;
s.configureDomain({lower:[-120,-120,-120],upper:[120,120,120],cellSize:6,particlesPerAxis:3});
s.createGeometry({shape:'cylinder',center:[80,20,-70],size:[12,20,16],rotation:[20,30,15],sampling:{enabled:true,strength:.2,seed:42},velocity:[3,-2,7]});
const initial=Array.from({length:s.count},(_,i)=>[s.x[i],s.y[i],s.z[i]]);
for(let i=0;i<6;i++)s.step();
console.log(JSON.stringify({initial,positions:Array.from({length:s.count},(_,i)=>[s.x[i],s.y[i],s.z[i]]),mass:s.snapshot().mass}));
