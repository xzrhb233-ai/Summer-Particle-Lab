import {Simulation3} from '../src/three/simulation.js';
const result=[];
for(const shape of ['box','ellipsoid','cylinder'])for(const fixed of [false,true]){
  const s=new Simulation3();s.box([-8,0,-8],[8,16,8],11,fixed,20,0,.025,35,shape,'',[0,0,0],{},{enabled:true,strength:.35,seed:123});
  result.push({shape,fixed,positions:Array.from({length:s.count},(_,i)=>[s.x[i],s.y[i],s.z[i]]),pinned:Array.from(s.pinned.slice(0,s.count))});
}
console.log(JSON.stringify(result));
