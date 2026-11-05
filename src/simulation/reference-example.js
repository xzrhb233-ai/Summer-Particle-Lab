import {preset} from '../multibody/presets.js';
import {fromLegacy} from './project.js';
import {localPoint} from './references.js';

export function referenceExample() {
  const p=fromLegacy(preset('coupling'));p.name='参考点连接与 MPM 区域固定';
  const joint=p.connections[0];
  for(const side of ['a','b']){
    const part=p.parts.find(p=>p.id===joint[side]),id='platen-'+side;
    p.frames.push({id,name:side==='a'?'Guide / 导轨参考点':'Platen / 压头参考点',part:part.id,position:localPoint(part,joint.anchor),rotation:[-90,0,0]});
  }
  joint.endpoints={a:{frame:'platen-a'},b:{frame:'platen-b'}};
  const specimen=p.parts.find(p=>p.method==='mpm');
  p.selectionSets.push({id:'specimen-base',name:'Specimen base / 试样底部',part:specimen.id,region:{type:'box',lower:[-.4,-.2,-.3],upper:[.4,-.12,.3]}});
  p.loads.push({id:'fixed-base',type:'fixed-selection',target:specimen.id,selection:'specimen-base'});
  // Also usable by the mechanical GPU adapter. Thermal controls remain editable.
  p.couplings[0].thermal=false;
  return p;
}
