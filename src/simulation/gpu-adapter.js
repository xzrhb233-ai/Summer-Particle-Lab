import {MAX_COUPLED_PARTICLES} from '../multibody/coupling-model.js';
import {validateGpuProject,GPU_PROJECT_FEATURE} from './gpu-contract.js';
import {thermalCommand} from './thermal-command.js';
import {isThermalLoad} from './thermal-loads.js';

// Dedicated unified-project protocol. A pure-particle GPU server must never be
// accepted as a coupled solver merely because it uses the same websocket port.
export class ProjectTransport {
  constructor(port,Socket=WebSocket){
    this.port=port;this.socket=new Socket(`ws://127.0.0.1:${port}`);this.socket.binaryType='arraybuffer';
    this.pending=new Map();this.next=1;this.generation=0;this.closed=false;
    this.ready=new Promise((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;});
    this.ready.catch(()=>{});
    this.readyTimer=setTimeout(()=>this.fail('GPU 项目服务未响应。请运行 start-project-gpu.ps1。'),12000);
    this.socket.onmessage=event=>{try{this.receive(event.data);}catch(e){this.fail(e.message);}};
    this.socket.onerror=()=>this.fail('无法连接 GPU 项目服务。请运行 start-project-gpu.ps1，并检查端口。');
    this.socket.onclose=()=>this.fail('GPU 项目连接已断开，求解已停止；可重新连接或切换 CPU。');
  }
  receive(packet){
    if(typeof packet==='string'){
      const d=JSON.parse(packet);
      if(d.type==='ready'){
        if(!d.features?.includes(GPU_PROJECT_FEATURE)||!['cuda','vulkan'].includes(d.backend?.arch))throw Error('GPU 项目服务版本不兼容，需要 V11 接触对与热耦合协议；请重启新版 start-project-gpu.ps1 并核对端口。');
        clearTimeout(this.readyTimer);this.backend=d.backend;this.features=d.features;this.resolveReady(d.backend);
      }else if(d.type==='error')throw Error(d.message);
      else if(d.type==='operation'){const p=this.pending.get(d.id);if(p){this.pending.delete(d.id);clearTimeout(p.timer);p.reject(Error(d.message));}}
      return;
    }
    if(!(packet instanceof ArrayBuffer)||packet.byteLength<4)throw Error('无效 GPU 项目帧');
    const length=new DataView(packet).getUint32(0,true),offset=4+Math.ceil(length/4)*4;
    if(length>packet.byteLength-4||length>1_000_000)throw Error('无效 GPU 项目帧头');
    const d=JSON.parse(new TextDecoder().decode(new Uint8Array(packet,4,length)));
    if(d.type!=='frame'||!Number.isInteger(d.count)||d.count<1||d.count>MAX_COUPLED_PARTICLES||offset+d.count*32!==packet.byteLength||!Number.isFinite(d.frame?.time)||!Array.isArray(d.frame.bodies))throw Error('无效 GPU 项目结果');
    const p=this.pending.get(d.id);if(!p)return;
    const particles=new Float32Array(packet,offset,d.count*8);if(particles.some(x=>!Number.isFinite(x)))throw Error('GPU 粒子包含非有限数值');
    this.pending.delete(d.id);clearTimeout(p.timer);p.resolve({...d.frame,particles});
  }
  async request(type,fields={}){
    await this.ready;if(this.closed)throw Error('GPU 项目连接已关闭');
    const id=this.next++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail('GPU 求解响应超时，连接已关闭。首次编译后可重新连接。'),180000);
      this.pending.set(id,{resolve,reject,timer});
      try{this.socket.send(JSON.stringify({type,id,...fields}));}catch(e){this.fail(e.message);}
    });
  }
  fail(message){
    if(this.closed)return;this.closed=true;clearTimeout(this.readyTimer);const error=Error(message);this.rejectReady(error);
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.socket.close();
  }
  close(){this.fail('GPU 项目会话已关闭');}
}

export function gpuCoupledAdapter(Socket=undefined){
  let transport=null;
  return {id:'taichi-coupled',asynchronous:true,methods:['rigid','mpm','pbf'],fields:['motion','temperature'],normalize:validateGpuProject,
    async create(project){
      const port=project.solver.gpuPort;
      const client=!transport||transport.closed||transport.port!==port?new ProjectTransport(port,Socket):transport;
      let initial;try{await client.ready;if(project.loads.some(isThermalLoad)&&!client.features?.includes('partThermalLoadsV1'))throw Error('GPU 服务尚不支持部件热载荷，请重启新版 start-project-gpu.ps1；当前项目未被替换');initial=await client.request('init',{project});}catch(e){if(client!==transport)client.close();throw e;}
      if(transport!==client)transport?.close();transport=client;const generation=++client.generation;
      const appearances=new Map(project.parts.filter(p=>p.method==='rigid').map(p=>{
        const display=structuredClone(p.geometry.appearance);if(display){for(const s of display){Object.freeze(s.position);Object.freeze(s.size);Object.freeze(s.rotation);Object.freeze(s);}Object.freeze(display);}return [p.id,display];
      }));
      const decorate=f=>{for(const b of f.bodies)b.appearance=appearances.get(b.id)??null;return f;};
      let frame=decorate(initial),queue=Promise.resolve();
      const enqueue=action=>{
        const next=queue.then(()=>{if(client.generation!==generation||client.closed)throw Error('GPU 会话已被替换或关闭');return action();});
        queue=next.catch(()=>{});return next;
      };
      return {async:true,get project(){return project;},get time(){return frame.time;},snapshot:()=>frame,
        step(dt){return enqueue(async()=>{frame=decorate(await client.request('step',{dt}));return frame;});},
        command(command){return enqueue(async()=>{
          const next=thermalCommand(project,command);
          const updated=await client.request('command',{command});
          project=next;frame=decorate(updated);return frame;
        });},
        free(){if(client.generation===generation)client.close();},
      };
    },
  };
}
