// Identical authored geometry/materials; denser sampling exercises neighbor load.
import fs from 'node:fs';
import {fourGPUExample,compileFourGPU} from '../src/mixed/four-gpu-model.js';
const p=fourGPUExample();
Object.assign(p.discretization.mpm,{cellSize:.1,particlesPerAxis:4});
const data=compileFourGPU(p);
fs.writeFileSync('artifacts/four-dense-compiled.json',JSON.stringify(data,(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));
console.log(`${data.seed.points.length} particles, ${data.fem.nodes.length} FEM nodes`);
