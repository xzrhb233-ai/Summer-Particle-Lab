import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const worker=readFileSync(new URL('../src/three/gpu-worker.js',import.meta.url),'utf8');
function connect(features,port,requireSolidSampling=false,requireDiscretization=false){
  const messages=[],sent=[],urls=[];let socket;
  class WebSocket {
    static OPEN=1;
    constructor(url){socket=this;this.readyState=1;urls.push(url);}
    send(value){sent.push(JSON.parse(value));}
    close(){this.readyState=3;}
  }
  const self={postMessage:message=>messages.push(message)};
  vm.runInNewContext(worker,{self,WebSocket});
  self.onmessage({data:{type:'init',scene:'melting',...(port===undefined?{}:{port}),...(requireSolidSampling?{requireSolidSampling}:{}),...(requireDiscretization?{requireDiscretization}:{})}});
  assert.equal(sent.length,0,'initialization must wait for capability negotiation');
  socket?.onmessage({data:JSON.stringify({type:'ready',backend:{arch:'cuda',device:'test'},features})});
  return {messages,sent,socket,urls,self};
}
test('GPU phase experiments reject the previous service even if it already supports melting',()=>{
  for(const features of [[],['customPhaseChange']]){
    const result=connect(features);assert.equal(result.sent.length,0);
    assert.ok(result.messages.some(m=>m.type==='backend-error'&&m.message.includes('稳定相变')));
    assert.equal(result.socket.readyState,3);
  }
});
test('GPU phase experiments start after the stable-handoff capability is advertised',()=>{
  const result=connect(['customPhaseChange','stablePhaseHandoff']);
  assert.deepEqual(result.sent,[{type:'init',scene:'melting'}]);assert.equal(result.socket.readyState,1);
  assert.ok(!result.messages.some(m=>m.type==='backend-error'));
});
test('separate GPU endpoints stay on loopback and validate the allowed service ports',()=>{
  const features=['customPhaseChange','stablePhaseHandoff'];
  assert.deepEqual(connect(features).urls,['ws://127.0.0.1:8765']);
  for(const port of [8766,8799])assert.deepEqual(connect(features,port).urls,[`ws://127.0.0.1:${port}`]);
  for(const port of [0,8764,8800,8766.5,'8766','evil.example',Infinity]){
    const result=connect(features,port);assert.deepEqual(result.urls,[]);
    assert.ok(result.messages.some(m=>m.type==='backend-error'&&m.message.includes('端口')));
  }
});
test('a stopped GPU transport rejects subsequent geometry commands',()=>{
  const result=connect(['customPhaseChange','stablePhaseHandoff'],8766),count=result.sent.length;
  result.socket.onmessage({data:JSON.stringify({type:'error',message:'GPU 正被另一个标签页使用。请关闭该 GPU 页面，或切换到 CPU。'})});
  result.self.onmessage({data:{type:'geometry',a:[0,0,0],b:[4,4,4]}});
  assert.equal(result.sent.length,count);assert.equal(result.socket.readyState,3);
  assert.ok(result.messages.some(m=>m.type==='backend-error'));
});
test('updated pages require solid sampling support before resetting an older GPU service',()=>{
  const old=connect(['customPhaseChange','stablePhaseHandoff'],8766,true);
  assert.equal(old.sent.length,0);assert.ok(old.messages.some(m=>m.type==='backend-error'&&m.message.includes('固体采样')));
  const current=connect(['customPhaseChange','stablePhaseHandoff','solidSampling'],8767,true);
  assert.equal(current.sent[0].type,'init');assert.ok(!current.messages.some(m=>m.type==='backend-error'));
});
test('domain controls require the updated GPU grid and geometry implementation',()=>{
  const features=['customPhaseChange','stablePhaseHandoff','solidSampling'];
  const old=connect(features,8767,true,true);assert.equal(old.sent.length,0);assert.ok(old.messages.some(m=>m.type==='backend-error'&&m.message.includes('网格设置')));
  const current=connect([...features,'discretization'],8768,true,true);assert.equal(current.sent[0].type,'init');assert.ok(!current.messages.some(m=>m.type==='backend-error'));
});
