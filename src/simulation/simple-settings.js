import {validateMixedGPU} from '../mixed/gpu-model.js';
import {validateMixed} from '../mixed/model.js';
import {validateGpuProject} from './gpu-contract.js';
import {requireCouplingSupport} from './coupling-mode.js';

export const projectDevice = p => p?.solver?.computeBackend==='gpu'||p?.solver?.adapter==='taichi-coupled'?'gpu':'cpu';
export const recommendedStep = p => p.parts.some(b=>b.method==='fem') ? .0002 : 1/480;

// A single authoring transaction. Never silently change materials or coupling
// to make a project fit another backend; the existing validators explain why.
export function prepareSimpleSettings(project,settings){
  const p=structuredClone(project),s=p.solver;
  if(!['cpu','gpu'].includes(settings.device))throw Error('计算设备须为 CPU 或 GPU');
  if(!['auto','custom'].includes(settings.timeStepMode))throw Error('时间步模式无效');
  const dt=settings.timeStepMode==='auto'?recommendedStep(p):settings.dt;
  if(!Number.isFinite(dt)||dt<1e-7||dt>.02)throw Error('最大时间步须为 1e-7–0.02 s');
  if(!Number.isFinite(settings.duration)||settings.duration<=0||settings.duration>60)throw Error('模拟结束时间须大于 0 且不超过 60 s');
  Object.assign(s,{dt,duration:settings.duration,timeStepMode:settings.timeStepMode,couplingMode:settings.couplingMode??s.couplingMode??'native',pbdIterations:settings.pbdIterations??s.pbdIterations??6});
  if(s.adapter==='cpu-fem-mpm'){
    s.computeBackend=settings.device;
    s.mixedGpuPort=settings.port??s.mixedGpuPort??8796;
    requireCouplingSupport(p);
    return settings.device==='gpu'?validateMixedGPU(p):validateMixed(p);
  }
  if(s.adapter.startsWith('cpu-fem-')){
    if(settings.device==='gpu')throw Error('当前独立 FEM 求解器使用 CPU；GPU 目前支持 MPM–FEM 或四方法耦合项目。');
    s.computeBackend='cpu';requireCouplingSupport(p);return p;
  }
  s.adapter=settings.device==='gpu'?'taichi-coupled':'cpu-coupled';
  s.computeBackend=settings.device;
  s.gpuPort=settings.port??s.gpuPort??8769;
  requireCouplingSupport(p);
  return settings.device==='gpu'?validateGpuProject(p):p;
}
