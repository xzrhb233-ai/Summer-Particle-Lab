import {gripExample} from './grip-example.js';
import {editLegacyProject} from './project.js';

// Shared CPU/GPU document: no prescribed particle motion or temperature.
export function thermalExample(release=false) {
  const project=editLegacyProject(gripExample(true), model=>{
    model.name=release?'加热熔化 · 夹持释放':'热夹具 · 温度相关扭转';
    const c=model.coupling,p=c.parts[0];
    c.thermal=true;c.thermalScale=1000;c.heater={center:[0,1,0],radius:1.5,power:0};
    p.name=release?'可熔化试样':'温度相关 J2 试样';
    p.sampling.enabled=false;p.model=10;
    p.thermalMaterial={...p.thermalMaterial,Tref:20,Thot:60,hotRatio:.08,A:.02,H:.02};
    for(const b of model.bodies) {
      b.thermal.temperature=release?55:180;
      b.thermal.power=0;
    }
    if(release) {
      p.temperature=55;
      p.phaseChange={enabled:true,meltingPoint:60,latentHeat:2000};
      c.heater={center:[0,1,0],radius:1.5,power:3000000};
      // Gravity lets released liquid fall; clamps remain on the motor guide.
      model.gravity=[0,-2,0];
    }
  });
  // Let the existing renderer display the actual rigid temperatures.
  for(const b of project.parts.filter(b=>b.method==='rigid'))b.geometry.appearance=null;
  return project;
}
