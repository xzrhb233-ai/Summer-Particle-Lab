import {fromLegacy} from './project.js';

export function contactExample(){
  return fromLegacy({
    schema:'summer-mbd/1',name:'热压头 · 压紧 / 滑动 / 分离',gravity:[0,0,0],dt:1/480,iterations:16,
    bodies:[
      {id:'guide',name:'固定导轨',type:'fixed',shape:'box',size:[.12,.5,.12],position:[-.8,.72,0]},
      {id:'carriage',name:'升降滑座',type:'dynamic',shape:'sphere',size:[.04,.04,.04],position:[-.25,.72,0],mass:2,collisionFamily:1},
      {id:'press',name:'热压头',type:'dynamic',shape:'box',size:[.3,.14,.4],position:[-.25,.72,0],mass:3,collisionFamily:1,thermal:{temperature:180,cp:500,conductivity:50}},
    ],
    joints:[
      {id:'vertical',name:'压紧与抬升',type:'prismatic',a:'guide',b:'carriage',anchor:[-.25,.72,0],axis:[0,1,0],motor:{mode:'position',target:0,stiffness:80000,damping:700}},
      {id:'slide',name:'水平滑动',type:'prismatic',a:'carriage',b:'press',anchor:[-.25,.72,0],axis:[1,0,0],motor:{mode:'position',target:0,stiffness:40000,damping:400}},
    ],
    coupling:{enabled:true,mechanical:false,thermal:true,thermalScale:1000,stiffness:4,
      domain:{lower:[-1.2,0,-.6],upper:[1.2,1.4,.6],cellSize:.1,particlesPerAxis:2},
      parts:[{id:'specimen',name:'热力耦合试样',shape:'box',center:[0,.275,0],size:[1,.35,.4],model:10,density:1100,temperature:20,fixedFace:'minY',sampling:{enabled:false},
        thermalMaterial:{Tref:20,Thot:80,hotRatio:.2,A:.04,H:.02}}]},
    contactPairs:[
      {id:'press-contact',name:'热压头 ↔ 试样',a:'press',b:'specimen',mechanical:true,thermal:true,friction:.65,contactConductance:20000},
      {id:'guide-isolated',name:'导轨隔离',a:'guide',b:'specimen',mechanical:false,thermal:false},
      {id:'carriage-isolated',name:'滑座隔离',a:'carriage',b:'specimen',mechanical:false,thermal:false},
    ],
    curves:[
      {id:'vertical-cycle',name:'压紧—保持—抬升',type:'smooth',points:[[0,0],[.6,-.21],[2.2,-.21],[2.9,0],[3,0]]},
      {id:'slide-cycle',name:'表面滑动',type:'smooth',points:[[0,0],[.8,0],[1.9,.45],[3,.45]]},
    ],
    loadBindings:[
      {id:'vertical-drive',name:'压头高度',kind:'motor-target',target:'vertical',curve:'vertical-cycle',scale:1,offset:0},
      {id:'slide-drive',name:'压头水平行程',kind:'motor-target',target:'slide',curve:'slide-cycle',scale:1,offset:0},
    ],
  });
}
