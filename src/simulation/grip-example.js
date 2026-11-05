import {fromLegacy} from './project.js';
import {convertConnectionToReferences} from './references.js';

export function gripExample(twist=false){
  const body=(id,position,type='fixed',rotation=[0,0,0])=>({id,name:id,shape:'box',type,position,rotation,size:[.2,.35,.35],mass:3,collisionFamily:1});
  let p=fromLegacy({schema:'summer-mbd/1',name:twist?'夹具扭转 MPM 试样':'夹具拉伸 MPM 试样',dt:1/240,iterations:12,gravity:[0,0,0],
    bodies:[body('left-clamp',[-.55,1,0]),body('right-clamp',[.55,1,0],'dynamic'),{...body('guide',[1.1,1,0],'fixed',[23,17,31]),size:[.12,.12,.12]}],
    joints:[{id:'actuator',name:twist?'扭转驱动':'拉伸驱动',type:twist?'revolute':'prismatic',a:'guide',b:'right-clamp',anchor:[.55,1,0],axis:[1,0,0],
      limits:twist?[-.8,.8]:[-.05,.2],motor:{mode:'position',target:twist?.55:.12,stiffness:twist?40:3000,damping:twist?8:100}}],
    coupling:{enabled:true,thermal:false,stiffness:2,domain:{lower:[-1.5,0,-.8],upper:[1.5,2,.8],cellSize:.1,particlesPerAxis:2},
      parts:[{id:'specimen',name:'弹性条带',center:[0,1,0],size:[1.2,.2,.2],model:0,density:1100,temperature:20,sampling:{enabled:true,strength:.12,seed:32}}]}});
  p=convertConnectionToReferences(p,'actuator');
  for(const b of p.parts.filter(b=>b.method==='rigid'))b.geometry.appearance=[{shape:'box',position:[0,0,0],rotation:[0,0,0],size:b.geometry.size.slice(),color:b.id==='left-clamp'?'#38958C':b.id==='right-clamp'?'#CE893B':'#7A8588'}];
  p.frames.push({id:'left-reference',name:'左夹具参考点',part:'left-clamp',position:[0,0,0],rotation:[0,90,0]});
  for(const side of ['left','right']){
    const set={id:side+'-end',name:side==='left'?'左端材料点':'右端材料点',part:'specimen',region:{type:'box',lower:[side==='left'?-.6:.45,-.1,-.1],upper:[side==='left'?-.45:.6,.1,.1]}};
    p.selectionSets.push(set);
    p.connections.push({id:side+'-grip',name:side==='left'?'左夹具绑定':'右夹具绑定',type:'region',a:side+'-clamp',b:'specimen',mode:'bind',stiffness:20000,damping:100,
      endpoints:{a:{frame:side==='left'?'left-reference':p.connections[0].endpoints.b.frame},b:{selection:set.id}}});
  }
  return p;
}
