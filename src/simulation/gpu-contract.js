import {toLegacy,normalizeProject,normalizeSolverProject} from './project.js';
export const GPU_PROJECT_FEATURE='rigidMpmPbfClockV11';
export function validateGpuProject(input){
  if(input.parts?.some(b=>b.geometry?.shape==='cad'))throw Error('SMLib CAD 部件目前支持 CPU 粒子离散；GPU 尚未接入 CAD 初始采样，请选择 CPU');
  const raw=normalizeProject(input),model=toLegacy(raw),project=normalizeSolverProject(raw);
  const c=model.coupling;
  if(model.contactPairs.some(d=>{const a=c?.parts.find(p=>p.id===d.a),b=c?.parts.find(p=>p.id===d.b);return a&&b&&a.method!==b.method;}))throw Error('旧 GPU 项目服务不支持显式 MPM–PBF 接触对；请使用 CPU 或四方法 GPU 求解器');
  if(raw.solver.diagnostics)throw Error('机械能与动量诊断当前使用 CPU；请关闭诊断或选择 CPU，项目未被替换。');
  for(const attachment of c?.attachments??[]){
    const part=c.parts.find(p=>p.id===attachment.part);
    if(!part||part.method!=='mpm'||part.fracture.enabled)throw Error('区域连接需连接刚体与未启用断裂的 MPM 部件');
  }
  if(!c?.enabled||!c.parts.length)throw Error('GPU 耦合需要至少一个 MPM 或 PBF 部件');
  if(c.parts.some(p=>p.method==='pbf'&&(p.temperature<=0||p.temperature>=100)))throw Error('PBF 水初温需在 0–100°C 之间；载入后可加热或冷却。');
  const port=raw.solver.gpuPort??8769;
  if(!Number.isInteger(port)||port<8765||port>8799)throw Error('GPU 项目服务端口必须为 8765–8799');
  project.solver.adapter='taichi-coupled';project.solver.gpuPort=port;
  return project;
}
