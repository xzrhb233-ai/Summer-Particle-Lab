import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once,EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {apiEndpoint,isPublicAPIAddress,createAPILookup,requestAPI,createAIHandler,startAI} from '../ai-server.mjs';
import {runCAD,cadWorkerEnvironment,createCADHandler} from '../cad-server.mjs';

const origin='http://127.0.0.1:5173',headers={Origin:origin,'Content-Type':'application/json'};
const aiBody=()=>({baseURL:'https://provider.example/v1',model:'fixture-model',key:'test-only-credential',messages:[{role:'user',content:'inspect project'}],context:{name:'fixture'}});
const reply=()=>new Response(JSON.stringify({choices:[{message:{content:'{"reply":"fixture","commands":[]}'}}]}));
async function serverFor(t,handler){const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));return 'http://127.0.0.1:'+server.address().port;}
const post=(base,path,value,extra={})=>fetch(base+path,{method:'POST',headers,...extra,body:typeof value==='string'?value:JSON.stringify(value)});
const lookup=(fn,host,options={all:true})=>new Promise((resolve,reject)=>fn(host,options,(e,value,family)=>e?reject(e):resolve(options.all?value:{address:value,family})));
function slowUpload(url){
  let outgoing;const response=new Promise((resolve,reject)=>{outgoing=request(url,{method:'POST',headers},incoming=>{const chunks=[];incoming.on('data',c=>chunks.push(c));incoming.on('end',()=>resolve({status:incoming.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));});outgoing.on('error',reject);outgoing.flushHeaders();outgoing.write('{');});
  return {request:outgoing,response};
}
function fakeChild(){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=0;child.kill=()=>{child.killed++;queueMicrotask(()=>child.emit('close',null));return true;};return child;
}
test('AI standalone startup remains bound to IPv4 loopback',async t=>{
  const server=startAI(0);await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));assert.equal(server.address().address,'127.0.0.1');
});
test('remote endpoints reject internal, metadata, multicast, mapped and reserved addresses',()=>{
  for(const address of ['0.0.0.0','10.0.0.1','100.64.1.1','169.254.169.254','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::ffff:192.168.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1','2002:a00:1::1','3fff::1']){
    assert.equal(isPublicAPIAddress(address),false,address);assert.throws(()=>apiEndpoint('https://'+(address.includes(':')?'['+address+']':address)+'/v1'));
  }
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(isPublicAPIAddress(address),true,address);
  for(const host of ['localhost','127.0.0.1','[::1]'])assert.match(apiEndpoint('http://'+host+':11434/v1'),/chat\/completions$/);
  assert.throws(()=>apiEndpoint('http://10.0.0.1/v1'));assert.throws(()=>apiEndpoint('https://user:credential@provider.example/v1'));
});
test('socket DNS lookup rejects private answers and pins the exact checked public results',async()=>{
  for(const addresses of [[{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],[{address:'::ffff:169.254.169.254',family:6}]]){
    const fn=createAPILookup((host,options,done)=>done(null,addresses));await assert.rejects(lookup(fn,'provider.example'),e=>e.code==='API_ADDRESS_BLOCKED');
  }
  let resolutions=0;const addresses=[{address:'8.8.8.8',family:4},{address:'2606:4700::1111',family:6}],fn=createAPILookup((host,options,done)=>{resolutions++;done(null,resolutions===1?addresses:[{address:'10.0.0.1',family:4}]);});
  assert.deepEqual(await lookup(fn,'provider.example'),addresses);assert.equal(resolutions,1);
  const local=createAPILookup(()=>{throw Error('localhost must not consult DNS');});assert.deepEqual(await lookup(local,'localhost',{family:6,all:true}),[{address:'::1',family:6}]);
});
test('default native transport preserves local model requests and never follows redirects',async t=>{
  const seen=[],target=await serverFor(t,async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push({url:req.url,authorization:req.headers.authorization,encoding:req.headers['accept-encoding'],body});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true}));});
  const options={method:'POST',headers:{Authorization:'Bearer test-only-credential','Content-Type':'application/json'},body:'{"model":"fixture"}',signal:new AbortController().signal};
  const result=await requestAPI(apiEndpoint(target+'/v1'),options);assert.equal(result.status,200);for await(const chunk of result.body){}assert.equal(seen[0].url,'/v1/chat/completions');assert.equal(seen[0].authorization,options.headers.Authorization);assert.equal(seen[0].encoding,'identity');
  const redirect=await serverFor(t,(req,res)=>res.writeHead(302,{Location:target+'/must-not-follow'}).end());const denied=await requestAPI(apiEndpoint(redirect),options);for await(const chunk of denied.body){}assert.equal(denied.status,302);assert.equal(seen.length,1);
});
test('AI request boundary denies foreign/null/missing origins, simple MIME, and unexpected commands',async t=>{
  let calls=0;const base=await serverFor(t,createAIHandler({fetcher:async()=>{calls++;return reply();}}));
  for(const bad of ['https://evil.example','null','http://127.0.0.1:5173.evil.example'])assert.equal((await post(base,'/chat',aiBody(),{headers:{...headers,Origin:bad}})).status,403);
  assert.equal((await post(base,'/chat',aiBody(),{headers:{'Content-Type':'application/json'}})).status,403);
  for(const mime of ['text/plain','application/jsonp'])assert.equal((await post(base,'/chat',aiBody(),{headers:{...headers,'Content-Type':mime}})).status,415);
  assert.equal((await post(base,'/chat',{...aiBody(),script:'arbitrary'})).status,400);assert.equal(calls,0);
  const response=await post(base,'/chat',aiBody());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(calls,1);
});
test('AI limits request/response bytes and keeps credentials out of upstream bodies and errors',async t=>{
  let sent,large=false;const base=await serverFor(t,createAIHandler({fetcher:async(url,options)=>{sent=options;if(large)return new Response('x'.repeat(120001));throw Error('test-only-credential in a transport failure');}}));
  let response=await post(base,'/chat',' '.repeat(350001));assert.equal(response.status,413);assert.equal(sent,undefined);
  response=await post(base,'/chat',aiBody());assert.equal(response.status,502);assert.equal((await response.text()).includes('test-only-credential'),false);assert.equal(sent.body.includes('test-only-credential'),false);assert.equal(sent.headers.Authorization,'Bearer test-only-credential');
  large=true;response=await post(base,'/chat',aiBody());assert.equal((await response.json()).code,'BODY_TOO_LARGE');
});
test('AI deadline interrupts stalled uploads and releases its concurrency slots',async t=>{
  const base=await serverFor(t,createAIHandler({timeout:100,fetcher:async()=>reply()})),a=slowUpload(base+'/chat'),b=slowUpload(base+'/chat');
  t.after(()=>{a.request.destroy();b.request.destroy();});
  assert.equal((await post(base,'/chat',aiBody())).status,429);
  const outcomes=await Promise.all([a.response,b.response]);assert.ok(outcomes.every(r=>r.status===408));
  assert.equal((await post(base,'/chat',aiBody())).status,200);
});
test('AI deadline cancels an upstream response that never finishes',async t=>{
  let cancelled=0;const base=await serverFor(t,createAIHandler({timeout:50,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled++;}}))}));
  const r=await post(base,'/chat',aiBody());assert.equal(r.status,502);assert.equal((await r.json()).code,'REQUEST_TIMEOUT');assert.equal(cancelled,1);
});
test('CAD child launch rejects client paths/scripts before spawning and inherits no credential variables',async()=>{
  let spawned=0;for(const data of [{action:'exec',code:'malicious'},{action:'export',recipe:[],path:'C:/private'},{action:'health',key:'test-only-credential'},{action:'build',recipe:[],extra:'x'}])await assert.rejects(runCAD(data,{spawnProcess:()=>{spawned++;return fakeChild();}}),/Invalid CAD request/);
  assert.equal(spawned,0);
  const env=cadWorkerEnvironment({SystemRoot:'C:/Windows',PATH:'fixture-path',TEMP:'fixture-temp',OPENAI_API_KEY:'test-only-credential',HTTPS_PROXY:'credential-proxy',PYTHONPATH:'untrusted',NODE_OPTIONS:'untrusted'});assert.equal(env.SystemRoot,'C:/Windows');assert.equal(env.PATH,'fixture-path');assert.equal(env.PYTHONNOUSERSITE,'1');assert.equal(JSON.stringify(env).includes('credential'),false);assert.equal(env.PYTHONPATH,undefined);
  const unread=Object.defineProperty({PATH:'fixture'},'API_KEY',{enumerable:true,get(){throw Error('Credential value must not be read');}});assert.deepEqual(cadWorkerEnvironment(unread).PATH,'fixture');
});
test('CAD process cancellation, deadlines and output caps terminate the child',async()=>{
  for(const mode of ['cancel','timeout','output']){
    const child=fakeChild(),controller=new AbortController();const result=runCAD({action:'health'},{spawnProcess:()=>child,timeout:mode==='timeout'?20:45000,signal:controller.signal});
    if(mode==='cancel')controller.abort();if(mode==='output')child.stdout.write(Buffer.alloc(16_000_001));
    await assert.rejects(result,e=>['CAD_CANCELLED','CAD_TIMEOUT','CAD_OUTPUT'].includes(e.code));assert.equal(child.killed,1);
  }
  const abort=new AbortController();abort.abort();let spawned=false;await assert.rejects(runCAD({action:'health'},{signal:abort.signal,spawnProcess:()=>{spawned=true;}}),/取消/);assert.equal(spawned,false);
});
test('CAD successful process contract uses a fixed executable, worker, shell=false and bounded JSON',async()=>{
  const child=fakeChild();let launch;const result=runCAD({action:'health'},{spawnProcess:(executable,args,options)=>{launch={executable,args,options};return child;}});
  child.stdout.write('SUMMER_CAD_RESULT='+JSON.stringify({ok:true,result:{ready:true}}));child.emit('close',0);assert.deepEqual(await result,{ready:true});
  assert.match(launch.executable,/\.venv-cad/);assert.equal(launch.args.length,1);assert.match(launch.args[0],/cad[\\/]worker\.py$/);assert.equal(launch.options.shell,false);assert.equal(launch.options.windowsHide,true);
  await assert.rejects(runCAD({action:'curve',spec:{padding:'x'.repeat(64000)}}),/容量/);await assert.rejects(runCAD({action:'health'},{timeout:Infinity}),/timeout/);
});
test('CAD HTTP errors never echo arbitrary runner/native stderr details',async t=>{
  let calls=0;const base=await serverFor(t,createCADHandler({runner:async()=>{calls++;throw Error('test-only-credential C:/private/source');}}));
  for(const bad of ['null','https://evil.example'])assert.equal((await post(base,'/api/cad',{action:'health'},{headers:{...headers,Origin:bad}})).status,403);
  assert.equal((await post(base,'/api/cad',{action:'health'},{headers:{...headers,'Content-Type':'text/plain'}})).status,415);
  assert.equal((await post(base,'/api/cad',{action:'export',recipe:[],path:'C:/private'})).status,400);assert.equal(calls,0);
  const response=await post(base,'/api/cad',{action:'health'}),text=await response.text();assert.equal(response.status,400);assert.equal(text.includes('test-only-credential'),false);assert.equal(text.includes('C:/private'),false);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});
test('CAD stalled body and ignored runner cancellation cannot hold the busy slot forever',async t=>{
  let hung=false;const base=await serverFor(t,createCADHandler({timeout:80,runner:async()=>hung?new Promise(()=>{}):{ready:true}})),slow=slowUpload(base+'/api/cad');t.after(()=>slow.request.destroy());
  assert.equal((await post(base,'/api/cad',{action:'health'})).status,409);assert.equal((await slow.response).status,408);
  hung=true;assert.equal((await post(base,'/api/cad',{action:'health'})).status,408);hung=false;assert.equal((await post(base,'/api/cad',{action:'health'})).status,200);
});
test('CAD client disconnect aborts native work and allows a later request',async t=>{
  let started,aborted;const start=new Promise(r=>started=r),abort=new Promise(r=>aborted=r);let calls=0;
  const base=await serverFor(t,createCADHandler({runner:async(data,{signal})=>{if(++calls>1)return {ready:true};started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(Error('cancelled'));},{once:true}));}}));
  const outgoing=request(base+'/api/cad',{method:'POST',headers});outgoing.on('error',()=>{});outgoing.end(JSON.stringify({action:'health'}));await start;outgoing.destroy();await abort;
  assert.equal((await post(base,'/api/cad',{action:'health'})).status,200);
});
