// One-time project compilation; no JS solver steps are run by these fixtures.
import fs from 'node:fs';
import {fourGPUExample,compileFourGPU} from '../src/mixed/four-gpu-model.js';
const write=(name,p)=>fs.writeFileSync(`artifacts/${name}.json`,JSON.stringify(compileFourGPU(p),(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));
const p=fourGPUExample();write('four-compiled',p);
const heat=structuredClone(p);heat.loads.push(...heat.parts.map(b=>({id:'heat-'+b.id,type:'thermal-power',target:b.id,region:{type:'whole'},power:100,enabled:true})));write('four-heaters',heat);
const sphere=structuredClone(p),r=sphere.parts[3];r.geometry.center=[-.5,.46,0];r.geometry.size=[.15,.15,.15];r.initial.velocity=[.2,-.2,0];write('four-sphere-fem',sphere);
fs.writeFileSync('artifacts/four-project.json',JSON.stringify(p));
console.log('Compiled four-method, four-heater and sphere–FEM fixtures.');
