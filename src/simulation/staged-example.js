import {thermalExample} from './thermal-example.js';
import {editLegacyProject} from './project.js';

export function stagedExample(){
  const p=editLegacyProject(thermalExample(),m=>{
    m.name='分阶段试验 · 加热 / 扭转 / 卸载 / 冷却';
    for(const b of m.bodies)b.thermal.temperature=20;
    m.joints.find(j=>j.id==='actuator').motor.target=0;
    m.coupling.thermalScale=100;
    m.coupling.heater={center:[0,1,0],radius:1.5,power:0};
  });
  p.curves=[
    {id:'thermal-cycle',name:'加热—停热—冷却',type:'linear',points:[[0,0],[.4,1],[.8,1],[1,0],[2.5,0],[2.8,-1],[3.2,-1],[3.5,0]]},
    {id:'twist-cycle',name:'缓慢扭转—保持—卸载',type:'smooth',points:[[0,0],[1,0],[1.8,1],[2.1,1],[2.5,0],[3.5,0]]},
  ];
  p.loadBindings=[
    {id:'heat-cycle',name:'试样功率',curve:'thermal-cycle',kind:'region-heat',target:'mpm',scale:3000000,offset:0,enabled:true},
    {id:'twist-cycle-drive',name:'夹具转角',curve:'twist-cycle',kind:'motor-target',target:'actuator',scale:.55,offset:0,enabled:true},
  ];
  return p;
}
