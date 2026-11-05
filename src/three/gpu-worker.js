// Native Taichi service owns physics; this worker only transports frames/commands.
let socket,queue=[],failed=false,ready=false,phaseSupported=false,solidSamplingSupported=false,discretizationSupported=false,lastScene='coupled';
function fail(message){if(failed)return;failed=true;self.postMessage({type:'backend-error',message});socket?.close();}
function forward(data){
  if(failed)return;
  const needsPhase=(['init','reset'].includes(data.type)&&data.scene==='melting')||(['box','geometry'].includes(data.type)&&data.phaseChange?.enabled);
  if(needsPhase&&!phaseSupported){
    const message='当前 GPU 服务尚未加载稳定相变修复。请重启 start-gpu.ps1，或使用 CPU 后端。';
    if(data.type==='init')fail(message);
    else self.postMessage({type:['box','geometry'].includes(data.type)?'created':'operation',ok:false,message,scene:data.type==='reset'?lastScene:undefined});
    return;
  }
  if(data.type==='init'&&data.requireSolidSampling&&!solidSamplingSupported){
    fail('当前 GPU 服务尚未加载固体采样稳定化。请启动新版 start-gpu.ps1；保留旧实验时请使用另一个端口。');return;
  }
  if(data.type==='init'&&data.requireDiscretization&&!discretizationSupported){fail('当前 GPU 服务尚未加载精确建模与网格设置。请启动新版 start-gpu.ps1；保留旧实验时请使用另一个端口。');return;}
  if(['init','reset'].includes(data.type))lastScene=data.scene;
  socket.send(JSON.stringify(data));
}
self.onmessage=({data})=>{
  if(data.type==='ack'){if(socket?.readyState===WebSocket.OPEN)socket.send('{"type":"ack"}');return;}
  if(data.type==='init'&&!socket){
    const port=data.port??8765;
    if(!Number.isInteger(port)||port<8765||port>8799){fail('GPU 服务端口必须是 8765–8799 之间的整数。');return;}
    self.postMessage({type:'backend-status',message:'正在连接本机 Taichi GPU 服务…'});
    socket=new WebSocket(`ws://127.0.0.1:${port}`);socket.binaryType='arraybuffer';
    socket.onmessage=({data:packet})=>{
      try{
        if(typeof packet==='string'){
          const d=JSON.parse(packet);
          if(d.type==='error'){fail(d.message);return;}
          if(d.type==='ready'){ready=true;discretizationSupported=!!d.features?.includes('discretization');solidSamplingSupported=!!d.features?.includes('solidSampling');phaseSupported=!!(d.features?.includes('customPhaseChange')&&d.features?.includes('stablePhaseHandoff'));self.postMessage({type:'backend-status',message:`Taichi ${d.backend.arch.toUpperCase()} · ${d.backend.device}`});for(const command of queue)forward(command);queue=[];}
          else self.postMessage(d);
          return;
        }
        const length=new DataView(packet).getUint32(0,true),offset=4+Math.ceil(length/4)*4;
        if(length>packet.byteLength-4)throw Error('无效帧头');
        const state=JSON.parse(new TextDecoder().decode(new Uint8Array(packet,4,length)));
        const rendered=state.renderCount??state.count;
        if(!Number.isInteger(state.count)||!Number.isInteger(rendered)||rendered<0||rendered>state.count||state.count<0||state.count>state.capacity||offset+rendered*32!==packet.byteLength)throw Error('无效粒子帧');
        state.data=new Float32Array(packet,offset,rendered*8);
        self.postMessage(state,[packet]);
      }catch(e){fail('无法读取 GPU 帧：'+e.message);}
    };
    socket.onerror=()=>fail('无法连接 Taichi 服务。请运行 start-gpu.ps1，等待 GPU READY 后重新连接。CPU 模式仍可用。');
    socket.onclose=()=>{if(!failed)fail(ready?'Taichi 服务连接已断开，模拟已停止。可重新连接或切换 CPU。':'Taichi 服务尚未就绪，请等待 GPU READY 后重新连接。');};
  }
  if(!failed){if(ready&&socket?.readyState===WebSocket.OPEN)forward(data);else queue.push(data);}
};
