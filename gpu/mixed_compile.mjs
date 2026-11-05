// One-time compilation only. No JavaScript/CPU solver runs during GPU ticks.
import {readFileSync} from 'node:fs';
import {validateMixedGPU,mixedParticleSeed,mixedScaleProject} from '../src/mixed/gpu-model.js';
import {projectDomains} from '../src/mixed/model.js';
import {FEMDynamicSimulation} from '../src/fem/dynamic.js';
import {mixedThermalDescriptors} from '../src/mixed/gpu-thermal.js';
import {inverse,quaternion,rotate} from '../src/multibody/model.js';
import {isFourGPU,compileFourGPU} from '../src/mixed/four-gpu-model.js';
const input=process.argv[2]?mixedScaleProject(Number(process.argv[2])):JSON.parse(readFileSync(0,'utf8'));
if(isFourGPU(input)){console.log(JSON.stringify(compileFourGPU(input),(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));process.exit(0);}
const p=validateMixedGPU(input),seed=mixedParticleSeed(p),fem=new FEMDynamicSimulation(projectDomains(p).fem),f=fem.states[0];
const shape=f.part.geometry,q=inverse(quaternion(shape.rotation));
for(const point of seed.points){const local=rotate(q,point.map((x,k)=>x*.025-shape.center[k]));if(local.every((x,k)=>Math.abs(x)<=shape.size[k]/2))throw Error('MPM 初始点位于 FEM 体积内部，请调整几何位置');}
try{console.log(JSON.stringify({project:p,seed,thermalLoads:mixedThermalDescriptors(p,seed,fem),fem:{nodes:f.mesh.nodes,cells:f.mesh.cells,surface:f.mesh.surface,A:f.A,m:f.m,fixed:f.fixed,force:f.f,bindings:f.bindings,velocity:f.v,dt:fem.dt,thermalEdges:f.thermal.edges,capacity:f.thermal.capacity,thermalDt:f.thermal.criticalDt},frame:fem.snapshot()},(_,v)=>ArrayBuffer.isView(v)?Array.from(v):v));}finally{fem.free();}
