import {validateMixedGPU,MIXED_GPU_FEATURE} from './gpu-model.js';
import {requireMixedMaterialFeatures} from './material-capabilities.js';
import {projectDomains} from './model.js';
import {toLegacy} from '../simulation/project.js';
import {FEMDynamicSimulation} from '../fem/dynamic.js';
import {updateThermalForce} from '../fem/thermal.js';
import {isFourGPU,FOUR_GPU_FEATURE} from './four-gpu-model.js';

export class MixedTransport{
  constructor(port,Socket=WebSocket){
    this.port=port;this.socket=new Socket(`ws://127.0.0.1:${port}`);this.socket.binaryType='arraybuffer';this.pending=new Map();this.serial=0;this.closed=false;this.generation=0;
    this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});this.ready.catch(()=>{});
    this.timer=setTimeout(()=>this.fail('混合 GPU 未响应，请运行 start-mixed-gpu.ps1。'),12000);
    this.socket.onmessage=e=>{try{this.receive(e.data);}catch(error){this.fail(error.message);}};
    this.socket.onerror=()=>this.fail('无法连接混合 GPU 服务，请运行 start-mixed-gpu.ps1 并核对端口。');this.socket.onclose=()=>this.fail('混合 GPU 已断开；求解已停止。');
  }
  receive(raw){
    if(typeof raw==='string'){const d=JSON.parse(raw);if(d.type==='ready'){
      if(d.feature!==MIXED_GPU_FEATURE||d.backend?.arch!=='cuda')throw Error('MPM–FEM CUDA 服务版本不兼容，请重启 start-mixed-gpu.ps1 并核对端口');this.features=d.features??[d.feature];clearTimeout(this.timer);this.resolve(d.backend);
    }else if(d.type==='operation'){const p=this.pending.get(d.id);if(p){clearTimeout(p.timer);this.pending.delete(d.id);p.reject(Error(d.message));}}
    else if(d.type==='error')throw Error(d.message);return;}
    if(!(raw instanceof ArrayBuffer)||raw.byteLength<4)throw Error('无效混合 GPU 数据');
    const length=new DataView(raw).getUint32(0,true),offset=4+Math.ceil(length/4)*4;
    if(length>4_000_000||offset>raw.byteLength)throw Error('无效混合 GPU 帧头');
    const d=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,4,length)));
    if(d.type!=='frame'||!Number.isInteger(d.count)||d.count<1||d.count>50000||offset+32*d.count!==raw.byteLength||!Number.isFinite(d.frame?.time))throw Error('无效混合 GPU 结果');
    const p=this.pending.get(d.id);if(!p)return;const particles=new Float32Array(raw,offset,d.count*8);
    if(particles.some(x=>!Number.isFinite(x)))throw Error('混合 GPU 粒子出现无效值');
    this.pending.delete(d.id);clearTimeout(p.timer);p.resolve({...d.frame,particles});
  }
  async request(type,fields={}){await this.ready;if(this.closed)throw Error('混合 GPU 连接已关闭');const id=++this.serial;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail('混合 GPU 响应超时'),180000);this.pending.set(id,{resolve,reject,timer});try{this.socket.send(JSON.stringify({type,id,...fields}));}catch(error){this.fail(error.message);}});}
  fail(message){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.reject(Error(message));for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();this.socket.close();}
}
// Recover display fields without applying a global GPU energy residual to the
// FEM subdomain: its separate interface-work ledger is not measured here.
export function convertMixedGPUFrame(project,local,g){
    if(project.solver.couplingMode==='unified-pbd'&&g.framework?.couplingMode!=='unified-pbd')throw Error('后端未启用 Unified PBD，请重启新版混合 GPU 服务并重新加载');
    const s=local.states[0],state=g.state;
    if(state.u.length!==s.u.length||state.v.length!==s.v.length||state.temperature.length!==s.thermal.temperature.length||[...state.u,...state.v,...state.temperature].some(x=>!Number.isFinite(x)))throw Error('GPU FEM 状态格式无效');
    s.u.set(state.u);s.v.set(state.v);s.thermal.temperature.set(state.temperature);local.time=g.time;local.steps=g.clock.steps;local.lastDt=g.clock.maxDt??0;local.solveMs=g.performance.solverMs;
    local.lastStart=Math.max(0,g.time-local.lastDt);local.lastEnd=g.time;updateThermalForce(s);
    const f=local.snapshot();f.fem.parts[0].summary.energyResidual=null;f.fem.parts[0].summary.contactWork=null;f.fem.parts[0].summary.dissipated=null;f.fem.parts[0].summary.externalWork=null;
    f.fem.parts[0].summary.thermalWork=null;f.fem.dynamics.thermalWork=null;
    Object.assign(f.fem.dynamics,{dt:g.clock.baseDt,energyResidual:null,contactWork:null,interfaceWork:null,dissipated:null,externalWork:null,energyScope:'gpu-fem-subdomain-ledger-unavailable'});
    const id=project.parts.find(p=>p.method==='mpm').id;
    f.results.parts[0].values={...f.results.parts[0].values,...f.fem.parts[0].summary};f.results.parts.push({id,method:'mpm',values:g.part});
    const energy=g.energy??null,active=energy?.enabled===true,complete=active&&energy.complete===true,sums=(...values)=>values.every(Number.isFinite)?values.reduce((a,b)=>a+b,0):null,storage=active?energy.storage:{};
    f.results.balance={mechanicalEnergy:active?energy.mechanical:null,knownMechanicalEnergy:active?energy.knownMechanical:null,
      kinetic:sums(storage?.mpmKinetic,storage?.mpmAffine,storage?.femKinetic),energy:sums(storage?.mpmElastic,storage?.femElastic),potential:storage?.mpmPotential??null,
      initialEnergy:active?energy.initial:null,externalWork:active?energy.externalWork:null,thermalWork:active?energy.thermalWork:null,dissipated:active?energy.physical?.total??null:null,numericalWork:active?energy.numerical?.total??null:null,
      energyResidual:complete?energy.unexplainedResidual:null,rawEnergyResidual:complete?energy.rawResidual:null,energyScope:energy?.scope??'gpu-mechanical-ledger-unavailable',energyComplete:complete,knownMechanicalResidual:active?energy.knownUnexplainedResidual??null:null,
      thermalResidual:g.thermal.residual,externalHeat:g.thermal.externalHeat,generatedHeat:g.thermal.generatedHeat,generated:g.thermal.generated,plasticWork:g.thermal.plasticWork,frictionLoss:g.thermal.frictionLoss};f.results.contactPairs=g.contactPairs;
    const result={...f,particles:g.particles,particleRadius:project.discretization.mpm.cellSize/project.discretization.mpm.particlesPerAxis*.35,particleColorMode:'temperature',thermal:g.thermal,thermalLoads:g.thermalLoads,contactPairs:g.contactPairs,
      coupling:{...g.part,meanTemperature:g.part.temperature,thermalResidual:g.thermal.residual},
      mixed:{scheme:'resident-mpm-fem/6',thermalMode:'coupled',backend:g.backend,clock:g.clock,contactSafety:g.contactSafety,energy,performance:g.performance,steps:g.clock.steps,solveMs:g.performance.solverMs,energyNote:energy?.enabled?'GPU 逐子步记录可恢复机械能、外力功、耗散及数值做功；温度参数功与热量 Q 分开，热弹性反馈仍为弱耦合。覆盖范围与缺项见能量账本。':'本次未记录 GPU 机械能账本；塑性功、摩擦损失及转热仍单独记录。'}};
    if(isFourGPU(project)){
      if(!g.four||g.bodies?.length!==1||g.particleParts?.length!==2)throw Error('GPU 四方法帧缺少部件状态');
      const b=g.bodies[0];if([b.position,b.velocity,b.angularVelocity,b.rotation].some((v,i)=>!Array.isArray(v)||v.length!==(i===3?4:3)||v.some(x=>!Number.isFinite(x)))||!Number.isFinite(b.temperature)||!Number.isFinite(b.kinetic))throw Error('GPU 刚体状态格式无效');
      result.bodies=g.bodies;result.results.parts=result.results.parts.filter(b=>b.method==='fem').concat(g.particleParts,g.bodies.map(b=>({id:b.id,method:'rigid',values:b})));
      result.fem.dynamics.rigidKinetic=g.bodies.reduce((s,b)=>s+b.kinetic,0);result.fem.dynamics.contactEnergy=null;result.fem.dynamics.contactDissipated=null;
      result.mixed.scheme='resident-four-method/1';result.mixed.energyNote='四方法驻留 CUDA；共享时钟，接触与传热双向反馈。完整机械能账本及摩擦转热尚未覆盖，热量收支单独记录。';
      result.mixed.framework=g.framework??null;
    }
    return result;
}
let transport;
export async function createMixedGPU(input){
  const project=validateMixedGPU(input),port=project.solver.mixedGpuPort;
  if(!transport||transport.closed||transport.port!==port)transport=new MixedTransport(port);
  const client=transport,local=new FEMDynamicSimulation(projectDomains(project).fem);
  // This object is used solely for result recovery at display frames. step()
  // and advanceShared() are never called; all physics is owned by Taichi.
  const convert=g=>convertMixedGPUFrame(project,local,g);
  let frame;try{
    await client.ready;
    requireMixedMaterialFeatures(project,client.features);
    if(isFourGPU(project)&&!client.features.includes(FOUR_GPU_FEATURE))throw Error('当前服务不支持四方法 GPU，请启动更新后的 start-mixed-gpu.ps1 -Port 8796。');
    frame=convert(await client.request('init',{project}));
  }catch(e){local.free();throw e;}
  const generation=++client.generation;
  const runtime={async:true,time:0,editorModel:toLegacy(projectDomains(project).particles),snapshot:()=>frame,
    async step(dt){frame=convert(await client.request('advance',{dt}));runtime.time=frame.time;return frame;},free(){local.free();if(generation===client.generation)client.fail('混合 GPU 会话已关闭');}};
  return runtime;
}
