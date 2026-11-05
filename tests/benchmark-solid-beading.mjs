import { Simulation3 } from '../src/three/simulation.js';
import { writeFileSync, mkdirSync } from 'node:fs';

export function specimen(model=10, loading='drop', enabled=true) {
  const s=new Simulation3();s.reset('empty');s.settings.thermal=false;s.settings.solidAntiClump=enabled;
  s.box([-12,loading==='drop'?0:-40,-12],[12,loading==='drop'?24:0,12],11,false,20,model,.025,35,'box','specimen',[0,0,0],{},{enabled:true,strength:.2,seed:42});
  if(loading==='press'){s.press={enabled:true,y:12,target:-25,origin:12,speed:16,velocity:0,impulse:0,force:0};}
  return s;
}
export function distribution(s) {
  const nearest=[],points=[];let close=0,minJ=1;
  for(let i=0;i<s.count;i++){
    let d=Infinity;
    for(let j=0;j<s.count;j++)if(i!==j){const r=Math.hypot(s.x[i]-s.x[j],s.y[i]-s.y[j],s.z[i]-s.z[j]);d=Math.min(d,r);if(j>i&&r<2)close++;}
    nearest.push(d);points.push([s.x[i],s.y[i],s.z[i]]);
  }
  nearest.sort((a,b)=>a-b);
  return {time:s.time,close,min:nearest[0],p10:nearest[Math.floor(nearest.length*.1)],median:nearest[Math.floor(nearest.length*.5)],minJ:s.mpm.minJ(s),bounds:[0,1,2].map(a=>[Math.min(...points.map(p=>p[a])),Math.max(...points.map(p=>p[a]))]),points};
}
if(process.argv[1]?.endsWith('benchmark-solid-beading.mjs')){
  const label=process.argv[2]||'baseline',frames=Number(process.argv[3]||360),models=(process.argv[4]||'0,4,10').split(',').map(Number);
  mkdirSync('.diagnostics/solid-beading',{recursive:true});
  for(const model of models)for(const loading of ['drop','press']){
    const s=specimen(model,loading,!process.argv.includes('--off'));for(let i=0;i<frames;i++)s.step();
    const result=distribution(s);writeFileSync(`.diagnostics/solid-beading/${label}-${model}-${loading}.json`,JSON.stringify(result));
    const {points,...metrics}=result;console.log(JSON.stringify({label,model,loading,...metrics}));
  }
}
