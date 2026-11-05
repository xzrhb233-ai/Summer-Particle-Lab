import {normalizeProject, toLegacy} from './project.js';
import {requireCouplingSupport} from './coupling-mode.js';
import {authoringPreview} from './authoring-preview.js';

// UI and navigation use this lifecycle and result-frame contract. Static FEM
// uses a separate adapter; cross-method coupling requires its own integrator.
export class SolverRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) {
    if (!adapter.id || !Array.isArray(adapter.methods) || typeof adapter.create !== 'function' || this.adapters.has(adapter.id)) throw Error('求解适配器注册无效');
    this.adapters.set(adapter.id, adapter); return this;
  }
  adapter(project) {
    requireCouplingSupport(project);
    const a = this.adapters.get(project.solver.adapter);
    if (!a) throw Error('求解适配器未安装');
    for (const part of project.parts) if (!a.methods.includes(part.method)) throw Error('求解器不支持 ' + part.method);
    return a;
  }
  normalize(project) { return this.adapter(project).normalize?.(project) ?? project; }
  create(project) { return this.adapter(project).create(project); }
}

export class ProjectSession {
  constructor(registry) { this.registry = registry; this.runtime = null; this.document = null; }
  stage(input,reason){
    const next=authoringPreview(input,reason),frame=next.snapshot(),old=this.runtime;
    this.runtime=next;this.document=next.project;old?.free();return frame;
  }
  replace(input) {
    const project = this.registry.normalize(normalizeProject(input));
    if(this.registry.adapter(project).asynchronous)throw Error('远程求解器必须使用异步项目加载');
    const next = this.registry.create(project);
    let frame;
    try { frame = next.snapshot(); } catch (error) { next.free(); throw error; }
    const old = this.runtime;
    this.runtime = next; this.document = project; old?.free();
    return frame;
  }
  async replaceAsync(input) {
    const project=this.registry.normalize(normalizeProject(input)),next=await this.registry.create(project);
    let frame;
    try{frame=await next.snapshot();}catch(error){next.free();throw error;}
    const old=this.runtime;this.runtime=next;this.document=project;old?.free();return frame;
  }
  get asynchronous(){return !!this.runtime?.async;}
  get project() { return structuredClone(this.document); }
  get model() { return this.runtime?.editorModel??toLegacy(this.document); } // Read-only compatibility for existing forms.
  get time() { return this.runtime?.time ?? 0; }
  step(dt = this.document.solver.dt) { return this.runtime.step(dt); }
  snapshot() { return this.runtime.snapshot(); }
  command(command) {
    if(!this.runtime?.command)throw Error('求解器不支持在线载荷修改');
    const runtime=this.runtime,result=runtime.command(command);
    const accept=()=>{if(this.runtime===runtime)this.document=runtime.project;return result;};
    if(result?.then)return result.then(value=>{accept();return value;});
    return accept();
  }
  setHeater(value) { return this.command({type:'region-heat',value}); }
  setThermalPower(id, power) { return this.command({type:'body-heat',id,power}); }
  free() { this.runtime?.free(); this.runtime = null; }
}
